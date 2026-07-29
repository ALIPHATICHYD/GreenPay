/**
 * __tests__/useWallet.test.ts
 *
 * Unit tests for useWallet, which now persists the connected public key via
 * utils/walletKeyStorage (backed by expo-secure-store) instead of touching
 * SecureStore directly.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWallet } from '../src/hooks/useWallet';
import { WALLET_KEY } from '../utils/walletKeyStorage';

const VALID_KEY = 'GA4JHZX455IELW533547WFB5LV57LLSUJURFFIIYG7AV4HTQNW4W4FUD';

beforeEach(() => {
  (AsyncStorage.clear as jest.Mock)();
  (SecureStore.getItemAsync as jest.Mock).mockClear();
  (SecureStore.setItemAsync as jest.Mock).mockClear();
  (SecureStore.deleteItemAsync as jest.Mock).mockClear();
  Object.keys((SecureStore as any).__store).forEach(
    (key) => delete (SecureStore as any).__store[key],
  );
});

test('starts with no public key and loading true, then loading false', async () => {
  const { result } = renderHook(() => useWallet());

  expect(result.current.loading).toBe(true);
  expect(result.current.publicKey).toBeNull();

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.publicKey).toBeNull();
});

test('restores a previously connected public key from SecureStore on mount', async () => {
  await SecureStore.setItemAsync(WALLET_KEY, VALID_KEY);

  const { result } = renderHook(() => useWallet());
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.publicKey).toBe(VALID_KEY);
});

test('connect() rejects an invalid address and does not persist it', async () => {
  const { result } = renderHook(() => useWallet());
  await waitFor(() => expect(result.current.loading).toBe(false));

  let success: boolean = true;
  await act(async () => {
    success = await result.current.connect('not-a-valid-address');
  });

  expect(success).toBe(false);
  expect(result.current.error).toMatch(/Invalid Stellar address/);
  expect(result.current.publicKey).toBeNull();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

test('connect() persists a valid address via SecureStore with the strict option', async () => {
  const { result } = renderHook(() => useWallet());
  await waitFor(() => expect(result.current.loading).toBe(false));

  let success: boolean = false;
  await act(async () => {
    success = await result.current.connect(VALID_KEY);
  });

  expect(success).toBe(true);
  expect(result.current.publicKey).toBe(VALID_KEY);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    WALLET_KEY,
    VALID_KEY,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
});

test('disconnect() clears the public key from SecureStore and state', async () => {
  const { result } = renderHook(() => useWallet());
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    await result.current.connect(VALID_KEY);
  });
  expect(result.current.publicKey).toBe(VALID_KEY);

  await act(async () => {
    await result.current.disconnect();
  });

  expect(result.current.publicKey).toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(WALLET_KEY);
});
