---
name: Phase 7 Research Contribution Hardening
overview: "Phase 7 turns the CLB-ACEL demo into a defensible paper: (1) replace the in-process Mode B guard with a real on-chain caveat so P5 is *prevented* not just audited; (2) machine-checked Tamarin proofs of the composed-protocol properties P1-P5; (3) implement the three CLB.md baselines (vanilla x402, AP2+x402 binding, eBay-style monitor) so the attack matrix shows *failure* in weaker stacks; (4) emit the verification certificate as an ERC-8004 Validation Registry entry (a new cross-layer-binding validator type); (5) a confidential commit-and-prove variant with selective disclosure; (6) reproduce the published 'Five Attacks on x402' (arXiv:2605.11781) against our stack. Builds on Phases 0-6."
todos:
  - id: p7-caveat-onchain
    content: "Move 2: real on-chain predicate caveat. Promote ContractPredicateGuard to enforce pi on-chain (reject settlement before transfer); fold atomic value into C'; runDelegatedOverHttp exercises live contract; Foundry tests for predicate-violating reverts"
    status: pending
  - id: p7-tamarin
    content: "Move 1: Tamarin model of the composed protocol (ERC-8004 identity + AP2 mandate + x402 nonce-consumption state fact + ERC-7710 caveat as guarded transition); prove P1-P5 as injective-agreement/trace lemmas; commit model + proof output + attack-or-proof writeup"
    status: pending
  - id: p7-real-baselines
    content: "Gap: implement the three CLB.md baselines B-vanilla-x402, B-ap2x402, B-ebay-monitor as runnable verifiers so the attack matrix shows each baseline MISSING the cross-layer attacks our stack catches"
    status: pending
  - id: p7-delivery-binding
    content: "Gap: upgrade R14 from timestamp-only to evidentiary. Merchant signs (settlementTxHash || reportHash); add R14b binding delivery to THIS settlement; reframe as accountability not atomicity in docs"
    status: pending
  - id: p7-8004-validation
    content: "Move 3: IERC8004Validator-style emitter. verifier-core certificate -> ERC-8004 Validation Registry entry; define CrossLayerBindingValidator as a new validator type alongside re-exec/zkML/TEE; testnet write + read-back"
    status: pending
  - id: p7-real-identity
    content: "Gap: resolve a real ERC-8004 testnet identity on the happy path (replace MockERC8004IdentityRegistry on the live flow); R3/R4 read a real agent card"
    status: pending
  - id: p7-confidential
    content: "Move 4: confidential commit-and-prove variant. On-chain = digest of C + range proof (value <= max); payee/amount/cart encrypted off-chain; verifier checks predicate against commitment without revealing params; selective-disclosure evidence path (encrypted S3 + public digest)"
    status: pending
  - id: p7-decision-instrumentation
    content: "Gap: instrument (not enforce) the decision layer. Log candidate merchants, ranking reason, selected merchant, prompt-injection scanner output as evidence events so the graph records what the agent saw; keep enforcement explicitly out of scope"
    status: pending
  - id: p7-five-attacks-repro
    content: "Move 5: reproduce arXiv:2605.11781 five attacks against our stack using their published artifact; show binding/replay/server-selection attacks (II, IV) eliminated by CLB, HTTP/proxy attacks (III) require their web-layer mitigations; honest results table"
    status: pending
  - id: p7-related-work-eval
    content: "Paper: related-work positioning vs Five-Attacks / eBay / A402 / SoK; composition-theorem framing; update docs/paper-outline.md and experiments/benchmarks with the new artifacts"
    status: pending
isProject: false
---

# Phase 7 — Research Contribution Hardening

