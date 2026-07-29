/**
 * __tests__/qrPayload.test.ts
 * Unit tests for GreenPay's own donation-link QR parser.
 *
 * Covers: the two accepted formats (https://greenpay.app/donate?projectId=
 * and greenpay://donate/<id>), the host allowlist (rejecting subdomains,
 * confusable hosts, and userinfo tricks), the projectId charset/length
 * constraint, and defensive handling of malformed input.
 */
import { parseGreenPayDonationLink } from '../utils/qrPayload';

describe('parseGreenPayDonationLink', () => {
  describe('valid links', () => {
    it('accepts the canonical https donation link', () => {
      const result = parseGreenPayDonationLink('https://greenpay.app/donate?projectId=proj-123');
      expect(result).toEqual({ ok: true, projectId: 'proj-123' });
    });

    it('accepts the custom-scheme short form', () => {
      const result = parseGreenPayDonationLink('greenpay://donate/proj-123');
      expect(result).toEqual({ ok: true, projectId: 'proj-123' });
    });

    it('accepts a projectId at the max allowed length (64 chars)', () => {
      const id = 'a'.repeat(64);
      const result = parseGreenPayDonationLink(`https://greenpay.app/donate?projectId=${id}`);
      expect(result).toEqual({ ok: true, projectId: id });
    });
  });

  describe('host allowlist', () => {
    it('rejects an arbitrary host with a projectId query param', () => {
      const result = parseGreenPayDonationLink('https://evil.com/?projectId=x');
      expect(result.ok).toBe(false);
    });

    it('rejects a confusable subdomain host', () => {
      const result = parseGreenPayDonationLink('https://greenpay.app.evil.com/donate?projectId=x');
      expect(result).toEqual({ ok: false, reason: 'untrusted-host' });
    });

    it('rejects a look-alike host', () => {
      const result = parseGreenPayDonationLink('https://evil-greenpay.app/donate?projectId=x');
      expect(result).toEqual({ ok: false, reason: 'untrusted-host' });
    });

    it('rejects userinfo smuggling (https://greenpay.app@evil.com/...)', () => {
      const result = parseGreenPayDonationLink('https://greenpay.app@evil.com/donate?projectId=x');
      expect(result.ok).toBe(false);
    });

    it('rejects http (non-https) scheme', () => {
      const result = parseGreenPayDonationLink('http://greenpay.app/donate?projectId=x');
      expect(result).toEqual({ ok: false, reason: 'invalid-scheme' });
    });

    it('rejects the wrong path', () => {
      const result = parseGreenPayDonationLink('https://greenpay.app/give?projectId=x');
      expect(result).toEqual({ ok: false, reason: 'invalid-path' });
    });

    it('rejects an unexpected port', () => {
      const result = parseGreenPayDonationLink('https://greenpay.app:8443/donate?projectId=x');
      expect(result).toEqual({ ok: false, reason: 'untrusted-host' });
    });
  });

  describe('projectId charset / length', () => {
    it('rejects an empty projectId', () => {
      const result = parseGreenPayDonationLink('https://greenpay.app/donate?projectId=');
      expect(result).toEqual({ ok: false, reason: 'invalid-project-id' });
    });

    it('rejects a projectId over the max length', () => {
      const id = 'a'.repeat(65);
      const result = parseGreenPayDonationLink(`https://greenpay.app/donate?projectId=${id}`);
      expect(result).toEqual({ ok: false, reason: 'invalid-project-id' });
    });

    it('rejects a projectId with unsafe characters (path traversal attempt)', () => {
      const result = parseGreenPayDonationLink('https://greenpay.app/donate?projectId=../../etc/passwd');
      expect(result).toEqual({ ok: false, reason: 'invalid-project-id' });
    });

    it('rejects a custom-scheme id with extra path segments', () => {
      const result = parseGreenPayDonationLink('greenpay://donate/proj-123/extra');
      expect(result).toEqual({ ok: false, reason: 'invalid-project-id' });
    });

    it('rejects a custom-scheme id with a query string appended', () => {
      const result = parseGreenPayDonationLink('greenpay://donate/proj-123?evil=1');
      expect(result).toEqual({ ok: false, reason: 'invalid-project-id' });
    });
  });

  describe('defensive handling of malformed input', () => {
    it('never throws and rejects a non-string input', () => {
      // @ts-expect-error deliberately passing a non-string
      expect(() => parseGreenPayDonationLink(null)).not.toThrow();
      // @ts-expect-error deliberately passing a non-string
      expect(parseGreenPayDonationLink(null).ok).toBe(false);
    });

    it('rejects an empty string', () => {
      expect(parseGreenPayDonationLink('').ok).toBe(false);
    });

    it('rejects an extremely long string', () => {
      const huge = `https://greenpay.app/donate?projectId=x&junk=${'a'.repeat(10000)}`;
      expect(parseGreenPayDonationLink(huge)).toEqual({ ok: false, reason: 'too-long' });
    });

    it('rejects a string with an embedded control character', () => {
      const controlChar = String.fromCharCode(2);
      const result = parseGreenPayDonationLink(`https://greenpay.app/donate?projectId=x${controlChar}`);
      expect(result).toEqual({ ok: false, reason: 'invalid-characters' });
    });

    it('never throws on unrelated garbage', () => {
      const inputs = ['', '???', 'not a url at all', '%%%%', 'greenpay://', 'greenpay://donate/'];
      for (const input of inputs) {
        expect(() => parseGreenPayDonationLink(input)).not.toThrow();
      }
    });
  });
});
