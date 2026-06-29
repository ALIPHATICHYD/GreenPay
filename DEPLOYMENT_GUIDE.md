# Smart Contract Deployment Pipeline

This guide covers the automated smart contract deployment pipeline for GreenPay's Soroban contracts, including CI/CD automation, deterministic deployment, verification, and multi-sig DAO governance integration.

## Overview

The deployment pipeline ensures:

1. **Automatic Testing & Verification**: All contracts are compiled, unit-tested, and verified on every PR that touches contract code
2. **Deterministic Deployment**: Contracts are deployed with reproducible builds and verifiable WASM hashes
3. **Multi-Sig Governance**: Mainnet deployments require DAO approval before execution
4. **Verification & Monitoring**: Deployed contracts are verified on-chain and monitoring is configured
5. **Audit Trail**: All deployments are logged with git metadata, timestamps, and identities

## Architecture

### Workflow Components

```
┌─────────────────────────────────────────────────────────────┐
│                 GitHub Actions CI/CD                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Pull Request on contracts/**                                │
│        ↓                                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. Test & Verify                                     │   │
│  │    - cargo fmt, clippy                               │   │
│  │    - unit tests, integration tests                    │   │
│  │    - build WASM (wasm32-unknown-unknown)             │   │
│  │    - security audit (cargo-audit)                    │   │
│  └──────────────────────────────────────────────────────┘   │
│        ↓                                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 2. Build Metadata                                    │   │
│  │    - generate WASM checksums                         │   │
│  │    - create deployment manifest                      │   │
│  │    - upload artifacts (30 day retention)             │   │
│  └──────────────────────────────────────────────────────┘   │
│        ↓                                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 3. Merge to main                                     │   │
│  │    - Generate multi-sig proposal                     │   │
│  │    - Comment on merged PR                            │   │
│  │    - Create upgrade proposal JSON                    │   │
│  └──────────────────────────────────────────────────────┘   │
│        ↓                                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 4. DAO Governance (Mainnet Only)                     │   │
│  │    - Propose upgrade to DAO                          │   │
│  │    - Wait for voting period                          │   │
│  │    - Execute upon approval                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Contracts Included

1. **greenpay-contract** - Main donation tracking contract
   - Tracks donations, projects, donor statistics
   - Mints impact NFTs
   - Upgradeable via WASM update

2. **dao-governance-contract** - DAO voting mechanism
   - Manages upgrade proposals
   - Handles voting and execution
   - Guards mainnet deployments

3. **escrow-contract** - Escrow and dispute resolution
   - Holds funds during disputes
   - Enables time-locked releases
   - Upgradeable for new features

## Automated Pipeline (GitHub Actions)

### Trigger Events

The pipeline (`contract-deploy.yml`) is triggered when:

1. **Pull Request** to `main` or `develop` with changes to `contracts/**`
2. **Push** to `main` with changes to `contracts/**`

### Workflow Jobs

#### 1. Test & Verify (`test-and-verify`)
- **Runs on**: Every PR
- **Steps**:
  - Install Rust toolchain + wasm32-unknown-unknown target
  - Cache cargo registry and build artifacts
  - Run `cargo fmt --check` (formatting verification)
  - Run `cargo clippy` (linting)
  - Run `cargo test --workspace` (unit + integration tests)
  - Build WASM in release mode
  - Generate SHA256 checksums for WASM files

**Artifacts**:
- `wasm-builds/`: Compiled WASM files
- `wasm-checksums/`: SHA256 checksums

#### 2. Build Metadata (`build-contract-metadata`)
- **Runs after**: test-and-verify
- **Steps**:
  - Generate deployment manifest with:
    - Contract names and WASM paths
    - Upgrade flags and network targets
    - Migration requirements
  - Upload manifest as artifact

**Artifacts**:
- `deployment-manifest/deployment-manifest.json`

#### 3. Generate Proposal (`generate-proposal`)
- **Runs on**: main branch only (after merge)
- **Steps**:
  - Download WASM artifacts and checksums
  - Generate multi-sig proposal JSON with:
    - Contract names, WASM hashes, sizes
    - Git commit SHA and branch
    - Proposal timestamp
  - Comments on PR with deployment summary
  - Uploads proposal for 90-day retention

**Artifacts**:
- `upgrade-proposal/upgrade-proposal-<SHA>.json`

#### 4. Security Audit (`security-audit`)
- **Runs on**: Every build
- **Steps**:
  - Install `cargo-audit`
  - Scan for known security vulnerabilities
  - Generate audit report
  - Upload report for review

**Artifacts**:
- `security-audit-report/audit-report.json`

## Local Deployment

### Prerequisites

```bash
# Install Stellar CLI
cargo install --locked stellar-cli

# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Set up Stellar identity
stellar keys generate alice --network testnet
```

### Environment Setup

Create `.env.local` (not committed) with:

```bash
# Identity to use for deployments
STELLAR_IDENTITY=alice

# Network configuration
SOROBAN_RPC_HOST=https://soroban-testnet.stellar.org
STELLAR_NETWORK=testnet

# Contract IDs (after first deployment)
GREENPAY_CONTRACT_ID=CAB...
DAO_GOVERNANCE_CONTRACT_ID=CAB...
ESCROW_CONTRACT_ID=CAB...
```

Load it:
```bash
source .env.local
```

### Quick Start

#### 1. Deploy All Contracts (Testnet)

```bash
chmod +x scripts/deploy-contracts-automated.sh
./scripts/deploy-contracts-automated.sh testnet deploy
```

This will:
1. Build all contracts in release mode
2. Run all tests
3. Deploy to testnet
4. Save deployment manifests to `.deployments/manifests/`
5. Output contract IDs

#### 2. Verify Deployment

```bash
chmod +x scripts/verify-contract.sh

# Verify specific contract
./scripts/verify-contract.sh testnet CAB123... greenpay-contract
```

#### 3. Generate DAO Proposal (Mainnet)

```bash
STELLAR_CONTRACT_ID=CAB123... \
./scripts/deploy-contracts-automated.sh mainnet propose greenpay-contract
```

This generates a proposal file in `.deployments/proposals/` that must be submitted to the DAO governance contract.

### Deployment Files Structure

```
.deployments/
├── logs/
│   ├── build-1719100800.log
│   ├── test-1719100801.log
│   └── upgrade-1719100802.log
├── manifests/
│   ├── greenpay-contract-testnet-2024-06-22T10:00:00Z.json
│   ├── dao-governance-contract-testnet-2024-06-22T10:00:00Z.json
│   └── escrow-contract-testnet-2024-06-22T10:00:00Z.json
└── proposals/
    ├── upgrade-greenpay-contract-1719100800.json
    ├── upgrade-dao-governance-contract-1719100801.json
    └── upgrade-escrow-contract-1719100802.json
```

## Deterministic & Verifiable Deployments

### Build Reproducibility

All WASM builds are reproducible:

```bash
# Build locally
cargo build --target wasm32-unknown-unknown --release

# Calculate hash
sha256sum contracts/target/wasm32-unknown-unknown/release/greenpay_contract.wasm
# Example: abc123def456...
```

### On-Chain Verification

The pipeline generates deployment manifests with WASM hashes, allowing verification that on-chain contract code matches the released source:

```json
{
  "contract": "greenpay-contract",
  "wasm_hash": "abc123def456...",
  "wasm_size": 156789,
  "timestamp": "2024-06-22T10:00:00Z",
  "git_sha": "abc1234567890abcdef"
}
```

Any audit can:
1. Check out the commit from `git_sha`
2. Run the build command
3. Verify the WASM hash matches

## Multi-Sig DAO Governance

### Proposal Format

Generated proposals follow this JSON structure:

```json
{
  "proposal_id": "upgrade-greenpay-contract-1719100800",
  "type": "contract_upgrade",
  "contract": "greenpay-contract",
  "contract_id": "CAB123...",
  "network": "mainnet",
  "action": "upgrade",
  "timestamp": "2024-06-22T10:00:00Z",
  "wasm_hash": "abc123def456...",
  "metadata": {
    "git_sha": "abc1234567890abcdef",
    "git_branch": "main",
    "author": "Developer Name",
    "email": "dev@example.com"
  },
  "voting": {
    "status": "pending",
    "threshold": "majority",
    "votes_for": 0,
    "votes_against": 0
  },
  "execution": {
    "status": "pending",
    "executed_at": null
  }
}
```

### DAO Voting Flow

1. **Proposal Creation**
   - Pipeline generates proposal JSON
   - Proposal is submitted to DAO governance contract
   - Voting period begins (configurable duration)

2. **Voting Period**
   - DAO members vote on the upgrade
   - Voting power is proportional to locked governance tokens
   - Votes are counted transparently on-chain

3. **Execution**
   - If proposal passes voting threshold
   - Any authorized executor can trigger the upgrade
   - New contract code is installed at the same contract ID
   - Storage is preserved and migrated as needed

4. **Verification**
   - Post-execution, contract is verified on-chain
   - WASM hash is checked against proposal

### Storage Migration

When upgrading contracts, storage must remain compatible:

```rust
// ✅ Safe: Add new storage key variant
pub enum DataKey {
    Admin,
    Project(String),
    // New in v2:
    ProjectMetadata(String),
}

// ❌ Unsafe: Rename or reorder existing variants
pub enum DataKey {
    Admin,
    Projects(String),  // renamed from Project!
}

// ❌ Unsafe: Remove fields from stored structs
struct Project {
    name: String,
    wallet: Address,
    // co2_per_xlm removed! storage corrupt
}
```

See [contracts/greenpay-contract/UPGRADE.md](contracts/greenpay-contract/UPGRADE.md) for storage compatibility details.

## Rollback Procedures

### Emergency Rollback

If an upgrade causes critical issues:

1. **Identify the Issue** (on-chain via monitoring)
2. **Create Rollback Proposal** to previous working contract version
3. **Fast-track DAO Vote** (if emergency procedures enabled)
4. **Deploy Previous WASM** matching prior git commit
5. **Run Regression Tests** to verify storage state

### Prevention

- All contract versions are retained in git history
- Previous WASM files are archived in GitHub Artifacts (90 days)
- Storage regression tests run before each deployment
- Upgrade is only executed after DAO approval

## Monitoring & Observability

### Deployment Logs

Check deployment status:

```bash
# List all deployments
ls -lh .deployments/manifests/

# View latest deployment
cat .deployments/manifests/greenpay-contract-*.json | jq .

# View build logs
tail -f .deployments/logs/build-*.log
```

### Contract Health Checks

```bash
# Query contract state on-chain
stellar contract info $CONTRACT_ID --network testnet

# Test contract functions
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- get_global_total
```

### GitHub Actions Logs

View deployment workflow details:

1. Go to https://github.com/B-Hands/GreenPay/actions
2. Select the `Contract Deploy & Verify` workflow
3. Click the latest run
4. Review logs for each job

## Troubleshooting

### Build Fails

```bash
# Clear cargo cache
cargo clean

# Rebuild all
cargo build --workspace --target wasm32-unknown-unknown --release

# Check for issues
cargo check --all-targets
```

### Deployment Fails

```bash
# Verify Stellar CLI is installed
stellar --version

# Check network connectivity
stellar network ls

# Verify identity has XLM for gas
stellar keys balance alice --network testnet
```

### Test Failures

```bash
# Run specific test
cargo test -p greenpay-contract test_name -- --nocapture

# Run tests with logging
RUST_LOG=debug cargo test --workspace -- --nocapture

# Run upgrade regression test
cargo test -p greenpay-contract test_upgrade_preserves_donation_state_and_storage_keys
```

### Verification Issues

```bash
# Compare local vs on-chain
sha256sum contracts/target/wasm32-unknown-unknown/release/greenpay_contract.wasm

# Check contract deployment
stellar contract info $CONTRACT_ID --network testnet --verbose
```

## Security Considerations

### Access Control

- **Testnet**: Developers can deploy freely
- **Mainnet**: Only DAO can execute deployments via multi-sig voting
- **Identities**: Each developer should use a separate Stellar account

### Environment Variables

Never commit:
- `.env.local` with private keys
- Ledger credentials
- API keys

### Code Review

Before merging contract changes to main:

1. **Code Review**: At least 2 approvals required
2. **Test Coverage**: All new code must have tests
3. **Security Review**: Use `/security-review` for sensitive changes
4. **Upgrade Impact**: Test storage compatibility with `test_upgrade_*` tests

## CI/CD Configuration

### GitHub Secrets

Configure these in repository Settings → Secrets:

```
STELLAR_TESTNET_KEY=...        # Testnet deployment identity
STELLAR_MAINNET_KEY=...        # Mainnet (DAO controlled)
SOROBAN_RPC_HOST=...           # Custom RPC endpoint
```

### Workflow Customization

Edit `.github/workflows/contract-deploy.yml`:

- Change trigger events (push, pull_request, schedule)
- Add deployment targets (new networks)
- Configure test strategies
- Adjust artifact retention

## Advanced Scenarios

### Scheduled Deployments

Deploy on a schedule (e.g., weekly):

```yaml
on:
  schedule:
    - cron: '0 0 * * 0'  # Every Sunday
```

### Staged Rollouts

Deploy to testnet first, then after validation, to mainnet:

```bash
# 1. Deploy to testnet
./scripts/deploy-contracts-automated.sh testnet deploy

# 2. Test thoroughly
# ... manual testing ...

# 3. Tag release
git tag v1.2.0

# 4. Deploy to mainnet (via DAO proposal)
./scripts/deploy-contracts-automated.sh mainnet deploy
```

### Cross-Contract Testing

Test interactions between contracts:

```bash
# Deploy both contracts
./scripts/deploy-contracts-automated.sh testnet deploy

# Run integration tests that invoke both
cargo test --test '*' --features integration
```

## Checklist for Deployments

Before deploying to mainnet:

- [ ] All tests pass (`cargo test --workspace`)
- [ ] Security audit passes (`cargo audit`)
- [ ] Code review approved (2+ reviewers)
- [ ] Storage compatibility verified
- [ ] Upgrade regression test passes
- [ ] Documentation updated
- [ ] CHANGELOG updated
- [ ] Git tag created
- [ ] Deployment manifest generated
- [ ] DAO proposal created and reviewed
- [ ] Voting period scheduled
- [ ] Monitoring configured

## References

- [Stellar Soroban Documentation](https://developers.stellar.org/docs/learn/introduction)
- [Contract Upgrade Guide](contracts/greenpay-contract/UPGRADE.md)
- [Contract Security Considerations](contracts/greenpay-contract/SECURITY.md)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Cargo Workspace Documentation](https://doc.rust-lang.org/cargo/reference/workspaces.html)

---

**Last Updated**: 2024-06-22
**Maintainers**: @B-Hands/contract-team
