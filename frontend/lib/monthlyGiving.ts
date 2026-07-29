import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { MonthlySubscription } from "@/utils/types";

export const MONTHLY_GIVING_STORAGE_KEY = "greenpay_monthly_subscriptions";

/**
 * Recurring donation date math.
 *
 * See docs/monthly-giving-scheduling.md for the full rationale. Summary:
 *
 * - Donor-local calendar semantics: a subscription "fires" on the donor's
 *   local calendar day, not a fixed UTC instant. We store an immutable
 *   `anchorDay` (1-31, the day the donor originally picked) and an IANA
 *   `timeZone` alongside the subscription, and compute a concrete UTC instant
 *   (`nextDueDate`) from those two on every cycle.
 * - Month-length clamping: if the target month is shorter than `anchorDay`
 *   (e.g. anchor 31 in a 30-day month, or 31/30/29 in February), we clamp to
 *   the LAST day of that month. Critically, the clamp is always computed
 *   from the original `anchorDay`, never from the previous cycle's
 *   (possibly-clamped) date — otherwise a Jan 31 subscription would degrade
 *   to the 29th forever after passing through February. This exact function
 *   (and its constants) is mirrored in backend/src/utils/recurringSchedule.js
 *   so the frontend's displayed "next charge date" and the backend's
 *   execution/reconciliation logic can never disagree.
 * - DST: local wall-clock -> UTC instant conversion is delegated to
 *   `date-fns-tz`, which resolves nonexistent (spring-forward) and ambiguous
 *   (fall-back) local times deterministically using the IANA tz database,
 *   so we never hand-roll DST arithmetic.
 */

/** Fixed local hour (24h, donor-local) subscriptions are scheduled to charge at. */
export const CHARGE_LOCAL_HOUR = 9;

/** Fallback timezone for legacy records created before `timeZone` was tracked. */
export const DEFAULT_TIME_ZONE = "UTC";

/** Number of days in `year`/`monthIndex0` (0-11), using proper Gregorian leap-year rules. */
export function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** Clamp `day` to the last valid day of `year`/`monthIndex0` if it overflows (e.g. 31 -> 28/29/30). */
export function clampDayToMonth(year: number, monthIndex0: number, day: number): number {
  return Math.min(day, daysInMonth(year, monthIndex0));
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * Read the donor-local (year, monthIndex0) that `instantIso` falls on within
 * `timeZone`.
 *
 * IMPORTANT: this deliberately goes through `formatInTimeZone` (string
 * formatting) rather than reading a `toZonedTime(...)` Date object's fields.
 * date-fns-tz v3's `toZonedTime` result is only meaningful when read with
 * the process's *local* getters (`getFullYear`/`getHours`/...), not the UTC
 * getters — using UTC getters silently produces the wrong answer whenever
 * the process timezone isn't UTC (e.g. a server running with TZ=Africa/Lagos
 * or any other non-UTC TZ). Formatting to a string sidesteps that footgun
 * entirely and keeps this function's output independent of the host
 * process's timezone.
 */
function getZonedYearMonth(instantIso: string, timeZone: string): { year: number; month: number } {
  const [year, month] = formatInTimeZone(new Date(instantIso), timeZone, "yyyy-MM")
    .split("-")
    .map(Number);
  return { year, month: month - 1 };
}

/**
 * Build the UTC instant corresponding to a donor-local wall-clock date/time.
 *
 * IMPORTANT: we pass `fromZonedTime` a naive ISO string (no "Z"/offset)
 * rather than a `Date` object. Passing a `Date` object causes date-fns-tz to
 * read it back with the process's *local* getters, which — for the same
 * reason as `getZonedYearMonth` above — makes the result depend on the host
 * process's timezone instead of only on `timeZone`. A plain wall-clock
 * string has no such ambiguity.
 */
function buildZonedInstant(
  year: number,
  monthIndex0: number,
  day: number,
  timeZone: string,
  hour: number = CHARGE_LOCAL_HOUR,
): Date {
  const naiveLocal = `${pad(year, 4)}-${pad(monthIndex0 + 1)}-${pad(day)}T${pad(hour)}:00:00`;
  return fromZonedTime(naiveLocal, timeZone);
}

/**
 * Parse a "YYYY-MM-DD" (or full ISO) date-only string into its calendar
 * components without ever routing through a UTC/local `Date` parse, which is
 * where off-by-one-day bugs usually creep in.
 */
function parseCalendarDate(dateOnly: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly);
  if (!match) {
    // Fall back to native parsing for already-full ISO instants.
    const d = new Date(dateOnly);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
  }
  const [, y, m, d] = match;
  return { year: Number(y), month: Number(m) - 1, day: Number(d) };
}

/**
 * Compute the first `nextDueDate` (UTC instant, ISO string) for a brand new
 * subscription, given the donor-local calendar date they picked and their
 * timezone. Returns the anchor day too, since callers need to persist it.
 */
