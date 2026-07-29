/**
 * utils/stellarValidation.ts
 * Stellar address validation for the mobile app.
 *
 * Validates real ed25519/muxed checksums via `@stellar/stellar-sdk`'s
 * `StrKey` (the same primitive used by `src/hooks/useWallet.ts`) instead of
 * a shape-only regex. A string that merely *looks* like a Stellar address
 * (right prefix, right length) is not guaranteed to be a real, checksum-valid
 * account id — accepting shape alone would let a single mistyped or
 * adversarially-crafted character through undetected.
 */
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Returns true when `address` is a valid Stellar Ed25519 public key (G…),
 * verified via StrKey's checksum check (not just a regex on shape).
 *
 * Kept for backward compatibility with existing callers; new code that
 * needs to accept any valid payment destination (including muxed accounts)
 * should use `isValidStellarDestination` instead.
 */
export function isValidStellarAddress(address: unknown): address is string {
  if (typeof address !== 'string') return false;
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

/**
 * Returns true when `address` is a valid Stellar muxed account (M…), as
 * defined by SEP-23. Muxed accounts encode an ed25519 public key plus a
 * 64-bit sub-account id and are a legitimate payment destination distinct
 * from a plain G-address.
 */
export function isValidStellarMuxedAddress(address: unknown): address is string {
  if (typeof address !== 'string') return false;
  try {
    return StrKey.isValidMed25519PublicKey(address);
  } catch {
    return false;
  }
}

/**
 * Returns true when `address` is a valid Stellar payment destination —
 * either a plain ed25519 account (G…) or a SEP-23 muxed account (M…).
 * This is the check new code should use when validating a scanned or
 * user-supplied payment destination.
 */
export function isValidStellarDestination(address: unknown): address is string {
  return isValidStellarAddress(address) || isValidStellarMuxedAddress(address);
}
