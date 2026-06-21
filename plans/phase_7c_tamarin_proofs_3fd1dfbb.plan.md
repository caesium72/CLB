---
name: Phase 7C — Tamarin Proofs of the Composed Protocol (P1–P5)
overview: "Machine-check the security of the COMPOSED protocol (ERC-8004 identity + AP2 mandate + x402 nonce-consumption + ERC-7710 caveat) — the direct answer to 'Five Attacks has proofs and you don't.' Model in Tamarin: Dolev-Yao A2A channel, ERC-8004 key-authorization fact, AP2 mandate signature over C, abstract chain with a NonceConsumed linear fact, ERC-7710 caveat as a guarded transition. Prove P1 identity binding, P2 authorization integrity, P3 freshness/non-replay, P4 non-transferability, P5 predicate soundness as injective-agreement + trace lemmas. Expected finding: a naive C without chainId/domain separation admits a transplant/cross-chain attack; the EIP-712-domain-separated model (already in clb-core) then verifies. RUNS IN PARALLEL with the engineering track. Spec: docs/superpowers/specs/2026-06-04-phase-7-sub-phases-design.md §5 (7C). HIGH RESEARCH RISK; degrade path is itself publishable (attack-found -> patched-model-proven)."
todos:
  - id: 7c-model-skeleton
    content: "formal/tamarin/clb.spthy: protocol skeleton — agents/keys, Dolev-Yao A2A channel, ERC-8004 key-auth fact, AP2 mandate sig over C, abstract chain NonceConsumed linear fact; sanity 'executability' lemma"
    status: pending
  - id: 7c-modeA-lemmas
    content: "Mode A lemmas P1-P4 (injective agreement + trace); run tamarin-prover --prove; expect/locate the transplant attack on a naive C (no chainId/domain)"
    status: pending
  - id: 7c-domain-fix
    content: "Add EIP-712 domain separation (chainId in C) to the model; re-prove P1-P4; commit the attack trace + the patched proof side by side"
    status: pending
  - id: 7c-modeB-caveat
    content: "Extend to Mode B: ERC-7710 caveat as a guarded transition gating settlement on predicate(pi); prove P5 predicate soundness"
    status: pending
  - id: 7c-proof-artifacts
    content: "formal/tamarin/README.md (how to run, versions), formal/tamarin/proofs/ (committed proof output or attack-trace+patched proof), Makefile target"
    status: pending
  - id: 7c-paper-section
    content: "docs/paper-outline.md: 'Formal soundness' section citing the machine-checked P1-P5 (or the patched-model result) + the domain-separation lesson"
    status: pending
isProject: false
---

# Phase 7C — Tamarin Proofs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. This is a **research/proof** plan: the "test" is `tamarin-prover --prove`, and steps are milestones (model → prove → patch → re-prove), not red/green unit tests. Work in small commits; commit the .spthy and proof output each milestone.

**Goal:** A committed Tamarin model + machine-checked lemmas establishing P1–P5 for the **composition** of ERC-8004 identity + AP2 authorization + x402 settlement + ERC-7710 caveat — or, if the tool surfaces an attack on a naive commitment, the attack trace **plus** the patched (domain-separated) model that then verifies.

**Architecture:** One `clb.spthy` theory. Multiset-rewrite rules model: human/agent/merchant keys; a Dolev–Yao A2A channel (`Out`/`In`); an ERC-8004 `!KeyAuth(agentId, payKey)` persistent fact; an AP2 mandate signature over the commitment `C`; an abstract chain with a **linear** `NonceConsumed(nonce)` fact (the crux Tamarin handles that ProVerif cannot); and an ERC-7710 caveat as a guarded settlement transition that fires only if `predicate(π, params)` holds. Lemmas are injective-agreement + trace properties.

**Tech Stack:** Tamarin Prover (install via Homebrew/Nix: `brew install tamarin-prover/tap/tamarin-prover` or the Nix flake) · optional ProVerif cross-check for the pure off-chain sub-protocol · `make` for repeatable proof runs.

**Why this beats Five-Attacks:** their proofs cover x402 **in isolation**. P1–P5 here are about what holds when identity, authorization, and settlement are **composed** — the named-open gap in SoK (2604.03733).

