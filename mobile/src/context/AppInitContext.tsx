/**
 * src/context/AppInitContext.tsx
 *
 * Provides a strict, ordered app-initialization sequence that solves the
 * deep-link / state-hydration race condition described in issue #32.
 *
 * Startup dependency graph:
 *   1. SecureStore read (via utils/walletKeyStorage) (wallet public key)
 *   2. isHydrated = true                 (state is safe to read)
 *   3. Pending deep-link processed       (navigation is now safe)
 *
 * Any deep link that arrives before step 2 is queued in a ref and replayed
 * exactly once after hydration completes. Subsequent links (warm start) are
 * processed immediately because isHydrated is already true.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { getWalletPublicKey } from '../../utils/walletKeyStorage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppInitState {
  /** True once all local-storage reads have completed and the root state is safe to use. */
  isHydrated: boolean;
  /** Wallet public key restored from SecureStore during hydration (null if not connected). */
  walletPublicKey: string | null;
  /**
   * Queue a deep-link URL to be processed after hydration.
   * If already hydrated the URL is returned immediately via the callback so
   * callers can decide whether to process it right away.
   */
  queueDeepLink: (url: string) => void;
  /**
   * Register a handler that will be called once — either immediately (if
   * already hydrated) or after hydration completes — with the pending URL.
   */
  onDeepLinkReady: (handler: (url: string) => void) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AppInitContext = createContext<AppInitState | null>(null);

export function useAppInit(): AppInitState {
  const ctx = useContext(AppInitContext);
  if (!ctx) {
    throw new Error('useAppInit must be used inside <AppInitProvider>');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppInitProvider({ children }: { children: React.ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [walletPublicKey, setWalletPublicKey] = useState<string | null>(null);

  // Queue holds at most one pending deep-link URL (cold-start scenario).
  const pendingUrl = useRef<string | null>(null);
  // Registered handler supplied by useDeepLink.
  const deepLinkHandler = useRef<((url: string) => void) | null>(null);

  // ── Step 1: hydrate all local state ──────────────────────────────────────
  useEffect(() => {
    async function hydrate() {
      try {
        // Restore wallet key via the shared helper (same source useWallet
        // reads/writes, including its AsyncStorage->SecureStore migration).
        const stored = await getWalletPublicKey();
        setWalletPublicKey(stored ?? null);
      } catch {
        // Non-fatal — app continues without a pre-loaded wallet.
      } finally {
        // ── Step 2: mark hydration complete ──────────────────────────────
        setIsHydrated(true);
      }
    }

    hydrate();
  }, []);

  // ── Step 3: flush pending deep link once hydration finishes ──────────────
  useEffect(() => {
    if (!isHydrated) return;
    if (pendingUrl.current && deepLinkHandler.current) {
      deepLinkHandler.current(pendingUrl.current);
      pendingUrl.current = null;
    }
  }, [isHydrated]);

  // ── Public API ────────────────────────────────────────────────────────────

  const queueDeepLink = useCallback((url: string) => {
    if (isHydrated) {
      // Already hydrated — handler can process immediately (warm start).
      deepLinkHandler.current?.(url);
    } else {
      // Not yet hydrated — store for later replay.
      pendingUrl.current = url;
    }
  }, [isHydrated]);

  const onDeepLinkReady = useCallback((handler: (url: string) => void) => {
    deepLinkHandler.current = handler;

    // If hydration already finished before the handler was registered,
    // flush any queued URL right now.
    if (isHydrated && pendingUrl.current) {
      handler(pendingUrl.current);
      pendingUrl.current = null;
    }
  }, [isHydrated]);

  return (
    <AppInitContext.Provider value={{ isHydrated, walletPublicKey, queueDeepLink, onDeepLinkReady }}>
      {children}
    </AppInitContext.Provider>
  );
}
