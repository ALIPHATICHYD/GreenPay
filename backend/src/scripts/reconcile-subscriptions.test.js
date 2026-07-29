"use strict";

const fc = require("fast-check");
const {
  computeExpectedChargeDates,
  detectDrift,
  reconcileAll,
} = require("./reconcile-subscriptions");

function baseSubscription(overrides = {}) {
  return {
    id: "sub_test",
    startDate: "2024-01-31",
    anchorDay: 31,
    timeZone: "UTC",
    durationMonths: null,
    ...overrides,
  };
}

describe("computeExpectedChargeDates", () => {
  test("produces one expected cycle per elapsed month, clamped for short months", () => {
    const sub = baseSubscription();
    const dates = computeExpectedChargeDates(sub, "2024-05-01T00:00:00.000Z");
    expect(dates).toEqual([
      "2024-01-31T09:00:00.000Z",
      "2024-02-29T09:00:00.000Z",
      "2024-03-31T09:00:00.000Z",
      "2024-04-30T09:00:00.000Z",
    ]);
  });

  test("stops after durationMonths cycles even if asOf is far in the future", () => {
    const sub = baseSubscription({ durationMonths: 2 });
    const dates = computeExpectedChargeDates(sub, "2030-01-01T00:00:00.000Z");
    expect(dates).toHaveLength(2);
  });
});

describe("detectDrift", () => {
  test("no drift when every cycle is charged exactly on schedule", () => {
    const sub = baseSubscription({ durationMonths: 3 });
    const expected = computeExpectedChargeDates(sub, "2024-04-01T00:00:00.000Z");
    const charges = expected.map((iso) => ({ chargedAt: iso, amountXLM: "25.0000000" }));

    const report = detectDrift(sub, charges, { asOf: "2024-04-01T00:00:00.000Z" });
    expect(report.hasDrift).toBe(false);
    expect(report.matched).toHaveLength(expected.length);
  });

  test("no drift when charges land within the tolerance window (small processing delay)", () => {
    const sub = baseSubscription({ durationMonths: 2 });
    const expected = computeExpectedChargeDates(sub, "2024-03-01T00:00:00.000Z");
    const charges = expected.map((iso) => ({
      chargedAt: new Date(new Date(iso).getTime() + 60 * 60 * 1000).toISOString(), // +1h
      amountXLM: "25.0000000",
    }));

    const report = detectDrift(sub, charges, { asOf: "2024-03-01T00:00:00.000Z" });
    expect(report.hasDrift).toBe(false);
  });

  test("flags a missed cycle when an expected charge has no matching actual charge", () => {
    const sub = baseSubscription({ durationMonths: 3 });
    const expected = computeExpectedChargeDates(sub, "2024-04-01T00:00:00.000Z");
    // Skip the February charge entirely.
    const charges = [expected[0], expected[2]].map((iso) => ({ chargedAt: iso }));

    const report = detectDrift(sub, charges, { asOf: "2024-04-01T00:00:00.000Z" });
    expect(report.hasDrift).toBe(true);
    expect(report.drift).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "missed_cycle", expected: expected[1] })]),
    );
  });

  test("flags a double charge when two actual charges land in the same cycle window", () => {
    const sub = baseSubscription({ durationMonths: 1 });
    const expected = computeExpectedChargeDates(sub, "2024-02-01T00:00:00.000Z");
    const [onlyExpected] = expected;
    const charges = [
      { chargedAt: onlyExpected },
      { chargedAt: new Date(new Date(onlyExpected).getTime() + 60 * 60 * 1000).toISOString() },
    ];

    const report = detectDrift(sub, charges, { asOf: "2024-02-01T00:00:00.000Z" });
    expect(report.hasDrift).toBe(true);
    expect(report.drift.some((d) => d.type === "double_charge")).toBe(true);
  });

  test("flags a date mismatch when a charge is well outside the tolerance window", () => {
    const sub = baseSubscription({ durationMonths: 1 });
    const expected = computeExpectedChargeDates(sub, "2024-02-01T00:00:00.000Z");
    const [onlyExpected] = expected;
    const charges = [
      { chargedAt: new Date(new Date(onlyExpected).getTime() + 5 * 24 * 60 * 60 * 1000).toISOString() }, // +5 days
    ];

    const report = detectDrift(sub, charges, { asOf: "2024-02-05T12:00:00.000Z" });
    expect(report.hasDrift).toBe(true);
    expect(report.drift.some((d) => d.type === "date_mismatch")).toBe(true);
  });

  test("flags an unexpected charge that doesn't correspond to any cycle", () => {
    const sub = baseSubscription({ durationMonths: 1 });
    const expected = computeExpectedChargeDates(sub, "2024-02-01T00:00:00.000Z");
    const charges = [
      { chargedAt: expected[0] },
      { chargedAt: "2025-06-15T09:00:00.000Z" }, // far in the future, no matching cycle
    ];

    const report = detectDrift(sub, charges, { asOf: "2025-06-16T00:00:00.000Z" });
    expect(report.drift.some((d) => d.type === "unexpected_charge")).toBe(true);
  });

  test("property: perfectly-on-schedule charge histories across random durations never flag drift", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2019, max: 2031 }),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 28, max: 31 }),
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom("UTC", "America/New_York", "Asia/Kolkata"),
        (year, month, anchorDay, durationMonths, timeZone) => {
          const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
          const sub = baseSubscription({ startDate, anchorDay, durationMonths, timeZone });
          const asOf = `${year + 3}-01-01T00:00:00.000Z`;
          const expected = computeExpectedChargeDates(sub, asOf);
          const charges = expected.map((iso) => ({ chargedAt: iso }));

          const report = detectDrift(sub, charges, { asOf });
          expect(report.hasDrift).toBe(false);
          expect(report.matched).toHaveLength(expected.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("reconcileAll", () => {
  test("aggregates drift across multiple subscriptions", () => {
    const clean = baseSubscription({ id: "sub_clean", durationMonths: 1 });
    const cleanExpected = computeExpectedChargeDates(clean, "2024-02-01T00:00:00.000Z");
    const drifted = baseSubscription({ id: "sub_drifted", durationMonths: 2 });

    const report = reconcileAll(
      [
        { subscription: clean, charges: cleanExpected.map((iso) => ({ chargedAt: iso })) },
        { subscription: drifted, charges: [] }, // both cycles missed
      ],
      { asOf: "2024-03-01T00:00:00.000Z" },
    );

    expect(report.total).toBe(2);
    expect(report.withDrift).toBe(1);
  });
});
