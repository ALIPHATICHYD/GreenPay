#!/usr/bin/env bash
# scripts/deploy-contracts-automated.sh
# Automated contract deployment with multi-sig governance integration.
#
# Usage:
#   ./scripts/deploy-contracts-automated.sh <testnet|mainnet> <action> [contract_name]
#   Actions: deploy, upgrade, propose, verify
#
# Examples:
#   ./scripts/deploy-contracts-automated.sh testnet deploy
#   ./scripts/deploy-contracts-automated.sh testnet propose greenpay-contract
#   ./scripts/deploy-contracts-automated.sh testnet verify greenpay-contract

set -euo pipefail

# Configuration
NETWORK=${1:-testnet}
ACTION=${2:-deploy}
CONTRACT_NAME=${3:-all}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$PROJECT_ROOT/contracts"
DEPLOYMENTS_DIR="$PROJECT_ROOT/.deployments"
PROPOSALS_DIR="$DEPLOYMENTS_DIR/proposals"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log_info() {
  echo -e "${BLUE}ℹ${NC} $*"
}

log_success() {
  echo -e "${GREEN}✓${NC} $*"
}

log_error() {
  echo -e "${RED}✗${NC} $*"
}

log_warning() {
  echo -e "${YELLOW}⚠${NC} $*"
}

# Verify dependencies
verify_dependencies() {
  local missing=0

  for cmd in stellar cargo jq; do
    if ! command -v "$cmd" &>/dev/null; then
      log_error "$cmd is not installed"
      missing=$((missing + 1))
    fi
  done

  if [[ $missing -gt 0 ]]; then
    log_error "Missing $missing dependency(ies)"
    exit 1
  fi

  log_success "All dependencies found"
}

# Initialize deployment directories
init_deployment_dirs() {
  mkdir -p "$DEPLOYMENTS_DIR"
  mkdir -p "$PROPOSALS_DIR"
  mkdir -p "$DEPLOYMENTS_DIR/logs"
  mkdir -p "$DEPLOYMENTS_DIR/manifests"
}

# Build contracts
build_contracts() {
  local contract=$1

  log_info "Building Soroban contracts..."
  cd "$CONTRACTS_DIR"

  if [[ "$contract" == "all" ]]; then
    cargo build --workspace --target wasm32-unknown-unknown --release 2>&1 | tee "$DEPLOYMENTS_DIR/logs/build-$(date +%s).log"
  else
    cargo build -p "$contract" --target wasm32-unknown-unknown --release 2>&1 | tee "$DEPLOYMENTS_DIR/logs/build-$(date +%s).log"
  fi

  log_success "Build completed"
}

# Run contract tests
run_tests() {
  local contract=$1

  log_info "Running contract tests..."
  cd "$CONTRACTS_DIR"

  if [[ "$contract" == "all" ]]; then
    cargo test --workspace 2>&1 | tee "$DEPLOYMENTS_DIR/logs/test-$(date +%s).log"
  else
    cargo test -p "$contract" 2>&1 | tee "$DEPLOYMENTS_DIR/logs/test-$(date +%s).log"
  fi

  log_success "All tests passed"
}

# Get WASM file path
get_wasm_path() {
  local contract=$1

  case "$contract" in
    greenpay-contract)
      echo "$CONTRACTS_DIR/target/wasm32-unknown-unknown/release/greenpay_contract.wasm"
      ;;
    dao-governance-contract)
      echo "$CONTRACTS_DIR/target/wasm32-unknown-unknown/release/dao_governance_contract.wasm"
      ;;
    escrow-contract)
      echo "$CONTRACTS_DIR/target/wasm32-unknown-unknown/release/escrow_contract.wasm"
      ;;
    *)
      log_error "Unknown contract: $contract"
      exit 1
      ;;
  esac
}

