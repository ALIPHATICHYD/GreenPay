/**
 * utils/stellarNetwork.ts
 * Resolves which Stellar network the app expects to operate on, mirroring
 * the web app's `NEXT_PUBLIC_STELLAR_NETWORK` pattern via
 * `EXPO_PUBLIC_STELLAR_NETWORK`.
 *
 * Used to reject SEP-7 payment requests (or any other payload that names a
 * network passphrase) that target a different Stellar network than the one
 * this build of the app is configured for.
 */
import { Networks } from '@stellar/stellar-sdk';

export type StellarNetworkLabel = 'testnet' | 'public';

/**
 * Returns the network label ('testnet' | 'public') this app build expects,
 * read from EXPO_PUBLIC_STELLAR_NETWORK. Accepts 'mainnet' as an alias for
 * 'public'. Defaults to 'testnet' when unset.
 */
export function getExpectedNetworkLabel(): StellarNetworkLabel {
  const raw = (process.env.EXPO_PUBLIC_STELLAR_NETWORK || '').trim().toLowerCase();
  if (raw === 'public' || raw === 'mainnet') return 'public';
  return 'testnet';
}

/** Returns the Stellar network passphrase this app build expects. */
export function getExpectedNetworkPassphrase(): string {
  return getExpectedNetworkLabel() === 'public' ? Networks.PUBLIC : Networks.TESTNET;
}
