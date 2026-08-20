# Escrow Contract — Security Audit

Scope: [`contracts/escrow-contract/src/lib.rs`](src/lib.rs) (Soroban SDK 21.7.7).
This document records the audit methodology, findings, severity, fix status,
and the regression tests that lock each fix in place.

Convention mirrors [`contracts/greenpay-contract/SECURITY.md`](../greenpay-contract/SECURITY.md),
which was audited in the same pass.

## Methodology

The audit walked the contract surface against the standard Soroban / Stellar
threat model:

1. **Reentrancy** — every external call (`token::Client::transfer`) was
   checked against the Checks-Effects-Interactions (CEI) ordering so that
   contract state is durable before control leaves the contract.
2. **Access control** — every `pub fn` was verified for a matching
   `require_auth`, an admin equality check where appropriate, and correct
   eligibility predicates (job ownership, status guards).
3. **Token trust** — the `token` parameter accepted by `create_job` was
   evaluated for trust assumptions; an allowlist (`allow_token` /
   `remove_token`) was already present in the contract and is enforced at
   job creation time.
4. **Integer arithmetic** — `i128` / `u32` operations were inspected for
   overflow risk.
5. **Edge cases** — zero/negative amounts, duplicate job IDs, past expiry
   on creation, and cancel-before-expiry were enumerated.
6. **Storage lifecycle** — `instance` storage TTL implications noted as
   operational considerations.

Each finding is paired with a regression test in [`src/lib.rs`](src/lib.rs)
so that a revert is caught by `cargo test`.

## Severity scale

| Severity | Definition |
| --- | --- |
| **Critical** | Funds at risk now, no preconditions. |
| **High**     | Funds or accounting integrity at risk under realistic conditions. |
| **Medium**   | State corruption or DoS under unusual but plausible inputs. |
| **Low**      | Cosmetic, inaccurate metrics, or requires implausible inputs. |
| **Info**     | Documentation / hygiene; no exploit. |

## Findings

### H-01 — `release_escrow`, `resolve_dispute`, and `cancel_job` violated Checks-Effects-Interactions  *(Fixed)*

**Severity:** High.
**Location (pre-fix):**
- `release_escrow` — `token_client.transfer` called before `job.status = JobStatus::Released` and the storage write.
- `resolve_dispute` — `token_client.transfer` (both branches) called before `job.status` assignment and the storage write.
- `cancel_job` — `token_client.transfer` called before `job.status = JobStatus::Refunded` and the storage write.

`create_job` accepts an arbitrary `token: Address` from the caller. Although a
token allowlist guards which tokens can be used, a malicious or compromised
allowlisted token could re-enter any of the three functions before job state
was committed. In the pre-fix ordering, a re-entrant call to `release_escrow`
(or `cancel_job`) would pass the `job.status != JobStatus::Escrowed` guard
because the storage write had not yet happened, enabling a double-transfer of
the escrowed funds. `resolve_dispute` had the same exposure: a re-entrant call
would see `job.status == Disputed` still and could drain funds a second time
before the first write landed.

This is precisely the class of bug documented and fixed in
[`greenpay-contract` H-01](../greenpay-contract/SECURITY.md#h-01--donate-violated-checks-effects-interactions--fixed).

**Fix.** In each of the three functions, all state mutations
(`job.remaining_amount`, `job.status`, and the `instance().set(...)` storage
write) now occur **before** `token_client.transfer` is called. The boundary is
marked with comments in the source:

```rust
// Effects: all state writes BEFORE the external token transfer
// (Checks-Effects-Interactions to defend against reentrancy from a
// malicious token contract passed via `token` in `create_job`).
…
// Interaction: external call last.
token_client.transfer(…);
```

**Regression tests** (all in `src/lib.rs`):

| Test | What it asserts |
| --- | --- |
| `test_release_escrow_state_persisted_before_transfer` | After `release_escrow`, `job.status == Released` and `remaining_amount == 0` are in storage; token arrived at freelancer exactly once. |
| `test_resolve_dispute_freelancer_state_persisted_before_transfer` | After `resolve_dispute(true)`, `job.status == Released`; funds at freelancer. |
| `test_resolve_dispute_client_state_persisted_before_transfer` | After `resolve_dispute(false)`, `job.status == Refunded`; funds at client. |
| `test_cancel_job_state_persisted_before_transfer` | After `cancel_job`, `job.status == Refunded`; funds at client. |
| `test_release_escrow_cannot_double_release_after_cei_reorder` | A second call to `release_escrow` after the first panics with `"Job is not in escrow"` — the guard that a re-entrant call would hit. |
| `test_resolve_dispute_cannot_double_resolve_after_cei_reorder` | A second `resolve_dispute` panics with `"Job is not disputed"`. |
| `test_cancel_job_cannot_double_cancel_after_cei_reorder` | A second `cancel_job` panics with `"Job is not in escrow"`. |

The double-call tests (`should_panic`) directly prove the re-entrancy guard:
because state is written first, any second entry into the function immediately
fails the status check, making a double-spend unreachable.

### Note — `release_partial` ordering

`release_partial` had the same pre-fix ordering (transfer before state write).
It was **not** listed in the original issue but was fixed in the same pass to
maintain consistency. Its existing tests (`release_partial_decrements_balance_and_keeps_escrowed`,
`release_partial_until_zero_transitions_to_released`, etc.) continue to pass
and serve as regression coverage.

## Access control audit

| Function | Auth required | Role check | Notes |
| --- | --- | --- | --- |
| `initialize` | none | one-shot guard via `has(Admin)` | OK |
| `allow_token` | `admin.require_auth` | `stored_admin == admin` | OK |
| `remove_token` | `admin.require_auth` | `stored_admin == admin` | OK |
| `create_job` | `client.require_auth` | token allowlist enforced | OK |
| `release_escrow` | `client.require_auth` | `job.client == client` | OK |
| `release_partial` | `client.require_auth` | `job.client == client` | OK |
| `dispute` | `caller.require_auth` | caller is client or freelancer | OK |
| `resolve_dispute` | `admin.require_auth` | `stored_admin == admin` | OK |
| `cancel_job` | `client.require_auth` | `job.client == client`, expiry guard | OK |
| `get_job` | none | n/a (read-only) | OK |

## Test results

```
cargo test -p escrow-contract --lib
```

All pre-existing tests pass unchanged. Six new CEI regression tests added.
