# Option A — Your agents, your wallets, your services

Use **your** funded testnet wallets and **your** local CLB-ACEL stack. Discovery uses the seeded shopping + merchant agents from `identity-service`; you do not depend on random agents from the public ERC-8004 registry.

Two tiers:

| Tier | On-chain identity | Best for |
| --- | --- | --- |
| **A1 — Quick** | In-memory mock (default) | Fastest smoke test after funding wallets |
| **A2 — Full** | Deploy mock registry + register agents on Base Sepolia | Phase 7B “real identity” demo |

You already completed wallet funding if `cast balance … --rpc-url https://sepolia.base.org` shows ETH on deployer + shopping agent.

---

## Shared `.env` (both tiers)

In repo root `.env` (see `.env.example`):

```bash
CHAIN_ID=84532
RPC_URL=https://sepolia.base.org
RPC_URL_BASE_SEPOLIA=https://sepolia.base.org

DEPLOYER_PRIVATE_KEY=0x...          # deployer
USER_TEST_PRIVATE_KEY=0x...         # same as deployer is fine
SHOPPING_AGENT_PRIVATE_KEY=0x...    # pays x402 (ETH + USDC)
MERCHANT_AGENT_PRIVATE_KEY=0x...    # receives payment; signs reports

X402_FACILITATOR_MODE=chain         # real Base Sepolia txHash
X402_NETWORK=base-sepolia
X402_ASSET=USDC
X402_ASSET_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
X402_PAY_TO_ADDRESS=0x...           # merchant **address** (from MERCHANT key)
X402_PRICE=2.00

ORCHESTRATOR_TRANSPORT=http         # live multi-service demo
```

Leave `ERC8004_REGISTRY_ADDRESS` **empty** for A1; set it after deploy for A2.

---

## A1 — Quick demo (no on-chain registry)

Identity stays in-memory; agents are seeded from your `.env` keys automatically.

### 1. Start backend

```bash
./scripts/start-all-services.sh
```

### 2. Smoke test (terminal 2)

```bash
bun run e2e:phase2
```

Expect `settlement.txHash` as a real `0x…` hash on [sepolia.basescan.org](https://sepolia.basescan.org).

### 3. Interactive web demo (optional)

```bash
bun run dev
```

Open http://localhost:3000 — intent → discovery → checkout → payment. Discovery narrates “searching ERC-8004” but resolves your local `shopping-agent-001` / `analysis-agent-001`.

---

## A2 — Full demo (on-chain registry)

Adds a **your** `MockERC8004IdentityRegistry` on Base Sepolia so `identity-service` reads agents from chain when `ERC8004_REGISTRY_ADDRESS` is set.

### 1. Deploy contracts

```bash
chmod +x scripts/deploy-base-sepolia.sh
./scripts/deploy-base-sepolia.sh
```

Copy printed addresses into `.env`:

```bash
AUDIT_ANCHOR_ADDRESS=0x...
ERC8004_REGISTRY_ADDRESS=0x...
```

### 2. Start services **before** registering agents

The on-chain reader fetches agent cards from `agentURI` (localhost URLs):

```bash
./scripts/start-all-services.sh
```

### 3. Register demo agents on-chain

In another terminal:

```bash
bun run setup:register-agents
```

This registers:

| agentId | Role |
| --- | --- |
| `shopping-agent-001` | Payer / shopping agent |
| `analysis-agent-001` | Merchant (token-risk reports) |
| `analysis-agent-002` | Decoy (no x402 — discovery narrative) |

Add to `.env`:

```bash
TEST_AGENT_ID=shopping-agent-001
```

### 4. Restart identity-service

So it picks up `ERC8004_REGISTRY_ADDRESS` (or restart all services with Ctrl+C → `./scripts/start-all-services.sh`).

Verify:

```bash
curl -s http://localhost:4002/agents/shopping-agent-001 | jq .agentId
# shopping-agent-001
```

### 5. Run demo

```bash
bun run e2e:phase2
# and/or
bun run dev
```

With `AUDIT_ANCHOR_ADDRESS` set, successful HTTP runs auto-anchor the Merkle root (non-fatal if anchor tx fails).

---

## Address cheat sheet

Derive addresses from your keys (never commit keys):

```bash
cast wallet address --private-key $SHOPPING_AGENT_PRIVATE_KEY
cast wallet address --private-key $MERCHANT_AGENT_PRIVATE_KEY
```

| Role | Pays gas? | Needs USDC? |
| --- | --- | --- |
| Deployer | Yes | No |
| Shopping agent | Yes | Yes (x402 asset) |
| Merchant | No* | No (receives USDC) |

\*Merchant only needs ETH if you register it yourself on-chain; `setup:register-agents` uses the deployer wallet.

---

## Faucets (if you need more gas)

Alchemy requires mainnet ETH. Prefer:

- [Coinbase CDP faucet](https://portal.cdp.coinbase.com/products/faucet) — Base Sepolia
- [Chainlink faucet](https://faucets.chain.link/base-sepolia)
- [thirdweb Base Sepolia faucet](https://thirdweb.com/base-sepolia-testnet)

USDC: [Circle faucet](https://faucet.circle.com) → Base → Sepolia → shopping agent address.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Insufficient funds` on settle | Drip more ETH to **shopping agent** (and deployer for deploy) |
| Identity 404 for agent | A2: run `bun run setup:register-agents`; ensure `ERC8004_REGISTRY_ADDRESS` is set |
| Agent card fetch fails on-chain | Start `identity-service` + `merchant-agent-api` before register; URIs point to localhost |
| Verification FAIL on R14b | Ensure merchant API is current (adds `deliveryBinding`); restart services |
| Still using mock identity | Clear `ERC8004_REGISTRY_ADDRESS` for A1; for A2 it must be set **and** RPC reachable |

---

## What Option A does *not* do

- LLM search of the **public** ERC-8004 registry (`0x8004A818…`) — discovery is deterministic over **your** three seeded agents
- Use third-party agents with pre-funded wallets — you fund **your** keys only

See [testnet-setup.md](./testnet-setup.md) for wallet generation and faucet links.
