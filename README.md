# CLB-ACEL

Cross-Layer Binding (CLB) inside an Agentic Commerce Evidence Layer (ACEL) — research-grade production demo.

See [CONTEXT_FULL_PROJECT.md](./CONTEXT_FULL_PROJECT.md) for the full implementation brief and [docs/api-reference.md](./docs/api-reference.md) for service Swagger URLs.

## Prerequisites

- [Bun](https://bun.sh) 1.2+
- [Docker](https://www.docker.com/) (Anvil only; local Postgres and MinIO are commented out)
- Neon Postgres connection string for `DATABASE_URL` (evidence-service)
- AWS S3 bucket and credentials for evidence object storage (optional)
- [Foundry](https://book.getfoundry.sh/) (optional — for `contracts/` build/deploy)
- [uv](https://docs.astral.sh/uv/) (optional — for `experiments/risk-scoring`)

## Quick start

```bash
# Install dependencies
bun install

# Copy environment template (no secrets committed)
cp .env.example .env

# Start local chain (Anvil)
docker compose up -d

# Run web demo (interactive live HTTP demo)
bun run dev

# Or run individual services (see docs/api-reference.md for ports)
bun run --filter @clb-acel/agent-orchestrator dev
bun run --filter @clb-acel/evidence-service dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verify

```bash
bun test          # all workspace tests (packages, services, apps)
bun run typecheck
bun run build     # all workspace packages + web demo

# Contracts (requires Foundry + forge-std install)
cd contracts && forge install foundry-rs/forge-std && forge test -vvv
```

## Local services

| Service            | Port | Swagger UI                   |
| ------------------ | ---- | ---------------------------- |
| agent-orchestrator | 4000 | http://localhost:4000/docs   |
| evidence-service   | 4001 | http://localhost:4001/docs   |
| identity-service   | 4002 | http://localhost:4002/docs   |
| mandate-service    | 4003 | http://localhost:4003/docs   |
| merchant-agent-api | 4004 | http://localhost:4004/docs   |
| verifier-service   | 4005 | http://localhost:4005/docs   |
| attack-simulator   | 4006 | http://localhost:4006/docs   |
| Anvil (docker)     | 8545 | —                            |

## Monorepo layout

```txt
apps/
  web-demo/              Next.js demo UI (8 protocol screens)
  agent-orchestrator/    Mode A + Mode B HTTP flow coordinator
  merchant-agent-api/    x402-protected token-risk report API
packages/
  schemas/               Shared Zod types
  clb-core/              EIP-712 commitment C, nonce = H(C)
  evidence-core/         Canonical JSON, hash chain, Merkle
  ap2-adapter/           AP2-style mandates
  x402-adapter/          x402 payment + local facilitator
  erc8004-adapter/       Mock identity registry
  delivery-core/         Report hashing + heuristic scoring
  verifier-core/         Deterministic rules R1–R17 (mode-aware: Mode A / Mode B)
  predicate-adapter/     Mode B predicate guard / caveat adapter (demo ERC-7710 stand-in)
  attack-core/           Phase 3 binding fixtures + B0–B3 matrix; Phase 4 P5 predicate fixtures
  service-kit/           Shared env loading + OpenAPI registration
services/
  evidence-service/      Evidence graph ingestion (Postgres)
  identity-service/      ERC-8004 agent cards
  mandate-service/       INTENT/CART/PAYMENT mandates
  verifier-service/      Verification certificate API
  attack-simulator/      Phase 3 attack benchmark API
contracts/               Foundry: AgenticAuditAnchor + MockERC8004
experiments/risk-scoring/  uv Python scorer (evaluation / Colab)
experiments/benchmarks/  Phase 3 attack matrix and metric artifacts
```

## Status

### Phase 0 — Scaffold ✅

- [x] Bun workspace, TypeScript, ESLint/Prettier
- [x] docker-compose (Anvil; Postgres/MinIO commented for Neon/AWS)
- [x] Shared Zod schemas (`packages/schemas`)
- [x] Web demo shell + research mode toggle

### Phase 1 — Evidence graph ✅

- [x] `packages/evidence-core` (hash chain, Merkle root)
- [x] `services/evidence-service` (Postgres + Swagger)

### Phase 2 — Mode A CLB foundation ✅

- [x] `packages/clb-core` + protocol adapters
- [x] Identity, mandate, merchant, verifier services + orchestrator
- [x] Deterministic verifier rules R1–R14
- [x] Foundry contract sources + tests (run `forge test` in `contracts/`)
- [x] Python uv risk scorer (`experiments/risk-scoring`)
- [x] Web demo screens 1–6, 8 wired to live Mode A trace

### Phase 2 follow-ups ✅

- [x] On-chain anchor wiring (`@clb-acel/anchor-core`, evidence-service)
- [x] Cross-service HTTP orchestrator (`runHumanPresentOverHttp`)
- [x] Browser wallet mandate signing (MetaMask/Rabby)
- [x] x402 facilitator modes: local / HTTP / on-chain
- [x] LLM report explanation adapter
- [x] Optional Python scorer hook in merchant API
- [x] CI: Bun tests, `forge test`, Python scorer pytest

### Phase 3 — Attack simulator ✅

- [x] `@clb-acel/attack-core` with ten fixtures, audit checks, and B0–B3 matrix
- [x] `services/attack-simulator` on port 4006
- [x] Orchestrator `POST /attack/:attackName`
- [x] `/attacks` live runner UI
- [x] `bun run e2e:phase3` benchmark artifacts under `experiments/benchmarks`

### Phase 4 — Mode B delegated / predicate flow ✅

- [x] Predicate schema hardening (`SettlementParams`, mandate `predicateRef`)
- [x] `clb-core` `evaluatePredicate` + settlement-time commitment C' (EIP-712)
- [x] `@clb-acel/predicate-adapter` (in-memory + contract guard, demo ERC-7710 stand-in)
- [x] `contracts/PredicatePaymentGuard.sol` + Foundry tests (TS↔Solidity C' parity)
- [x] `x402-adapter` `predicate` scheme + guard-enforced settle path
- [x] `verifier-core` R17 + mode-aware R6/R7/R8/R10/R11–R13
- [x] `ap2-adapter` INTENT-over-predicate + `mandate-service` predicate support
- [x] `agent-orchestrator` `runDelegated` + `POST /run-delegated`
- [x] `bun run e2e:phase4` (delegated PASS + R17 + guard prevention + gas report)

### Phase 4 follow-up — P5 predicate attacks ✅

- [x] `attack-core` `MODE_B_PREDICATE_FIXTURES` + `runPredicateAttack`
- [x] `attack-simulator` predicate endpoints + orchestrator `POST /attack/predicate/:name`
- [x] `bun run e2e:phase4b` → `experiments/benchmarks/p5-attack-matrix.md`

### Phase 5 — Interactive live demo ✅

- [x] Wallet-signed mandate registration (`POST /mandates/register`)
- [x] HTTP Mode A with externally registered mandates
- [x] HTTP Mode B delegated run with registered INTENT predicate mandate + R17
- [x] Next.js `/api/demo/*` BFF routes
- [x] `DemoRunProvider` session state + mode-aware shell
- [x] Interactive intent, discovery, mandate, payment, evidence, verifier, anchor pages
- [x] Anchor button + status/read-back UI
- [x] `bun run e2e:phase5`

### Phase 6 — Production hardening (in progress)

- [x] Lightsail backend deploy scripts (`deploy/lightsail/`, `scripts/start-backend.sh`)
- [ ] [docs/deploy-lightsail.md](./docs/deploy-lightsail.md) checklist: Base Sepolia, HTTPS, SECURITY.md, demo script, encryption

See [DECISIONS.md](./DECISIONS.md) for architecture choices and Phase 2 deferrals.

**Deploy (Anvil on Lightsail + Vercel UI):** [docs/deploy-lightsail.md](./docs/deploy-lightsail.md)
