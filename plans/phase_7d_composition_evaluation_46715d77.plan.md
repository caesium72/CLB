---
name: Phase 7D — Composition Evaluation (runnable baselines + Five-Attacks repro + decision instrumentation)
overview: "Make the 'composition matters' argument empirical. (1) Replace the NARRATIVE B0-B3 (LOGICAL_BASELINE_OUTCOMES in attack-core/baselines.ts) with three RUNNABLE verifiers: bVanillaX402 (x402 well-formedness only), bAp2X402 (AP2 mandate + x402, no ERC-8004 identity, no C recompute), bEbayMonitor (context-binding + consume-once on the AP2 mandate only, off-chain). Run all 10 binding + 4 predicate fixtures through each baseline AND full CLB-ACEL -> baseline-comparison.md where each baseline ACCEPTs a trace CLB rejects. (2) Reproduce 'Five Attacks on x402' (arXiv:2605.11781) using the LOCAL committed artifact -> honest five-attacks-comparison.md (eliminated/mitigated/out-of-scope). (3) Instrument the decision layer (candidate merchants, ranking reason, selected merchant, prompt-injection scan) as evidence events so the Attack IV row is honest — auditable, NOT enforced. Spec §5 (7D). Depends on 7A (real enforcement) + 7B (real identity for Attack IV)."
todos:
  - id: 7d-baseline-vanilla
    content: "attack-core: bVanillaX402 runnable verifier — accepts any well-formed x402 settlement; no cross-layer rules"
    status: completed
  - id: 7d-baseline-ap2x402
    content: "attack-core: bAp2X402 runnable verifier — AP2 mandate validity + x402 settlement, but no ERC-8004 identity binding and no C recompute"
    status: completed
  - id: 7d-baseline-ebay
    content: "attack-core: bEbayMonitor runnable verifier — faithful re-impl of eBay's enforced checks (context-binding + consume-once on AP2 mandate only), off-chain, single-protocol"
    status: completed
  - id: 7d-baseline-matrix
    content: "Run 10 binding + 4 predicate fixtures x {3 baselines + full CLB-ACEL}; emit experiments/benchmarks/baseline-comparison.md; e2e:phase7-baselines regenerates; CI fails on drift"
    status: completed
  - id: 7d-five-attacks-repro
    content: "experiments/five-attacks-repro: drive the local committed artifact (reference-papers/.../x402-attack-FDF1) against our testbed; honest five-attacks-comparison.md (I partial, II eliminated, III out-of-scope-cite, IV mitigated-when-bound)"
    status: completed
  - id: 7d-decision-instrumentation
    content: "agent-orchestrator: emit evidence events for candidate merchants/ranking reason/selected merchant/prompt-injection scan; evidence-core node+edge types; graph renders; docs: auditable NOT enforced"
    status: completed
isProject: false
---

# Phase 7D — Composition Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Two checked-in benchmark tables that make the paper's empirical case — (a) `baseline-comparison.md`: each weaker stack (vanilla-x402, AP2+x402, eBay-monitor) **ACCEPTS** ≥1 cross-layer attack that full CLB-ACEL **REJECTS**; (b) `five-attacks-comparison.md`: honest eliminated/mitigated/out-of-scope mapping of the five published x402 attacks against our stack — plus decision-layer evidence that makes the server-selection (Attack IV) row honest.

**Architecture:** Replace the hardcoded `LOGICAL_BASELINE_OUTCOMES` in `attack-core` with three **runnable** baseline verifiers that each implement only a subset of rules, share the existing `buildValidBundle()` / fixture-mutation machinery, and produce real ACCEPT/REJECT per fixture. A reproduction harness drives the local Five-Attacks artifact against our local + Base Sepolia testbed and maps outcomes honestly. Decision instrumentation adds evidence nodes/edges recording *what the agent saw* during discovery — audited, never enforced (competence stays out of scope per CONTEXT §28).

**Tech Stack:** TypeScript (Bun) · existing `@clb-acel/attack-core` (`baselines.ts`, `fixtures.ts`, `mode-b.ts`, `types.ts`), `@clb-acel/verifier-core`, `@clb-acel/evidence-core`, `apps/agent-orchestrator` · the committed Five-Attacks artifact under `reference-papers/Five Attacks on x402/x402-attack-FDF1 (attack simulation)` (Hardhat/Node).

