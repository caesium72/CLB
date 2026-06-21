---
name: Attack Lab honesty + mandate formula clarity
status: proposed
created: 2026-06-07
branch: project-v3
overview: >
  Make the Attack Lab a SOLID, honest, reproducible demonstration of the Phase 7 thesis
  ("single-layer soundness does not compose") instead of one with real CLB-ACEL verdicts
  but mock baseline columns and legacy token-risk fixtures. Plus a clarity pass on the
  mandate/commitment formula panel (what a mandate is, what humanPrincipal means).
---

# Attack Lab honesty + mandate formula clarity

## Why (current state, verified 2026-06-07)

The Attack Lab's engine is real but its *comparison story* is mock:

- `runAttack` (packages/attack-core/src/index.ts) builds a trace, mutates the exact
  field, runs the REAL `verifyTrace` (R1–R17) with a fixed seed → the **CLB-ACEL (B3)
  verdict is genuine and reproducible**.
- BUT the **baseline columns B0/B1/B2 are hardcoded narrative** (`commonOutcomes.b0/b1/b2`
  in baselines.ts, notes like "Live verifier *should* fail R12"). `buildBaselineMatrix`
  spreads `fixture.baselineOutcomes` for B0–B2 and only computes B3 live.
- **Real baseline verifiers already exist** — `bVanillaX402`, `bAp2X402`, `bEbayMonitor`
  (packages/attack-core/src/baselines/*) — and a real `runBaselineMatrix()`
  (baselines/matrix.ts) runs them against the attacked bundle. **The web app never calls it.**
- **Fixtures use retired token-risk data** (tokens XYZ/AAVE, `inputDataHash`,
  `TokenRiskReport`), not the demo's grammar (6827) / weather (6823) agents.
- The **"Five Attacks" table** (five-attacks-table.tsx) is a fully static array.
- Predicate (Mode B) prevention uses the **in-memory** `createPredicateGuard()`, not the
  deployed on-chain `PredicatePaymentGuard` revert (the Phase 7A headline).

Thesis impact: the lab is supposed to be the paper's money figure — weaker stacks ACCEPT
a trace CLB-ACEL REJECTS. Today it *asserts* that with narrative cells. The fix is mostly
**wiring real code that already exists** + aligning fixtures + surfacing the on-chain revert.

## Guardrails (honesty)

- Never show a baseline outcome that wasn't actually computed by a runnable verifier.
- Anything not reproduced live must be explicitly labelled "cited from paper", not implied live.
- Keep the lab deterministic/offline by default; any live-on-chain path is an explicit,
  separately-labelled action (network-dependent), never silently mixed with deterministic runs.

---

## Phase 1 — Wire the REAL baselines (highest value, lowest effort)

Replace the narrative B0/B1/B2 cells with the verdicts the real baseline verifiers already
produce, so the matrix genuinely shows weaker stacks MISSING what CLB-ACEL catches.

Decisions:
- Unify on the **matrix.ts model**: 4 columns = Vanilla x402 / AP2+x402 / eBay monitor /
  CLB-ACEL, each an ACCEPT/REJECT computed live (drop the "ACEL audit-only B2" narrative
  column, or keep it as a 5th *computed* column = verifier-detects-but-x402-doesn't-prevent,
  which is also real). Pick 4 clean columns for the demo.
- The per-attack run should carry the real baseline cells so each single-attack view and the
  full matrix agree.

Tasks:
1. `packages/attack-core/src/index.ts` `runAttack`: compute
   `bVanillaX402(bundle)` / `bAp2X402(bundle)` / `bEbayMonitor(bundle)` on the attacked
   bundle and return them as real ACCEPT/REJECT cells (alongside the live CLB-ACEL verdict).
   Same for `runPredicateAttack` in mode-b.ts.
2. Update `AttackRunResult` (types.ts) to carry `{ vanilla, ap2x402, ebay, clbacel }` cells
   + `clbDetection` string (reuse the `BaselineMatrixRow` shape from matrix.ts).
3. `baseline-matrix-section.tsx` + `attack-runner.tsx` + `predicate-attack-runner.tsx`:
   render the 4 real columns from the run result; delete the narrative `baselineOutcomes`
   rendering path. Keep `BASELINE_DESCRIPTIONS`/explainer (those are honest definitions).
4. Retire `fixture.baselineOutcomes` (narrative) once nothing reads it; or keep only as
   internal expected-values used by a test that asserts the live cells match.
5. Tests: a deterministic test asserting, for each fixture, the real baseline cells
   (e.g. AMOUNT_ESCALATION → vanilla ACCEPT, CLB-ACEL REJECT). CI fails on drift.

Acceptance: every baseline cell in the UI comes from a runnable verifier; at least one
attack shows Vanilla/AP2 ACCEPT while CLB-ACEL REJECTs, computed live.

## Phase 2 — Mandate formula panel clarity

File: `apps/web-demo/src/components/agent/mandate-formula-panel.tsx` (+ verify
`/api/demo/prepare` returns `mandateDraft.authorizedAgent`).

Tasks:
1. Add a one-line "What's a mandate?" gloss: the human's signed authorization (AP2).
   CART = you approved this exact cart; INTENT = you approved a spending rule.
2. Plain-language sublabels: `humanPrincipal` → "your wallet — who the agent acts for";
   `type` → "exact cart" (A) / "spending rule" (B).
3. Show `authorizedAgent` in the mandateDigest card (it IS hashed into the digest but is
   currently invisible — its omission is why the digest reads as a black box).
4. Spell out the digest inputs: `keccak256(AP2 fields)` where AP2 fields =
   `{mandateId, type, humanPrincipal, authorizedAgent, constraints}`.
5. Fix the Mode A label: a CART commits an exact `value`, not a `maxAmount` — relabel per mode
   (Mode B keeps maxValue/maxAmount).

Acceptance: a first-time viewer can read the panel and state what the mandate is, who the
human principal is, and which fields the digest commits.

## Phase 3 — Five-Attacks table honesty

File: `apps/web-demo/src/app/(demo)/attacks/components/five-attacks-table.tsx`.

Tasks:
1. Tag each row provenance: "reproduced live in this lab" vs "cited from arXiv:2605.11781".
   Today only Attack II is live — make that explicit per-row, not just in the caption.
2. If `experiments/five-attacks-repro/` has an artifact, drive the live rows from it; else
   keep static but clearly labelled cited.
3. Link the live row(s) to the corresponding lab attack so a viewer can run it.

Acceptance: nothing in the table reads as overclaim; live vs cited is unambiguous per row.

## Phase 4 — Align fixtures to grammar/weather (largest)

Retire token-risk fixtures so attacks run against the demo's real two agents.

Tasks:
1. `packages/attack-core/src/fixtures.ts` `buildValidBundle`: produce a ServiceReport-based
   bundle (grammar/weather) instead of TokenRiskReport; keep R15 taskHash↔reportHash and
   R14b delivery-binding semantics intact.
2. Replace the scenario generator's `TOKENS` with realistic tasks/cities (proofread text /
   city forecast); update anatomy copy that references "token".
3. Re-verify every binding + predicate fixture still triggers its expected rule with the new
   artifact (the mutations are artifact-agnostic, but hashes/fields change).
4. Update attack-core tests + any benchmark artifacts that pin token-risk values.

Acceptance: no fixture references the retired token-risk merchant; all attacks still fire
their expected rule deterministically; the lab visually matches the rest of the demo.

## Phase 5 — Surface the on-chain Mode B revert (network-dependent)

Show the real deployed `PredicatePaymentGuard` reverting a predicate-violating settlement
(the "prevented in-protocol" headline), distinct from the deterministic in-memory run.

Decisions:
- Keep deterministic runs as the default. Add an explicit, separately-labelled "Run live
  on-chain" action for predicate attacks that settles through the deployed guard on Base
  Sepolia and shows the revert tx (BaseScan link) + typed error.
- Requires: deployed guard address (env), RPC, a funded signer — reuse the Phase 7A path
  from `runDelegated`/predicate-adapter. Gracefully fall back to the deterministic result
  with a visible "live endpoint unavailable" badge.

Tasks:
1. `packages/predicate-adapter` / orchestrator: expose a "settle-through-guard and capture
   revert" helper returning `{ reverted, txHash, error }`.
2. New route `POST /api/demo/attacks/predicate/[id]/run-onchain` (env-gated).
3. predicate-attack-runner.tsx: optional "Run live on-chain" button → show revert tx + error;
   keep the deterministic verdict as the primary, labelled view.

Acceptance: a predicate-violating Mode B settlement shows a real on-chain revert tx on Base
Sepolia, clearly separated from the deterministic verdict; absence of env degrades gracefully.

---

## Suggested order
Phase 1 (money figure, mostly wiring) → Phase 2 (clarity, isolated UI) → Phase 3 (quick
honesty) → Phase 4 (fixture realignment, larger) → Phase 5 (on-chain, network-dependent).

## Verification
- `bun test packages/attack-core` green incl. new baseline-cell assertions.
- tsc clean (orchestrator + web-demo), `next build` green.
- Manual: each attack shows live 4-column baselines; formula panel reads clearly; five-attacks
  rows labelled; (Phase 5) a real revert tx opens on BaseScan.
