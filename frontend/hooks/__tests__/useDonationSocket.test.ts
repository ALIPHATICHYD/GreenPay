/**
 * hooks/__tests__/useDonationSocket.test.ts
 *
 * Unit tests for useDonationSocket:
 * - Runtime schema validation & rejection of malformed events
 * - Idempotent deduplication (asserts duplicate events do NOT double-count)
 * - Reconnection reconciliation hook
 * - Filtering by projectId
 */
import { renderHook } from "@testing-library/react";
import { useDonationSocket } from "../useDonationSocket";
import { SOCKET_EVENTS } from "@/lib/socketEvents";

// Mock socket client
const mockListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

const mockSocket = {
  on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
    if (!mockListeners[event]) mockListeners[event] = [];
    mockListeners[event].push(cb);
  }),
  off: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
    if (mockListeners[event]) {
      mockListeners[event] = mockListeners[event].filter((fn) => fn !== cb);
    }
  }),
};

jest.mock("@/lib/socket", () => ({
  getSocket: () => mockSocket,
}));

function emitSocketEvent(event: string, payload?: unknown) {
  if (mockListeners[event]) {
    mockListeners[event].forEach((cb) => cb(payload));
  }
}

describe("useDonationSocket", () => {
  const targetProjectId = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
  const validDonation = {
    projectId: targetProjectId,
    donorAddress: "GDYO6GEXKXPU3UH5SWGTAVHMBBZZEKUHWHXUJ33PL2TJJVHZB7CG6BI5",
    amountXLM: 50,
    transactionHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    timestamp: "2026-08-21T09:00:00.000Z",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockListeners).forEach((k) => delete mockListeners[k]);
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("subscribes to donation_event on mount and unsubscribes on unmount", () => {
    const onDonation = jest.fn();
    const { unmount } = renderHook(() => useDonationSocket(targetProjectId, onDonation));

    expect(mockSocket.on).toHaveBeenCalledWith(SOCKET_EVENTS.DONATION_EVENT, expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("connect", expect.any(Function));

    unmount();

    expect(mockSocket.off).toHaveBeenCalledWith(SOCKET_EVENTS.DONATION_EVENT, expect.any(Function));
    expect(mockSocket.off).toHaveBeenCalledWith("connect", expect.any(Function));
  });

  test("invokes onDonation when receiving a valid event matching projectId", () => {
    const onDonation = jest.fn();
    renderHook(() => useDonationSocket(targetProjectId, onDonation));

    emitSocketEvent(SOCKET_EVENTS.DONATION_EVENT, validDonation);

    expect(onDonation).toHaveBeenCalledTimes(1);
    expect(onDonation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: targetProjectId,
      amountXLM: 50,
      transactionHash: validDonation.transactionHash,
    }));
  });

  test("rejects malformed events at runtime without invoking onDonation or corrupting state", () => {
    const onDonation = jest.fn();
    renderHook(() => useDonationSocket(targetProjectId, onDonation));

    // Malformed: missing transactionHash
    emitSocketEvent(SOCKET_EVENTS.DONATION_EVENT, {
      projectId: targetProjectId,
      donorAddress: validDonation.donorAddress,
      amountXLM: 10,
      timestamp: validDonation.timestamp,
    });

    // Malformed: negative amount
    emitSocketEvent(SOCKET_EVENTS.DONATION_EVENT, {
      ...validDonation,
      amountXLM: -25,
    });

    // Malformed: non-Stellar public key
    emitSocketEvent(SOCKET_EVENTS.DONATION_EVENT, {
      ...validDonation,
      donorAddress: "invalid-key",
    });

    // Malformed: invalid timestamp
    emitSocketEvent(SOCKET_EVENTS.DONATION_EVENT, {
      ...validDonation,
      timestamp: "not-a-date",
    });

    expect(onDonation).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  test("[GUARD] receiving the same event twice is idempotent and does NOT double-count", () => {
    const onDonation = jest.fn();
    renderHook(() => useDonationSocket(targetProjectId, onDonation));

    // First emission
    emitSocketEvent(SOCKET_EVENTS.DONATION_EVENT, validDonation);
    expect(onDonation).toHaveBeenCalledTimes(1);

    // Duplicate emission with exact same transactionHash
    emitSocketEvent(SOCKET_EVENTS.DONATION_EVENT, validDonation);
    expect(onDonation).toHaveBeenCalledTimes(1); // STILL 1 — no double counting!

    // Duplicate emission with slightly modified amount but same hash
    emitSocketEvent(SOCKET_EVENTS.DONATION_EVENT, { ...validDonation, amountXLM: 100 });
    expect(onDonation).toHaveBeenCalledTimes(1); // STILL 1!
  });

  test("ignores events destined for other projects", () => {
    const onDonation = jest.fn();
    renderHook(() => useDonationSocket(targetProjectId, onDonation));

    const otherProjectEvent = {
      ...validDonation,
      projectId: "4d57d6cb-5e8e-4647-a5f0-acfbb9f0ce10",
      transactionHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    };

    emitSocketEvent(SOCKET_EVENTS.DONATION_EVENT, otherProjectEvent);

    expect(onDonation).not.toHaveBeenCalled();
  });

  test("triggers onReconnect callback on socket reconnection", () => {
    const onDonation = jest.fn();
    const onReconnect = jest.fn();
    renderHook(() => useDonationSocket(targetProjectId, onDonation, { onReconnect }));

    // Initial connect
    emitSocketEvent("connect");
    expect(onReconnect).not.toHaveBeenCalled(); // First connection is initial mount

    // Reconnect after network drop
    emitSocketEvent("connect");
    expect(onReconnect).toHaveBeenCalledTimes(1);

    // Subsequent reconnect
    emitSocketEvent("connect");
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });
});
