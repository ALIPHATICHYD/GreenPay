# Smart Contract Deployment Scripts

This directory contains automated deployment scripts for GreenPay's Soroban contracts.

## Scripts Overview

### `deploy-contracts-automated.sh`
Comprehensive deployment automation with multi-sig governance integration.

**Features**:
- Build, test, and deploy all contracts
- Multi-sig DAO proposal generation
- Deployment manifest creation
- Error handling and logging

**Usage**:
```bash
./scripts/deploy-contracts-automated.sh <network> <action> [contract_name]
```

**Networks**: `testnet`, `mainnet`

**Actions**:
- `deploy` - Build, test, and deploy all contracts
- `upgrade` - Upgrade specific contract (requires `STELLAR_CONTRACT_ID`)
- `propose` - Generate DAO governance proposal
- `verify` - Verify contract on-chain
- `help` - Show usage help

**Examples**:
```bash
# Deploy all contracts to testnet
./scripts/deploy-contracts-automated.sh testnet deploy

# Upgrade specific contract
STELLAR_CONTRACT_ID=CAB... ./scripts/deploy-contracts-automated.sh testnet upgrade greenpay-contract

# Generate DAO proposal for mainnet
STELLAR_CONTRACT_ID=CAB... ./scripts/deploy-contracts-automated.sh mainnet propose greenpay-contract

# Verify contract on testnet
STELLAR_CONTRACT_ID=CAB... ./scripts/deploy-contracts-automated.sh testnet verify greenpay-contract
```

### `verify-contract.sh`
Verify deployed contract matches source code and passes tests.

**Usage**:
```bash
./scripts/verify-contract.sh <network> <contract_id> <contract_name>
```

**Example**:
```bash
./scripts/verify-contract.sh testnet CAB123... greenpay-contract
```

**What it does**:
1. Builds contract locally
2. Calculates WASM hash
3. Fetches contract info from network
4. Runs functional tests
5. Verifies consistency

### `deploy-contract.sh` (Original)
Basic manual deployment script (kept for compatibility).

**Usage**:
```bash
./scripts/deploy-contract.sh [testnet|mainnet] [identity]
```

## Environment Setup

### 1. Install Dependencies

```bash
# Stellar CLI
cargo install --locked stellar-cli

# Rust + WASM target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Build tools
sudo apt-get install build-essential pkg-config
```

### 2. Create Stellar Identity

```bash
# Generate identity for testnet
stellar keys generate alice --network testnet

# Check balance (need XLM for gas)
stellar keys balance alice --network testnet

# Fund testnet account
# Visit https://laboratory.stellar.org/ and use friendbot
```

### 3. Configure Environment

Create `.env.local` (not committed):

```bash
# Identity for deployments
export STELLAR_IDENTITY=alice

# Network selection
export STELLAR_NETWORK=testnet

# RPC endpoints (optional)
export SOROBAN_RPC_HOST=https://soroban-testnet.stellar.org
export STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org

# Contract IDs (after deployment)
export GREENPAY_CONTRACT_ID=CAB...
export DAO_GOVERNANCE_CONTRACT_ID=CAB...
export ESCROW_CONTRACT_ID=CAB...
```

Load it:
```bash
source .env.local
```

## Deployment Workflow

### Step 1: Test Locally

```bash
cd contracts
cargo test --workspace
cargo build --workspace --target wasm32-unknown-unknown --release
```

### Step 2: Deploy to Testnet

```bash
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

Save the contract IDs for future operations.

### Step 3: Verify Deployment

```bash
# Verify each contract
STELLAR_CONTRACT_ID=CAB123... ./scripts/verify-contract.sh testnet CAB123... greenpay-contract
STELLAR_CONTRACT_ID=CAB456... ./scripts/verify-contract.sh testnet CAB456... dao-governance-contract
STELLAR_CONTRACT_ID=CAB789... ./scripts/verify-contract.sh testnet CAB789... escrow-contract
```

### Step 4: Test on Testnet

```bash
# Register a test project
stellar contract invoke \
  --id $GREENPAY_CONTRACT_ID \
  --source alice \
  --network testnet \
  -- register_project \
  --admin alice \
  --project_id "test-001" \
  --name "Test Project" \
  --wallet $TEST_WALLET \
  --co2_per_xlm 8500

# Make a test donation
stellar contract invoke \
  --id $GREENPAY_CONTRACT_ID \
  --source alice \
  --network testnet \
  -- donate \
  --token $TOKEN_ID \
  --donor alice \
  --project_id "test-001" \
  --amount 100 \
  --msg_hash "hash123"

# Query donation stats
stellar contract invoke \
  --id $GREENPAY_CONTRACT_ID \
  --source alice \
  --network testnet \
  -- get_global_total
```

### Step 5: Generate Mainnet Proposal

Once testnet is validated:

```bash
# Generate proposal for DAO voting
STELLAR_CONTRACT_ID=$GREENPAY_CONTRACT_ID \
./scripts/deploy-contracts-automated.sh mainnet propose greenpay-contract

# View proposal
cat .deployments/proposals/upgrade-greenpay-contract-*.json | jq .
```

### Step 6: Submit to DAO

The proposal JSON can be submitted to the DAO governance contract:

```bash
stellar contract invoke \
  --id $DAO_GOVERNANCE_CONTRACT_ID \
  --source proposer \
  --network mainnet \
  -- create_proposal \
  --proposal_type "CONTRACT_UPGRADE" \
  --description "Upgrade GreenPay to v2.1.0" \
  --wasm_hash "abc123..." \
  --contract_id $GREENPAY_CONTRACT_ID