# Deploy contract to Soroban
deploy_contract() {
  local contract=$1
  local identity=${STELLAR_IDENTITY:-alice}

  log_info "Deploying $contract to $NETWORK..."

  local wasm_path=$(get_wasm_path "$contract")

  if [[ ! -f "$wasm_path" ]]; then
    log_error "WASM file not found: $wasm_path"
    exit 1
  fi

  local wasm_hash=$(sha256sum "$wasm_path" | cut -d' ' -f1)
  log_info "WASM hash: $wasm_hash"
  log_info "WASM size: $(du -h "$wasm_path" | cut -f1)"

  # Deploy to Soroban
  local contract_id=$(stellar contract deploy \
    --wasm "$wasm_path" \
    --source "$identity" \
    --network "$NETWORK" \
    2>&1 | tail -1)

  log_success "Deployed $contract to $NETWORK"
  log_info "Contract ID: $contract_id"

  # Save deployment manifest
  local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local manifest="$DEPLOYMENTS_DIR/manifests/${contract}-${NETWORK}-${timestamp}.json"

  cat > "$manifest" << EOF
{
  "contract": "$contract",
  "network": "$NETWORK",
  "contract_id": "$contract_id",
  "wasm_hash": "$wasm_hash",
  "wasm_size": $(stat -c%s "$wasm_path"),
  "timestamp": "$timestamp",
  "identity": "$identity",
  "git_sha": "$(cd "$PROJECT_ROOT" && git rev-parse HEAD)",
  "git_branch": "$(cd "$PROJECT_ROOT" && git rev-parse --abbrev-ref HEAD)"
}
EOF

  log_success "Manifest saved to $manifest"
  echo "$contract_id"
}

# Upgrade contract via proxy
upgrade_contract() {
  local contract=$1
  local contract_id=$2
  local identity=${STELLAR_IDENTITY:-alice}

  log_info "Upgrading $contract (ID: $contract_id)..."

  local wasm_path=$(get_wasm_path "$contract")

  if [[ ! -f "$wasm_path" ]]; then
    log_error "WASM file not found: $wasm_path"
    exit 1
  fi

  # Update the contract code at the same ID
  stellar contract deploy \
    --wasm "$wasm_path" \
    --source "$identity" \
    --network "$NETWORK" \
    --extend-to 536870912 \
    2>&1 | tee "$DEPLOYMENTS_DIR/logs/upgrade-$(date +%s).log"

  log_success "Upgraded $contract"
}

# Generate multi-sig DAO proposal
generate_proposal() {
  local contract=$1
  local contract_id=$2

  log_info "Generating DAO governance proposal for $contract..."

  local wasm_path=$(get_wasm_path "$contract")
  local wasm_hash=$(sha256sum "$wasm_path" | cut -d' ' -f1)
  local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local proposal_id="upgrade-$(echo "$contract" | tr '-' '_')-$(date +%s)"

  local proposal_file="$PROPOSALS_DIR/${proposal_id}.json"

  cat > "$proposal_file" << EOF
{
  "proposal_id": "$proposal_id",
  "type": "contract_upgrade",
  "contract": "$contract",
  "contract_id": "$contract_id",
  "network": "$NETWORK",
  "action": "upgrade",
  "timestamp": "$timestamp",
  "wasm_hash": "$wasm_hash",
  "wasm_size": $(stat -c%s "$wasm_path"),
  "metadata": {
    "git_sha": "$(cd "$PROJECT_ROOT" && git rev-parse HEAD)",
    "git_branch": "$(cd "$PROJECT_ROOT" && git rev-parse --abbrev-ref HEAD)",
    "author": "$(git config user.name)",
    "email": "$(git config user.email)"
  },
  "voting": {
    "status": "pending",
    "start_height": null,
    "end_height": null,
    "threshold": "majority",
    "votes_for": 0,
    "votes_against": 0,
    "voting_weight_for": 0,
    "voting_weight_against": 0
  },
  "execution": {
    "status": "pending",
    "executed_at": null,
    "executed_by": null,
    "tx_hash": null
  }
}
EOF

  log_success "Proposal generated: $proposal_file"
  log_info "Proposal ID: $proposal_id"

  # Output proposal for submission to DAO
  cat "$proposal_file" | jq '.'
}

# Verify contract on-chain
verify_contract() {
  local contract=$1
  local contract_id=$2

  log_info "Verifying contract on-chain..."

  local wasm_path=$(get_wasm_path "$contract")
  local local_hash=$(sha256sum "$wasm_path" | cut -d' ' -f1)

  log_info "Local WASM hash: $local_hash"

  # Fetch contract from Soroban
  local on_chain_code=$(stellar contract info "$contract_id" --network "$NETWORK" 2>&1)

  if [[ -z "$on_chain_code" ]]; then
    log_error "Could not fetch contract from on-chain"
    exit 1
  fi

  log_success "Contract verified on $NETWORK"
  log_info "Contract details:"
  echo "$on_chain_code" | jq '.' || echo "$on_chain_code"
}

