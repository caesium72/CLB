# Phase 7 (v2) — Research Contribution Hardening: Sub-Phase Decomposition

**Date:** 2026-06-04
**Status:** approved decomposition; drives 7 implementation plans (`phase_7a … phase_7g`)
**Supersedes scope of:** `plans/phase_7_research_contribution_hardening_3f3rdfgdf3.plan.md` (that file becomes the Phase 7 *umbrella overview*)

---

## 1. Why this document exists

Phases 0–6 shipped a **working but largely mock / in-process demo (v1)**: the verifier runs R1–R17,
`PredicatePaymentGuard.sol` has TS↔Solidity C′ parity, but Mode B settles through the in-process
`InMemoryPredicateGuard`; identity is `MockERC8004IdentityRegistry`; R14 is timestamp-only; baselines
B0–B3 are *narrative* outcomes; there is no formal model.

**v2 (Phase 7) is the real work for a conference paper.** The existing Phase 7 draft is well-researched
and competitively grounded, but it is one large plan with 10 work-items of very different size,
dependency, and risk. This document **decomposes it into 7 right-sized, independently-executable
sub-phases** so each can be handed to a focused Claude Code session and so the project/plan structure
cleanly separates v1 from v2.

This is a **planning/spec document — no code.** Each sub-phase gets its own implementation plan, and each
of those plans must re-verify current file paths/symbols against the repo before editing.

---

## 2. Competitive landscape (verified June 2026)

The four collected papers are real and current; arXiv IDs confirmed. Positioning holds.

| Paper | arXiv | Scope | What it proves/builds | Our survival seam |
| --- | --- | --- | --- | --- |
| **Five Attacks on x402** | 2605.11781 | x402 **only** | 5 concrete attacks (I-A revert-grant, I-B settlement preemption, II replay/idempotency, III proxy/cache, IV server-selection) + reproducible testbed (local + Base Sepolia + live) + mitigations | x402-only; **no ERC-8004 identity, no AP2 authorization**. Our theorem is about the *composition* of all three. |
| **Zero-Trust Runtime Verification** (eBay) | 2602.06345 | AP2 **only** | context-binding + consume-once via time-bound nonces; off-chain runtime monitor; ~3.8 ms @ 10k tps | external monitor, single-protocol, **no in-protocol enforcement, no proofs** |
| **A402** | 2603.01179 | new **rail** | payment↔delivery atomicity via TEE adaptor signatures + TEE Liquidity Vault | a *new rail*, not a binding over existing protocols; heavy TEE trust |
| **SoK: A2A Payments** | 2604.03733 | taxonomy | 4-stage lifecycle (discovery/authorization/execution/accounting); names "weak intent binding", "payment–service decoupling", "limited accountability" as **open** | we *close* the named-open gaps with a concrete construction + proofs + economic loop |
| **SoK: Security of Autonomous LLM Agents** (new) | 2604.15367 | taxonomy | security of LLM agents in agentic commerce | decision-layer taxonomy; we cite it and stay honest that competence is out of scope (we instrument, not enforce) |

**Protocol maturity (decision-relevant):**

- **ERC-8004** went **live on Ethereum mainnet 2026-01-29** (45k+ agents registered; canonical contracts at
  `erc-8004/erc-8004-contracts`). → **Real testnet Identity Registry is feasible** (7B can replace the mock on
  the happy path).
- **ERC-8004 Validation Registry is still being revised** with the TEE community. → proposing a new
  validator type is **timely and publishable**, but the ABI is unstable → **must stay adapter-isolated** (7E).
- **ERC-7710 + MetaMask Delegation Toolkit** (`@metamask/delegation-toolkit`) is **audited and production**
  in 2026, with prebuilt caveat enforcers validated on-chain. → the Mode B caveat can graduate from a
  "demo stand-in" to a **real on-chain enforcer** (7A) — the core v1-mock → v2-real upgrade.

---

## 3. Thesis (preserved from the umbrella plan)

> **Single-layer soundness does not compose.** We prove the three-layer composition (ERC-8004 identity +
> AP2 authorization + x402 settlement), enforce the delegated (human-not-present) case **on-chain**, and
> feed the resulting verification certificate into ERC-8004's **Validation Registry** so the agent economy
> can *price* the guarantee. No current paper does the last two.

