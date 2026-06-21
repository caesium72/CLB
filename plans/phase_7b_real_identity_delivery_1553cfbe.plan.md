---
name: Phase 7B — Real ERC-8004 Identity + Evidentiary Delivery
overview: "Replace the two remaining mock/weak layers on the happy path. (0) Free testnet setup: fund two Base Sepolia wallets from public faucets (testnet ETH + testnet USDC from Circle — zero real monetary value), register both agents on the live ERC-8004 Base Sepolia registry, configure env. (1) Resolve a REAL ERC-8004 identity on Base Sepolia (Identity Registry went live on mainnet Jan 2026; canonical contracts exist) — verifier R3/R4 read a live agent card (endpoints + payment keys), not a fixture; keep the mock behind the adapter for offline tests. (2) Wire X402_FACILITATOR_MODE=chain so the merchant receives REAL testnet USDC via a real on-chain EIP-3009 transfer on Base Sepolia — the settlement txHash is visible on Basescan and the merchant wallet balance increases. (3) Auto-anchor: every successful HTTP-flow run calls anchor-core after verification. (4) Make delivery cryptographic: merchant signs (settlementTxHash || reportHash); add verifier rule R14b_DELIVERY_BOUND_TO_SETTLEMENT binding delivery to THIS settlement; frame R14/R14b as accountability/dispute evidence (NOT atomicity — cite A402 as the enforcement alternative we don't claim). Spec: docs/superpowers/specs/2026-06-04-phase-7-sub-phases-design.md §5 (7B)."
todos:
  - id: 7b-testnet-setup
    content: "Free testnet setup: fund wallets from faucets (Base Sepolia ETH + testnet USDC), register agents on live ERC-8004 Base Sepolia registry, update .env.example with faucet URLs, create docs/testnet-setup.md"
    status: completed
  - id: 7b-x402-chain-mode
    content: "Wire X402_FACILITATOR_MODE=chain: real on-chain EIP-3009 USDC transfer to merchant wallet on Base Sepolia; settlementTxHash is a real tx visible on Basescan; add USDC testnet address to .env.example"
    status: completed
  - id: 7b-auto-anchor
    content: "runHumanPresentOverHttp + runDelegatedOverHttp: call createAnchorClientFromEnv() after successful verification; anchor fires automatically on every happy-path run; silent no-op when AUDIT_ANCHOR_ADDRESS not set"
    status: completed
  - id: 7b-erc8004-real-reader
    content: "erc8004-adapter: real on-chain registry reader (chainId, registryAddr, agentId) -> agent card; keep InMemory/mock behind the same interface; env-selected (REAL on Base Sepolia, mock offline)"
    status: completed
  - id: 7b-identity-happy-path
    content: "identity-service + happy-path resolution use the real reader; R3 resolves a live agentId, R4 checks the live card's authorizedPaymentKeys"
    status: completed
  - id: 7b-delivery-signature
    content: "delivery-core + merchant-agent-api: merchant signs (settlementTxHash || reportHash) and returns it in the report artifact"
    status: completed
  - id: 7b-r14b-rule
    content: "verifier-core: add R14b_DELIVERY_BOUND_TO_SETTLEMENT verifying the signature binds delivery to THIS settlementTxHash; keep R14 as the timestamp check"
    status: completed
  - id: 7b-docs-framing
    content: "docs + DECISIONS: frame R14/R14b as accountability/dispute evidence; cite A402 (2603.01179) as the atomicity/fair-exchange alternative we do not claim; document the mock<->real identity switch; document x402 chain-mode and auto-anchor"
    status: completed
isProject: false
---

# Phase 7B — Real Identity + Evidentiary Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The happy-path trace runs on **free Base Sepolia testnet** (no real money — testnet assets only), resolves a **live ERC-8004 agent card** (R3/R4 read real on-chain data), settles via a **real on-chain x402 EIP-3009 USDC transfer** visible on Basescan (the merchant's wallet actually receives testnet USDC), auto-anchors the Merkle root to `AgenticAuditAnchor`, and the delivered report is **cryptographically bound to its settlement** (R14b).