```

### Step 7: DAO Voting

1. Voting period starts (configurable, typically 1 week)
2. DAO members vote (need locked governance tokens)
3. If majority approves, proposal passes
4. Execution permitted after vote conclusion

### Step 8: Execute Upgrade

```bash
# After DAO approval
stellar contract invoke \
  --id $DAO_GOVERNANCE_CONTRACT_ID \
  --source executor \
  --network mainnet \
  -- execute_proposal \
  --proposal_id proposal_uuid
```

## Deployment Artifacts

After deployment, check `.deployments/`:

```
.deployments/
├── logs/                      # Build and deployment logs
│   ├── build-1719100800.log
│   └── test-1719100801.log
├── manifests/                 # Deployment metadata
│   ├── greenpay-contract-mainnet-2024-06-22T10:00:00Z.json
│   ├── dao-governance-contract-mainnet-2024-06-22T10:00:00Z.json
│   └── escrow-contract-mainnet-2024-06-22T10:00:00Z.json
└── proposals/                 # DAO governance proposals
    ├── upgrade-greenpay-contract-1719100800.json
    ├── upgrade-dao-governance-contract-1719100801.json
    └── upgrade-escrow-contract-1719100802.json
```

### Deployment Manifest Format

```json
{
  "contract": "greenpay-contract",
  "network": "mainnet",
  "contract_id": "CAB123XYZ...",
  "wasm_hash": "abc123def456...",
  "wasm_size": 156789,
  "timestamp": "2024-06-22T10:00:00Z",
  "identity": "alice",
  "git_sha": "abc1234567890abcdef",
  "git_branch": "main"
}
```

## Troubleshooting

### `stellar` command not found
```bash
cargo install --locked stellar-cli
export PATH="$HOME/.cargo/bin:$PATH"
```

### Insufficient balance
```bash
# Check current balance
stellar keys balance alice --network testnet

# Fund via friendbot (testnet)
# https://laboratory.stellar.org/

# For mainnet, deposit via exchange
```

### WASM file not found
```bash
# Ensure you're in project root
cd /path/to/GreenPay

# Build contracts
cargo build --workspace --target wasm32-unknown-unknown --release

# Check build output
ls contracts/target/wasm32-unknown-unknown/release/*.wasm
```

### Contract deployment fails
```bash
# Check network connectivity
stellar network ls

# Verify RPC endpoint
curl https://soroban-testnet.stellar.org/health

# Try with explicit host
SOROBAN_RPC_HOST=https://soroban-testnet.stellar.org \
./scripts/deploy-contracts-automated.sh testnet deploy
```

### Verification fails
```bash
# Compare hashes
sha256sum contracts/target/wasm32-unknown-unknown/release/greenpay_contract.wasm

# Check contract on-chain
stellar contract info $CONTRACT_ID --network testnet --verbose
```

## Security Considerations

### Private Keys
- Never commit `.env` files with private keys
- Use environment variables for sensitive data
- Rotate identities regularly for mainnet

### Network Selection
- **Testnet**: For development and testing
- **Mainnet**: Production deployments (DAO-controlled)

### Verification
- Always verify WASM hash matches source
- Test on testnet before mainnet
- Review DAO proposals carefully

### Gas Limits
- Testnet: generous limits for testing
- Mainnet: conservative limits for safety
- Monitor actual gas usage

## Advanced Usage

### Upgrade Existing Contract

```bash
# Set contract ID environment variable
export STELLAR_CONTRACT_ID=CAB123...

# Deploy new code to same address
./scripts/deploy-contracts-automated.sh testnet upgrade greenpay-contract
```

### Custom Network

```bash
# Use environment variable for custom RPC
export SOROBAN_RPC_HOST=https://your-rpc-host.example.com

./scripts/deploy-contracts-automated.sh testnet deploy
```

### Batch Deployments

```bash
# Deploy multiple contracts
for contract in greenpay-contract dao-governance-contract escrow-contract; do
  echo "Deploying $contract..."
  ./scripts/deploy-contracts-automated.sh testnet deploy
done
```

## CI/CD Integration

Deployments are automated via GitHub Actions (`.github/workflows/contract-deploy.yml`):

1. **PR Checks**: Test and build on every PR
2. **Main Merge**: Generate proposal on merge to main
3. **Artifacts**: Retain WASM for 30 days, proposals for 90 days

View workflow status:
- https://github.com/B-Hands/GreenPay/actions
- Filter by "Contract Deploy & Verify"

## Getting Help

1. **Script Help**:
   ```bash
   ./scripts/deploy-contracts-automated.sh help
   ```

2. **Makefile Help**:
   ```bash
   make -f Makefile.contracts help
   ```

3. **Full Documentation**:
   - [DEPLOYMENT_GUIDE.md](../docs/DEPLOYMENT_GUIDE.md)
   - [TESTING_STRATEGY.md](../contracts/TESTING_STRATEGY.md)
   - [Stellar Soroban Docs](https://developers.stellar.org/docs/learn/introduction)

---

**Last Updated**: 2024-06-22
**Maintainers**: @B-Hands/contract-team