We beat **Five-Attacks** (x402-only, no identity/authorization), **eBay** (AP2-only off-chain monitor),
and **A402** (a new rail, not a binding), and we *close* the gaps **SoK** names as open.

---

## 4. Design philosophy (from owner decisions, 2026-06-04)

1. **Headline = on-chain enforcement (Mode B *prevented*, not just audited).** Land 7A first and make it
   bulletproof; everything else strengthens or surrounds it.
2. **Real core + swappable adapters.** Real on-chain enforcement + real identity on the happy path, but
   facilitator / registry / enforcer stay behind adapter interfaces so a conference demo can fall back to a
   deterministic mock if a live endpoint is flaky. Credibility without demo fragility.
3. **No fixed deadline → order by dependency + risk.** Parallelize the highest-risk research track (Tamarin)
   from day one so a negative result surfaces early; keep the riskiest crypto (confidential variant)
   optional and clearly cuttable.
4. **Every sub-phase strengthens a *claim* and emits a checked-in artifact** (benchmark table, proof output,
   gas report, on-chain tx, paper section). No new product surface for its own sake.

---

## 5. Sub-phase decomposition

Each sub-phase below lists: **Goal · Lands (paper section) · Source items · Key tasks · Depends on · Risk ·
Cut-line · Acceptance / artifacts.** Source items reference the umbrella plan's Moves/Gaps and PR numbers.

### 7A — On-chain predicate enforcement *(headline; must-have)*

- **Goal:** A predicate-violating Mode B settlement **reverts on-chain before transfer**, not just fails R17.
- **Lands:** the central "Mode B prevented in-protocol" claim; enforcement section.
- **Source:** Move 2 (PR16).
- **Key tasks:**
  1. `packages/clb-core`: `computeSettlementParamsDigest` commits `valueAtomic` (uint) so the committed
     value and the on-chain compare are the *same quantity*; remove the parallel-field demo simplification;
     update C′ parity vectors (`test_ParityWithClbCore`).
  2. `contracts/PredicatePaymentGuard.sol`: add `settleIfPredicateHolds(...)` that recomputes C′, checks
     payee/asset/chain/amount/expiry on-chain, enforces single-use nonce = H(C′), and reverts with typed
     errors (`PredicatePayeeNotAllowed`, `PredicateAmountExceeded`, `PredicateAssetNotAllowed`,
     `PredicateExpired`, `NonceAlreadyUsed`). Foundry tests: revert-per-violation + happy-path success + gas
     report.
  3. **Real vs. demo enforcer (per "real core, swappable adapters"):** promote `PredicatePaymentGuard.sol`
     to a *genuine* on-chain enforcer (it already checks the predicate fields) deployed to Anvil + Base
     Sepolia; **additionally** expose an ERC-7710-compatible caveat-enforcer adapter so it plugs into the
     MetaMask Delegation Framework as the "production delegation" story. The plan evaluates integration cost;
     the bulletproof headline is the real on-chain revert, with the ERC-7710 wrapper as the swappable
     adapter seam. Keep the "demo caveat stand-in vs. production ERC-7710 enforcer" gap documented honestly.
  4. `packages/predicate-adapter`: make `ContractPredicateGuard` the default in `runDelegatedOverHttp`; keep
     `InMemoryPredicateGuard` for unit tests only.
  5. `apps/agent-orchestrator`: `runDelegatedOverHttp` deploys/points to the guard and settles through it.
- **Depends on:** Phase 4 foundation (exists). No other sub-phase.
- **Risk:** Medium (testnet + contract integration).
- **Cut-line:** **Must-have** (the whole paper leans on this).
- **Acceptance:** a predicate-violating Mode B settlement **reverts on-chain**; `bun run e2e:phase7-caveat`
  emits a tx-reverted artifact + gas numbers.

### 7B — Real identity + evidentiary delivery *(must-have)*

