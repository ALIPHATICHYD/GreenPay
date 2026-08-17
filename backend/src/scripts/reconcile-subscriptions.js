#!/usr/bin/env node
/**
 * src/scripts/reconcile-subscriptions.js
 *
 * Reconciliation report for recurring ("monthly giving") donation
 * subscriptions: compares each subscription's expected schedule (derived
 * from ../utils/recurringSchedule.js, the exact same date math the frontend
 * uses to display "next charge date") against its actually-executed charge
 * records, and flags drift:
 *
 *   - missed_cycle    an expected charge has no corresponding executed charge
 *   - double_charge   more than one executed charge landed in a single
 *                     cycle's window
 *   - date_mismatch   an executed charge exists for a cycle, but outside the
 *                     configured tolerance of the expected date
 *   - unexpected_charge  an executed charge doesn't correspond to any
 *                     expected cycle at all (e.g. after the subscription's
 *                     duration ended)
 *
 * IMPORTANT — scope note: as of this writing there is no backend table or
 * job that actually executes monthly-giving charges. `frontend/lib/
 * monthlyGiving.ts` is entirely client-side (localStorage), and
 * `backend/src/routes/subscriptions.js` is an unrelated feature (subscribing
 * to project-update emails, backed by the `project_subscriptions` table) —
 * see docs/monthly-giving-scheduling.md for the full audit note. There is
 * therefore no live DB source to query yet.
 *
 * This module is deliberately data-source-agnostic: `detectDrift` /
 * `computeExpectedChargeDates` are pure functions you can unit test and wire
 * up to whatever store eventually holds subscriptions + charge history. The
 * `main()` CLI below demonstrates that by reading a JSON export (as could be
 * pulled from a donor's localStorage, or a future DB export) of
 * `{ subscription, charges }` records and printing a drift report — it does
 * NOT assume any particular DB schema, and is intentionally not wired to a
 * cron/scheduler.
 */
"use strict";

const fs = require("fs");
const { computeInitialChargeDate, computeNextChargeDate } = require("../utils/recurringSchedule");

const DEFAULT_TOLERANCE_MS = 24 * 60 * 60 * 1000; // 24h grace period for processing delay

// How far from an expected cycle date an actual charge can be and still be
// considered "for" that cycle at all (as opposed to belonging to a
// different cycle, or being unrelated). Half a typical ~30-day cycle keeps
// adjacent cycles from ever being confused with one another.
const DEFAULT_MAX_MATCH_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;

/**
 * Generate the sequence of expected charge instants (ISO strings) for a
 * subscription, from its first cycle up to (and including) the first cycle
 * whose date is >= `asOfIso`, or until `durationMonths` cycles have been
 * produced — whichever comes first.
 *
 * @param {{ startDate: string, anchorDay?: number, timeZone?: string, durationMonths: number|null }} subscription
 * @param {string} asOfIso
 */
function computeExpectedChargeDates(subscription, asOfIso) {
  const timeZone = subscription.timeZone || "UTC";
  const initial = computeInitialChargeDate(subscription.startDate, timeZone);
  const anchorDay = subscription.anchorDay || initial.anchorDay;
  const asOfMs = new Date(asOfIso).getTime();

  const dates = [initial.nextDueDate];
  const maxCycles = subscription.durationMonths ?? Infinity;

  while (
    dates.length < maxCycles &&
    new Date(dates[dates.length - 1]).getTime() <= asOfMs
  ) {
    const next = computeNextChargeDate({
      fromIso: dates[dates.length - 1],
      anchorDay,
      timeZone,
      monthsToAdvance: 1,
    });
    dates.push(next);
  }

  // Only report cycles that were actually due by `asOfIso` (drop the final
  // entry if it's still in the future relative to asOf, unless it's the
  // very first / only cycle).
  return dates.filter((iso) => new Date(iso).getTime() <= asOfMs);
}

/**
 * Compare expected charge dates against actual charge records and flag
 * drift. Uses a greedy nearest-match: actual charges are matched to
 * expected cycles in chronological order, one expected cycle can match at
 * most one "on-time" actual charge; anything left over is drift.
 *
 * @param {{ startDate: string, anchorDay?: number, timeZone?: string, durationMonths: number|null }} subscription
 * @param {Array<{ chargedAt: string, amountXLM?: string }>} charges
 * @param {{ asOf?: string, toleranceMs?: number }} [options]
 */