> **⚠️ This is now the Phase 7 UMBRELLA OVERVIEW.** Phase 7 was decomposed (2026-06-04) into 7
> independently-executable sub-phase plans. Execute those, not this file. The detailed body below is
> retained as background/rationale.
>
> **Decomposition spec:** `docs/superpowers/specs/2026-06-04-phase-7-sub-phases-design.md`
>
> | Sub-phase | Plan | Lands | Cut-line |
> | --- | --- | --- | --- |
> | **7A** On-chain predicate enforcement (headline) | `plans/phase_7a_onchain_enforcement_4e40f7d3.plan.md` | Mode B reverts on-chain | must-have |
> | **7B** Real identity + evidentiary delivery | `plans/phase_7b_real_identity_delivery_1553cfbe.plan.md` | Live ERC-8004 card + R14b | must-have |
> | **7C** Tamarin proofs P1–P5 (parallel) | `plans/phase_7c_tamarin_proofs_3fd1dfbb.plan.md` | Formal soundness | stretch |
> | **7D** Composition evaluation | `plans/phase_7d_composition_evaluation_46715d77.plan.md` | Baselines + Five-Attacks + instrumentation | must-have |
> | **7E** ERC-8004 validation loop | `plans/phase_7e_validation_registry_loop_fdf9bc81.plan.md` | Economic loop | high-value stretch |
> | **7F** Confidential commit-and-prove | `plans/phase_7f_confidential_commit_prove_95a409ec.plan.md` | Privacy variant | optional |
> | **7G** Paper consolidation | `plans/phase_7g_paper_consolidation_39e02dee.plan.md` | Paper skeleton + related work | must-have, final |
>
> **Ordering:** spine 7A→7B→7D→7E; 7C parallel from day 1; 7F optional; 7G last.

Scope: convert the working Phases 0-6 demo into a paper that survives review against the
June-2026 competitive landscape. This phase does NOT add new product surface; every item
strengthens a _claim_. Follows the monorepo patterns of the
[Phase 4 plan](/Users/md.alamin/.cursor/plans/phase_4_mode_b_c66e7c74.plan.md) and
[Phase 3 plan](/Users/md.alamin/.cursor/plans/phase_3_attack_simulator_3bf9afe2.plan.md).

**Why this phase exists (competitive landscape, verified June 2026):**

- **arXiv:2605.11781 "Five Attacks on x402"** (Ohio State/CSIRO/Manchester, May 2026) — already
  formally analyzes x402 as a _cross-layer_ protocol with security theorems + proofs. **Threat:**
  scoops the x402-layer formal angle. **Survival seam:** x402-only; no ERC-8004 identity, no AP2
  authorization. Our theorem is about the _composition_ of all three.
- **arXiv:2602.06345 (eBay)** — AP2-only, off-chain runtime monitor, no proofs.
- **arXiv:2603.01179 (A402)** — payment-delivery atomicity via TEE channels; a _new rail_, not a binding.
- **arXiv:2604.03733 (SoK)** — taxonomy; names "enforcement-based coupling" as open.

**Phase 7 thesis:** single-layer soundness does not compose. We prove the three-layer composition,
enforce the delegated case on-chain, and feed the resulting certificate into ERC-8004's Validation
Registry so the agent economy can _price_ the guarantee. No current paper does the last two.

**Repo state entering Phase 7:** Phases 0-6 complete. `verifier-core` runs R1-R17 mode-aware.
`PredicatePaymentGuard.sol` exists with TS<->Solidity C' parity but Mode B settlement uses the
in-process `InMemoryPredicateGuard` (`ContractPredicateGuard` is optional; `runDelegatedOverHttp`
mirrors in-process). Identity is `MockERC8004IdentityRegistry`. R14 is timestamp-only. No formal
model. Baselines B0-B3 in `attack-core` are _simulated_ outcomes, not runnable weaker verifiers.

---

## Move 2 — Real on-chain predicate caveat (PR16) — HIGHEST PRIORITY

This is the only uncontested green cell in the trust matrix and it is currently stubbed. Finishing
it is what moves Mode B from "audited" to "prevented in-protocol."

