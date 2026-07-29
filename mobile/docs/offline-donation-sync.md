# Offline Donation Sync

## Before this change

`app/donate/[id].tsx` had no offline handling at all. `handleDonate()` built a
Stellar transaction, signed it with a secret key typed into a local
`TextInput`, submitted it to Horizon, then posted the resulting transaction
hash to the backend. If any step failed — network down, Horizon unreachable,
backend unreachable — the `catch` block simply set an error status message.
**The donation was lost.** Nothing was queued, cached, or retried, and the
user had no way to recover it short of re-entering everything and trying
again once they had connectivity.

This document describes the offline queue and conflict-resolution flow that
replaces that behavior.

## What triggers a save vs. a flush

- **Save (enqueue):** in `handleDonate()`, before any Horizon/backend network
  call, we check current connectivity with
  `@react-native-community/netinfo`. If the device is offline
  (`NetInfo.fetch()` reports `isConnected === false`), we **do not** attempt
  any network call. Instead we save the donation *intent* to the queue, show
  a confirmation, and reset the form.
- **Flush (preflight sync):** `hooks/useDonationSync.ts` subscribes to
  `NetInfo.addEventListener` and detects offline→online transitions. On each
  transition it runs a one-shot preflight validation over every
  `pending-sync` queue entry (see "Conflict rules" below).
- **Manual flush:** `app/sync-conflicts.tsx` also exposes a pull-to-refresh
  that calls the same `syncNow()` preflight routine, so the user can force a
  re-check without waiting for another reconnect event.

The preflight runs **once per reconnect event (or manual pull) per entry** —
there is no background retry loop and no automatic resubmission. An entry
that comes out of preflight simply sits in `ready` or `conflict` state until
the user acts on it from the sync-conflicts screen.

## Where the queue lives

- **Storage:** AsyncStorage, key `greenpay_donation_queue` (see
  `utils/donationQueue.ts`).
- **Entry shape:**

  ```ts
  interface QueuedDonation {
    id: string;                 // client-generated, e.g. donation_<ts>_<rand>
    projectId: string;
    projectName: string;
    donorAddress: string;       // Stellar public key only
    amountXLM: string;
    message?: string;
    createdAt: number;
    status: 'pending-sync' | 'ready' | 'conflict' | 'completed';
    conflictReason?: 'insufficient-balance' | 'project-inactive' | 'duplicate';
    conflictDetail?: string;
    horizonTransactionHash?: string;
  }
  ```

- **CRUD:** `enqueueDonation`, `listQueuedDonations`, `updateQueuedDonation`,
  `removeQueuedDonation` in `utils/donationQueue.ts`.

## Conflict rules

Run by `preflightCheck()` in `hooks/useDonationSync.ts`, one entry at a time:

| Check | Data source | Outcome |
|---|---|---|
| Project still accepting donations? | `GET /api/projects`, match by `projectId`, require `status === 'active'` | Not active/found → `status: 'conflict'`, `conflictReason: 'project-inactive'` |
| Donor balance still covers the amount? | `Server(HORIZON_URL).loadAccount(donorAddress)`, native XLM balance | `available < amountXLM + 0.5 XLM fee buffer` → `status: 'conflict'`, `conflictReason: 'insufficient-balance'`, `conflictDetail` states available vs. required |
| Already submitted in a prior attempt? | `entry.horizonTransactionHash` already set | → `status: 'completed'`, removed from the queue, user notified via alert that it already went through — never asked to resubmit |
| None of the above | — | `status: 'ready'` — safe to complete |

Preflight failures caused by a transient network/Horizon error (as opposed to
a real conflict) leave the entry as `pending-sync` so the next reconnect or
manual pull tries again — entries are never silently dropped.

## Resolving queued entries (`app/sync-conflicts.tsx`)

- **`ready`** — "Complete now" routes to `/donate/[projectId]`, reusing the
  existing donate screen and its signing flow (no duplicated signing logic).
  The user connects their wallet and re-enters their secret key exactly like
  a normal donation.
- **`conflict: insufficient-balance`** — shows required vs. available
  amount; "Edit amount" lets the user adjust the amount (which resets the
  entry to `pending-sync` for re-check on the next sync), or "Remove".
- **`conflict: project-inactive`** — explains the project was deactivated;
  "Choose a different project" links to `/projects`, or "Remove".
- **`completed`** — informational only; the entry is auto-removed by the
  sync engine and the user is told it already succeeded via an alert.

A small banner on the home screen (`app/index.tsx`) shows "N donations
waiting to sync" and links to `/sync-conflicts` whenever the queue is
non-empty.

## Why secret keys are never queued

The donate screen's secret key `TextInput` was never persisted before this
change — it lived only in component state and was cleared after submit. The
offline queue **intentionally preserves that property**: only the donation
*intent* (project, amount, donor public address, optional message) is
persisted to AsyncStorage. No signing key material is ever written to disk,
and the sync engine never signs or submits a transaction automatically.
Storing a secret key (even encrypted) so a background job could
auto-resubmit a payment would turn a lost-donation UX problem into a
"malware on the phone can drain the wallet while the owner is asleep"
security problem — the asymmetry isn't worth it. Instead, finalizing a
queued donation always routes back through the normal, live donate flow,
requiring the same explicit secret-key entry and biometric confirmation as
any other donation.