**Architecture:** Three layers of "realness" added: (1) testnet identity — `erc8004-adapter` factory selects a `viem`-backed on-chain reader vs. mock by env; (2) testnet x402 payment — `X402_FACILITATOR_MODE=chain` selects the existing `createBaseSepolia` facilitator in `x402-adapter`, producing a real txHash pointing to a real USDC transfer; (3) delivery binding — merchant signs `(settlementTxHash ‖ reportHash)`, verifier checks it (R14b). Auto-anchor wires `anchor-core` after every successful HTTP-flow run. All run on free testnet assets.

**⚠️ Free testnet assets only — no real monetary value:**

- Base Sepolia ETH: from public faucets (for gas — deployer + shopping-agent wallets)
- Base Sepolia USDC: from Circle's free testnet faucet at faucet.circle.com (select "Base Sepolia")
- These tokens have zero real-world value; this is explicitly a research testnet

**Tech Stack:** TypeScript (Bun) · `viem` (contract reads, EIP-3009 signatures) · Base Sepolia public RPC · existing `erc8004-adapter`, `x402-adapter` (chain mode already implemented), `anchor-core`, `identity-service`, `delivery-core`, `merchant-agent-api`, `verifier-core`.

**Repo grounding (verify before editing):**

- `packages/erc8004-adapter/src/*` — in-memory registry + `AgentCard` shape + `Erc8004Registry` interface.
- `packages/x402-adapter/src/index.ts` — `createFacilitator(mode?)` already supports `"chain"` → `createBaseSepolia`; `X402_FACILITATOR_MODE` env selects it. `X402_ASSET_ADDRESS` is the USDC contract address.
- `packages/anchor-core/src/index.ts` — `createAnchorClientFromEnv()` returns an `AnchorClient | null`; null-safe (no-op when `AUDIT_ANCHOR_ADDRESS` not set).
- `apps/agent-orchestrator/src/http-flow.ts` — `runHumanPresentOverHttp` and `runDelegatedOverHttp` (the two HTTP flows that need auto-anchor).
- `packages/delivery-core/src/*` — `reportHash`, merchant signing/verification.
- `packages/verifier-core/src/index.ts` — rule list incl. `R3_AGENT_IDENTITY_RESOLVES`, `R4_AGENT_PAYMENT_KEY_AUTHORIZED`, `R14_DELIVERY_AFTER_SETTLEMENT`.
- ERC-8004 canonical contracts: `erc-8004/erc-8004-contracts` (Identity Registry ABI). Env: `CHAIN_ID=84532`, `RPC_URL_BASE_SEPOLIA`, `ERC8004_REGISTRY_ADDRESS`.

---

## Task 0: Free testnet setup + env configuration

**Files:**

- Modify: `.env.example` (Base Sepolia section + faucet URLs as comments)
- Create: `docs/testnet-setup.md`

> This task is **documentation and configuration** — no code. It must be done first so all subsequent tasks have real wallets and a funded chain to test against.

- [ ] **Step 1: Generate three dedicated testnet wallets** (never reuse wallets that have real funds)

Run: `node -e "const {generatePrivateKey,privateKeyToAccount} = require('viem/accounts'); for(let i=0;i<3;i++){const k=generatePrivateKey(); console.log(k, privateKeyToAccount(k).address)}"` (or use `cast wallet new` if Foundry is installed)

Note the three key/address pairs as: DEPLOYER, SHOPPING_AGENT, MERCHANT_AGENT. Keep them for testnet only.

- [ ] **Step 2: Get free testnet ETH (for gas)**

Fund DEPLOYER and SHOPPING_AGENT addresses with Base Sepolia ETH from **any free public faucet** — no registration required on most:

- https://www.alchemy.com/faucets/base-sepolia (0.05 ETH per request, no login needed)
- https://faucet.quicknode.com/base/sepolia (requires QuickNode account)
- https://coinbase.com/faucets (select Base Sepolia)