**Repo grounding (verify before editing):**
- `packages/attack-core/src/baselines.ts` — currently `LOGICAL_BASELINE_OUTCOMES` (hardcoded `{detected, prevented, note}` for B0–B3) + `BASELINE_LABELS`/`DESCRIPTIONS`. This is the narrative to replace.
- `packages/attack-core/src/fixtures.ts` — `buildValidBundle()` + the 10 binding fixtures; `mode-b.ts` — `buildValidModeBBundle()` + the 4 `MODE_B_PREDICATE_FIXTURES`.
- `packages/verifier-core/src/index.ts` — `verifyTrace`, rule ids R1–R17 (+ R14b from 7B).
- `experiments/benchmarks/*` — existing Phase 3/4b artifacts (`attack-matrix.md`, `p5-attack-matrix.md`); follow their format.
- Five-Attacks artifact README maps attacks I-A/I-B/II/III/IV → scripts/results.

**Depends on:** 7A (real on-chain prevention → the B3 "prevented" column) and 7B (real identity → Attack IV server-selection honesty). Baselines themselves can be built before 7A lands, but the final matrix run should follow 7A.

---

## Task 1: `bVanillaX402` runnable baseline

**Files:**
- Create: `packages/attack-core/src/baselines/vanilla-x402.ts`
- Modify: `packages/attack-core/src/baselines.ts` (export the runnable verifiers; keep labels)
- Create: `packages/attack-core/test/baseline-vanilla.test.ts`

- [ ] **Step 1: Write the failing test** — vanilla x402 ACCEPTS a payee-substitution fixture (it only checks settlement well-formedness) but full CLB-ACEL REJECTS it.

```ts
// packages/attack-core/test/baseline-vanilla.test.ts
import { describe, expect, it } from "bun:test";
import { bVanillaX402 } from "../src/baselines/vanilla-x402";
import { buildFixture } from "../src/fixtures";
import { verifyTrace } from "@clb-acel/verifier-core";

it("vanilla x402 accepts PAYEE_SUBSTITUTION; CLB-ACEL rejects it", () => {
  const t = buildFixture("PAYEE_SUBSTITUTION");
  expect(bVanillaX402(t).accepted).toBe(true);                 // baseline misses it
  expect(verifyTrace(t).status).toBe("FAIL");                  // full stack catches it
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/attack-core/test/baseline-vanilla.test.ts`
Expected: FAIL — `bVanillaX402` not defined.

- [ ] **Step 3: Implement** — `bVanillaX402(bundle): { accepted, reasons }` checks ONLY that the x402 settlement is structurally valid (asset/payTo present, value parses, signature recovers) — no payee/amount/identity/nonce-binding cross-checks.

```ts
// packages/attack-core/src/baselines/vanilla-x402.ts
export function bVanillaX402(b: TraceBundle): BaselineVerdict {
  const s = b.settlement;
  const ok = isAddress(s.asset) && isAddress(s.payTo) && parseable(s.value) && recovers(s.payload);
  return { accepted: ok, reasons: ok ? [] : ["MALFORMED_X402"] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/attack-core/test/baseline-vanilla.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/attack-core/src/baselines/vanilla-x402.ts packages/attack-core/test/baseline-vanilla.test.ts
git commit -m "feat(attack-core): runnable bVanillaX402 baseline verifier"
```

---

## Task 2: `bAp2X402` runnable baseline

**Files:**
- Create: `packages/attack-core/src/baselines/ap2-x402.ts`
- Create: `packages/attack-core/test/baseline-ap2x402.test.ts`

- [ ] **Step 1: Write the failing test** — AP2+x402 catches an over-budget amount (mandate has maxAmount) but MISSES `AGENT_IDENTITY_SWAP` (no ERC-8004 identity binding, no C recompute).

