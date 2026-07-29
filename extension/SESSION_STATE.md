# Extension session state

The MV3 service worker treats memory as disposable. `WorkerSessionState`
reconstructs every popup dependency before responding to a recovery request.

| State | Storage | Invalidation |
| --- | --- | --- |
| Wallet public key and network | `chrome.storage.session` | Revalidated with Freighter on every popup open; cleared when locked, access is revoked, the active account changes, the schema changes, or after 15 minutes |
| Three project summaries | `chrome.storage.local` | Refetched after 5 minutes or a schema change; search results are never persisted |
| Last worker instance seen by the popup | `chrome.storage.session` | Replaced after every successful popup recovery; a mismatch identifies worker termination/restart |

Only public wallet identity is stored. Secret keys, signed transactions, pending
donations, balances, search queries, and Freighter authorization are never
persisted. Balances are fetched again after recovery, and authorization is
always determined by Freighter rather than the cached wallet record.