MERCHANT_AGENT does not need ETH — as the EIP-3009 transfer recipient it does not pay gas.

- [ ] **Step 3: Get free testnet USDC (for x402 payment)**

Fund SHOPPING_AGENT with Base Sepolia USDC from **Circle's free testnet faucet**:

- Go to https://faucet.circle.com → select "Base" → select "Sepolia" → enter SHOPPING_AGENT address → click "Send USDC"
- No registration, no real money, testnet USDC only.
- Amount received is typically 10 USDC (testnet) — more than enough for repeated demos.

- [ ] **Step 4: Register both agents on the live ERC-8004 Base Sepolia registry**

Check the live registry address from `erc-8004/erc-8004-contracts` releases or Ethereum EIPs page. If available on Base Sepolia, register the shopping agent and merchant agent using the DEPLOYER wallet. If no official Base Sepolia registry exists yet, deploy `MockERC8004IdentityRegistry.sol` to Base Sepolia using the existing deploy script and use that address. Note the `ERC8004_REGISTRY_ADDRESS` and the `agentId` values returned.

- [ ] **Step 5: Update `.env.example`** with the Base Sepolia config block:

```bash
# ── Base Sepolia testnet (free — no real monetary value) ──────────────────────
# Wallets: generate with `cast wallet new` or `node -e "..."` — testnet only
# ETH faucet (free, no login): https://www.alchemy.com/faucets/base-sepolia
# USDC faucet (free, Circle): https://faucet.circle.com (select Base > Sepolia)

CHAIN_ID=84532
RPC_URL_BASE_SEPOLIA=https://sepolia.base.org          # free public RPC
DEPLOYER_PRIVATE_KEY=                                   # testnet-only wallet
USER_TEST_PRIVATE_KEY=                                  # can reuse DEPLOYER for demo
SHOPPING_AGENT_PRIVATE_KEY=                             # needs testnet ETH + USDC
MERCHANT_AGENT_PRIVATE_KEY=                             # receives USDC (no ETH needed)

ERC8004_REGISTRY_ADDRESS=                               # live registry or mock deploy
TEST_AGENT_ID=                                          # shopping agent agentId on-chain

# x402 — Base Sepolia USDC (testnet token, no real value)
X402_FACILITATOR_MODE=chain                             # sends real on-chain tx; set to "local" for offline
X402_NETWORK=base-sepolia
X402_ASSET=USDC
X402_ASSET_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # USDC on Base Sepolia
X402_PAY_TO_ADDRESS=                                    # merchant wallet (receives testnet USDC)
X402_PRICE=2.00

# Audit anchor (deploy once; see contracts/README.md)
AUDIT_ANCHOR_ADDRESS=
```

- [ ] **Step 6: Write `docs/testnet-setup.md`** — a concise step-by-step guide (faucet URLs, wallet generation, agent registration, env file fill-in). Reference the `.env.example` block above. One paragraph explaining: _"All testnet assets have zero real-world monetary value. The ETH is for gas. The USDC is a test token issued by Circle for development. Never use wallets that hold real funds."_

---

## Task 1 (was 0): x402 chain-mode wiring for real merchant payment

**Files:**

- Modify: `apps/agent-orchestrator/src/flow.ts` (in-process `resolveConfig` — already reads `X402_FACILITATOR_MODE`)
- Verify: `packages/x402-adapter/src/index.ts` — confirm `createFacilitator("chain")` calls `createBaseSepolia` with `RPC_URL_BASE_SEPOLIA` + `DEPLOYER_PRIVATE_KEY`; no code change if already wired
- Modify: `apps/merchant-agent-api/src/server.ts` — ensure the `payTo` address comes from `X402_PAY_TO_ADDRESS` env, not a hardcoded Anvil key