- **Goal:** replace the two remaining mock/weak layers on the happy path so the demo is "real, not mock."
- **Lands:** construction "realness" + delivery-accountability section.
- **Source:** PR20a (real testnet identity) + PR19a (evidentiary delivery binding).
- **Key tasks:**
  1. Point happy-path identity resolution at a **real ERC-8004 Base Sepolia registry** (official deployed
     registry if available, else deploy `erc-8004/erc-8004-contracts` to Base Sepolia). Verifier R3/R4 read a
     **real agent card** (endpoints + payment keys), not a fixture. Keep the mock for offline unit tests;
     document the switch in `DECISIONS.md`.
  2. `apps/merchant-agent-api`: sign `(settlementTxHash ‖ reportHash)` and include it in the report.
  3. `verifier-core`: add `R14b_DELIVERY_BOUND_TO_SETTLEMENT` verifying the signature binds delivery to
     *this* settlement (not a later wall-clock time). Keep R14 as the timestamp check.
  4. Docs: frame R14/R14b as **accountability / dispute evidence**, explicitly citing A402 as the
     *enforcement* (fair-exchange) alternative we do **not** claim to match.
- **Depends on:** 7A patterns (adapter discipline); otherwise independent.
- **Risk:** Low–Medium.
- **Cut-line:** **Must-have** (identity realness underpins the composition claim).
- **Acceptance:** happy-path trace resolves a live ERC-8004 card; `R14b` passes on honest delivery and fails
  on a delivery not bound to the settlement.

### 7C — Formal proofs: Tamarin P1–P5 *(parallel; strong stretch)*

- **Goal:** machine-checked soundness of the *composed* protocol — the direct answer to "Five-Attacks has
  proofs and you don't."
- **Lands:** formal-soundness section.
- **Source:** Move 1 (PR17).
- **Key tasks:**
  1. `formal/tamarin/clb.spthy`: model = Dolev–Yao A2A channel; ERC-8004 key-authorization fact; AP2 mandate
     signature over C; abstract chain with a `NonceConsumed` linear fact; ERC-7710 caveat as a guarded
     transition. Lemmas P1–P5 as injective-agreement + trace properties. `formal/tamarin/README.md` (how to
     run). ProVerif cross-check on the off-chain sub-protocol (optional).
  2. Commit proof output **or** the found-attack trace + patched-model proof under `formal/tamarin/proofs/`.
  3. `docs/paper-outline.md`: formal-soundness section citing the machine-checked result.
- **Depends on:** *independent — runs in parallel from day one* (models the protocol, not the code).
- **Risk:** **High** (research; tooling; may need model iteration).
- **Cut-line:** Strong stretch. **Degrade path is itself publishable:** the expected finding is that a naive
  C without `chainId`/domain separation admits a transplant/cross-chain attack; the tool surfaces it and the
  EIP-712-domain-separated model then verifies — an "attack-found → patched-model-proven" narrative.
- **Acceptance:** `tamarin-prover --prove formal/tamarin/clb.spthy` verifies P1–P5 (or documents the patched
  model that does).

### 7D — Composition evaluation *(must-have core)*

- **Goal:** empirically show weaker stacks **MISS** what CLB-ACEL catches, and reproduce the newest
  competitor's attacks against our stack.
- **Lands:** the evaluation "money-figure" + the Five-Attacks comparison + decision-layer accountability.
- **Source:** PR18 (runnable baselines) + Move 5 / PR22 (Five-Attacks repro) + PR21 (decision instrumentation,
  folded in because Attack IV needs it).
- **Key tasks:**
  1. **Runnable baselines** in `packages/attack-core/src/baselines/`:
     - `bVanillaX402` — checks only that the x402 settlement is well-formed (no cross-layer rules).
     - `bAp2X402` — AP2 mandate validity + x402 settlement, but no ERC-8004 identity binding and no C recompute.
     - `bEbayMonitor` — faithful re-impl of the eBay model's *enforced* checks (context-binding + consume-once
       on the AP2 mandate only), off-chain, single-protocol.
     Run all 10 binding fixtures + 4 predicate fixtures through each baseline **and** full CLB-ACEL →
     `experiments/benchmarks/baseline-comparison.md` (each baseline column shows ACCEPT/missed on the
     cross-layer attacks CLB catches). `bun run e2e:phase7-baselines` regenerates; CI fails on drift.
  2. **Five-Attacks reproduction** in `experiments/five-attacks-repro/`: drive the **local committed artifact**
     (`reference-papers/Five Attacks on x402/x402-attack-FDF1 (attack simulation)`) against our testbed
     (local + Base Sepolia). Honest results table `experiments/benchmarks/five-attacks-comparison.md`:
     - I (settlement-path) → **partially mitigated** (nonce = H(C) + R8/R9 pin settlement to one commitment).
     - II (replay/idempotency) → **eliminated** (single-use nonce derived from C; R9).
     - III (HTTP/proxy/cache) → **not** mitigated by CLB (web-layer; cite their mitigation, be honest).
     - IV (server-selection) → **mitigated when discovery is bound** (identity binding + decision
       instrumentation below).
  3. **Decision-layer instrumentation (audit, not enforce):** `apps/agent-orchestrator` emits evidence events
     for candidate merchants, ranking reason, selected merchant, and prompt-injection-scanner output during
     discovery; `evidence-core` gets new node/edge types; the graph renders them. Docs state plainly: the
     decision layer is **auditable but not enforced**; competence stays out of scope (CONTEXT §28). This is
     what makes the Attack IV row honest.
