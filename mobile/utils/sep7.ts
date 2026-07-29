/**
 * utils/sep7.ts
 * Defensive parser/validator for SEP-0007 ("URI Scheme to facilitate
 * delegated signing") *payment* requests — the `web+stellar:pay?...` URIs
 * that a GreenPay QR code (or any third-party QR code) may encode.
 *
 * This module is intentionally paranoid: it is the boundary between
 * "arbitrary bytes scanned from a camera" and "a Stellar payment
 * destination the app is about to route a donation to." It must never
 * throw, and it must fail closed (return `{ ok: false, reason }`) on
 * anything that is not *exactly* a well-formed SEP-7 pay request on the
 * network this app build is configured for.
 *
 * Note: a checksum-valid destination is not the same as a *trusted*
 * destination — callers still need to cross-check the resolved
 * `destination` against a known allowlist (e.g. active GreenPay projects)
 * before navigating anywhere. This module only guarantees the payload is
 * well-formed and internally consistent.
 */
import { isValidStellarDestination } from './stellarValidation';
import { getExpectedNetworkPassphrase } from './stellarNetwork';

/** Hard cap on the raw scanned string length before we even attempt to parse it. */
const MAX_RAW_LENGTH = 4000;
/** SEP-7 amounts are decimal strings; this is generously larger than any real one. */
const MAX_AMOUNT_LENGTH = 30;
/** Bounded length for the free-text memo field. */
const MAX_MEMO_LENGTH = 200;

const SEP7_SCHEME = 'web+stellar:';
const SEP7_PAY_OPERATION = 'pay';

/** Matches a positive, finite, plain decimal amount (no sign, no exponent, no whitespace). */
const AMOUNT_RE = /^\d{1,18}(\.\d{1,7})?$/;

export type Sep7PayResult =
  | {
      ok: true;
      destination: string;
      amount?: string;
      memo?: string;
      memoType?: string;
    }
  | {
      ok: false;
      reason: string;
    };

function containsControlOrNullChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
}

/**
 * Parses and validates a scanned string as a SEP-7 `pay` operation URI.
 * Never throws — any failure (parse error, wrong scheme/operation, invalid
 * destination, invalid amount, network mismatch, malformed input of any
 * kind) resolves to `{ ok: false, reason }`.
 */
export function parseSep7PayUri(raw: unknown): Sep7PayResult {
  try {
    if (typeof raw !== 'string') {
      return { ok: false, reason: 'not-a-string' };
    }
    if (raw.length === 0) {
      return { ok: false, reason: 'empty' };
    }
    if (raw.length > MAX_RAW_LENGTH) {
      return { ok: false, reason: 'too-long' };
    }
    if (containsControlOrNullChars(raw)) {
      return { ok: false, reason: 'invalid-characters' };
    }

    const trimmed = raw.trim();
    if (!trimmed.toLowerCase().startsWith(SEP7_SCHEME)) {
      return { ok: false, reason: 'invalid-scheme' };
    }

    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return { ok: false, reason: 'unparseable' };
    }

    // Must be exactly the web+stellar scheme (case-insensitive per URL spec,
    // the WHATWG URL parser lower-cases protocol for us).
    if (url.protocol !== SEP7_SCHEME) {
      return { ok: false, reason: 'invalid-scheme' };
    }

    // For `web+stellar:pay?...` the WHATWG parser treats "pay" as the
    // pathname (opaque path, no authority). Must be exactly "pay" — nothing
    // else (no `pay/`, no `PAY`, no extra segments).
    if (url.pathname !== SEP7_PAY_OPERATION) {
      return { ok: false, reason: 'invalid-operation' };
    }

    let params: URLSearchParams;
    try {
      params = url.searchParams;
    } catch {
      return { ok: false, reason: 'unparseable-query' };
    }

    // .get() always returns the first occurrence, so duplicated/polluted
    // query params can't smuggle a second conflicting value through.
    const destination = params.get('destination');
    if (!destination || !isValidStellarDestination(destination)) {
      return { ok: false, reason: 'invalid-destination' };
    }

    const amountRaw = params.get('amount');
    let amount: string | undefined;
    if (amountRaw !== null) {
      if (
        typeof amountRaw !== 'string' ||
        amountRaw.length === 0 ||
        amountRaw.length > MAX_AMOUNT_LENGTH ||
        !AMOUNT_RE.test(amountRaw)
      ) {
        return { ok: false, reason: 'invalid-amount' };
      }
      const numeric = Number(amountRaw);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return { ok: false, reason: 'invalid-amount' };
      }
      amount = amountRaw;
    }

    const networkPassphrase = params.get('network_passphrase');
    if (networkPassphrase !== null) {
      if (
        typeof networkPassphrase !== 'string' ||
        networkPassphrase.length === 0 ||
        networkPassphrase.length > 200
      ) {
        return { ok: false, reason: 'invalid-network-passphrase' };
      }
      if (networkPassphrase !== getExpectedNetworkPassphrase()) {
        return { ok: false, reason: 'network-mismatch' };
      }
      // Present and matches — network explicitly confirmed by the payload.
    }
    // Absent — proceed. The payload didn't explicitly confirm the network,
    // which is fine; it's not an adversarial signal on its own.

    const memoTypeRaw = params.get('memo_type');
    let memoType: string | undefined;
    if (memoTypeRaw !== null) {
      if (typeof memoTypeRaw !== 'string' || memoTypeRaw.length === 0 || memoTypeRaw.length > 40) {
        return { ok: false, reason: 'invalid-memo-type' };
      }
      memoType = memoTypeRaw;
    }

    const memoRaw = params.get('memo');
    let memo: string | undefined;
    if (memoRaw !== null) {
      if (typeof memoRaw !== 'string' || memoRaw.length > MAX_MEMO_LENGTH || containsControlOrNullChars(memoRaw)) {
        return { ok: false, reason: 'invalid-memo' };
      }
      memo = memoRaw;
    }

    const result: Sep7PayResult = { ok: true, destination };
    if (amount !== undefined) result.amount = amount;
    if (memo !== undefined) result.memo = memo;
    if (memoType !== undefined) result.memoType = memoType;
    return result;
  } catch {
    // Absolute last-resort guard: no matter what unexpected exception
    // surfaces above (a hostile getter on URLSearchParams, an engine quirk,
    // etc.), never let it escape — fail closed.
    return { ok: false, reason: 'unexpected-error' };
  }
}