> **What this enables in the demo:** setting `X402_FACILITATOR_MODE=chain` in `.env` means the shopping agent wallet's testnet USDC is transferred on-chain to the merchant's `X402_PAY_TO_ADDRESS`. The `settlementTxHash` in the trace is a **real Base Sepolia transaction** — paste it into https://sepolia.basescan.org to see the USDC transfer.

- [ ] **Step 1: Verify chain-mode wiring is complete** — read `packages/x402-adapter/src/index.ts` around `createFacilitator` and `createBaseSepolia`. Confirm:
  - `X402_FACILITATOR_MODE=chain` selects `createBaseSepolia(RPC_URL_BASE_SEPOLIA, DEPLOYER_PRIVATE_KEY)`.
  - The returned `settlementReceipt.txHash` is a real chain tx (not `simulateTxHash`).
  - If not wired, add the env read (no structural change needed — the code path already exists).

- [ ] **Step 2: Confirm `X402_PAY_TO_ADDRESS` flows to merchant** — in `apps/merchant-agent-api/src/server.ts` the `payTo` in `settlementDescriptor` must come from `process.env.X402_PAY_TO_ADDRESS`. Grep and verify; fix if it falls back to a hardcoded key.

- [ ] **Step 3: Manual smoke test** (Base Sepolia, funded wallets required)

Run: `X402_FACILITATOR_MODE=chain bun run e2e:phase2`
Expected: `settlement.txHash` is a `0x...` Base Sepolia txHash (not a keccak of a local payload). Paste the hash into `https://sepolia.basescan.org` — the USDC transfer from SHOPPING_AGENT to X402_PAY_TO_ADDRESS is visible.

---

## Task 2 (new): Auto-anchor after every successful HTTP-flow run

**Files:**

- Modify: `apps/agent-orchestrator/src/http-flow.ts` (tail of `runHumanPresentOverHttp` and `runDelegatedOverHttp`)
- Create/Modify: `apps/agent-orchestrator/test/auto-anchor.test.ts`

> Auto-anchor means the Merkle root is written to `AgenticAuditAnchor.sol` on Base Sepolia automatically at the end of every successful demo run. When `AUDIT_ANCHOR_ADDRESS` is not set, `createAnchorClientFromEnv()` returns `null` and the call is a no-op — offline tests are unaffected.

- [ ] **Step 1: Write the failing test** — a mocked anchor client receives exactly one call per successful run; the call carries the expected `traceId`, `merkleRoot`, and `eventHashes`.

```ts
// apps/agent-orchestrator/test/auto-anchor.test.ts
import { expect, it, mock } from "bun:test";

it("auto-anchor is called once after a successful run with the correct merkleRoot", async () => {
  const anchored: unknown[] = [];
  const mockAnchorClient = {
    anchorTrace: async (input: unknown) => {
      anchored.push(input);
      return { txHash: "0xanchor" };
    },
  };
  // inject via the overrides parameter (see Step 3)
  const out = await runHumanPresentOverHttp(testIntent(), { anchorClient: mockAnchorClient });
  expect(anchored).toHaveLength(1);
  expect((anchored[0] as any).merkleRoot).toBe(out.merkleRoot);
});
```

- [ ] **Step 2: Run to verify it fails** Run: `bun test apps/agent-orchestrator/test/auto-anchor.test.ts` → FAIL (`anchorClient` option not accepted).

- [ ] **Step 3: Implement** — at the end of both `runHumanPresentOverHttp` and `runDelegatedOverHttp`, after `verification` is computed:

```ts
// apps/agent-orchestrator/src/http-flow.ts (tail of each run function)
const anchorClient = options.anchorClient ?? createAnchorClientFromEnv();
if (anchorClient && verification.result.status !== "FAIL") {
  await anchorClient
    .anchorTrace({
      traceId,
      merkleRoot,
      eventHashes,
      metadataUri: `clb-acel://trace/${traceId}`,
    })
    .catch(() => {}); // non-fatal: demo works without a deployed anchor
}
```

Add `anchorClient?: AnchorClient | null` to the `options` parameter type of both functions (for injection in tests).

- [ ] **Step 4: Run to verify it passes** Run: `bun test apps/agent-orchestrator/test/auto-anchor.test.ts` → PASS.

---

**Files:**

- Create: `packages/erc8004-adapter/src/onchain-reader.ts`
- Modify: `packages/erc8004-adapter/src/index.ts` (factory: `createIdentityRegistry(env)` → real | mock)
- Create: `packages/erc8004-adapter/test/onchain-reader.test.ts`

- [ ] **Step 1: Write the failing test** — resolving a known testnet `agentId` returns a card with `authorizedPaymentKeys`; the factory returns the mock when no RPC/registry is configured.

```ts
// packages/erc8004-adapter/test/onchain-reader.test.ts
import { describe, expect, it } from "bun:test";
import { createIdentityRegistry } from "../src";

it("factory falls back to mock without RPC config", () => {
  const reg = createIdentityRegistry({}); // no RPC_URL / registry
  expect(reg.kind).toBe("mock");
});

