/**
 * src/utils/recurringSchedule.js
 *
 * Recurring donation date math, mirrored 1:1 from
 * frontend/lib/monthlyGiving.ts. See docs/monthly-giving-scheduling.md for
 * the full rationale. Summary:
 *
 * - Donor-local calendar semantics: a subscription "fires" on the donor's
 *   local calendar day, not a fixed UTC instant. Every subscription carries
 *   an immutable `anchorDay` (1-31, the day the donor originally picked) and
 *   an IANA `timeZone`. Every cycle's charge instant is (re)derived from
 *   those two, never from the previous cycle's already-computed date.
 * - Month-length clamping: if the target month is shorter than `anchorDay`,
 *   we clamp to the LAST day of that month. The clamp is always computed
 *   from the original `anchorDay` — never from a previous cycle's clamped
 *   day — otherwise a Jan 31 subscription would permanently degrade to the
 *   29th after passing through one February.
 * - DST: local wall-clock -> UTC instant conversion is delegated to
 *   `date-fns-tz`, which resolves nonexistent/ambiguous local times via the
 *   IANA tz database instead of hand-rolled arithmetic.
 *
 * IMPORTANT date-fns-tz v3 footgun (see inline comments below): its
 * `fromZonedTime`/`toZonedTime` helpers only behave in a host-timezone
 * independent way when you feed/read them as strings, not `Date` objects —
 * reading a `toZonedTime(...)` result with `getUTC*()` getters (or building
 * a "wall clock" via `Date.UTC(...)` and handing it to `fromZonedTime`)
 * silently uses the *process's own* local timezone and produces wrong
 * answers whenever the server isn't running with TZ=UTC. Every function
 * here is written to avoid that trap.
 *
 * This module is intentionally dependency-free of any Express/DB code so it
 * can be unit tested in isolation and imported by both the (future) charge
 * executor and backend/src/scripts/reconcile-subscriptions.js.
 */
"use strict";

const { formatInTimeZone, fromZonedTime } = require("date-fns-tz");

/** Fixed local hour (24h, donor-local) subscriptions are scheduled to charge at. */
const CHARGE_LOCAL_HOUR = 9;

/** Fallback timezone for legacy records created before `timeZone` was tracked. */
const DEFAULT_TIME_ZONE = "UTC";

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

/** Number of days in `year`/`monthIndex0` (0-11), using proper Gregorian leap-year rules. */
function daysInMonth(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** Clamp `day` to the last valid day of `year`/`monthIndex0` if it overflows (e.g. 31 -> 28/29/30). */
function clampDayToMonth(year, monthIndex0, day) {
  return Math.min(day, daysInMonth(year, monthIndex0));
}

/** Read the donor-local (year, monthIndex0) that `instantIso` falls on within `timeZone`. */
function getZonedYearMonth(instantIso, timeZone) {
  const [year, month] = formatInTimeZone(new Date(instantIso), timeZone, "yyyy-MM")
    .split("-")
    .map(Number);
  return { year, month: month - 1 };
}

/** Build the UTC instant corresponding to a donor-local wall-clock date/time. */
function buildZonedInstant(year, monthIndex0, day, timeZone, hour = CHARGE_LOCAL_HOUR) {
  const naiveLocal = `${pad(year, 4)}-${pad(monthIndex0 + 1)}-${pad(day)}T${pad(hour)}:00:00`;
  return fromZonedTime(naiveLocal, timeZone);
}

/**
 * Parse a "YYYY-MM-DD" (or full ISO) date-only string into its calendar
 * components without routing through a UTC/local `Date` parse.
 */
function parseCalendarDate(dateOnly) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly);
  if (!match) {
    const d = new Date(dateOnly);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
  }
  const [, y, m, d] = match;
  return { year: Number(y), month: Number(m) - 1, day: Number(d) };
}

/**
 * Compute the first `nextDueDate` (UTC instant, ISO string) for a brand new
 * subscription, given the donor-local calendar date they picked and their
 * timezone.
 */
function computeInitialChargeDate(startDate, timeZone) {
  const { year, month, day } = parseCalendarDate(startDate);
  return {
    nextDueDate: buildZonedInstant(year, month, day, timeZone).toISOString(),
    anchorDay: day,
  };
}

/**
 * Compute the next charge date after `fromIso`, advancing `monthsToAdvance`
 * calendar months (donor-local) and clamping to `anchorDay`. Always derives
 * the target day from the immutable `anchorDay`, never from `fromIso`'s
 * (possibly already-clamped) day.
 */
function computeNextChargeDate({ fromIso, anchorDay, timeZone, monthsToAdvance = 1 }) {
  const { year, month } = getZonedYearMonth(fromIso, timeZone);
  const totalMonths = year * 12 + month + monthsToAdvance;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const clampedDay = clampDayToMonth(targetYear, targetMonth, anchorDay);
  return buildZonedInstant(targetYear, targetMonth, clampedDay, timeZone).toISOString();
}

module.exports = {
  CHARGE_LOCAL_HOUR,
  DEFAULT_TIME_ZONE,
  daysInMonth,
  clampDayToMonth,
  computeInitialChargeDate,
  computeNextChargeDate,
};
