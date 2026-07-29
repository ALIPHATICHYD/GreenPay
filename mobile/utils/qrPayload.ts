/**
 * utils/qrPayload.ts
 * Defensive parser for GreenPay's own QR/deep-link donation format.
 *
 * Replaces the old ad-hoc `extractProjectId` that used to live in
 * `QRScannerScreen.tsx`, which accepted *any* URL carrying a `?projectId=`
 * query param regardless of host (e.g. `https://evil.com/?projectId=x`
 * would have passed). This module instead requires an exact allowlisted
 * host+path (or the exact custom-scheme form), and constrains the
 * projectId itself to a safe charset/length — nothing is inferred, nothing
 * "close enough" is accepted.
 *
 * Never throws; always resolves to a well-formed result object.
 */

const ALLOWED_HOST = 'greenpay.app';
const ALLOWED_PATH = '/donate';
const CUSTOM_SCHEME_PREFIX = 'greenpay://donate/';
const MAX_RAW_LENGTH = 4000;

/** Safe charset/length for a project id: 1-64 chars of [a-zA-Z0-9_-]. */
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export type GreenPayLinkResult =
  | { ok: true; projectId: string }
  | { ok: false; reason: string };

function containsControlOrNullChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
}

/**
 * Parses a scanned string as a GreenPay donation link. Accepts only:
 *   - `https://greenpay.app/donate?projectId=<id>` (exact host, exact path)
 *   - `greenpay://donate/<id>` (exact custom-scheme form)
 * with `<id>` constrained to `/^[a-zA-Z0-9_-]{1,64}$/`. Anything else
 * (wrong host, subdomain, path traversal, wrong scheme, look-alike/
 * confusable hosts) is rejected.
 */
export function parseGreenPayDonationLink(raw: unknown): GreenPayLinkResult {
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

    // Custom-scheme form: greenpay://donate/<id> — exact prefix match only,
    // no query string, no extra path segments.
    if (trimmed.toLowerCase().startsWith('greenpay://')) {
      if (!trimmed.startsWith(CUSTOM_SCHEME_PREFIX)) {
        return { ok: false, reason: 'invalid-path' };
      }
      const rest = trimmed.slice(CUSTOM_SCHEME_PREFIX.length);
      // Reject trailing slash, query string, fragment, or extra segments —
      // the id must be the entire remainder.
      if (rest.length === 0 || /[/?#]/.test(rest)) {
        return { ok: false, reason: 'invalid-project-id' };
      }
      if (!PROJECT_ID_RE.test(rest)) {
        return { ok: false, reason: 'invalid-project-id' };
      }
      return { ok: true, projectId: rest };
    }

    // https form: exact host + exact path allowlist.
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return { ok: false, reason: 'unparseable' };
    }

    if (url.protocol !== 'https:') {
      return { ok: false, reason: 'invalid-scheme' };
    }
    // Exact hostname match — no subdomains, no "greenpay.app.evil.com",
    // no "evil-greenpay.app". Reject userinfo (e.g. https://greenpay.app@evil.com)
    // by requiring username/password to be empty too.
    if (
      url.hostname !== ALLOWED_HOST ||
      url.username !== '' ||
      url.password !== '' ||
      (url.port !== '' && url.port !== '443')
    ) {
      return { ok: false, reason: 'untrusted-host' };
    }
    if (url.pathname !== ALLOWED_PATH) {
      return { ok: false, reason: 'invalid-path' };
    }

    const projectId = url.searchParams.get('projectId');
    if (!projectId || !PROJECT_ID_RE.test(projectId)) {
      return { ok: false, reason: 'invalid-project-id' };
    }

    return { ok: true, projectId };
  } catch {
    return { ok: false, reason: 'unexpected-error' };
  }
}