it("real reader resolves a live agent card (Base Sepolia)", async () => {
  if (!process.env.RPC_URL_BASE_SEPOLIA || !process.env.ERC8004_REGISTRY_ADDRESS) return; // skip offline
  const reg = createIdentityRegistry({
    rpcUrl: process.env.RPC_URL_BASE_SEPOLIA,
    registryAddr: process.env.ERC8004_REGISTRY_ADDRESS as `0x${string}`,
    chainId: 84532,
  });
  expect(reg.kind).toBe("onchain");
  const card = await reg.getCard(process.env.TEST_AGENT_ID!);
  expect(card.authorizedPaymentKeys.length).toBeGreaterThan(0);
  expect(card.agentId).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/erc8004-adapter/test/onchain-reader.test.ts`
Expected: FAIL — `createIdentityRegistry` has no `onchain` branch / `reg.kind` undefined.

- [ ] **Step 3: Implement the on-chain reader** — a `viem` public client reads the Identity Registry (`ownerOf`/`agentURI`/key-authorization views per the canonical ABI), fetches the agent card JSON from `agentURI` (IPFS/HTTPS), and maps it to the existing `AgentCard` type. `createIdentityRegistry` returns `{ kind: "onchain", getCard }` when RPC+registry are set, else the existing mock `{ kind: "mock", ... }`.

```ts
// packages/erc8004-adapter/src/onchain-reader.ts (shape)
export function createOnchainRegistry(o: {
  rpcUrl: string;
  registryAddr: `0x${string}`;
  chainId: number;
}) {
  const client = createPublicClient({ chain: defineChain(o.chainId), transport: http(o.rpcUrl) });
  return {
    kind: "onchain" as const,
    async getCard(agentId: string): Promise<AgentCard> {
      const uri = await client.readContract({
        address: o.registryAddr,
        abi: ERC8004_ABI,
        functionName: "agentURI",
        args: [BigInt(agentId)],
      });
      const card = await fetchAgentCard(uri); // HTTPS/IPFS
      return normalizeCard(card, { chainId: o.chainId, registryAddr: o.registryAddr, agentId });
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes** (the live test self-skips offline; the mock-fallback test must pass).

Run: `bun test packages/erc8004-adapter`
Expected: PASS (live test skipped offline; fallback asserted).

---

## Task 2: Happy-path resolution + R3/R4 read the live card

**Files:**

- Modify: `services/identity-service/src/*` (use `createIdentityRegistry(env)`)
- Modify: `packages/verifier-core/src/index.ts` (R3/R4 consume the resolved live card; no behavior change, only the source)
- Modify/Create: `packages/verifier-core/test/identity-rules.test.ts`

- [ ] **Step 1: Write the failing test** — given a trace whose identity came from the on-chain reader, R3 resolves and R4 authorizes the settled payer key; a card missing the payer key fails R4.

```ts
it("R4 fails when settled payer key not in live card.authorizedPaymentKeys", () => {
  const trace = traceWithCard({ authorizedPaymentKeys: ["0xAAA"] }, /* settledPayer */ "0xBBB");
  const res = verifyTrace(trace);
  expect(res.failedRules).toContain("R4_AGENT_PAYMENT_KEY_AUTHORIZED");
});
```

- [ ] **Step 2: Run to verify it fails** (only if R4 currently reads a fixture, not the resolved card).

Run: `bun test packages/verifier-core/test/identity-rules.test.ts`
Expected: FAIL or RED depending on current wiring.

- [ ] **Step 3: Implement** — `identity-service` constructs the registry via `createIdentityRegistry(env)`; the resolved card flows into the trace bundle; R3/R4 read `trace.identity.card` (the resolved object) rather than a hardcoded fixture. Keep the mock registry for offline/unit runs.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/verifier-core services/identity-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/identity-service packages/verifier-core
git commit -m "feat(identity): happy path resolves live ERC-8004 card; R3/R4 read resolved card"
```

---

## Task 3: Merchant signs `(settlementTxHash ‖ reportHash)`

**Files:**

- Modify: `packages/delivery-core/src/*` (add `signDeliveryBinding` / `verifyDeliveryBinding`)
- Modify: `apps/merchant-agent-api/*` (include the binding signature in the report response)
- Modify/Create: `packages/delivery-core/test/delivery-binding.test.ts`

- [ ] **Step 1: Write the failing test** — `verifyDeliveryBinding` accepts a signature over `(settlementTxHash ‖ reportHash)` by the merchant key and rejects a swapped `settlementTxHash`.

```ts
// packages/delivery-core/test/delivery-binding.test.ts
import { describe, expect, it } from "bun:test";
import { signDeliveryBinding, verifyDeliveryBinding } from "../src";

const merchant = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // test key
it("binding verifies for the matching settlement", async () => {
  const sig = await signDeliveryBinding({
    settlementTxHash: "0xtx",
    reportHash: "0xrep",
    merchantKey: merchant,
  });
  expect(
    await verifyDeliveryBinding({
      settlementTxHash: "0xtx",
      reportHash: "0xrep",
      signature: sig,
      merchant: addr(merchant),
    }),
  ).toBe(true);
});
it("binding fails for a different settlement", async () => {
  const sig = await signDeliveryBinding({
    settlementTxHash: "0xtx",
    reportHash: "0xrep",
    merchantKey: merchant,
  });
  expect(
    await verifyDeliveryBinding({
      settlementTxHash: "0xOTHER",
      reportHash: "0xrep",
      signature: sig,
      merchant: addr(merchant),
    }),
  ).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/delivery-core/test/delivery-binding.test.ts`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement** `signDeliveryBinding`/`verifyDeliveryBinding` (keccak256 over canonically-encoded `(settlementTxHash, reportHash)`, secp256k1 sign/recover via `viem`). Wire `merchant-agent-api` to call `signDeliveryBinding` after settlement and attach `deliveryBinding` to the `TokenRiskReport` response.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/delivery-core apps/merchant-agent-api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/delivery-core apps/merchant-agent-api
git commit -m "feat(delivery): merchant signs (settlementTxHash || reportHash) binding"
```

---

## Task 4: Verifier rule `R14b_DELIVERY_BOUND_TO_SETTLEMENT`

**Files:**

- Modify: `packages/verifier-core/src/index.ts` (+ `src/types.ts` rule enum/list)
- Modify/Create: `packages/verifier-core/test/r14b.test.ts`

- [ ] **Step 1: Write the failing test** — R14b passes when the delivery binding matches the settlement tx, fails when it does not; R14 (timestamp) is unchanged.

```ts
// packages/verifier-core/test/r14b.test.ts
it("R14b passes for a delivery bound to this settlement", () => {
  const res = verifyTrace(traceWithBoundDelivery());
  expect(res.failedRules).not.toContain("R14b_DELIVERY_BOUND_TO_SETTLEMENT");
});
it("R14b fails when delivery binds a different settlement", () => {
  const res = verifyTrace(traceWithMisboundDelivery());
  expect(res.failedRules).toContain("R14b_DELIVERY_BOUND_TO_SETTLEMENT");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/verifier-core/test/r14b.test.ts`
Expected: FAIL — rule not implemented.

- [ ] **Step 3: Implement R14b** — add `R14b_DELIVERY_BOUND_TO_SETTLEMENT` to the rule list/enum; in `verifyTrace`, when a delivery proof exists, call `verifyDeliveryBinding({ settlementTxHash: settlement.txHash, reportHash: delivery.reportHash, signature: delivery.deliveryBinding, merchant: identity.merchantCard.owner })` and push the rule id to `failedRules` on false. Keep R14 (timestamp) intact.

- [ ] **Step 4: Run to verify it passes** (and the full verifier suite still green)

Run: `bun test packages/verifier-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/verifier-core
git commit -m "feat(verifier): R14b binds delivery to this settlement"
```

---

## Task 5: Docs framing + DECISIONS

**Files:**

- Modify: `docs/protocol/*` or `docs/threat-model.md` (delivery accountability section)
- Modify: `DECISIONS.md`

- [ ] **Step 1: Write the framing** — a short subsection: R14/R14b provide **accountability and dispute evidence** (a signed claim binding delivery to a settlement), **not** payment-delivery atomicity / fair exchange. Cite **A402 (arXiv:2603.01179)** as the atomicity approach (TEE adaptor signatures) we deliberately do not claim to match.

- [ ] **Step 2: Record DECISIONS rows** — (a) ERC-8004 identity is real on Base Sepolia on the happy path, mock behind the adapter for offline tests; (b) R14b binds delivery cryptographically; (c) explicit scope: accountability not atomicity.

- [ ] **Step 3: Commit**

```bash
git add docs DECISIONS.md
git commit -m "docs(7b): real identity switch + R14/R14b accountability framing (not atomicity; cite A402)"
```

---

## Acceptance (7B complete when)

- [ ] `docs/testnet-setup.md` exists; `.env.example` has the Base Sepolia block with faucet URLs.
- [ ] With the funded wallets + `X402_FACILITATOR_MODE=chain`, running `bun run e2e:phase2` produces a `settlementTxHash` visible on `https://sepolia.basescan.org` as a real USDC transfer to `X402_PAY_TO_ADDRESS`.
- [ ] Auto-anchor fires at the end of `runHumanPresentOverHttp`; the Merkle root appears in `AgenticAuditAnchor` on Base Sepolia (or is a no-op when `AUDIT_ANCHOR_ADDRESS` is not set — no crash).
- [ ] `bun test packages/erc8004-adapter packages/delivery-core packages/verifier-core services/identity-service apps/merchant-agent-api` green.
- [ ] With `RPC_URL_BASE_SEPOLIA` + `ERC8004_REGISTRY_ADDRESS` + `TEST_AGENT_ID` set, the happy-path resolves a **live** agent card and R3/R4 pass against it; without them, the mock keeps tests green.
- [ ] R14b fails a delivery not bound to the settlement and passes an honest one.
- [ ] DECISIONS + docs frame delivery as accountability, not atomicity, citing A402.

## Self-review checklist

- [ ] The on-chain reader and the mock implement the **same** `AgentCard` interface (verifier is source-agnostic).
- [ ] Live tests self-skip offline (no hard dependency on a testnet RPC in CI).
- [ ] R14 still exists and is unchanged; R14b is additive.
- [ ] Auto-anchor is non-fatal (`catch(() => {})`) — a failed anchor tx does not fail the demo run.
- [ ] `.env.example` faucet URLs are correct and publicly accessible (verify before committing).
- [ ] `X402_ASSET_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e` is the correct Base Sepolia USDC address (re-verify against https://developers.circle.com/stablecoins/docs/usdc-on-test-networks before committing).