| Decision         | Choice                                                                                                                                            | Rationale                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Enforcement path | `runDelegatedOverHttp` calls the deployed `PredicatePaymentGuard` on Anvil/Base Sepolia; settlement reverts if `evaluatePredicate` fails on-chain | Prevention, not post-hoc audit                                         |
| Atomic value     | Bind `valueAtomic` (integer) inside C' itself, not a parallel field                                                                               | Removes the documented demo simplification a reviewer will poke        |
| Caveat semantics | Guard checks payee/asset/chain/amount/expiry + single-use nonce = H(C') before releasing transfer                                                 | Mirrors the ERC-7710 caveat-enforcer redemption check in CLB.md Flow B |
| ERC-7710 label   | Keep the "demo caveat stand-in" label; document the exact gap vs a production ERC-7710 enforcer                                                   | Honest scope per existing DECISIONS discipline                         |

Tasks:

1. `packages/clb-core`: change `computeSettlementParamsDigest` to commit `valueAtomic` (uint) so the
   on-chain compare and the committed value are the same quantity. Update C' parity vectors.
2. `contracts/PredicatePaymentGuard.sol`: add `settleIfPredicateHolds(...)` that recomputes C',
   checks the predicate fields on-chain, enforces single-use nonce, and reverts with typed errors
   (`PredicatePayeeNotAllowed`, `PredicateAmountExceeded`, etc.). Foundry tests asserting revert per
   violation + happy-path success + gas report.
3. `packages/predicate-adapter`: make `ContractPredicateGuard` the default in `runDelegatedOverHttp`;
   keep `InMemoryPredicateGuard` for unit tests only.
4. `apps/agent-orchestrator`: `runDelegatedOverHttp` deploys/points to the guard and settles through it.
5. Acceptance: a predicate-violating Mode B settlement **reverts on-chain** (not just fails R17);
   `bun run e2e:phase7-caveat` produces a tx-reverted artifact + gas numbers.

---

## Move 1 — Tamarin proofs of the composed protocol (PR17)

| Decision         | Choice                                                                                                                                                                     | Rationale              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Tool             | Tamarin (stateful single-use nonce is the crux); ProVerif cross-check on the off-chain sub-protocol                                                                        | CLB.md §9              |
| Model surface    | Dolev-Yao A2A channel; ERC-8004 key-authorization fact; AP2 mandate sig over C; abstract chain with a `NonceConsumed` linear fact; ERC-7710 caveat as a guarded transition | CLB.md §8 threat model |
| Properties       | P1 identity binding, P2 authorization integrity, P3 freshness/non-replay, P4 non-transferability, P5 predicate soundness — as injective-agreement + trace lemmas           | CLB.md §8              |
| Expected finding | Tool surfaces a transplant/cross-chain attack on a naive C without chainId domain separation; patch motivates the EIP-712 domain fix already in clb-core                   | CLB.md §9              |

Tasks:

1. `formal/tamarin/clb.spthy` — model + lemmas P1-P5. `formal/tamarin/README.md` — how to run.
2. Commit proof output (or the found-attack trace + patched-model proof) under `formal/tamarin/proofs/`.
3. `docs/paper-outline.md`: a "formal soundness" section citing the machine-checked result.
4. Acceptance: `tamarin-prover --prove formal/tamarin/clb.spthy` verifies P1-P5 (or documents the
   patched model that does). This is the answer to "Five Attacks has proofs and you don't."

---

## Gap — Runnable baselines (PR18)

The current B0-B3 are _narrative_ outcomes. A reviewer wants to see the weaker stack actually accept
a trace our stack rejects.

Tasks:

1. `packages/attack-core/src/baselines/`: implement three runnable verifiers —
   - `bVanillaX402`: checks only that the x402 settlement is well-formed (no cross-layer rules).
   - `bAp2X402`: AP2 mandate validity + x402 settlement, but no ERC-8004 identity binding and no C recompute.
   - `bEbayMonitor`: context-binding + consume-once on the AP2 mandate only (faithful re-impl of the
     eBay model's _enforced_ checks), off-chain, single-protocol.
2. Run all 10 binding fixtures + 4 predicate fixtures through each baseline + full CLB-ACEL.
3. `experiments/benchmarks/baseline-comparison.md`: a matrix where each baseline column shows
   ACCEPT (missed) on the cross-layer attacks that CLB-ACEL catches. This table is the paper's
   money figure for "composition matters."
4. Acceptance: `bun run e2e:phase7-baselines` regenerates the matrix; CI fails on drift.

---

## Gap — Evidentiary delivery binding (PR19a)

R14 currently trusts a claimed timestamp. Make it cryptographic without overclaiming atomicity.

Tasks:

1. `apps/merchant-agent-api`: sign `(settlementTxHash || reportHash)` and include in the report.
2. `verifier-core`: add `R14b_DELIVERY_BOUND_TO_SETTLEMENT` — verify that signature binds delivery to
   _this_ settlement, not just a later wall-clock time.
3. Docs: frame R14/R14b as **accountability / dispute evidence**, explicitly cite A402 as the
   _enforcement_ (fair-exchange) alternative we do not claim to match.

---

## Move 3 — Certificate as ERC-8004 Validation Registry entry (PR19b) — KEY DIFFERENTIATOR

This is the Web3-economy contribution no competitor has. The ERC-8004 spec itself says the
Validation Registry provides hooks for validator types (stakers re-running jobs, zkML verifiers, TEE
oracles). We add a new one: **cross-layer-binding validation**.

| Decision       | Choice                                                                                              | Rationale                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Validator type | `CrossLayerBindingValidator` — emits a validation entry iff the deterministic verifier returns PASS | New primitive alongside re-exec/zkML/TEE                                         |
| Linkage        | Validation entry references `certificateHash` + `traceMerkleRoot` + `settlementTxHash`              | Closes the loop from CLB.md §7 output and ACEL feedback step                     |
| Future hook    | Entry schema leaves room to carry a zkML proof digest later                                         | Aligns with the zkML/Validation-Registry research thread without scope creep now |

Tasks:

1. `contracts/`: a thin `CrossLayerBindingValidator.sol` that records `(traceId, certificateHash,
result)` and is readable by an ERC-8004 Validation Registry (real testnet registry, or the mock
   if the live one is unavailable — adapter-swappable per existing pattern).
2. `services/verifier-service`: on PASS, emit a validation write; expose read-back.
3. Acceptance: a verified trace produces an on-chain validation entry retrievable by `traceId`;
   `docs/paper-outline.md` reframes CLB-ACEL as "the validation primitive that lets the agent
   economy price cross-layer trust."

---

## Gap — Real testnet identity (PR20a)

Tasks:

1. Point the happy-path identity resolution at a real ERC-8004 testnet registry (Base Sepolia).
2. `verifier-core` R3/R4 read a real agent card (endpoints + payment keys), not a fixture.
3. Keep the mock for offline unit tests; document the switch in DECISIONS.md.

---

## Move 4 — Confidential commit-and-prove variant (PR20b)

Both Five-Attacks and A402 flag on-chain metadata leakage; A402 solves it with a heavy TEE vault. Win
on elegance instead.

| Decision  | Choice                                                              | Rationale                                                      |
| --------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| On-chain  | digest of C + a range proof that `value <= maxValue`                | Hides payee/amount while keeping the predicate checkable       |
| Off-chain | payee/amount/cart encrypted (S3); public digest only                | Implements the selective-disclosure design ACEL.md §4 promised |
| Verifier  | checks predicate against the commitment without learning the params | Lighter than A402's TEE Liquidity Vault                        |

Tasks:

1. `packages/clb-core`: a `confidential` mode producing a commitment + range proof (use a simple
   Bulletproof/Pedersen library behind an adapter; keep it swappable).
2. `services/evidence-service`: encrypted-payload path (public digest + private encrypted blob),
   finally delivering the deferred encryption work.
3. `verifier-core`: a confidential verification path that consumes the proof, not the plaintext.
4. Acceptance: `bun run e2e:phase7-confidential` shows a PASS where on-chain data reveals neither
   payee nor exact amount. Cite as the privacy answer to the leakage critique.

> Note: if the range-proof library proves too heavy for v1, ship the selective-disclosure evidence
> path (encrypted off-chain + public digest) alone and label the range proof a documented extension.
> Do not block the rest of Phase 7 on cryptographic tooling.

---

## Gap — Decision-layer instrumentation, not enforcement (PR21)

Neutralize the red-teaming-paper critique honestly: record what the agent saw, don't claim to judge it.

Tasks:

1. `apps/agent-orchestrator`: emit evidence events for candidate merchants, ranking reason, selected
   merchant, and prompt-injection-scanner output during discovery.
2. `evidence-core`: new node/edge types for the decision context; graph renders them.
3. Docs: state plainly that this makes the decision layer **auditable but not enforced**; competence
   remains out of scope per CONTEXT §28.

---

## Move 5 — Reproduce "Five Attacks on x402" (PR22) — depends on PR16

The strongest evaluation sentence in the paper comes from building _on_ the newest competitor.

| Their attack                                     | Our expectation                   | Why                                                 |
| ------------------------------------------------ | --------------------------------- | --------------------------------------------------- |
| Attack I (settlement-path inconsistencies)       | Partially mitigated               | nonce=H(C) + R8/R9 pin settlement to one commitment |
| Attack II (replay/idempotency across HTTP-chain) | **Eliminated**                    | single-use nonce derived from C; R9                 |
| Attack III (HTTP/proxy header manipulation)      | **Not** mitigated by CLB          | web-layer; cite their mitigation, be honest         |
| Attack IV (server-selection)                     | Mitigated when discovery is bound | identity binding + decision instrumentation (PR21)  |

Tasks:

1. `experiments/five-attacks-repro/`: pull their anonymized artifact; replay each attack against our
   testbed (local + Base Sepolia).
2. `experiments/benchmarks/five-attacks-comparison.md`: honest results table (eliminated / mitigated /
   out-of-scope-cite-their-fix).
3. Acceptance: reproducible run; the table reads "three of five eliminated/mitigated by cross-layer
   binding; remaining require the web-layer mitigations the original authors propose."

---

## Paper deliverables (PR23)

1. `docs/paper-outline.md`: composition-theorem framing; the related-work paragraph positioning vs
   Five-Attacks / eBay / A402 / SoK (drop in the paragraph already drafted).
2. `docs/threat-model.md`: align with the proven P1-P5 and the explicit out-of-scope (decision layer,
   atomicity, HTTP/proxy).
3. Consolidate artifacts: `baseline-comparison.md`, `five-attacks-comparison.md`,
   `p5-attack-matrix.md`, gas reports, Tamarin proof output.

---

## Verification checklist (subset of CONTEXT §23)

- Contract: `forge test` green incl. predicate-violation reverts + validator entry + gas report
- Formal: `tamarin-prover --prove` verifies P1-P5 (or patched model)
- Integration: Mode B violation **reverts on-chain**; baselines MISS cross-layer attacks CLB catches
- E2E: `e2e:phase7-caveat`, `e2e:phase7-baselines`, `e2e:phase7-confidential`, five-attacks repro
- Economic loop: verified trace -> on-chain validation entry retrievable by traceId

---

## Explicitly out of scope (honest, per CONTEXT §28)

- Agent competence / "best choice" — instrumented (PR21) but never enforced or claimed
- Payment-delivery atomicity / fair exchange — A402's domain; we provide evidentiary binding only
- HTTP/proxy-layer attacks (Five-Attacks III) — web-layer; we cite their mitigations
- Production-grade ERC-7710 enforcer — adapter interface + demo caveat; full enforcer is future work
- Full zkML proof in the validation entry — schema leaves room; proof generation is a follow-on paper

---

## Success criteria

1. A predicate-violating delegated settlement **reverts on-chain** (Mode B prevention is real).
2. `tamarin-prover` machine-checks P1-P5 over the composed protocol (or the patched model).
3. The baseline-comparison matrix shows vanilla-x402, AP2+x402, and the eBay-monitor each MISSING
   cross-layer attacks that CLB-ACEL catches.
4. A verified trace writes an ERC-8004 Validation Registry entry — the economic loop closes.
5. The Five-Attacks reproduction table shows which of their attacks cross-layer binding eliminates.
6. `docs/paper-outline.md` positions the contribution as the _composition theorem + economic loop_,
   beating Five-Attacks (x402-only), eBay (AP2-only monitor), and A402 (new rail).
