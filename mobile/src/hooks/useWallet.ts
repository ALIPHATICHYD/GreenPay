import { useState, useEffect, useCallback } from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import {
  getWalletPublicKey,
  setWalletPublicKey,
  clearWalletPublicKey,
} from '../../utils/walletKeyStorage';

export function useWallet() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getWalletPublicKey()
      .then((stored) => setPublicKey(stored))
      .finally(() => setLoading(false));
  }, []);

  const connect = useCallback(async (address: string) => {
    setError(null);
    const trimmed = address.trim();

    if (!StrKey.isValidEd25519PublicKey(trimmed)) {
      setError('Invalid Stellar address. Must start with G and be 56 characters.');
      return false;
    }

    await setWalletPublicKey(trimmed);
    setPublicKey(trimmed);
    return true;
  }, []);

  const disconnect = useCallback(async () => {
    await clearWalletPublicKey();
    setPublicKey(null);
  }, []);

  return { publicKey, loading, error, connect, disconnect };
}
