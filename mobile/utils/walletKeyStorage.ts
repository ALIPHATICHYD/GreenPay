/**
 * utils/walletKeyStorage.ts
 *
 * Single source of truth for persisting the connected wallet's Stellar
 * *public* key (never the secret key — that is never persisted anywhere,
 * see mobile/app/donate/[id].tsx).
 *
 * Historically `useWallet.ts` wrote this value to expo-secure-store while
 * `AppInitContext.tsx` read it back from AsyncStorage under the same key
 * name. Since the two storage backends are not connected, the hydration
 * read never saw anything `useWallet` wrote. Routing both call sites
 * through this module fixes that by construction, and the migration logic
 * below recovers any value that may already be stranded in AsyncStorage on
 * a device that hit the old, broken code path.
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const WALLET_KEY = 'greenpay_stellar_public_key';

// Strictest available iOS Keychain protection class: only accessible while
// the device is unlocked, and never included in backups/migrations to a
// new device. Android's Keystore-backed encryption under expo-secure-store
// is already hardware-backed where available, so no extra options are
// needed (or possible) on that side.
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function getWalletPublicKey(): Promise<string | null> {
  const stored = await SecureStore.getItemAsync(WALLET_KEY);
  if (stored) {
    return stored;
  }

  // Migration path: recover a value stranded in AsyncStorage by the old,
  // inconsistent storage code, then move it into SecureStore and clean up.
  const legacy = await AsyncStorage.getItem(WALLET_KEY);
  if (legacy) {
    await SecureStore.setItemAsync(WALLET_KEY, legacy, SECURE_STORE_OPTIONS);
    await AsyncStorage.removeItem(WALLET_KEY);
    return legacy;
  }

  return null;
}

export async function setWalletPublicKey(value: string): Promise<void> {
  await SecureStore.setItemAsync(WALLET_KEY, value, SECURE_STORE_OPTIONS);
}

export async function clearWalletPublicKey(): Promise<void> {
  await SecureStore.deleteItemAsync(WALLET_KEY);
  // Defensive cleanup in case a legacy value is still sitting in
  // AsyncStorage from before the migration path had a chance to run.
  await AsyncStorage.removeItem(WALLET_KEY);
}
