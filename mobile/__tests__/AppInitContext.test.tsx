/**
 * __tests__/AppInitContext.test.tsx
 *
 * Unit tests for AppInitProvider and useAppInit.
 * Covers the hydration sequence and deep-link queue behaviour (issue #32).
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AppInitProvider, useAppInit } from '../src/context/AppInitContext';
import { WALLET_KEY } from '../utils/walletKeyStorage';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(AppInitProvider, null, children);

beforeEach(() => {
  (AsyncStorage.clear as jest.Mock)();
  (AsyncStorage.getItem as jest.Mock).mockClear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
  (AsyncStorage.removeItem as jest.Mock).mockClear();
  (SecureStore.getItemAsync as jest.Mock).mockClear();
  (SecureStore.setItemAsync as jest.Mock).mockClear();
  Object.keys((SecureStore as any).__store).forEach(
    (key) => delete (SecureStore as any).__store[key],
  );
});

// ── Hydration ────────────────────────────────────────────────────────────────

test('isHydrated starts false and becomes true after AsyncStorage read', async () => {
  const { result } = renderHook(() => useAppInit(), { wrapper });

  expect(result.current.isHydrated).toBe(false);

  await act(async () => {});

  expect(result.current.isHydrated).toBe(true);
});

test('restores walletPublicKey from SecureStore on hydration', async () => {
  await SecureStore.setItemAsync(WALLET_KEY, 'GTEST123');

  const { result } = renderHook(() => useAppInit(), { wrapper });
  await act(async () => {});

  expect(result.current.walletPublicKey).toBe('GTEST123');
});

test('walletPublicKey is null when nothing stored', async () => {
  const { result } = renderHook(() => useAppInit(), { wrapper });
  await act(async () => {});

  expect(result.current.walletPublicKey).toBeNull();
});

test('migrates a legacy AsyncStorage value into SecureStore during hydration', async () => {
  // Simulate a device that hit the old, inconsistent storage code and has a
  // wallet key stranded in AsyncStorage instead of SecureStore.
  await AsyncStorage.setItem(WALLET_KEY, 'GLEGACY456');

  const { result } = renderHook(() => useAppInit(), { wrapper });
  await act(async () => {});

  // Hydration still recovers the value...
  expect(result.current.walletPublicKey).toBe('GLEGACY456');
  // ...and the migration path has moved it into SecureStore...
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    WALLET_KEY,
    'GLEGACY456',
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
  // ...and cleaned it up from AsyncStorage.
  expect(await AsyncStorage.getItem(WALLET_KEY)).toBeNull();
});

// ── Deep-link queue ──────────────────────────────────────────────────────────

test('queueDeepLink holds URL until hydrated, then fires handler', async () => {
  const handler = jest.fn();
  const { result } = renderHook(() => useAppInit(), { wrapper });

  // Queue before hydration completes
  act(() => {
    result.current.queueDeepLink('greenpay://project/1');
    result.current.onDeepLinkReady(handler);
  });

  expect(handler).not.toHaveBeenCalled();

  // Let hydration finish
  await act(async () => {});

  expect(handler).toHaveBeenCalledWith('greenpay://project/1');
  expect(handler).toHaveBeenCalledTimes(1);
});

test('onDeepLinkReady fires immediately if already hydrated', async () => {
  const handler = jest.fn();
  const { result } = renderHook(() => useAppInit(), { wrapper });

  // Hydrate first
  await act(async () => {});
  expect(result.current.isHydrated).toBe(true);

  // Queue a URL after hydration — should call handler right away
  act(() => {
    result.current.onDeepLinkReady(handler);
    result.current.queueDeepLink('greenpay://donate/GABC');
  });

  expect(handler).toHaveBeenCalledWith('greenpay://donate/GABC');
});

test('queued URL is only processed once even if onDeepLinkReady called twice', async () => {
  const handler = jest.fn();
  const { result } = renderHook(() => useAppInit(), { wrapper });

  act(() => {
    result.current.queueDeepLink('greenpay://project/dupe');
    result.current.onDeepLinkReady(handler);
    result.current.onDeepLinkReady(handler); // re-register (should not double-fire)
  });

  await act(async () => {});

  expect(handler).toHaveBeenCalledTimes(1);
});

test('throws when used outside AppInitProvider', () => {
  // Suppress React error boundary noise in test output
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => renderHook(() => useAppInit())).toThrow(
    'useAppInit must be used inside <AppInitProvider>',
  );
  spy.mockRestore();
});