export function computeInitialChargeDate(startDate: string, timeZone: string): {
  nextDueDate: string;
  anchorDay: number;
} {
  const { year, month, day } = parseCalendarDate(startDate);
  return {
    nextDueDate: buildZonedInstant(year, month, day, timeZone).toISOString(),
    anchorDay: day,
  };
}

/**
 * Compute the next charge date after `fromIso`, advancing `monthsToAdvance`
 * calendar months (donor-local) and clamping to `anchorDay` per the rule
 * documented above. Always derives the target day from the immutable
 * `anchorDay`, never from `fromIso`'s (possibly already-clamped) day.
 */
export function computeNextChargeDate(params: {
  fromIso: string;
  anchorDay: number;
  timeZone: string;
  monthsToAdvance?: number;
}): string {
  const { fromIso, anchorDay, timeZone, monthsToAdvance = 1 } = params;
  const { year, month } = getZonedYearMonth(fromIso, timeZone);
  const totalMonths = year * 12 + month + monthsToAdvance;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const clampedDay = clampDayToMonth(targetYear, targetMonth, anchorDay);
  return buildZonedInstant(targetYear, targetMonth, clampedDay, timeZone).toISOString();
}

/** Best-effort browser IANA timezone, falling back to UTC in non-browser environments. */
export function resolveBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/**
 * Backfill `anchorDay`/`timeZone` on subscriptions persisted before those
 * fields existed. Best-effort: derives the anchor day from the currently
 * stored `nextDueDate` (read as a UTC calendar day) and assumes UTC, which
 * matches the exact behavior those legacy records were created with.
 */
function hydrateSubscription(sub: MonthlySubscription): MonthlySubscription {
  if (sub.anchorDay && sub.timeZone) return sub;
  const timeZone = sub.timeZone ?? DEFAULT_TIME_ZONE;
  const anchorDay = sub.anchorDay ?? new Date(sub.nextDueDate || sub.startDate).getUTCDate();
  return { ...sub, anchorDay, timeZone };
}

export function loadMonthlySubscriptions(): MonthlySubscription[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MONTHLY_GIVING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(hydrateSubscription) : [];
  } catch {
    return [];
  }
}

export function saveMonthlySubscriptions(subscriptions: MonthlySubscription[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MONTHLY_GIVING_STORAGE_KEY, JSON.stringify(subscriptions));
}

export function createMonthlySubscription(input: {
  projectId: string;
  projectName: string;
  amountXLM: string;
  startDate: string;
  durationMonths: number | null;
  timeZone?: string;
}) {
  const nowIso = new Date().toISOString();
  const timeZone = input.timeZone ?? resolveBrowserTimeZone();
  const { nextDueDate, anchorDay } = computeInitialChargeDate(input.startDate, timeZone);

  const subscription: MonthlySubscription = {
    id: `sub_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`,
    projectId: input.projectId,
    projectName: input.projectName,
    amountXLM: input.amountXLM,
    startDate: input.startDate,
    durationMonths: input.durationMonths,
    nextDueDate,
    remainingMonths: input.durationMonths,
    status: "active",
    createdAt: nowIso,
    history: [],
    anchorDay,
    timeZone,
  };

  const all = loadMonthlySubscriptions();
  saveMonthlySubscriptions([subscription, ...all]);
  return subscription;
}

export function markMonthlySubscriptionPaid(subscriptionId: string, amountXLM: string) {
  const all = loadMonthlySubscriptions();
  const updated = all.map((sub) => {
    if (sub.id !== subscriptionId || sub.status !== "active") return sub;

    const nextRemaining =
      sub.remainingMonths === null ? null : Math.max(sub.remainingMonths - 1, 0);
    const completed = nextRemaining === 0;
    const nextStatus: MonthlySubscription["status"] = completed ? "completed" : "active";
    const timeZone = sub.timeZone ?? DEFAULT_TIME_ZONE;
    const anchorDay = sub.anchorDay ?? new Date(sub.nextDueDate).getUTCDate();

    return {
      ...sub,
      history: [{ paidAt: new Date().toISOString(), amountXLM }, ...sub.history],
      remainingMonths: nextRemaining,
      status: nextStatus,
      nextDueDate: completed
        ? sub.nextDueDate
        : computeNextChargeDate({ fromIso: sub.nextDueDate, anchorDay, timeZone, monthsToAdvance: 1 }),
      anchorDay,
      timeZone,
    };
  });
  saveMonthlySubscriptions(updated);
}

export function getDueMonthlySubscriptions() {
  const now = new Date();
  return loadMonthlySubscriptions().filter((sub) => {
    if (sub.status !== "active") return false;
    return new Date(sub.nextDueDate).getTime() <= now.getTime();
  });
}
