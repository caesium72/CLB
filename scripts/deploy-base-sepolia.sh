#!/usr/bin/env bash
# Deploy AgenticAuditAnchor + MockERC8004IdentityRegistry to Base Sepolia.
# Usage (from repo root): ./scripts/deploy-base-sepolia.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

RPC_URL="${RPC_URL_BASE_SEPOLIA:-https://sepolia.base.org}"
PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY:?Set DEPLOYER_PRIVATE_KEY in .env}"

if ! command -v forge >/dev/null; then
  echo "forge not found. Install Foundry: https://book.getfoundry.sh/getting-started/installation" >&2
  exit 1
fi

cd contracts
if [[ ! -d lib/forge-std ]]; then
  forge install foundry-rs/forge-std
fi

echo "[deploy-base-sepolia] broadcasting to $RPC_URL"
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --private-key "$PRIVATE_KEY"

echo ""
echo "Add the printed addresses to $ROOT/.env:"
echo "  AUDIT_ANCHOR_ADDRESS=<AgenticAuditAnchor>"
echo "  ERC8004_REGISTRY_ADDRESS=<MockERC8004IdentityRegistry>"
echo ""
echo "Then register your demo agents:"
echo "  bun run setup:register-agents"