- **Depends on:** 7A (real enforcement → the "prevented" column), 7B (real identity → Attack IV).
- **Risk:** Medium.
- **Cut-line:** Baselines = must-have (the composition argument); Five-Attacks repro = high-value;
  instrumentation = required for an honest Attack IV row.
- **Acceptance:** both benchmark tables regenerate reproducibly; baselines demonstrably accept ≥1 trace
  CLB-ACEL rejects.

### 7E — Economic loop: ERC-8004 Validation Registry entry *(differentiator; high-value stretch)*

- **Goal:** close the loop from verification certificate to on-chain, priceable trust — the contribution no
  competitor has.
- **Lands:** the "validation primitive that lets the agent economy price cross-layer trust" section.
- **Source:** Move 3 (PR19b).
- **Key tasks:**
  1. `contracts/CrossLayerBindingValidator.sol`: thin contract recording `(traceId, certificateHash, result)`,
     readable by an ERC-8004 Validation Registry — **real testnet registry if the (still-moving) ABI permits,
     else the mock; adapter-swappable per existing pattern.** Entry schema leaves room to carry a zkML proof
     digest later (no scope creep now).
  2. `services/verifier-service`: on PASS, emit a validation write; expose read-back.
  3. `docs/paper-outline.md`: reframe CLB-ACEL as a new validator type — `CrossLayerBindingValidator` —
     alongside re-exec / zkML / TEE.
- **Depends on:** 7B (real identity helps); existing verifier certificate.
- **Risk:** Medium (Validation Registry ABI in flux → isolate behind the adapter).
- **Cut-line:** High-value stretch (strongest novelty, but ABI risk).
- **Acceptance:** a verified trace produces an on-chain validation entry retrievable by `traceId`.

### 7F — Confidential commit-and-prove variant *(optional stretch)*

- **Goal:** answer the on-chain metadata-leakage critique (raised by Five-Attacks and A402) with elegance, not
  a heavy TEE vault.
- **Lands:** the privacy section.
- **Source:** Move 4 (PR20b).
- **Key tasks:**
  1. `packages/clb-core`: a `confidential` mode producing a commitment + a range proof that `value ≤ maxValue`
     (simple Bulletproof/Pedersen library behind a swappable adapter).
  2. `services/evidence-service`: the **encrypted-payload path** (public digest + private encrypted blob) —
     finally delivering the deferred encryption work (ACEL.md §4 selective disclosure).
  3. `verifier-core`: a confidential verification path that consumes the proof, not the plaintext.
- **Depends on:** independent.
- **Risk:** **High** (cryptographic tooling).
- **Cut-line:** **Optional.** Degrade path: if the range-proof library is too heavy, ship the
  selective-disclosure evidence path alone (encrypted off-chain + public digest) and label the range proof a
  documented extension. **Do not block 7G on this.**
- **Acceptance:** `bun run e2e:phase7-confidential` shows a PASS where on-chain data reveals neither payee nor
  exact amount (or, in degrade mode, the selective-disclosure path ships with the range proof documented as
  future work).

### 7G — Paper consolidation + related work *(must-have; final)*

- **Goal:** turn the artifacts into the paper's spine and position honestly against the landscape.
- **Lands:** related work, threat model, consolidated evaluation.
- **Source:** PR23.
- **Key tasks:**
  1. `docs/paper-outline.md`: composition-theorem framing; related-work paragraph positioning vs.
     Five-Attacks / eBay / A402 / SoK **and the new SoK 2604.15367**.
  2. `docs/threat-model.md`: align with the proven P1–P5 and the explicit out-of-scope (decision layer,
     atomicity, HTTP/proxy).
  3. Consolidate artifacts: `baseline-comparison.md`, `five-attacks-comparison.md`, `p5-attack-matrix.md`, gas
     reports, Tamarin proof output.
