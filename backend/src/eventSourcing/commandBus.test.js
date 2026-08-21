"use strict";

const DONOR = "G" + "A".repeat(55);
const TX = "a".repeat(64);

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

jest.mock("./eventStore", () => ({
  eventStore: { append: jest.fn().mockResolvedValue({ eventId: "evt-1", version: 1, inserted: true }) },
}));

const pool = require("../db/pool");
const { eventStore } = require("./eventStore");
const commandBus = require("./commandBus");
const {
  RecordDonationCommand,
  ApplyMatchCommand,
  ChangeProjectStatusCommand,
  ReachMilestoneCommand,
  ReleaseEscrowCommand,
  CreateMatchOfferCommand,
} = require("./commands");

function fakeQuery(sql) {
  if (sql.includes("DonationRecorded")) return Promise.resolve({ rows: [] });
  if (sql.includes("MatchApplied")) return Promise.resolve({ rows: [] });
  if (sql.includes("event_stream")) return Promise.resolve({ rows: [{ max_version: null }] });
  if (sql.includes("donor_stats")) return Promise.resolve({ rows: [] });
  if (sql.includes("match_state")) return Promise.resolve({ rows: [{ cap_xlm: "1000", matched_xlm: "0" }] });
  if (sql.includes("FROM jobs")) {
    return Promise.resolve({
      rows: [{ id: "job-1", client_public_key: DONOR, freelancer_public_key: DONOR, amount_escrow_xlm: "5" }],
    });
  }
  if (sql.includes("SELECT id FROM projects")) return Promise.resolve({ rows: [{ id: "proj-1" }] });
  if (sql.includes("FROM projects")) {
    return Promise.resolve({ rows: [{ id: "proj-1", status: "active", raised_xlm: "0", donor_count: 0, goal_xlm: "0" }] });
  }
  if (sql.includes("INSERT INTO profiles")) return Promise.resolve({ rows: [] });
  if (sql.includes("UPDATE projects")) return Promise.resolve({ rows: [] });
  return Promise.resolve({ rows: [] });
}

beforeEach(() => {
  pool.query.mockImplementation(fakeQuery);
  eventStore.append.mockClear();
  eventStore.append.mockResolvedValue({ eventId: "evt-1", version: 1, inserted: true });
});

const commands = [
  {
    name: "RecordDonation",
    build: () =>
      new RecordDonationCommand({
        actor: "tester",
        projectId: "proj-1",
        donorAddress: DONOR,
        amountXlm: 10,
        transactionHash: TX,
      }),
  },
  {
    name: "ApplyMatch",
    build: () =>
      new ApplyMatchCommand({
        actor: "tester",
        matchId: "m-1",
        projectId: "proj-1",
        donorAddress: DONOR,
        matchAmount: 5,
        originalTxHash: TX,
        multiplier: 1,
      }),
  },
  {
    name: "ChangeProjectStatus",
    build: () =>
      new ChangeProjectStatusCommand({
        actor: "tester",
        projectId: "proj-1",
        status: "completed",
        reason: "done",
      }),
  },
  {
    name: "ReachMilestone",
    build: () =>
      new ReachMilestoneCommand({
        actor: "tester",
        milestoneId: "ms-1",
        projectId: "proj-1",
        transactionHash: TX,
      }),
  },
  {
    name: "ReleaseEscrow",
    build: () =>
      new ReleaseEscrowCommand({
        actor: "tester",
        jobId: "job-1",
        releaseTransactionHash: TX,
      }),
  },
  {
    name: "CreateMatchOffer",
    build: () =>
      new CreateMatchOfferCommand({
        actor: "tester",
        projectId: "proj-1",
        matcherAddress: DONOR,
        capXlm: 100,
        multiplier: 2,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
  },
];

describe("command handlers route through eventStore.append()", () => {
  test.each(commands)("$name handler calls eventStore.append once and emits no raw INSERT", async ({ build }) => {
    const result = await commandBus.execute(build());

    expect(eventStore.append).toHaveBeenCalledTimes(1);
    expect(result.events).toBeDefined();
    expect(result.events.length).toBeGreaterThanOrEqual(1);

    const rawInsertCalls = pool.query.mock.calls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO event_stream")
    );
    expect(rawInsertCalls).toHaveLength(0);
  });
});

describe("DonationCommandHandler dedup-by-transactionHash still works", () => {
  test("a duplicate transactionHash is returned as deduplicated and does not append", async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes("DonationRecorded")) {
        return Promise.resolve({ rows: [{ event_id: "existing-1" }] });
      }
      if (sql.includes("SELECT * FROM event_stream WHERE event_id")) {
        return Promise.resolve({
          rows: [
            {
              event_id: "existing-1",
              stream_id: "Donation:tx",
              aggregate_type: "Donation",
              aggregate_id: "Donation:tx",
              event_type: "DonationRecorded",
              version: 1,
              aggregate_version: 1,
              payload: { data: { amountXlm: 10 } },
              actor: "tester",
              occurred_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
            },
          ],
        });
      }
      return fakeQuery(sql);
    });

    const result = await commandBus.execute(
      new RecordDonationCommand({
        actor: "tester",
        projectId: "proj-1",
        donorAddress: DONOR,
        amountXlm: 10,
        transactionHash: TX,
      })
    );

    expect(result.deduplicated).toBe(true);
    expect(eventStore.append).not.toHaveBeenCalled();
  });
});
