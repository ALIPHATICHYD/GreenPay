import fc from "fast-check";
import { formatInTimeZone } from "date-fns-tz";
import {
  CHARGE_LOCAL_HOUR,
  clampDayToMonth,
  computeInitialChargeDate,
  computeNextChargeDate,
  daysInMonth,
} from "@/lib/monthlyGiving";

// At least one DST zone (spring-forward/fall-back), one non-DST control zone,
// and a second DST zone with different transition dates than the US.
const TIME_ZONES = ["America/New_York", "Asia/Kolkata", "Europe/London"];

// Deliberately string-based (not `toZonedTime(...).getUTC*()`) so these
// assertions are independent of the test runner's own process timezone —
// see the comments in monthlyGiving.ts on why that matters with date-fns-tz.
function zonedYearMonthDay(iso: string, timeZone: string) {
  const [year, month, day] = formatInTimeZone(new Date(iso), timeZone, "yyyy-MM-dd")
    .split("-")
    .map(Number);
  return { year, month: month - 1, day };
}

// These exact vectors are also asserted in
// backend/src/utils/recurringSchedule.test.js's "cross-implementation
// agreement" fixtures. If a future change to either side's date math causes
// them to diverge, one of the two test suites will fail — that's the point:
// the frontend's displayed "next charge date" and the backend's execution
// logic must never disagree.
describe("computeNextChargeDate - cross-implementation agreement fixtures", () => {
  it.each([
    ["2024-01-31", "UTC", "2024-01-31T09:00:00.000Z", "2024-02-29T09:00:00.000Z"],
    ["2024-01-31", "America/New_York", "2024-01-31T14:00:00.000Z", "2024-02-29T14:00:00.000Z"],
    ["2024-01-31", "Asia/Kolkata", "2024-01-31T03:30:00.000Z", "2024-02-29T03:30:00.000Z"],
    ["2023-01-31", "UTC", "2023-01-31T09:00:00.000Z", "2023-02-28T09:00:00.000Z"],
  ])("startDate=%s timeZone=%s", (startDate, timeZone, expectedInitial, expectedNext) => {
    const initial = computeInitialChargeDate(startDate, timeZone);
    expect(initial.nextDueDate).toBe(expectedInitial);
    const next = computeNextChargeDate({
      fromIso: initial.nextDueDate,
      anchorDay: initial.anchorDay,
      timeZone,
      monthsToAdvance: 1,
    });
    expect(next).toBe(expectedNext);
  });
});

describe("daysInMonth / clampDayToMonth", () => {
  it("knows February's length for leap and non-leap years", () => {
    expect(daysInMonth(2024, 1)).toBe(29); // leap
    expect(daysInMonth(2023, 1)).toBe(28); // non-leap
    expect(daysInMonth(2000, 1)).toBe(29); // divisible by 400 -> leap
    expect(daysInMonth(1900, 1)).toBe(28); // divisible by 100 but not 400 -> not leap
  });

  it("clamps day-of-month to the last valid day, never overflowing into the next month", () => {
    expect(clampDayToMonth(2024, 1, 31)).toBe(29); // Feb 2024 (leap)
    expect(clampDayToMonth(2023, 1, 31)).toBe(28); // Feb 2023
    expect(clampDayToMonth(2024, 3, 31)).toBe(30); // April
    expect(clampDayToMonth(2024, 0, 31)).toBe(31); // January itself is fine
  });
});

