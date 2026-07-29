/**
 * utils/useDeviceIntegrity.ts
 *
 * Runs the (synchronous, native-module-backed) jailbreak/root check once per
 * mount and exposes the result as a boolean. Kept separate from
 * deviceIntegrity.ts so plain non-React code can call checkDeviceIntegrity()
 * directly without needing hooks.
 */
import { useState } from 'react';
import { checkDeviceIntegrity } from './deviceIntegrity';

export function useDeviceIntegrity(): { isCompromised: boolean } {
  const [result] = useState(() => checkDeviceIntegrity());
  return result;
}
