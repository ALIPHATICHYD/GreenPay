/**
 * __tests__/walletKeyStorage.test.ts
 *
 * Covers utils/walletKeyStorage.ts: normal SecureStore read/write with the
 * strict Keychain accessibility option, and the AsyncStorage -> SecureStore
 * migration path for values stranded by the old, inconsistent code path.
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getWalletPublicKey,
  setWalletPublicKey,
  clearWalletPublicKey,
  WALLET_KEY,
} from '../utils/walletKeyStorage';

beforeEach(() => {
  (AsyncStorage.clear as jest.Mock)();
  (AsyncStorage.getItem as jest.Mock).mockClear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
  (AsyncStorage.removeItem as jest.Mock).mockClear();
  (SecureStore.getItemAsync as jest.Mock).mockClear();
  (SecureStore.setItemAsync as jest.Mock).mockClear();
  (SecureStore.deleteItemAsync as jest.Mock).mockClear();
  // Reset the in-memory store backing the SecureStore mock.
  Object.keys((SecureStore as any).__store).forEach(
    (key) => delete (SecureStore as any).__store[key],
  );
});

const PUBLIC_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

describe('setWalletPublicKey / getWalletPublicKey (normal path)', () => {
  test('writes through SecureStore with the strict accessibility option', async () => {
    await setWalletPublicKey(PUBLIC_KEY);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      WALLET_KEY,
      PUBLIC_KEY,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  });

  test('reads back the value from SecureStore', async () => {
    await setWalletPublicKey(PUBLIC_KEY);

    const result = await getWalletPublicKey();

    expect(result).toBe(PUBLIC_KEY);
  });

  test('returns null when nothing is stored anywhere', async () => {
    const result = await getWalletPublicKey();
    expect(result).toBeNull();
  });
});

describe('getWalletPublicKey (AsyncStorage -> SecureStore migration)', () => {
  test('recovers a value stranded in AsyncStorage, migrates it, and cleans up', async () => {
    // Seed a legacy value the old, buggy code path would have left behind.
    await AsyncStorage.setItem(WALLET_KEY, PUBLIC_KEY);

    const result = await getWalletPublicKey();

    // Value is recovered.
    expect(result).toBe(PUBLIC_KEY);

    // It was written into SecureStore with the strict option.
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      WALLET_KEY,
      PUBLIC_KEY,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );

    // And removed from AsyncStorage afterward.
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(WALLET_KEY);
    const remaining = await AsyncStorage.getItem(WALLET_KEY);
    expect(remaining).toBeNull();

    // A subsequent read no longer needs AsyncStorage at all.
    (AsyncStorage.getItem as jest.Mock).mockClear();
    const secondRead = await getWalletPublicKey();
    expect(secondRead).toBe(PUBLIC_KEY);
  });

  test('prefers the SecureStore value when both are present', async () => {
    await setWalletPublicKey('GSECURE00000000000000000000000000000000000000000000000');
    await AsyncStorage.setItem(WALLET_KEY, 'GLEGACY0000000000000000000000000000000000000000000000');

    const result = await getWalletPublicKey();

    expect(result).toBe('GSECURE00000000000000000000000000000000000000000000000');
  });
});

describe('clearWalletPublicKey', () => {
  test('deletes from both SecureStore and AsyncStorage', async () => {
    await setWalletPublicKey(PUBLIC_KEY);
    await AsyncStorage.setItem(WALLET_KEY, PUBLIC_KEY);

    await clearWalletPublicKey();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(WALLET_KEY);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(WALLET_KEY);
    expect(await getWalletPublicKey()).toBeNull();
  });
});