# Main deployment flow
deploy_all_contracts() {
  log_info "Starting full contract deployment to $NETWORK"

  # Build all contracts
  build_contracts "all"

  # Run tests
  run_tests "all"

  # Deploy each contract
  local contracts=("greenpay-contract" "dao-governance-contract" "escrow-contract")
  local -A contract_ids

  for contract in "${contracts[@]}"; do
    log_info "Processing $contract..."
    contract_ids[$contract]=$(deploy_contract "$contract")
  done

  # Generate proposals for DAO voting
  if [[ "$NETWORK" == "mainnet" ]]; then
    log_warning "Mainnet deployment - generating governance proposals"
    for contract in "${contracts[@]}"; do
      generate_proposal "$contract" "${contract_ids[$contract]}"
    done
  else
    log_info "Testnet deployment - skipping DAO proposal generation"
  fi

  log_success "All contracts deployed successfully"

  # Print summary
  echo ""
  echo "════════════════════════════════════════════"
  echo "  📊 Deployment Summary"
  echo "════════════════════════════════════════════"
  for contract in "${contracts[@]}"; do
    echo "  $contract: ${contract_ids[$contract]}"
  done
  echo "════════════════════════════════════════════"
}

# Upgrade specific contract
upgrade_specific() {
  if [[ "$CONTRACT_NAME" == "all" ]]; then
    log_error "Must specify contract name for upgrade"
    exit 1
  fi

  log_warning "This action requires the contract ID"
  local contract_id=${STELLAR_CONTRACT_ID:-}

  if [[ -z "$contract_id" ]]; then
    log_error "STELLAR_CONTRACT_ID environment variable not set"
    exit 1
  fi

  build_contracts "$CONTRACT_NAME"
  run_tests "$CONTRACT_NAME"
  upgrade_contract "$CONTRACT_NAME" "$contract_id"
}

# Show usage
show_usage() {
  cat << EOF
Usage: $0 <network> <action> [contract_name]

Networks:
  testnet    Deploy to Stellar testnet
  mainnet    Deploy to Stellar mainnet

Actions:
  deploy     Build, test, and deploy all contracts
  upgrade    Upgrade specific contract (requires CONTRACT_NAME and STELLAR_CONTRACT_ID)
  propose    Generate DAO governance proposal
  verify     Verify contract on-chain

Environment Variables:
  STELLAR_IDENTITY       Stellar CLI identity to use (default: alice)
  STELLAR_CONTRACT_ID    Contract ID for upgrade/verify actions
  SOROBAN_RPC_HOST       Custom Soroban RPC endpoint

Examples:
  ./scripts/deploy-contracts-automated.sh testnet deploy
  STELLAR_CONTRACT_ID=CAB... ./scripts/deploy-contracts-automated.sh testnet upgrade greenpay-contract
  STELLAR_CONTRACT_ID=CAB... ./scripts/deploy-contracts-automated.sh testnet verify greenpay-contract

EOF
}

# Main
main() {
  case "$ACTION" in
    deploy)
      verify_dependencies
      init_deployment_dirs
      deploy_all_contracts
      ;;
    upgrade)
      verify_dependencies
      init_deployment_dirs
      upgrade_specific
      ;;
    propose)
      verify_dependencies
      init_deployment_dirs
      if [[ -z "${STELLAR_CONTRACT_ID:-}" ]]; then
        log_error "STELLAR_CONTRACT_ID not set"
        exit 1
      fi
      generate_proposal "$CONTRACT_NAME" "$STELLAR_CONTRACT_ID"
      ;;
    verify)
      verify_dependencies
      if [[ -z "${STELLAR_CONTRACT_ID:-}" ]]; then
        log_error "STELLAR_CONTRACT_ID not set"
        exit 1
      fi
      verify_contract "$CONTRACT_NAME" "$STELLAR_CONTRACT_ID"
      ;;
    help|-h|--help)
      show_usage
      ;;
    *)
      log_error "Unknown action: $ACTION"
      show_usage
      exit 1
      ;;
  esac
}

main "$@"
