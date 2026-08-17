# Smart Contract Deployment - Quick Start

## What Was Implemented

A production-ready automated smart contract deployment pipeline with:

✅ **Automated CI/CD Testing** - Every PR runs full test suite, security audit, and builds WASM  
✅ **Deterministic Deployments** - Reproducible builds with SHA256 verification  
✅ **Multi-Sig DAO Governance** - Mainnet deployments require DAO approval before execution  
✅ **Storage Migration Safety** - Built-in upgrade compatibility tests  
✅ **Complete Audit Trail** - Git metadata, timestamps, and WASM hashes embedded in proposals  

## Get Started in 5 Minutes

### 1. Setup

```bash
# Install dependencies (if not already done)
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli

# Generate Stellar identity
stellar keys generate alice --network testnet

# Create .env.local (not committed)
cat > .env.local << 'EOF'
export STELLAR_IDENTITY=alice
export STELLAR_NETWORK=testnet
EOF

source .env.local
```

### 2. Deploy to Testnet

```bash
# Make script executable
chmod +x scripts/deploy-contracts-automated.sh

# Deploy all contracts
./scripts/deploy-contracts-automated.sh testnet deploy
```

**Output**:
```
✓ All contracts deployed successfully

════════════════════════════════════════════
  📊 Deployment Summary
════════════════════════════════════════════
  greenpay-contract: CAB123XYZ...
  dao-governance-contract: CAB456XYZ...
  escrow-contract: CAB789XYZ...
════════════════════════════════════════════
```

Save these contract IDs!

### 3. Verify Deployment

```bash
# Verify contracts match source code
STELLAR_CONTRACT_ID=CAB123... ./scripts/verify-contract.sh testnet CAB123... greenpay-contract
STELLAR_CONTRACT_ID=CAB456... ./scripts/verify-contract.sh testnet CAB456... dao-governance-contract
STELLAR_CONTRACT_ID=CAB789... ./scripts/verify-contract.sh testnet CAB789... escrow-contract
```

### 4. Generate Mainnet Proposal

```bash
# Generate proposal for DAO voting
STELLAR_CONTRACT_ID=CAB123... \
./scripts/deploy-contracts-automated.sh mainnet propose greenpay-contract

# View proposal
cat .deployments/proposals/upgrade-greenpay-contract-*.json | jq .
```

### 5. Submit to DAO (Manual)

The proposal JSON is ready for submission to the DAO governance contract. DAO members will vote, and if approved, the upgrade executes automatically.

## Using the Makefile

Easier way to run common tasks:

```bash
# View all available commands
make -f Makefile.contracts help

# Build and test
make -f Makefile.contracts build test

# Deploy to testnet
make -f Makefile.contracts deploy-testnet

# Setup environment
make -f Makefile.contracts setup-testnet

# Run security audit
make -f Makefile.contracts audit
```

## What Happens Automatically

### On Every PR (GitHub Actions)

1. ✅ Code formatting check
2. ✅ Clippy linting
3. ✅ Unit tests
4. ✅ Integration tests
5. ✅ Build WASM
6. ✅ Security audit
7. ✅ Generate checksums

### On Merge to Main (GitHub Actions)

1. ✅ All tests pass
2. ✅ WASM files built and uploaded
3. ✅ Deployment manifest created
4. ✅ Multi-sig proposal generated
5. ✅ PR commented with deployment summary

## Deployment Files Structure

After deployment, you'll find:

```
.deployments/
├── logs/
│   ├── build-1719100800.log
│   └── test-1719100801.log
├── manifests/
│   ├── greenpay-contract-testnet-2024-06-22T10:00:00Z.json
│   ├── dao-governance-contract-testnet-2024-06-22T10:00:00Z.json
│   └── escrow-contract-testnet-2024-06-22T10:00:00Z.json
└── proposals/
    ├── upgrade-greenpay-contract-1719100800.json
    ├── upgrade-dao-governance-contract-1719100801.json
    └── upgrade-escrow-contract-1719100802.json
```

