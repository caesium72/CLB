# Phase 5 Demo Walkthrough

## Local Anvil Path

1. Copy `.env.example` to `.env`.
2. Keep `CHAIN_ID=31337`, `NEXT_PUBLIC_DEMO_CHAIN_ID=31337`, and `RPC_URL=http://127.0.0.1:8545`.
3. Start Anvil with `anvil --chain-id 31337`.
4. Start the services:

```bash
bun run --filter @clb-acel/agent-orchestrator dev
bun run --filter @clb-acel/evidence-service dev
bun run --filter @clb-acel/identity-service dev
bun run --filter @clb-acel/mandate-service dev
bun run --filter @clb-acel/merchant-agent-api dev
bun run --filter @clb-acel/verifier-service dev
```

5. Start the web demo with `bun run dev` and open `http://localhost:3000`.

The sidebar lists **Attack Simulator** as step 0 (optional). The live shopping walkthrough runs steps 1–9.

## Mode A presenter script (~3 min)

1. **Intent** — Enter task and token; click **Send to agent**.
2. **Discovery** — Watch the shopping agent search ERC-8004 and select the analysis merchant; continue to quote.
3. **Quote** — Review the live cart line item; continue to authorize.
4. **Mandate** — Connect wallet (or demo account); **Sign cart authorization** (no payment yet).
5. **Checkout** — Click **Agent pays**; observe the live **402 Payment Required** panel, then settlement.
6. **Receipt** — Confirm amount and nonce binding.
7. **Evidence** — Interactive graph: hash-chain spine (BINDS_TO) plus semantic edges (AUTHORIZES → PAYS_FOR → SETTLES → DELIVERS). Click nodes for detail; enable **Research mode** for the events table and raw JSON.
8. **Verifier / Anchor** — Certificate and optional on-chain anchor.

## Mode B presenter script (~3 min)

1. Toggle **You set limits, agent pays**.
2. Same intent and discovery flow.
3. **Quote** shows spending limits preview (not an exact price yet).
4. **Mandate** — **Sign spending limits** once (INTENT predicate).
5. **Checkout** — Click **Agent pays**; agent picks concrete settlement within limits.
6. **Receipt** — Note agent-chosen amount and R17 in verifier step.

## Base Sepolia Switch

Set:

```bash
CHAIN_ID=84532
NEXT_PUBLIC_DEMO_CHAIN_ID=84532
RPC_URL_BASE_SEPOLIA=<your Base Sepolia RPC>
AUDIT_ANCHOR_ADDRESS=<deployed AgenticAuditAnchor>
DEPLOYER_PRIVATE_KEY=<funded deployer key>
```

Fund the deployer wallet, deploy the anchor contract, restart services and the web demo, then use the same click path.

## Playwright smoke test

```bash
cd apps/web-demo && bunx playwright test
```
