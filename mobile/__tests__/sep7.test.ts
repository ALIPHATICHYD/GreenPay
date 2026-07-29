/**
 * __tests__/sep7.test.ts
 * Unit tests for the SEP-0007 payment URI parser.
 *
 * Covers: a valid pay request (with and without optional fields), each
 * documented failure reason (wrong scheme, wrong operation, invalid/missing
 * destination, invalid amount, network mismatch), and defensive handling of
 * malformed/garbage input.
 */
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { parseSep7PayUri } from '../utils/sep7';

const VALID_DESTINATION = Keypair.random().publicKey();
const OTHER_VALID_DESTINATION = Keypair.random().publicKey();

describe('parseSep7PayUri', () => {
  describe('valid requests', () => {
    it('accepts a minimal valid pay URI', () => {
      const result = parseSep7PayUri(`web+stellar:pay?destination=${VALID_DESTINATION}`);
      expect(result).toEqual({ ok: true, destination: VALID_DESTINATION });
    });

    it('accepts a pay URI with a valid amount', () => {
      const result = parseSep7PayUri(`web+stellar:pay?destination=${VALID_DESTINATION}&amount=5.5`);
      expect(result).toEqual({ ok: true, destination: VALID_DESTINATION, amount: '5.5' });
    });

    it('accepts a pay URI whose network_passphrase matches the expected (default testnet) network', () => {
      const result = parseSep7PayUri(
        `web+stellar:pay?destination=${VALID_DESTINATION}&network_passphrase=${encodeURIComponent(
          Networks.TESTNET
        )}`
      );
      expect(result).toEqual({ ok: true, destination: VALID_DESTINATION });
    });

    it('passes through memo and memo_type', () => {
      const result = parseSep7PayUri(
        `web+stellar:pay?destination=${VALID_DESTINATION}&memo=Thanks!&memo_type=MEMO_TEXT`
      );
      expect(result).toEqual({
        ok: true,
        destination: VALID_DESTINATION,
        memo: 'Thanks!',
        memoType: 'MEMO_TEXT',
      });
    });

    it('uses only the first destination when the query param is duplicated', () => {
      const result = parseSep7PayUri(
        `web+stellar:pay?destination=${VALID_DESTINATION}&destination=${OTHER_VALID_DESTINATION}`
      );
      expect(result).toEqual({ ok: true, destination: VALID_DESTINATION });
    });
  });

  describe('invalid scheme / operation', () => {
    it('rejects a plain https URL', () => {
      const result = parseSep7PayUri(`https://greenpay.app/donate?projectId=x`);
      expect(result).toEqual({ ok: false, reason: 'invalid-scheme' });
    });

    it('rejects a javascript: scheme', () => {
      const result = parseSep7PayUri('javascript:alert(1)');
      expect(result).toEqual({ ok: false, reason: 'invalid-scheme' });
    });

    it('rejects a non-pay SEP-7 operation (tx)', () => {
      const result = parseSep7PayUri('web+stellar:tx?xdr=AAAA');
      expect(result).toEqual({ ok: false, reason: 'invalid-operation' });
    });

    it('rejects the authority form web+stellar://pay?...', () => {
      const result = parseSep7PayUri(`web+stellar://pay?destination=${VALID_DESTINATION}`);
      expect(result.ok).toBe(false);
    });

    it('rejects a case-mismatched operation (PAY)', () => {
      const result = parseSep7PayUri(`web+stellar:PAY?destination=${VALID_DESTINATION}`);
      expect(result).toEqual({ ok: false, reason: 'invalid-operation' });
    });
  });

  describe('destination validation', () => {
    it('rejects a missing destination', () => {
      const result = parseSep7PayUri('web+stellar:pay?amount=5');
      expect(result).toEqual({ ok: false, reason: 'invalid-destination' });
    });

    it('rejects a checksum-invalid destination that has the right shape/length', () => {
      const shapeOnly = `G${'A'.repeat(55)}`;
      const result = parseSep7PayUri(`web+stellar:pay?destination=${shapeOnly}`);
      expect(result).toEqual({ ok: false, reason: 'invalid-destination' });
    });

    it('rejects an empty destination', () => {
      const result = parseSep7PayUri('web+stellar:pay?destination=');
      expect(result).toEqual({ ok: false, reason: 'invalid-destination' });
    });
  });

  describe('amount validation', () => {
    it.each(['-5', '0', 'NaN', 'Infinity', '1e10', '5.5.5', 'abc', '1'.repeat(40)])(
      'rejects invalid amount %p',
      (amount) => {
        const result = parseSep7PayUri(
          `web+stellar:pay?destination=${VALID_DESTINATION}&amount=${encodeURIComponent(amount)}`
        );
        expect(result).toEqual({ ok: false, reason: 'invalid-amount' });
      }
    );

    it('accepts a whole-number amount', () => {
      const result = parseSep7PayUri(`web+stellar:pay?destination=${VALID_DESTINATION}&amount=100`);
      expect(result).toEqual({ ok: true, destination: VALID_DESTINATION, amount: '100' });
    });
  });

  describe('network passphrase validation', () => {
    it('rejects a mismatched network passphrase (mainnet payload on testnet app)', () => {
      const result = parseSep7PayUri(
        `web+stellar:pay?destination=${VALID_DESTINATION}&network_passphrase=${encodeURIComponent(
          Networks.PUBLIC
        )}`
      );
      expect(result).toEqual({ ok: false, reason: 'network-mismatch' });
    });

    it('rejects a garbage network passphrase', () => {
      const result = parseSep7PayUri(
        `web+stellar:pay?destination=${VALID_DESTINATION}&network_passphrase=not-a-real-network`
      );
      expect(result).toEqual({ ok: false, reason: 'network-mismatch' });
    });
  });

  describe('defensive handling of malformed input', () => {
    it('never throws and rejects a non-string input', () => {
      // @ts-expect-error deliberately passing a non-string
      expect(() => parseSep7PayUri(12345)).not.toThrow();
      // @ts-expect-error deliberately passing a non-string
      expect(parseSep7PayUri(12345).ok).toBe(false);
    });

    it('rejects an empty string', () => {
      expect(parseSep7PayUri('').ok).toBe(false);
    });

    it('rejects an extremely long string', () => {
      const huge = `web+stellar:pay?destination=${VALID_DESTINATION}&junk=${'a'.repeat(10000)}`;
      expect(parseSep7PayUri(huge)).toEqual({ ok: false, reason: 'too-long' });
    });

    it('rejects a string containing an embedded control character', () => {
      const controlChar = String.fromCharCode(1);
      const withControlChar = `web+stellar:pay?destination=${VALID_DESTINATION}${controlChar}`;
      const result = parseSep7PayUri(withControlChar);
      expect(result).toEqual({ ok: false, reason: 'invalid-characters' });
    });

    it('rejects a string containing an embedded null character', () => {
      const nullChar = String.fromCharCode(0);
      const withNullChar = `web+stellar:pay?destination=${VALID_DESTINATION}${nullChar}`;
      const result = parseSep7PayUri(withNullChar);
      expect(result).toEqual({ ok: false, reason: 'invalid-characters' });
    });

    it('never throws on completely unrelated garbage', () => {
      const inputs = ['', '???', 'web+stellar:', 'web+stellar:pay?', '%%%%', String.fromCharCode(9)];
      for (const input of inputs) {
        expect(() => parseSep7PayUri(input)).not.toThrow();
      }
    });
  });
});