- **Depends on:** all other sub-phases (consumes their artifacts).
- **Risk:** Low.
- **Cut-line:** Must-have (it *is* the paper).
- **Acceptance:** `docs/paper-outline.md` reads as a submittable skeleton with every claim backed by a
  checked-in artifact.

---

## 6. Execution tracks & ordering

No fixed deadline → order by dependency + risk; parallelize to surface risk early.

```
Track A (spine):     7A ──▶ 7B ──▶ 7D ──▶ 7E
Track B (parallel):  7C  (start day 1 — highest research risk, isolated from the code)
Track C (optional):  7F  (independent; pick up when spine is healthy)
Finalize:            7G  (after the others emit artifacts)
```

- **Start together:** 7A (headline) + 7C (Tamarin) — land the must-have win while a negative formal result
  has time to surface.
- **7D needs 7A + 7B** (real enforcement + real identity) for an honest "prevented" column and Attack IV row.
- **7E needs 7B**; isolate it behind the Validation-Registry adapter because the ABI is still moving.
- **7F is fully optional** and must never block 7G.

---

## 7. Project / plan reorganization ("0th" organizing step)

Because "project and plan need to be organized" and v1/v2 must be legible:

1. **`CONTEXT_FULL_PROJECT.md` §21:** mark Phases 0–6 as **v1 (complete)**; add a **Phase 7 (v2)** section
   listing sub-phases 7A–7G with one-line goals and the cut-lines above.
2. **`DECISIONS.md`:** add a **Phase 7 (v2)** heading; record decisions as each sub-phase lands (mirroring the
   Phase 0–5b structure already there).
3. **Umbrella plan:** keep `plans/phase_7_research_contribution_hardening_3f3rdfgdf3.plan.md` as the **Phase 7
   overview** — trim its body to the thesis + landscape + a pointer table to the 7 child plans, so it stops
   reading like a single monolithic plan.
4. **Naming convention** (matches existing `phase_4_*`, `phase_5b_*`): the 7 child plans are
   `plans/phase_7a_onchain_enforcement_*.plan.md` … `plans/phase_7g_paper_consolidation_*.plan.md`.

---

## 8. Out of scope (honest, per CONTEXT §28)

- **Agent competence / "best choice"** — instrumented (7D) but never enforced or claimed.
- **Payment–delivery atomicity / fair exchange** — A402's domain; we provide *evidentiary* binding only (7B).
- **HTTP/proxy-layer attacks** (Five-Attacks III) — web-layer; we cite the original authors' mitigations.
- **Production-grade ERC-7710 enforcer** — 7A ships a real on-chain enforcer + an ERC-7710 adapter seam; a
  fully battle-hardened delegation enforcer is future work.
- **Full zkML proof in the validation entry** — 7E's schema leaves room; proof generation is a follow-on.

---

## 9. Success criteria (Phase 7 as a whole)

1. A predicate-violating delegated settlement **reverts on-chain** (7A) — Mode B prevention is real.
2. `tamarin-prover` machine-checks P1–P5 over the composed protocol, or the patched model (7C).
3. The baseline-comparison matrix shows vanilla-x402, AP2+x402, and the eBay-monitor each **MISSING**
   cross-layer attacks CLB-ACEL catches (7D).
4. A verified trace writes an ERC-8004 Validation Registry entry — the economic loop closes (7E).
5. The Five-Attacks reproduction table shows which of their attacks cross-layer binding eliminates (7D).
6. `docs/paper-outline.md` positions the contribution as the **composition theorem + on-chain enforcement +
   economic loop** (7G), beating Five-Attacks (x402-only), eBay (AP2-only monitor), and A402 (new rail).

---

## 10. Open risks

- **Tamarin (7C):** stateful nonce modeling is genuinely hard; budget for the attack-found→patch narrative.
- **Validation Registry ABI (7E):** still in revision — keep strictly behind the adapter; be ready to ship
  against the mock + the current draft interface.
- **Confidential crypto (7F):** range-proof tooling may be too heavy → selective-disclosure-only degrade.
- **Live-endpoint flakiness (7B/7E):** the "real core, swappable adapters" rule means every live path keeps a
  deterministic mock fallback so a conference demo never hard-depends on a testnet RPC.
