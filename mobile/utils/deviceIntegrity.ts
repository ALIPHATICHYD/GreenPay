/**
 * utils/deviceIntegrity.ts
 *
 * Best-effort jailbreak/root detection, used as defense-in-depth around the
 * wallet key material stored on-device. This is explicitly advisory: it
 * powers a dismissible warning banner (see components/SecurityWarningBanner)
 * and must never be used to block app functionality — jailbreak/root
 * detection has known false positives, and hard-gating on it risks locking
 * out legitimate users.
 */
import JailMonkey from 'jail-monkey';

export interface DeviceIntegrityResult {
  isCompromised: boolean;
}

export function checkDeviceIntegrity(): DeviceIntegrityResult {
  return { isCompromised: JailMonkey.isJailBroken() };
}