**Reference grounding:**
- `CLB.md` §8 (threat model: P1–P5, Dolev–Yao adversary) and §9 (formal plan: Tamarin, expected transplant attack on naive C).
- `packages/clb-core` — the real EIP-712 domain (`name: "CLB-ACEL"`, `version`, `chainId`) the patched model must mirror.
- The five properties are already named in `CONTEXT_FULL_PROJECT.md` §20 and `CLB.md` §8.

> **No deps on other sub-phases.** Start day one so a negative result has time to surface.

---

## Task 1: Model skeleton + executability sanity

**Files:**
- Create: `formal/tamarin/clb.spthy`
- Create: `formal/tamarin/README.md`
- Create: `formal/tamarin/Makefile`

- [ ] **Step 1: Write the theory skeleton** — keys, channel, registry, mandate, settlement rules + a `lemma executable: exists-trace` proving a full honest run is reachable (guards against a vacuously-true model).

```
theory CLB
begin
builtins: signing, hashing

// ---- key / identity setup ----
rule RegisterAgent:
    [ Fr(~sk) ]
  --[ AgentKey($agentId, pk(~sk)) ]->
    [ !Ltk($agentId, ~sk), !KeyAuth($agentId, pk(~sk)), Out(pk(~sk)) ]

// ---- human authorizes commitment C over (identityRef, mandateDigest, settlementDesc) ----
rule HumanAuthorize:
    [ Fr(~md), !Ltk($P, skP), !KeyAuth($agentId, payKey) ]
  --[ Authorized($P, $agentId, payKey, ~md) ]->
    [ Out( <C($agentId, ~md, settle), sign(C($agentId, ~md, settle), skP)> ) ]

// ---- abstract chain: single-use nonce = H(C) ----
rule Settle:
    [ In(<c, sig>), !KeyAuth($agentId, payKey) ]
  --[ Settle($agentId, payKey, c), NonceConsumed(h(c)) ]->
    [ ]

lemma executable: exists-trace " Ex a k c #i. Settle(a, k, c) @ #i "
end
```

- [ ] **Step 2: Run executability** Run: `cd formal/tamarin && tamarin-prover --prove=executable clb.spthy`
Expected: `executable` verified (an honest trace exists).

- [ ] **Step 3: Write README** (Tamarin version pinned, `make prove`, expected runtime) and a `Makefile` (`prove:` → `tamarin-prover --prove clb.spthy +RTS -N4 -RTS`).

- [ ] **Step 4: Commit**

```bash
git add formal/tamarin/clb.spthy formal/tamarin/README.md formal/tamarin/Makefile
git commit -m "feat(formal): CLB Tamarin skeleton + executability lemma"
```

---

## Task 2: Mode A lemmas P1–P4 + locate the transplant attack

**Files:** Modify `formal/tamarin/clb.spthy`

- [ ] **Step 1: Add the P1–P4 lemmas** (injective-agreement + non-replay + non-transferability), deliberately over a **naive** `C` that omits `chainId`/domain — to surface the expected attack.

```
// P3 freshness: a nonce is consumed at most once
lemma P3_no_replay:
  "All n #i #j. NonceConsumed(n) @ #i & NonceConsumed(n) @ #j ==> #i = #j"

// P1 identity binding: the settling payKey was authorized for that agentId
lemma P1_identity_binding:
  "All a k c #i. Settle(a, k, c) @ #i ==> Ex #j. AgentKey(a, k) @ #j & #j < #i"

// P4 non-transferability: settlement agrees with a human authorization for the SAME params
lemma P4_injective_agreement:
  "All a k c #i. Settle(a, k, c) @ #i
     ==> (Ex P md #j. Authorized(P, a, k, md) @ #j & #j < #i)"
```

- [ ] **Step 2: Run the proofs** Run: `make prove` (or `tamarin-prover --prove clb.spthy`)
Expected: **P3/P1 verify; P4 (or a cross-chain variant) FALSIFIES** — Tamarin returns an attack trace where a commitment authorized on chain X is replayed on chain Y (naive `C` has no domain separation). Save the attack graph:

Run: `tamarin-prover --prove=P4_injective_agreement clb.spthy --output-dot=proofs/attack-transplant.dot`

- [ ] **Step 3: Commit the attack** (this is a paper result, not a failure)

```bash
git add formal/tamarin/clb.spthy formal/tamarin/proofs/attack-transplant.dot
git commit -m "formal: Tamarin surfaces cross-chain transplant on naive C (no domain separation)"
```

---

