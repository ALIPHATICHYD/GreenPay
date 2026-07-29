/**
 * __tests__/stellarValidation.test.ts
 * Unit tests for the Stellar address validation utilities.
 *
 * Covers: real checksum-valid G-addresses and M-addresses (muxed accounts),
 * checksum-invalid strings that merely match the shape/length of a real
 * address, wrong prefix, wrong length, bad characters, and
 * null/undefined/number/object inputs.
 */
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  isValidStellarAddress,
  isValidStellarMuxedAddress,
  isValidStellarDestination,
} from '../utils/stellarValidation';

// A known checksum-valid Stellar public key (from Stellar's own
// documentation examples) — real, not synthetic filler.
const KNOWN_VALID_ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

// A freshly generated, checksum-valid keypair — exercises the validator
// against an address not hardcoded anywhere else in the codebase.
const RANDOM_VALID_ADDRESS = Keypair.random().publicKey();

// A string with the right prefix and the right length (56 chars, G + 55)
// that is NOT checksum-valid — this is exactly the kind of value a regex
// check would wrongly accept.
const SHAPE_ONLY_ADDRESS = `G${'A'.repeat(55)}`;

// Build a real, checksum-valid muxed account (M...) by combining a real
// ed25519 public key with a sub-account id, per SEP-23.
function buildMuxedAddress(ed25519PublicKey: string, id: bigint): string {
  const raw = StrKey.decodeEd25519PublicKey(ed25519PublicKey);
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64BE(id);
  return StrKey.encodeMed25519PublicKey(Buffer.concat([raw, idBuf]));
}

const VALID_MUXED_ADDRESS = buildMuxedAddress(KNOWN_VALID_ADDRESS, 12345n);

describe('isValidStellarAddress', () => {
  it('accepts a known checksum-valid G-address', () => {
    expect(isValidStellarAddress(KNOWN_VALID_ADDRESS)).toBe(true);
  });

  it('accepts a freshly generated checksum-valid G-address', () => {
    expect(isValidStellarAddress(RANDOM_VALID_ADDRESS)).toBe(true);
  });

  it('rejects a string with the right prefix and length but an invalid checksum', () => {
    expect(isValidStellarAddress(SHAPE_ONLY_ADDRESS)).toBe(false);
  });

  it('rejects an address starting with a lowercase g', () => {
    expect(isValidStellarAddress(KNOWN_VALID_ADDRESS.toLowerCase())).toBe(false);
  });

  it('rejects an address that starts with a character other than G', () => {
    expect(isValidStellarAddress(`S${'A'.repeat(55)}`)).toBe(false);
    expect(isValidStellarAddress(`X${'A'.repeat(55)}`)).toBe(false);
  });

  it('rejects an address that is too short', () => {
    expect(isValidStellarAddress(`G${'A'.repeat(54)}`)).toBe(false);
  });

  it('rejects an address that is too long', () => {
    expect(isValidStellarAddress(`G${'A'.repeat(56)}`)).toBe(false);
  });

  it('rejects an address containing lowercase letters', () => {
    expect(isValidStellarAddress(`G${'a'.repeat(55)}`)).toBe(false);
  });

  it('rejects an address containing spaces', () => {
    expect(isValidStellarAddress(`G${' '.repeat(55)}`)).toBe(false);
  });

  it('rejects a valid muxed (M...) address', () => {
    expect(isValidStellarAddress(VALID_MUXED_ADDRESS)).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidStellarAddress('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidStellarAddress(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidStellarAddress(undefined)).toBe(false);
  });

  it('rejects a number', () => {
    expect(isValidStellarAddress(12345)).toBe(false);
  });

  it('rejects an object', () => {
    expect(isValidStellarAddress({})).toBe(false);
  });
});

describe('isValidStellarMuxedAddress', () => {
  it('accepts a valid muxed (M...) address', () => {
    expect(isValidStellarMuxedAddress(VALID_MUXED_ADDRESS)).toBe(true);
  });

  it('rejects a plain G-address', () => {
    expect(isValidStellarMuxedAddress(KNOWN_VALID_ADDRESS)).toBe(false);
  });

  it('rejects a shape-only, checksum-invalid M-address', () => {
    expect(isValidStellarMuxedAddress(`M${'A'.repeat(68)}`)).toBe(false);
  });

  it('rejects null/undefined/number/object', () => {
    expect(isValidStellarMuxedAddress(null)).toBe(false);
    expect(isValidStellarMuxedAddress(undefined)).toBe(false);
    expect(isValidStellarMuxedAddress(12345)).toBe(false);
    expect(isValidStellarMuxedAddress({})).toBe(false);
  });
});

describe('isValidStellarDestination', () => {
  it('accepts a valid G-address', () => {
    expect(isValidStellarDestination(KNOWN_VALID_ADDRESS)).toBe(true);
  });

  it('accepts a valid M-address', () => {
    expect(isValidStellarDestination(VALID_MUXED_ADDRESS)).toBe(true);
  });

  it('rejects a checksum-invalid, shape-only address', () => {
    expect(isValidStellarDestination(SHAPE_ONLY_ADDRESS)).toBe(false);
  });

  it('rejects garbage strings', () => {
    expect(isValidStellarDestination('not-an-address')).toBe(false);
    expect(isValidStellarDestination('')).toBe(false);
  });

  it('rejects null/undefined/number/object', () => {
    expect(isValidStellarDestination(null)).toBe(false);
    expect(isValidStellarDestination(undefined)).toBe(false);
    expect(isValidStellarDestination(12345)).toBe(false);
    expect(isValidStellarDestination({})).toBe(false);
  });
});
