#!/usr/bin/env bash
# Deploy ACEL contracts to Anvil on the Lightsail host (or local).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"

if ! command -v forge >/dev/null; then
  echo "forge not found. Run: bash deploy/lightsail/install.sh" >&2
  exit 1
fi

curl -sf "$RPC_URL" -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' >/dev/null \
  || { echo "Anvil not reachable at $RPC_URL — start clb-acel-anvil.service first." >&2; exit 1; }

cd contracts
if [[ ! -d lib/forge-std ]]; then
  forge install foundry-rs/forge-std
fi

echo "[deploy-anvil] broadcasting to $RPC_URL"
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --private-key "$PRIVATE_KEY"

echo ""
echo "Copy the printed contract addresses into $ROOT/.env:"
echo "  AUDIT_ANCHOR_ADDRESS"
echo "  ERC8004_REGISTRY_ADDRESS"
echo "  PREDICATE_GUARD_ADDRESS"
echo "Then restart backend: sudo systemctl restart clb-acel-backend"
