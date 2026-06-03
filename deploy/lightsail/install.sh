#!/usr/bin/env bash
# One-time setup on Ubuntu Lightsail (22.04+): Bun, Foundry (forge/anvil), uv, nginx.
# Run: bash deploy/lightsail/install.sh
set -euo pipefail

if ! command -v sudo >/dev/null; then
  echo "sudo required" >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y curl git nginx build-essential

# --- Bun ---
if ! command -v bun >/dev/null; then
  curl -fsSL https://bun.sh/install | bash
fi
# shellcheck disable=SC2016
grep -q 'BUN_INSTALL' "$HOME/.bashrc" 2>/dev/null || {
  echo 'export BUN_INSTALL="$HOME/.bun"' >>"$HOME/.bashrc"
  echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >>"$HOME/.bashrc"
}
# shellcheck disable=SC1091
source "$HOME/.bun/env" 2>/dev/null || true
export PATH="$HOME/.bun/bin:$PATH"

# --- Foundry (forge, anvil, cast) ---
if ! command -v forge >/dev/null; then
  curl -L https://foundry.paradigm.xyz | bash
  "$HOME/.foundry/bin/foundryup"
fi
# shellcheck disable=SC2016
grep -q '.foundry/bin' "$HOME/.bashrc" 2>/dev/null || {
  echo 'export PATH="$HOME/.foundry/bin:$PATH"' >>"$HOME/.bashrc"
}
export PATH="$HOME/.foundry/bin:$PATH"

# --- uv (Python risk scorer when RISK_SCORER=python) ---
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
# shellcheck disable=SC2016
grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null || {
  echo 'export PATH="$HOME/.local/bin:$PATH"' >>"$HOME/.bashrc"
}
export PATH="$HOME/.local/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

bun install
chmod +x scripts/start-backend.sh scripts/deploy-anvil-contracts.sh

# Sync Python scorer env (optional)
if [[ -f experiments/risk-scoring/pyproject.toml ]]; then
  (cd experiments/risk-scoring && uv sync) || echo "uv sync skipped (non-fatal)"
fi

if [[ ! -f .env ]]; then
  cp deploy/lightsail/env.production.example .env
  echo "Created .env from deploy/lightsail/env.production.example"
fi

echo ""
echo "Installed: bun $(bun --version), forge $(forge --version | head -1), uv $(uv --version)"
echo ""
echo "Next steps (Anvil + Vercel frontend):"
echo "  1. Edit $REPO_ROOT/.env (DATABASE_URL, S3)"
echo "  2. sudo cp deploy/lightsail/clb-acel-anvil.service /etc/systemd/system/"
echo "     sudo cp deploy/lightsail/clb-acel-backend.service /etc/systemd/system/"
echo "     (units expect repo at /home/ubuntu/agentic-web3)"
echo "  3. sudo systemctl daemon-reload"
echo "     sudo systemctl enable --now clb-acel-anvil"
echo "     bash scripts/deploy-anvil-contracts.sh   # then update contract addresses in .env"
echo "     sudo systemctl enable --now clb-acel-backend"
echo "  4. Demo HTTPS: sudo bash deploy/lightsail/setup-https.sh"
echo "  5. Vercel env: deploy/lightsail/vercel.env.example"
echo "  Firewall: 22, 80, 443, 8545 (+ 4000-4006 if not using nginx HTTPS paths)"
