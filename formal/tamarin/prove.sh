#!/usr/bin/env bash
# Regenerate all Tamarin proof artifacts for Phase 7C.
# Usage: formal/tamarin/prove.sh
# Requires: tamarin-prover (brew install tamarin-prover/tap/tamarin-prover)
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v tamarin-prover >/dev/null 2>&1; then
  echo "tamarin-prover not found. Install: brew install tamarin-prover/tap/tamarin-prover" >&2
  exit 1
fi

mkdir -p proofs

for model in replay-demo.spthy clb.spthy clb-naive.spthy clb-naive-modeb.spthy; do
  [ -f "$model" ] || continue
  echo "=== proving $model ==="
  tamarin-prover --prove "$model" --output="proofs/${model%.spthy}.proof"
done

echo "All proof artifacts written to formal/tamarin/proofs/"
