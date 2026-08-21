/**
 * hooks/useDonationSocket.ts
 *
 * Subscribes to the backend's realtime donation broadcast over Socket.IO.
 *
 * Contract & Delivery Guarantees
 * ──────────────────────────────
 * 1. Runtime validation: Every incoming event is parsed and validated against
 *    the canonical shared schema (validateDonationPayload). Malformed or corrupt
 *    events are dropped with a warning without mutating client state.
 * 2. Idempotency (At-Least-Once Delivery): Uses a hash set of seen transaction
 *    hashes (O(1) lookup) to ensure duplicate broadcasts (e.g. from multiple
 *    server emitters, replay, or retries) never double-count.
 * 3. Reconnect Reconciliation: When the socket disconnects and reconnects,
 *    an optional `onReconnect` / `reconcile` callback is invoked so the client
 *    can re-fetch the latest REST view to fill any gap during offline downtime.
 */
import { useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket";
import {
  SOCKET_EVENTS,
  validateDonationPayload,
  type DonationSocketPayload,
} from "@/lib/socketEvents";

export type { DonationSocketPayload };

export interface UseDonationSocketOptions {
  /**
   * Optional reconciliation hook called when the socket reconnects after being
   * disconnected. Use this to backfill any donations missed while offline.
   */
  onReconnect?: () => void;
  /**
   * Maximum number of transaction hashes to track in the deduplication cache.
   * Defaults to 500.
   */
  maxDeduplicationEntries?: number;
}

/**
 * Subscribes to the backend's "donation_event" Socket.IO broadcast, validates
 * payloads, deduplicates by transactionHash, and invokes `onDonation` for events
 * matching `projectId`.
 *
 * @param projectId - Target project ID to filter events for, or undefined to skip.
 * @param onDonation - Callback invoked with validated, deduplicated donation payloads.
 * @param options - Optional configuration (reconnect callback, deduplication limits).
 */
export function useDonationSocket(
  projectId: string | undefined,
  onDonation: (payload: DonationSocketPayload) => void,
  options: UseDonationSocketOptions = {}
) {
  const { onReconnect, maxDeduplicationEntries = 500 } = options;
  const onDonationRef = useRef(onDonation);
  const onReconnectRef = useRef(onReconnect);
  const seenTxHashesRef = useRef<Set<string>>(new Set());
  const hasConnectedBeforeRef = useRef(false);

  useEffect(() => {
    onDonationRef.current = onDonation;
  }, [onDonation]);

  useEffect(() => {
    onReconnectRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    if (!projectId) return;

    const socket = getSocket();

    const handleEvent = (rawPayload: unknown) => {
      // 1. Runtime schema validation
      const validation = validateDonationPayload(rawPayload);
      if (!validation.success) {
        console.warn("[useDonationSocket] Dropped malformed donation event:", validation.error, rawPayload);
        return;
      }

      const payload = validation.data;

      // Filter for target project
      if (payload.projectId !== projectId) {
        return;
      }

      // 2. Idempotent deduplication (DSA: O(1) Hash Set lookup & pruning)
      if (seenTxHashesRef.current.has(payload.transactionHash)) {
        return;
      }

      // Prune if set exceeds max size to prevent unbounded memory growth
      if (seenTxHashesRef.current.size >= maxDeduplicationEntries) {
        // Clear oldest half when limit is reached
        const entries = Array.from(seenTxHashesRef.current);
        seenTxHashesRef.current = new Set(entries.slice(Math.floor(entries.length / 2)));
      }

      seenTxHashesRef.current.add(payload.transactionHash);

      // 3. Dispatch validated, deduplicated payload
      onDonationRef.current(payload);
    };

    // 4. Reconnection handler: reconcile with REST view if we were disconnected
    const handleConnect = () => {
      if (hasConnectedBeforeRef.current) {
        onReconnectRef.current?.();
      }
      hasConnectedBeforeRef.current = true;
    };

    socket.on(SOCKET_EVENTS.DONATION_EVENT, handleEvent);
    socket.on("connect", handleConnect);

    return () => {
      socket.off(SOCKET_EVENTS.DONATION_EVENT, handleEvent);
      socket.off("connect", handleConnect);
    };
  }, [projectId, maxDeduplicationEntries]);
}
