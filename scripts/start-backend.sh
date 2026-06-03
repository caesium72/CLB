#!/usr/bin/env bash
# Start all CLB-ACEL backend services (HTTP orchestrator mode).
# Usage: from repo root, after .env is configured:
#   ./scripts/start-backend.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export ORCHESTRATOR_TRANSPORT="${ORCHESTRATOR_TRANSPORT:-http}"

PIDS=()

cleanup() {
  local pid
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

start_service() {
  local filter="$1"
  echo "[start-backend] $filter"
  bun run --filter "$filter" dev &
  PIDS+=("$!")
}

start_service "@clb-acel/identity-service"
start_service "@clb-acel/mandate-service"
start_service "@clb-acel/evidence-service"
start_service "@clb-acel/verifier-service"
start_service "@clb-acel/merchant-agent-api"
start_service "@clb-acel/agent-orchestrator"
start_service "@clb-acel/attack-simulator"

echo "[start-backend] listening on ports ${AGENT_ORCHESTRATOR_PORT:-4000}–${ATTACK_SIMULATOR_PORT:-4006}"
wait