## Task 3: Domain separation fix → re-prove P1–P4

**Files:** Modify `formal/tamarin/clb.spthy`

- [ ] **Step 1: Add `chainId`/domain into `C`** so the commitment mirrors the real EIP-712 domain in `clb-core` (`C = H(domain(chainId) ‖ identityRef ‖ mandateDigest ‖ settlementDesc)`). Update the `Settle` rule to require the settlement's `chainId` equal the domain's.

- [ ] **Step 2: Re-prove** Run: `make prove`
Expected: **P1–P4 all verify** on the domain-separated model. Export proofs:

Run: `tamarin-prover --prove clb.spthy --output=proofs/clb-modeA-proven.spthy`

- [ ] **Step 3: Commit**

```bash
git add formal/tamarin/clb.spthy formal/tamarin/proofs/clb-modeA-proven.spthy
git commit -m "formal: domain separation fixes transplant; P1-P4 verified (Mode A)"
```

---

## Task 4: Mode B — ERC-7710 caveat guarded transition → P5

**Files:** Modify `formal/tamarin/clb.spthy`

- [ ] **Step 1: Model the predicate + caveat** — the human signs an Intent predicate `π = (allowedPayees, allowedAssets, maxValue, validUntil, allowedChainIds)`; a `SettleB` rule fires only under an action fact `PredicateHolds(π, params)` (the on-chain caveat). Add the soundness lemma:

```
// P5 predicate soundness: no settlement violates the signed predicate
lemma P5_predicate_soundness:
  "All a k params #i. SettleB(a, k, params) @ #i
     ==> Ex pi #j. SignedPredicate(pi) @ #j & #j < #i & Holds(pi, params)"
```

- [ ] **Step 2: Prove P5** Run: `tamarin-prover --prove=P5_predicate_soundness clb.spthy`
Expected: P5 verifies (a `SettleB` with `params` violating `π` is unreachable because the caveat guard blocks it). If it falsifies, record the trace and tighten the guarded transition, then re-prove.

- [ ] **Step 3: Full prove run** Run: `make prove`
Expected: P1–P5 all verified on the final model.

- [ ] **Step 4: Commit**

```bash
git add formal/tamarin/clb.spthy formal/tamarin/proofs/
git commit -m "formal: ERC-7710 caveat guarded transition; P5 predicate soundness verified"
```

---

## Task 5: Proof artifacts + paper section

**Files:**
- Create/update: `formal/tamarin/proofs/SUMMARY.md`
- Modify: `docs/paper-outline.md`

- [ ] **Step 1: Write `proofs/SUMMARY.md`** — table of P1–P5 (status: verified; tool version; wall-clock; oracle/heuristics used) + the transplant-attack narrative (naive C → domain-separated C).

- [ ] **Step 2: Add the "Formal soundness" section** to `docs/paper-outline.md`: the composition is machine-checked; the domain-separation lesson is the on-paper justification for the EIP-712 domain already shipping in `clb-core`; contrast with Five-Attacks (x402-only proofs).

- [ ] **Step 3: Commit**

```bash
git add formal/tamarin/proofs/SUMMARY.md docs/paper-outline.md
git commit -m "formal: proof summary + paper formal-soundness section"
```

---

## Acceptance (7C complete when)

- [ ] `cd formal/tamarin && make prove` verifies P1–P5 on the final (domain-separated, caveat-guarded) model **or** `proofs/` contains the attack trace + the patched model that verifies, with `SUMMARY.md` explaining both.
- [ ] `executable` lemma holds (model is not vacuous).
- [ ] `docs/paper-outline.md` has a formal-soundness section citing the result.

## Degrade path (explicit, honest)

If full P1–P5 over the composed model proves intractable in the available time, ship: (a) Mode A P1–P4 verified + (b) the documented transplant attack on naive C + the patched-model proof + (c) P5 stated with the caveat-guard model and either a verified result or a clearly-scoped partial result. The "attack-found → patched-model-proven" story is itself a paper-worthy contribution and the expected outcome per CLB.md §9.

## Self-review checklist

- [ ] The model's `C` field order/domain matches `clb-core`'s real EIP-712 domain (so the proof is about the *shipped* construction).
- [ ] `NonceConsumed` is a **linear** fact (single-use), not persistent.
- [ ] Each lemma names the property (P1–P5) it establishes; `SUMMARY.md` maps lemma → property.
