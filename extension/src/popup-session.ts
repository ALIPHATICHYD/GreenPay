import type { ProjectSummary, RecoverySnapshot, WalletSession } from './session-state';

export interface PopupRecoveryClient {
  getPreviousWorkerInstanceId(): Promise<string | null>;
  getRecoveryState(previousWorkerInstanceId: string | null): Promise<RecoverySnapshot>;
  probeWallet(): Promise<string | null>;
  setWallet(publicKey: string): Promise<WalletSession>;
  clearWallet(): Promise<void>;
  refreshProjects(): Promise<ProjectSummary[]>;
  rememberWorkerInstanceId(workerInstanceId: string): Promise<void>;
}

/**
 * Runs before popup controls are enabled. The wallet is deliberately probed on
 * every open: persisted connection state is never treated as authorization.
 */
export async function recoverPopupSession(
  client: PopupRecoveryClient
): Promise<RecoverySnapshot> {
  const previousWorkerInstanceId = await client.getPreviousWorkerInstanceId();
  const snapshot = await client.getRecoveryState(previousWorkerInstanceId);

  const publicKey = await client.probeWallet();
  let wallet: WalletSession | null = snapshot.wallet;
  if (publicKey) {
    wallet = await client.setWallet(publicKey);
  } else if (snapshot.wallet) {
    await client.clearWallet();
    wallet = null;
  }

  let projects = snapshot.projects;
  if (projects === null) {
    try {
      projects = await client.refreshProjects();
    } catch {
      // A project API outage must not prevent wallet/session recovery.
      projects = [];
    }
  }
  await client.rememberWorkerInstanceId(snapshot.workerInstanceId);

  return {
    ...snapshot,
    wallet,
    projects,
    needsWalletValidation: false,
  };
}
