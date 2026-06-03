#!/usr/bin/env bash
# Start all backend services (run from repo root).
# Usage: ./scripts/start-all-services.sh
# Stop with Ctrl+C — sends SIGTERM to all child processes.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load repo .env so services inherit DATABASE_URL, CHAIN_ID, etc.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

PIDS=()

cleanup() {
  echo ""
  echo "Stopping services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

start() {
  local name="$1"
  local filter="$2"
  echo "→ $name"
  bun run --filter "$filter" dev &
  PIDS+=($!)
}

echo "Starting CLB-ACEL backend services (ports 4000–4006)..."
start "agent-orchestrator :4000" "@clb-acel/agent-orchestrator"
start "evidence-service   :4001" "@clb-acel/evidence-service"
start "identity-service   :4002" "@clb-acel/identity-service"
start "mandate-service    :4003" "@clb-acel/mandate-service"
start "merchant-agent-api :4004" "@clb-acel/merchant-agent-api"
start "verifier-service   :4005" "@clb-acel/verifier-service"
start "attack-simulator   :4006" "@clb-acel/attack-simulator"

echo ""
echo "All services starting. Run the E2E smoke test in another terminal:"
echo "  bun run e2e:phase2"
echo "  bun run e2e:phase3"
echo ""
echo "Press Ctrl+C to stop all services."

wait
