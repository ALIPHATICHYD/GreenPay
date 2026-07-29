/**
 * __tests__/qrFuzz.test.ts
 * Property-based (fuzz) tests for the two QR/deep-link parsers that sit
 * directly between "arbitrary bytes scanned from a camera" and "a Stellar
 * payment destination the app might navigate to."
 *
 * These parsers (`parseSep7PayUri`, `parseGreenPayDonationLink`) must:
 *   (a) never throw, no matter how hostile or malformed the input, and
 *   (b) always resolve to a well-formed `{ ok: false, reason: string }` or
 *       a well-formed success shape — never `undefined` or a partial object.
 *
 * Plus a handful of hand-picked adversarial cases that are easy to miss
 * with pure randomization: wrong network passphrase, a checksum-invalid
 * destination with the exact right shape, a `javascript:` scheme, and a
 * confusable host.
 */
import fc from 'fast-check';
import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';
import { parseSep7PayUri, Sep7PayResult } from '../utils/sep7';
import { parseGreenPayDonationLink, GreenPayLinkResult } from '../utils/qrPayload';

const VALID_DESTINATION = Keypair.random().publicKey();

function isWellFormedSep7Result(result: Sep7PayResult): boolean {
  if (result === null || typeof result !== 'object') return false;
  if (result.ok === true) {
    return typeof result.destination === 'string' && result.destination.length > 0;
  }
  if (result.ok === false) {
    return typeof (result as any).reason === 'string' && (result as any).reason.length > 0;
  }
  return false;
}

function isWellFormedGreenPayResult(result: GreenPayLinkResult): boolean {
  if (result === null || typeof result !== 'object') return false;
  if (result.ok === true) {
    return typeof result.projectId === 'string' && result.projectId.length > 0;
  }
  if (result.ok === false) {
    return typeof (result as any).reason === 'string' && (result as any).reason.length > 0;
  }
  return false;
}