```ts
it("AP2+x402 catches AMOUNT_ESCALATION but misses AGENT_IDENTITY_SWAP", () => {
  expect(bAp2X402(buildFixture("AMOUNT_ESCALATION")).accepted).toBe(false); // mandate cap catches it
  expect(bAp2X402(buildFixture("AGENT_IDENTITY_SWAP")).accepted).toBe(true); // no identity layer -> missed
  expect(verifyTrace(buildFixture("AGENT_IDENTITY_SWAP")).status).toBe("FAIL"); // CLB catches it (R4)
});
```

- [ ] **Step 2: Run to verify it fails** Run: `bun test packages/attack-core/test/baseline-ap2x402.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `bAp2X402` verifies the AP2 mandate signature + amount/payee against the mandate, and the x402 settlement well-formedness, but performs **no** ERC-8004 identity resolution (R3/R4) and **no** C/nonce recompute (R6/R8). It accepts traces whose only fault is identity substitution or commitment mismatch.

- [ ] **Step 4: Run to verify it passes** Run: `bun test packages/attack-core/test/baseline-ap2x402.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/attack-core/src/baselines/ap2-x402.ts packages/attack-core/test/baseline-ap2x402.test.ts
git commit -m "feat(attack-core): runnable bAp2X402 baseline (no identity, no C recompute)"
```

---

## Task 3: `bEbayMonitor` runnable baseline (faithful eBay re-impl)

**Files:**
- Create: `packages/attack-core/src/baselines/ebay-monitor.ts`
- Create: `packages/attack-core/test/baseline-ebay.test.ts`

- [ ] **Step 1: Write the failing test** — the eBay monitor (context-binding + consume-once on the AP2 mandate) catches `MANDATE_REPLAY` but MISSES `CHAIN_TRANSPLANT` (off-chain, single-protocol, no settlement-domain check).

```ts
it("eBay monitor catches MANDATE_REPLAY but misses CHAIN_TRANSPLANT", () => {
  expect(bEbayMonitor(buildFixture("MANDATE_REPLAY")).accepted).toBe(false);   // consume-once
  expect(bEbayMonitor(buildFixture("CHAIN_TRANSPLANT")).accepted).toBe(true);  // no chain-domain binding
  expect(verifyTrace(buildFixture("CHAIN_TRANSPLANT")).status).toBe("FAIL");   // CLB catches it (R10)
});
```

- [ ] **Step 2: Run to verify it fails** Run: `bun test packages/attack-core/test/baseline-ebay.test.ts` → FAIL.

- [ ] **Step 3: Implement** — faithful re-impl of the eBay model's two **enforced** checks (per arXiv:2602.06345): (a) explicit **context binding** — the mandate carries a context nonce that must match execution context; (b) **consume-once** — a mandate nonce settles at most once (time-bound). No cross-chain domain check, no ERC-8004 identity, no on-chain enforcement. Cite the paper in a header comment.

- [ ] **Step 4: Run to verify it passes** Run: `bun test packages/attack-core/test/baseline-ebay.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/attack-core/src/baselines/ebay-monitor.ts packages/attack-core/test/baseline-ebay.test.ts
git commit -m "feat(attack-core): runnable bEbayMonitor baseline (faithful eBay enforced checks)"
```

---

## Task 4: Baseline-comparison matrix + `e2e:phase7-baselines`

**Files:**
- Modify: `packages/attack-core/src/baselines.ts` (add `runBaselineMatrix()` over fixtures × baselines + CLB-ACEL)
- Create: `scripts/e2e-phase7-baselines.ts`
- Modify: `package.json` (`"e2e:phase7-baselines": "bun run scripts/e2e-phase7-baselines.ts"`)
- Output: `experiments/benchmarks/baseline-comparison.md`, `experiments/benchmarks/baseline-comparison.json`
- Create: `packages/attack-core/test/baseline-matrix.test.ts`

- [ ] **Step 1: Write the failing test** — the matrix has a column per baseline + CLB-ACEL, a row per fixture, and at least one cross-layer attack where every baseline ACCEPTs but CLB-ACEL REJECTs.

```ts
it("every baseline misses >=1 attack CLB-ACEL catches", () => {
  const m = runBaselineMatrix(); // {fixtureId -> {vanilla, ap2x402, ebay, clbacel}}
  const clbCatches = (id: string) => m[id].clbacel === "REJECT";
  for (const base of ["vanilla", "ap2x402", "ebay"] as const) {
    expect(Object.keys(m).some((id) => clbCatches(id) && m[id][base] === "ACCEPT")).toBe(true);
  }
});
```

- [ ] **Step 2: Run to verify it fails** Run: `bun test packages/attack-core/test/baseline-matrix.test.ts` → FAIL.

- [ ] **Step 3: Implement `runBaselineMatrix()`** over the 10 binding fixtures + 4 predicate fixtures × {bVanillaX402, bAp2X402, bEbayMonitor, full `verifyTrace`}. Then `scripts/e2e-phase7-baselines.ts` calls it and renders `baseline-comparison.md` (ACCEPT = missed, REJECT = caught; mark the cross-layer rows) + writes the JSON.

- [ ] **Step 4: Run + regenerate artifacts** Run: `bun test packages/attack-core/test/baseline-matrix.test.ts && bun run e2e:phase7-baselines`
Expected: test PASS; `baseline-comparison.md` written with the money-figure matrix.

- [ ] **Step 5: CI drift guard** — add a CI step (or extend the existing benchmark CI) that runs `e2e:phase7-baselines` and `git diff --exit-code experiments/benchmarks/baseline-comparison.md` so the table can't silently drift.

- [ ] **Step 6: Commit**

```bash
git add packages/attack-core scripts/e2e-phase7-baselines.ts package.json experiments/benchmarks/baseline-comparison.*
git commit -m "feat(eval): runnable baseline-comparison matrix + e2e:phase7-baselines + CI drift guard"
```

---

## Task 5: Five-Attacks reproduction (honest results table)

**Files:**
- Create: `experiments/five-attacks-repro/README.md`
- Create: `experiments/five-attacks-repro/run.ts` (or a thin wrapper invoking the local artifact's npm scripts)
- Output: `experiments/benchmarks/five-attacks-comparison.md`

- [ ] **Step 1: Map their attacks to our stack** in `five-attacks-comparison.md` (honest, per spec §5 7D):

| Their attack | Our result | Mechanism |
| --- | --- | --- |
| I-A revert-grant / I-B settlement preemption | **Partially mitigated** | nonce=H(C) + R8/R9 pin settlement to one commitment; optimistic-grant window is web-layer |
| II replay / missing idempotency | **Eliminated** | single-use nonce derived from C; R9 consume-once |
| III proxy/cache header manipulation | **Out of scope (cite their fix)** | web-layer; we cite their `Cache-Control: no-store, private` mitigation |
| IV server-selection manipulation | **Mitigated when discovery is bound** | ERC-8004 identity binding (7B) + decision instrumentation (Task 6) makes the choice auditable |

- [ ] **Step 2: Wire the reproduction** — `experiments/five-attacks-repro/run.ts` drives the **local committed artifact** (`reference-papers/Five Attacks on x402/x402-attack-FDF1 (attack simulation)`): run their Attack II locally (`npm run attack2`) and replay the same flow through *our* stack, asserting our verifier’s R9 rejects the replay. For III, record "out of scope" with a pointer to their result JSON; do not re-run their proxy containers in our CI.

> Do **not** vendor or re-commit their artifact; reference it by path. Use a disposable Base Sepolia wallet only if running the live probes; default to the local Hardhat path.

- [ ] **Step 3: Run + verify** Run: `bun run experiments/five-attacks-repro/run.ts`
Expected: writes `five-attacks-comparison.md`; the Attack II row shows our R9 eliminating the replay that vanilla x402 grants `n` times.

- [ ] **Step 4: Commit**

```bash
git add experiments/five-attacks-repro experiments/benchmarks/five-attacks-comparison.md
git commit -m "feat(eval): reproduce Five-Attacks (II eliminated, IV mitigated, III cite, I partial)"
```

---

## Task 6: Real LLM agent selection + decision-layer instrumentation

> **Key clarification:** "decision instrumentation" means the shopping agent uses a **real LLM call** to generate its selection rationale — not just logging a hardcoded string. The LLM reasoning is what gets recorded in the `DECISION_CONTEXT` evidence event and hashed into the chain. The deterministic selection logic (enforced by identity + protocol checks) stays non-LLM; the LLM only narrates the decision. Falls back to a heuristic if no API key is set.

**Files:**
- Modify: `packages/llm-adapter/src/index.ts` (add `selectMerchantWithRationale` function)
- Modify: `apps/agent-orchestrator/src/http-flow.ts` (`discoverAgentsForIntent` — call LLM for rationale)
- Modify: `packages/evidence-core/src/*` (new `DECISION_CONTEXT` node + `CONSIDERED`/`SELECTED` edge types)
- Modify: `apps/web-demo/*` (graph renders the decision node — minimal label)
- Create: `apps/agent-orchestrator/test/decision-evidence.test.ts`

**LLM adapter addition (`packages/llm-adapter/src/index.ts`):**

Add a `selectMerchantWithRationale` export that takes the intent + candidate list + the deterministically-selected agentId and returns a rationale string from OpenAI/Grok (or a heuristic fallback). The existing `resolveProvider` / `callOpenAi` / `callGrok` patterns apply exactly — add two new thin call functions for selection and one public export. The heuristic fallback produces a deterministic sentence so the function always returns without an API key.

```ts
// types to add (before the existing ExplainReportInput):
export type MerchantCandidate = {
  agentId: string; name: string; description: string;
  supportedProtocols: string[];
  rejected?: boolean; rejectedReason?: string;
};
export type SelectMerchantInput = {
  intent: { task: string; token: string; budget: string; asset: string };
  candidates: MerchantCandidate[];
  selectedAgentId: string;
  provider?: LlmProvider;
};
export type SelectMerchantResult = { provider: LlmProvider; rationale: string; generatedAt: string; };

// exported function:
export async function selectMerchantWithRationale(input: SelectMerchantInput): Promise<SelectMerchantResult>
// — calls callOpenAiForSelection / callGrokForSelection (new, same pattern as callOpenAi/callGrok)
// — system prompt: "You are a shopping agent. Explain merchant selection in 1-2 sentences. Name rejected candidates and why. No protocol names."
// — falls back to heuristicSelectionRationale() on error or when provider==="heuristic"
```

**`discoverAgentsForIntent` in `http-flow.ts`** currently returns a hardcoded `rationale` string. Replace that with:
```ts
const selection = await selectMerchantWithRationale({
  intent,
  candidates: candidates.map((c) => ({ agentId: c.agentId, name: c.card.name, description: c.card.description, supportedProtocols: c.card.supportedProtocols, rejected: !!c.rejectedReason, rejectedReason: c.rejectedReason })),
  selectedAgentId: merchantAgent.agentId,
});
// rationale: selection.rationale (from real LLM or heuristic fallback)
// llmProvider: selection.provider  (record which provider was used)
```

- [ ] **Step 1: Write the failing test** — `discoverAgentsForIntent` emits a `rationale` that differs per run when an LLM key is set, and produces a non-empty heuristic string when `LLM_PROVIDER=heuristic`.

```ts
// apps/agent-orchestrator/test/decision-evidence.test.ts
it("discovery returns a non-empty rationale (heuristic fallback)", async () => {
  process.env.LLM_PROVIDER = "heuristic";
  const d = await discoverAgentsForIntent(testIntent());
  expect(d.rationale.length).toBeGreaterThan(10);
  expect(d.llmProvider).toBe("heuristic");
});

it("discovery emits a DECISION_CONTEXT evidence event in the trace", async () => {
  const out = await runHumanPresentOverHttp(intentWithDecoyMerchant(), { /* mock services */ });
  const ev = out.events.find((e) => e.objectType === "DECISION_CONTEXT");
  expect(ev).toBeTruthy();
  expect(ev!.publicFields.candidates.length).toBeGreaterThan(1);
  expect(ev!.publicFields.selected).toBeTruthy();
  expect(ev!.publicFields.rationale.length).toBeGreaterThan(10);
  expect(ev!.publicFields.llmProvider).toMatch(/openai|grok|heuristic/);
  expect(ev!.publicFields).not.toHaveProperty("enforced"); // audited, never enforced
});
```

- [ ] **Step 2: Run to verify it fails** Run: `bun test apps/agent-orchestrator/test/decision-evidence.test.ts` → FAIL (`selectMerchantWithRationale` not defined / `rationale` still hardcoded).

- [ ] **Step 3: Implement `selectMerchantWithRationale`** in `packages/llm-adapter/src/index.ts` per the shape above. System prompt must not expose internal protocol names (ERC-8004, x402) to the LLM output — the LLM describes merchant capabilities in commerce language.

- [ ] **Step 4: Wire into `discoverAgentsForIntent`** — replace the hardcoded `rationale` string with the `selectMerchantWithRationale` call; add `llmProvider` to the `DiscoveryResult` type.

- [ ] **Step 5: Add `DECISION_CONTEXT` evidence node/edge** — add `DECISION_CONTEXT` to `EvidenceNode` and `CONSIDERED`/`SELECTED` to `EvidenceEdge` in `evidence-core`; in `runHumanPresentOverHttp` and `runDelegatedOverHttp` insert a `DECISION_CONTEXT` event after the `ERC8004_AGENT_IDENTITY` event (it is part of the evidence hash chain):

```ts
evidenceEvent(traceId, 2.5 /* renumber */, "USER", "DECISION_CONTEXT", "shopping-agent", {
  candidates: discovery.candidates.map((c) => ({ agentId: c.agentId, name: c.card.name, rejected: !!c.rejectedReason, reason: c.rejectedReason })),
  selected: discovery.selectedMerchantId,
  rationale: discovery.rationale,
  llmProvider: discovery.llmProvider,
  promptInjectionScan: "NONE_DETECTED", // placeholder; wire a real scanner if available
}, baseTime)
```

Render the node in the web-demo graph with label "Agent decision — audit only".

- [ ] **Step 6: Run to verify it passes** Run: `bun test apps/agent-orchestrator/test/decision-evidence.test.ts` → PASS.

- [ ] **Step 7: Docs** — one paragraph in the paper-outline / threat-model: the shopping agent uses a **real LLM** (OpenAI gpt-4o-mini or Grok-2 per `LLM_PROVIDER`) to reason about merchant selection; this reasoning is hashed into the evidence chain; it is **auditable, not enforced** — the verifier does not trust LLM output, only the deterministic cryptographic binding rules (CLB.md §1 non-goal: "agent capability trust"). Cite SoK 2604.15367.

- [ ] **Step 8: Commit**

```bash
git add packages/llm-adapter packages/evidence-core apps/agent-orchestrator apps/web-demo docs
git commit -m "feat(eval): real LLM merchant selection (OpenAI/Grok/heuristic) + DECISION_CONTEXT evidence event"
```

---

## Acceptance (7D complete when)

- [ ] `bun test packages/attack-core apps/agent-orchestrator packages/evidence-core packages/llm-adapter` green.
- [ ] `bun run e2e:phase7-baselines` regenerates `baseline-comparison.md`; the matrix shows each of vanilla-x402 / AP2+x402 / eBay-monitor ACCEPTING ≥1 cross-layer attack CLB-ACEL REJECTS; CI fails on drift.
- [ ] `five-attacks-comparison.md` exists with the honest eliminated/mitigated/out-of-scope mapping; Attack II reproduction shows R9 eliminating the replay.
- [ ] `discoverAgentsForIntent` returns a `rationale` generated by a real LLM (OpenAI/Grok) when a key is set, or a heuristic fallback when not; `llmProvider` field is present in `DiscoveryResult`.
- [ ] The trace from a live HTTP-flow run contains a `DECISION_CONTEXT` evidence event with `candidates`, `selected`, `rationale`, and `llmProvider` in `publicFields`; the event is in the hash chain.

## Self-review checklist

- [ ] Baselines share `buildValidBundle()`/fixtures — no duplicated fixture construction.
- [ ] The narrative `LOGICAL_BASELINE_OUTCOMES` is removed or clearly superseded; `BASELINE_LABELS`/`DESCRIPTIONS` still match the runnable baselines.
- [ ] Decision events carry no enforcement verdict (audit-only) and are in the hash chain.
- [ ] Five-Attacks artifact is referenced, not re-vendored.
- [ ] `selectMerchantWithRationale` system prompt does not include protocol names (ERC-8004, x402, AP2) — LLM sees commerce-language descriptions only.
- [ ] Heuristic fallback works with no API keys set (CI-safe).
