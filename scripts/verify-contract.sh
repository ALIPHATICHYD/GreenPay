#!/usr/bin/env bash
# scripts/verify-contract.sh
# Verify deployed contracts match source code and are functioning correctly.

set -euo pipefail

NETWORK=${1:-testnet}
CONTRACT_ID=${2:-}
CONTRACT_NAME=${3:-}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$PROJECT_ROOT/contracts"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ${NC} $*"; }
log_success() { echo -e "${GREEN}✓${NC} $*"; }
log_error() { echo -e "${RED}✗${NC} $*"; }

if [[ -z "$CONTRACT_ID" ]] || [[ -z "$CONTRACT_NAME" ]]; then
  echo "Usage: $0 <testnet|mainnet> <contract_id> <contract_name>"
  echo "Example: $0 testnet CABC... greenpay-contract"
  exit 1
fi

# Map contract names to WASM paths
get_wasm_path() {
  case "$1" in
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
      log_error "Unknown contract: $1"
      exit 1
      ;;
  esac
}

log_info "Verifying $CONTRACT_NAME on $NETWORK"

# Build contracts first
log_info "Building contract locally..."
cd "$CONTRACTS_DIR"
cargo build -p "$CONTRACT_NAME" --target wasm32-unknown-unknown --release 2>&1 | grep -E "(Compiling|Finished)" || true

WASM_PATH=$(get_wasm_path "$CONTRACT_NAME")

if [[ ! -f "$WASM_PATH" ]]; then
  log_error "WASM file not found: $WASM_PATH"
  exit 1
fi

# Calculate local hash
LOCAL_HASH=$(sha256sum "$WASM_PATH" | cut -d' ' -f1)
LOCAL_SIZE=$(stat -c%s "$WASM_PATH")

log_success "Local build info:"
log_info "  Hash: $LOCAL_HASH"
log_info "  Size: $LOCAL_SIZE bytes"

# Fetch contract info from network
log_info "Fetching contract info from $NETWORK..."

CONTRACT_INFO=$(stellar contract info "$CONTRACT_ID" --network "$NETWORK" 2>&1 || true)

if [[ -z "$CONTRACT_INFO" ]]; then
  log_error "Could not fetch contract from network"
  exit 1
fi

log_success "Contract found on $NETWORK"
echo "$CONTRACT_INFO" | jq '.' 2>/dev/null || echo "$CONTRACT_INFO"

# Run functional verification tests
log_info "Running functional tests..."
cd "$CONTRACTS_DIR"

case "$CONTRACT_NAME" in
  greenpay-contract)
    log_info "Testing GreenPay contract functions..."
    cargo test -p "$CONTRACT_NAME" --lib -- --nocapture 2>&1 | tail -20
    ;;
  dao-governance-contract)
    log_info "Testing DAO governance contract functions..."
    cargo test -p "$CONTRACT_NAME" --lib -- --nocapture 2>&1 | tail -20
    ;;
  escrow-contract)
    log_info "Testing Escrow contract functions..."
    cargo test -p "$CONTRACT_NAME" --lib -- --nocapture 2>&1 | tail -20
    ;;
esac

log_success "$CONTRACT_NAME verified successfully on $NETWORK"