## Key Files

| File | Purpose |
|------|---------|
| `.github/workflows/contract-deploy.yml` | CI/CD automation |
| `scripts/deploy-contracts-automated.sh` | Main deployment orchestrator |
| `scripts/verify-contract.sh` | Post-deployment verification |
| `Makefile.contracts` | Convenient command shortcuts |
| `DEPLOYMENT_GUIDE.md` | Complete deployment guide |
| `contracts/deployment-config.json` | Contract metadata |
| `contracts/TESTING_STRATEGY.md` | Testing procedures |

## Common Tasks

### Deploy All Contracts
```bash
./scripts/deploy-contracts-automated.sh testnet deploy
```

### Upgrade Specific Contract
```bash
STELLAR_CONTRACT_ID=CAB... \
./scripts/deploy-contracts-automated.sh testnet upgrade greenpay-contract
```

### Verify Contract On-Chain
```bash
STELLAR_CONTRACT_ID=CAB... \
./scripts/verify-contract.sh testnet CAB... greenpay-contract
```

### Run All Tests Locally
```bash
cd contracts
cargo test --workspace
```

### Run Upgrade Regression Test
```bash
cd contracts
cargo test test_upgrade_preserves_donation_state_and_storage_keys
```

### Generate Security Audit
```bash
cd contracts
cargo audit
```

## Troubleshooting

### "stellar CLI not found"
```bash
cargo install --locked stellar-cli
export PATH="$HOME/.cargo/bin:$PATH"
```

### "Insufficient balance"
```bash
# Check balance
stellar keys balance alice --network testnet

# Fund via friendbot (testnet only)
# Visit: https://laboratory.stellar.org/
```

### "WASM file not found"
```bash
# Build contracts first
cargo build --workspace --target wasm32-unknown-unknown --release
```

### "Deployment fails"
```bash
# Check network connectivity
stellar network ls

# Verify RPC endpoint
curl https://soroban-testnet.stellar.org/health
```

## CI/CD Integration

The pipeline is **automatic** and requires no setup:

1. **Create PR** with contract changes → Tests run automatically
2. **All tests pass** → PR can be merged
3. **Merge to main** → Proposal generated automatically
4. **Check artifacts** → View at https://github.com/B-Hands/GreenPay/actions

## Deployment Flow

```
Developer makes changes
        ↓
Push to PR
        ↓
GitHub Actions tests (automatic)
        ↓
Code review & approval
        ↓
Merge to main
        ↓
GitHub Actions builds WASM (automatic)
        ↓
GitHub Actions generates proposal (automatic)
        ↓
Testnet deployment (manual)
        ↓
Testnet validation (manual testing)
        ↓
Mainnet proposal (manual submission to DAO)
        ↓
DAO voting period
        ↓
Execute if approved (automatic)
        ↓
Verify on-chain (automatic)
```

## Security Model

**Testnet**: Developers can deploy freely  
**Mainnet**: Only DAO can execute (multi-sig governance)

This ensures mainnet safety while allowing rapid testnet iteration.

## Next Steps

1. Read [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for complete details
2. Check [scripts/README-DEPLOYMENT.md](scripts/README-DEPLOYMENT.md) for script details
3. Review [contracts/TESTING_STRATEGY.md](contracts/TESTING_STRATEGY.md) for testing info
4. Run `./scripts/deploy-contracts-automated.sh help` for command reference

## Support

**For script help**:
```bash
./scripts/deploy-contracts-automated.sh help
```

**For Makefile help**:
```bash
make -f Makefile.contracts help
```

**For full documentation**:
- Read the guides in order: DEPLOYMENT_GUIDE.md → scripts/README-DEPLOYMENT.md
- Check [Stellar Soroban Docs](https://developers.stellar.org/docs/learn/introduction)

---

**Status**: ✅ Ready to use  
**Created**: 2024-06-22  
**Maintainers**: @B-Hands/contract-team