function detectDrift(subscription, charges, options = {}) {
  const asOf = options.asOf || new Date().toISOString();
  const toleranceMs = options.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  const maxMatchWindowMs = options.maxMatchWindowMs ?? DEFAULT_MAX_MATCH_WINDOW_MS;

  const expected = computeExpectedChargeDates(subscription, asOf);
  const actual = [...charges]
    .map((c) => ({ ...c, ms: new Date(c.chargedAt).getTime() }))
    .sort((a, b) => a.ms - b.ms);

  const usedActualIndexes = new Set();
  const missed = [];
  const matched = [];
  const dateMismatch = [];

  for (const expectedIso of expected) {
    const expectedMs = new Date(expectedIso).getTime();

    // Find the closest not-yet-used actual charge to this expected cycle,
    // but only within `maxMatchWindowMs` — otherwise an actual charge that
    // really belongs to a neighboring cycle (or doesn't belong to this
    // subscription's schedule at all) would get wrongly "borrowed" to cover
    // a cycle that was genuinely missed.
    let bestIndex = -1;
    let bestDiff = Infinity;
    actual.forEach((a, idx) => {
      if (usedActualIndexes.has(idx)) return;
      const diff = Math.abs(a.ms - expectedMs);
      if (diff < bestDiff && diff <= maxMatchWindowMs) {
        bestDiff = diff;
        bestIndex = idx;
      }
    });

    if (bestIndex === -1) {
      missed.push({ type: "missed_cycle", expected: expectedIso });
      continue;
    }

    usedActualIndexes.add(bestIndex);
    const actualCharge = actual[bestIndex];
    if (bestDiff <= toleranceMs) {
      matched.push({ expected: expectedIso, actual: actualCharge.chargedAt, driftMs: bestDiff });
    } else {
      dateMismatch.push({
        type: "date_mismatch",
        expected: expectedIso,
        actual: actualCharge.chargedAt,
        driftMs: bestDiff,
      });
    }
  }

  // Any actual charges never consumed above are extras: either a double
  // charge landing in the same window as an already-matched cycle, or a
  // charge with no corresponding expected cycle at all.
  const doubleCharge = [];
  const unexpectedCharge = [];
  actual.forEach((a, idx) => {
    if (usedActualIndexes.has(idx)) return;
    const nearestExpectedMs = expected.length
      ? expected.reduce((closest, iso) => {
        const diff = Math.abs(new Date(iso).getTime() - a.ms);
        return diff < Math.abs(new Date(closest).getTime() - a.ms) ? iso : closest;
      }, expected[0])
      : null;
    const diff = nearestExpectedMs ? Math.abs(new Date(nearestExpectedMs).getTime() - a.ms) : Infinity;
    if (nearestExpectedMs && diff <= maxMatchWindowMs) {
      doubleCharge.push({ type: "double_charge", nearExpected: nearestExpectedMs, actual: a.chargedAt });
    } else {
      unexpectedCharge.push({ type: "unexpected_charge", actual: a.chargedAt });
    }
  });

  const drift = [...missed, ...dateMismatch, ...doubleCharge, ...unexpectedCharge];

  return {
    subscriptionId: subscription.id,
    expectedCycleCount: expected.length,
    matchedCount: matched.length,
    matched,
    drift,
    hasDrift: drift.length > 0,
  };
}

/**
 * Run reconciliation over a batch of `{ subscription, charges }` records and
 * return the aggregate report.
 */
function reconcileAll(records, options = {}) {
  const results = records.map(({ subscription, charges }) => detectDrift(subscription, charges || [], options));
  return {
    total: results.length,
    withDrift: results.filter((r) => r.hasDrift).length,
    results,
  };
}

function main() {
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!fileArg) {
    console.error(
      "Usage: node reconcile-subscriptions.js <records.json>\n" +
        "  records.json: JSON array of { subscription, charges } — see the\n" +
        "  header comment in this file for why there's no default DB source yet.",
    );
    process.exitCode = 1;
    return;
  }

  const raw = fs.readFileSync(fileArg, "utf8");
  const records = JSON.parse(raw);
  const report = reconcileAll(records);

  console.log(`Reconciled ${report.total} subscription(s), ${report.withDrift} with drift.\n`);
  for (const result of report.results) {
    if (!result.hasDrift) continue;
    console.log(`Subscription ${result.subscriptionId}:`);
    for (const d of result.drift) {
      console.log(`  - ${d.type}`, JSON.stringify(d));
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_TOLERANCE_MS,
  DEFAULT_MAX_MATCH_WINDOW_MS,
  computeExpectedChargeDates,
  detectDrift,
  reconcileAll,
};