describe("computeNextChargeDate - month-length clamping (property-based)", () => {
  it("never skips a calendar month and always lands on the clamped anchor day", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2019, max: 2031 }),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 28, max: 31 }),
        fc.constantFrom(...TIME_ZONES),
        (year, month, anchorDay, timeZone) => {
          const startDay = clampDayToMonth(year, month, anchorDay);
          const fromIso = computeInitialChargeDate(
            `${year}-${String(month + 1).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`,
            timeZone,
          ).nextDueDate;

          const nextIso = computeNextChargeDate({ fromIso, anchorDay, timeZone, monthsToAdvance: 1 });

          const from = zonedYearMonthDay(fromIso, timeZone);
          const next = zonedYearMonthDay(nextIso, timeZone);

          const expectedMonth = (month + 1) % 12;
          const expectedYear = month === 11 ? year + 1 : year;

          // Never skips (or repeats) a calendar month.
          expect(next.year).toBe(expectedYear);
          expect(next.month).toBe(expectedMonth);

          // Always lands on the correctly clamped day for the target month.
          expect(next.day).toBe(clampDayToMonth(expectedYear, expectedMonth, anchorDay));

          // Monotonic: the next charge is strictly after the previous one
          // (guards against double-charging the same cycle).
          expect(new Date(nextIso).getTime()).toBeGreaterThan(new Date(fromIso).getTime());

          // Sanity bound: a "one calendar month later" instant is always
          // between ~27 and ~32 days away, even accounting for a 1-hour DST
          // shift. A naive bug that jumps 2 months (e.g. Jan 31 -> Mar 3)
          // would blow well past this bound.
          const diffDays = (new Date(nextIso).getTime() - new Date(fromIso).getTime()) / 86_400_000;
          expect(diffDays).toBeGreaterThan(26.9);
          expect(diffDays).toBeLessThan(32.1);
          void from; // referenced for clarity/debugging only
        },
      ),
      { numRuns: 500 },
    );
  });

  it("regression: a day-31 anchor returns to the 31st in every 31-day month, forever (no permanent degradation to 29th)", () => {
    // This is the classic bug: deriving the "day" for the next cycle from
    // the previous (already-clamped) date instead of from an immutable
    // anchor. Jan 31 -> Feb 29 (clamped) -> Mar 29 (WRONG, should be 31).
    const timeZone = "UTC";
    const anchorDay = 31;
    let iso = computeInitialChargeDate("2024-01-31", timeZone).nextDueDate;
    const daysSeen: number[] = [zonedYearMonthDay(iso, timeZone).day];
    for (let i = 0; i < 13; i++) {
      iso = computeNextChargeDate({ fromIso: iso, anchorDay, timeZone, monthsToAdvance: 1 });
      daysSeen.push(zonedYearMonthDay(iso, timeZone).day);
    }
    // Months in order: Jan24(31) Feb24(29,leap) Mar(31) Apr(30) May(31) Jun(30)
    // Jul(31) Aug(31) Sep(30) Oct(31) Nov(30) Dec(31) Jan25(31) Feb25(28,non-leap)
    expect(daysSeen).toEqual([31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31, 28]);
  });
});

describe("computeNextChargeDate - DST correctness", () => {
  it("keeps the donor-local wall-clock time fixed across a DST spring-forward/fall-back boundary (America/New_York)", () => {
    const timeZone = "America/New_York";
    const anchorDay = 10;
    let iso = computeInitialChargeDate("2024-01-10", timeZone).nextDueDate;
    const localTimes: string[] = [];
    for (let i = 0; i < 12; i++) {
      localTimes.push(formatInTimeZone(new Date(iso), timeZone, "HH:mm"));
      iso = computeNextChargeDate({ fromIso: iso, anchorDay, timeZone, monthsToAdvance: 1 });
    }
    // Regardless of crossing the Mar 10 2024 spring-forward and Nov 3 2024
    // fall-back transitions, the donor always sees the same local
    // wall-clock charge time.
    localTimes.forEach((t) => expect(t).toBe(`0${CHARGE_LOCAL_HOUR}:00`));
  });

  it("reflects the actual UTC offset change across the spring-forward transition (proves this isn't naive fixed-offset math)", () => {
    const timeZone = "America/New_York";
    const anchorDay = 10;
    const febIso = computeInitialChargeDate("2024-02-10", timeZone).nextDueDate; // EST (UTC-5)
    const marIso = computeNextChargeDate({ fromIso: febIso, anchorDay, timeZone, monthsToAdvance: 1 }); // EDT (UTC-4)

    expect(new Date(febIso).getUTCHours()).toBe(14); // 09:00 EST = 14:00 UTC
    expect(new Date(marIso).getUTCHours()).toBe(13); // 09:00 EDT = 13:00 UTC
  });

  it("never shifts UTC offset for a non-DST-observing zone (Asia/Kolkata control)", () => {
    const timeZone = "Asia/Kolkata";
    const anchorDay = 10;
    let iso = computeInitialChargeDate("2024-01-10", timeZone).nextDueDate;
    for (let i = 0; i < 12; i++) {
      // 09:00 IST is always UTC+5:30 -> 03:30 UTC, every month, no exceptions.
      expect(new Date(iso).getUTCHours()).toBe(3);
      expect(new Date(iso).getUTCMinutes()).toBe(30);
      iso = computeNextChargeDate({ fromIso: iso, anchorDay, timeZone, monthsToAdvance: 1 });
    }
  });

  it("handles the Europe/London DST boundary (last-Sunday-of-March/October rule, different dates than the US) without skipping or double-firing", () => {
    const timeZone = "Europe/London";
    const anchorDay = 29; // stresses Feb clamping too
    let prevIso = computeInitialChargeDate("2023-12-29", timeZone).nextDueDate;
    for (let i = 0; i < 24; i++) {
      const nextIso = computeNextChargeDate({ fromIso: prevIso, anchorDay, timeZone, monthsToAdvance: 1 });
      expect(new Date(nextIso).getTime()).toBeGreaterThan(new Date(prevIso).getTime());
      expect(formatInTimeZone(new Date(nextIso), timeZone, "HH:mm")).toBe("09:00");
      prevIso = nextIso;
    }
  });
});
