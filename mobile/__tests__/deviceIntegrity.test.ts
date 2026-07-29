/**
 * __tests__/deviceIntegrity.test.ts
 *
 * Unit tests for utils/deviceIntegrity.ts and utils/useDeviceIntegrity.ts.
 * jail-monkey is a native module, mocked in __mocks__/jail-monkey.js.
 */
import { renderHook } from '@testing-library/react-native';
import JailMonkey from 'jail-monkey';
import { checkDeviceIntegrity } from '../utils/deviceIntegrity';
import { useDeviceIntegrity } from '../utils/useDeviceIntegrity';

beforeEach(() => {
  (JailMonkey.isJailBroken as jest.Mock).mockClear();
  (JailMonkey.isJailBroken as jest.Mock).mockReturnValue(false);
});

describe('checkDeviceIntegrity', () => {
  test('reports not compromised when JailMonkey.isJailBroken() is false', () => {
    (JailMonkey.isJailBroken as jest.Mock).mockReturnValue(false);

    expect(checkDeviceIntegrity()).toEqual({ isCompromised: false });
  });

  test('reports compromised when JailMonkey.isJailBroken() is true', () => {
    (JailMonkey.isJailBroken as jest.Mock).mockReturnValue(true);

    expect(checkDeviceIntegrity()).toEqual({ isCompromised: true });
  });
});

describe('useDeviceIntegrity', () => {
  test('exposes isCompromised: false for a clean device', () => {
    (JailMonkey.isJailBroken as jest.Mock).mockReturnValue(false);

    const { result } = renderHook(() => useDeviceIntegrity());

    expect(result.current.isCompromised).toBe(false);
  });

  test('exposes isCompromised: true for a jailbroken/rooted device', () => {
    (JailMonkey.isJailBroken as jest.Mock).mockReturnValue(true);

    const { result } = renderHook(() => useDeviceIntegrity());

    expect(result.current.isCompromised).toBe(true);
  });
});