describe('QR parser fuzzing: never throws, always well-formed', () => {
  it('parseSep7PayUri never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (input) => {
        let result: Sep7PayResult;
        expect(() => {
          result = parseSep7PayUri(input);
        }).not.toThrow();
        expect(isWellFormedSep7Result(result!)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('parseSep7PayUri never throws on arbitrary unicode (including confusables)', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString({ maxLength: 300 }), (input) => {
        let result: Sep7PayResult;
        expect(() => {
          result = parseSep7PayUri(input);
        }).not.toThrow();
        expect(isWellFormedSep7Result(result!)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('parseSep7PayUri never throws on non-string input of any type', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        let result: Sep7PayResult;
        expect(() => {
          result = parseSep7PayUri(input as any);
        }).not.toThrow();
        expect(isWellFormedSep7Result(result!)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('parseSep7PayUri never throws on web+stellar:pay? plus garbage query strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (garbage) => {
        const input = `web+stellar:pay?${garbage}`;
        let result: Sep7PayResult;
        expect(() => {
          result = parseSep7PayUri(input);
        }).not.toThrow();
        expect(isWellFormedSep7Result(result!)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('parseSep7PayUri never throws on extremely long strings', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 4001, maxLength: 20000 }), (input) => {
        let result: Sep7PayResult;
        expect(() => {
          result = parseSep7PayUri(input);
        }).not.toThrow();
        expect(isWellFormedSep7Result(result!)).toBe(true);
        expect(result!.ok).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  it('parseSep7PayUri never throws on strings containing control/null characters', () => {
    const controlChar = fc.integer({ min: 0, max: 31 }).map((code) => String.fromCharCode(code));
    fc.assert(
      fc.property(
        fc.string({ maxLength: 100 }),
        controlChar,
        fc.string({ maxLength: 100 }),
        (prefix, ctrl, suffix) => {
          const input = `${prefix}${ctrl}${suffix}`;
          let result: Sep7PayResult;
          expect(() => {
            result = parseSep7PayUri(input);
          }).not.toThrow();
          expect(isWellFormedSep7Result(result!)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('parseGreenPayDonationLink never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (input) => {
        let result: GreenPayLinkResult;
        expect(() => {
          result = parseGreenPayDonationLink(input);
        }).not.toThrow();
        expect(isWellFormedGreenPayResult(result!)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('parseGreenPayDonationLink never throws on arbitrary unicode (including confusables)', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString({ maxLength: 300 }), (input) => {
        let result: GreenPayLinkResult;
        expect(() => {
          result = parseGreenPayDonationLink(input);
        }).not.toThrow();
        expect(isWellFormedGreenPayResult(result!)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('parseGreenPayDonationLink never throws on non-string input of any type', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        let result: GreenPayLinkResult;
        expect(() => {
          result = parseGreenPayDonationLink(input as any);
        }).not.toThrow();
        expect(isWellFormedGreenPayResult(result!)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('parseGreenPayDonationLink never throws on greenpay:// plus garbage', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (garbage) => {
        const input = `greenpay://donate/${garbage}`;
        let result: GreenPayLinkResult;
        expect(() => {
          result = parseGreenPayDonationLink(input);
        }).not.toThrow();
        expect(isWellFormedGreenPayResult(result!)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('parseGreenPayDonationLink never throws on extremely long strings', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 4001, maxLength: 20000 }), (input) => {
        let result: GreenPayLinkResult;
        expect(() => {
          result = parseGreenPayDonationLink(input);
        }).not.toThrow();
        expect(isWellFormedGreenPayResult(result!)).toBe(true);
        expect(result!.ok).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  it('parseGreenPayDonationLink never throws on strings with control/null characters', () => {
    const controlChar = fc.integer({ min: 0, max: 31 }).map((code) => String.fromCharCode(code));
    fc.assert(
      fc.property(
        fc.string({ maxLength: 100 }),
        controlChar,
        fc.string({ maxLength: 100 }),
        (prefix, ctrl, suffix) => {
          const input = `${prefix}${ctrl}${suffix}`;
          let result: GreenPayLinkResult;
          expect(() => {
            result = parseGreenPayDonationLink(input);
          }).not.toThrow();
          expect(isWellFormedGreenPayResult(result!)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('near-miss destinations with a single flipped character are rejected', () => {
    const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    // Flip one character at a handful of positions across the address —
    // each of these has been confirmed (via StrKey) to break the checksum,
    // so the parser must reject every one of them.
    for (const position of [1, 10, 20, 30, 40, 54]) {
      const chars = VALID_DESTINATION.split('');
      const current = chars[position];
      const replacement = base32Alphabet.split('').find((c) => c !== current)!;
      chars[position] = replacement;
      const mutated = chars.join('');

      // Sanity check: confirm the mutation really did break the checksum
      // (guards against an astronomically unlikely accidental collision).
      expect(StrKey.isValidEd25519PublicKey(mutated)).toBe(false);

      const result = parseSep7PayUri(`web+stellar:pay?destination=${mutated}`);
      expect(result).toEqual({ ok: false, reason: 'invalid-destination' });
    }
  });
});

describe('Hand-picked adversarial cases', () => {
  it('rejects a SEP-7 URI targeting the wrong network (mainnet payload on testnet app)', () => {
    const result = parseSep7PayUri(
      `web+stellar:pay?destination=${VALID_DESTINATION}&network_passphrase=${encodeURIComponent(
        Networks.PUBLIC
      )}`
    );
    expect(result).toEqual({ ok: false, reason: 'network-mismatch' });
  });

  it('rejects a non-checksum-valid destination that is the right shape/length', () => {
    const shapeOnly = `G${'A'.repeat(55)}`;
    expect(shapeOnly.length).toBe(56);
    const result = parseSep7PayUri(`web+stellar:pay?destination=${shapeOnly}`);
    expect(result).toEqual({ ok: false, reason: 'invalid-destination' });
  });

  it('rejects a javascript: scheme masquerading as a payment link', () => {
    const result = parseSep7PayUri('javascript:alert(document.cookie)');
    expect(result).toEqual({ ok: false, reason: 'invalid-scheme' });
  });

  it('rejects a confusable host (greenpay.app.evil.com) for the GreenPay link format', () => {
    const result = parseGreenPayDonationLink('https://greenpay.app.evil.com/donate?projectId=x');
    expect(result).toEqual({ ok: false, reason: 'untrusted-host' });
  });
});
