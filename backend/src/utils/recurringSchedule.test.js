"use strict";

const fc = require("fast-check");
const { formatInTimeZone } = require("date-fns-tz");
const {
  CHARGE_LOCAL_HOUR,
  clampDayToMonth,
  computeInitialChargeDate,
  computeNextChargeDate,
  daysInMonth,
} = require("./recurringSchedule");

// At least one DST zone (spring-forward/fall-back), one non-DST control
// zone, and a second DST zone with different transition dates than the US.
const TIME_ZONES = ["America/New_York", "Asia/Kolkata", "Europe/London"];

function zonedYearMonthDay(iso, timeZone) {
  const [year, month, day] = formatInTimeZone(new Date(iso), timeZone, "yyyy-MM-dd")
    .split("-")
    .map(Number);
  return { year, month: month - 1, day };
}

describe("daysInMonth / clampDayToMonth", () => {
  test("knows February's length for leap and non-leap years", () => {
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2023, 1)).toBe(28);
    expect(daysInMonth(2000, 1)).toBe(29);
    expect(daysInMonth(1900, 1)).toBe(28);
  });

  test("clamps day-of-month to the last valid day", () => {
    expect(clampDayToMonth(2024, 1, 31)).toBe(29);
    expect(clampDayToMonth(2023, 1, 31)).toBe(28);
    expect(clampDayToMonth(2024, 3, 31)).toBe(30);
  });
});

// These exact vectors are also asserted in
// frontend/lib/__tests__/monthlyGiving.test.ts's "cross-implementation
// agreement" fixtures. If a future change to either side's date math causes
// them to diverge, one of the two test suites will fail — that's the point:
// the frontend's displayed "next charge date" and the backend's execution
// logic must never disagree.
describe("computeNextChargeDate - cross-implementation agreement fixtures", () => {
  test.each([
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

describe("computeNextChargeDate - month-length clamping (property-based)", () => {
  test("never skips a calendar month and always lands on the clamped anchor day", () => {
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

          const next = zonedYearMonthDay(nextIso, timeZone);
          const expectedMonth = (month + 1) % 12;
          const expectedYear = month === 11 ? year + 1 : year;

          expect(next.year).toBe(expectedYear);
          expect(next.month).toBe(expectedMonth);
          expect(next.day).toBe(clampDayToMonth(expectedYear, expectedMonth, anchorDay));

          expect(new Date(nextIso).getTime()).toBeGreaterThan(new Date(fromIso).getTime());

          const diffDays = (new Date(nextIso).getTime() - new Date(fromIso).getTime()) / 86_400_000;
          expect(diffDays).toBeGreaterThan(26.9);
          expect(diffDays).toBeLessThan(32.1);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("regression: a day-31 anchor returns to the 31st in every 31-day month forever", () => {
    const timeZone = "UTC";
    const anchorDay = 31;
    let iso = computeInitialChargeDate("2024-01-31", timeZone).nextDueDate;
    const daysSeen = [zonedYearMonthDay(iso, timeZone).day];
    for (let i = 0; i < 13; i++) {
      iso = computeNextChargeDate({ fromIso: iso, anchorDay, timeZone, monthsToAdvance: 1 });
      daysSeen.push(zonedYearMonthDay(iso, timeZone).day);
    }
    expect(daysSeen).toEqual([31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31, 28]);
  });
});

describe("computeNextChargeDate - DST correctness", () => {
  test("keeps the donor-local wall-clock time fixed across America/New_York DST boundaries", () => {
    const timeZone = "America/New_York";
    const anchorDay = 10;
    let iso = computeInitialChargeDate("2024-01-10", timeZone).nextDueDate;
    for (let i = 0; i < 12; i++) {
      expect(formatInTimeZone(new Date(iso), timeZone, "HH:mm")).toBe(`0${CHARGE_LOCAL_HOUR}:00`);
      iso = computeNextChargeDate({ fromIso: iso, anchorDay, timeZone, monthsToAdvance: 1 });
    }
  });

  test("reflects the real UTC offset change across the spring-forward transition", () => {
    const timeZone = "America/New_York";
    const anchorDay = 10;
    const febIso = computeInitialChargeDate("2024-02-10", timeZone).nextDueDate;
    const marIso = computeNextChargeDate({ fromIso: febIso, anchorDay, timeZone, monthsToAdvance: 1 });
    expect(new Date(febIso).getUTCHours()).toBe(14); // EST (UTC-5)
    expect(new Date(marIso).getUTCHours()).toBe(13); // EDT (UTC-4)
  });

  test("never shifts UTC offset for a non-DST-observing zone (Asia/Kolkata control)", () => {
    const timeZone = "Asia/Kolkata";
    const anchorDay = 10;
    let iso = computeInitialChargeDate("2024-01-10", timeZone).nextDueDate;
    for (let i = 0; i < 12; i++) {
      expect(new Date(iso).getUTCHours()).toBe(3);
      expect(new Date(iso).getUTCMinutes()).toBe(30);
      iso = computeNextChargeDate({ fromIso: iso, anchorDay, timeZone, monthsToAdvance: 1 });
    }
  });

  test("handles the Europe/London DST boundary without skipping or double-firing", () => {
    const timeZone = "Europe/London";
    const anchorDay = 29;
    let prevIso = computeInitialChargeDate("2023-12-29", timeZone).nextDueDate;
    for (let i = 0; i < 24; i++) {
      const nextIso = computeNextChargeDate({ fromIso: prevIso, anchorDay, timeZone, monthsToAdvance: 1 });
      expect(new Date(nextIso).getTime()).toBeGreaterThan(new Date(prevIso).getTime());
      expect(formatInTimeZone(new Date(nextIso), timeZone, "HH:mm")).toBe("09:00");
      prevIso = nextIso;
    }
  });
});
