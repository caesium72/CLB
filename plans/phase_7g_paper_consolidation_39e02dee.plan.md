---
name: Phase 7G — Paper Consolidation + Related Work
overview: "Turn the Phase 7 artifacts into a submittable paper skeleton and position honestly against the June-2026 landscape. (1) docs/paper-outline.md: composition-theorem framing + related-work paragraph vs Five-Attacks (2605.11781), eBay (2602.06345), A402 (2603.01179), SoK (2604.03733), and the NEW SoK (2604.15367). (2) docs/threat-model.md: align with the proven P1-P5 + explicit out-of-scope (decision layer, atomicity, HTTP/proxy). (3) Consolidate artifacts: baseline-comparison.md, five-attacks-comparison.md, p5-attack-matrix.md, gas reports, Tamarin proof output, validation-loop result. Every claim backed by a checked-in artifact. Spec §5 (7G). Depends on ALL other sub-phases; final."
todos:
  - id: 7g-paper-outline
    content: "docs/paper-outline.md: composition-theorem framing (single-layer soundness does not compose); contribution = proof + on-chain enforcement + economic loop; map each claim -> artifact"
    status: pending
  - id: 7g-related-work
    content: "Related-work section positioning vs Five-Attacks (x402-only), eBay (AP2-only monitor), A402 (new rail), SoK 2604.03733 (taxonomy/open gaps), + NEW SoK 2604.15367 (LLM-agent security)"
    status: pending
  - id: 7g-threat-model
    content: "docs/threat-model.md: align adversary + assets with proven P1-P5; explicit out-of-scope (decision-layer competence, payment-delivery atomicity, HTTP/proxy-layer)"
    status: pending
  - id: 7g-artifact-consolidation
    content: "experiments/benchmarks/: index + cross-link baseline-comparison.md, five-attacks-comparison.md, p5-attack-matrix.md, phase7-caveat-gas, tamarin proofs, validation-loop result; an evaluation README mapping RQ -> artifact"
    status: pending
  - id: 7g-demo-walkthrough
    content: "docs/demo-script.md: three-layer on-chain + off-chain verification table (what UI shows vs. what reviewer independently verifies) + skeptic Q&A (real money?, LLM security?, tampering?)"
    status: pending
isProject: false
---

# Phase 7G — Paper Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. This is a **documentation/consolidation** plan: steps are write-and-verify (does the doc cite a real, checked-in artifact?), not unit tests. Commit per section.

**Goal:** `docs/paper-outline.md` reads as a submittable skeleton in which **every claim is backed by a checked-in artifact**, with an honest related-work section positioning CLB-ACEL as the _composition theorem + on-chain enforcement + economic loop_ against the five competitor papers; `docs/threat-model.md` matches the proven P1–P5 and the explicit out-of-scope.

**Architecture:** Pure documentation + artifact indexing. Consume the outputs of 7A–7F: the on-chain-revert + gas artifact (7A), real-identity/R14b notes (7B), Tamarin proofs (7C), baseline-comparison + five-attacks-comparison + decision instrumentation (7D), the validation-registry loop result (7E), and the confidential/selective-disclosure result (7F). Cross-link them so a reviewer can trace each claim to evidence.

**Tech Stack:** Markdown. Use the elements-of-style writing-clearly-and-concisely guidance if available. No code.

**Repo grounding (verify before editing):**

- `docs/paper-outline.md`, `docs/threat-model.md` (existing; update, don't rewrite wholesale).
- `experiments/benchmarks/` — existing `attack-matrix.md`, `p5-attack-matrix.md`, gas/latency reports; Phase 7 adds `baseline-comparison.md`, `five-attacks-comparison.md`, `phase7-caveat-gas.md`, `phase7-confidential.json`.
- `formal/tamarin/proofs/SUMMARY.md` (7C).
- The umbrella overview `plans/phase_7_research_contribution_hardening_3f3rdfgdf3.plan.md` (thesis + success criteria to mirror).
- Paper framing already drafted in `CONTEXT_FULL_PROJECT.md` §28 (title, RQ1–RQ4, contribution statement, honesty caveats).

---

## Task 1: Composition-theorem framing in `paper-outline.md`

**Files:** Modify `docs/paper-outline.md`

- [ ] **Step 1: Write the thesis + contribution** — "single-layer soundness does not compose"; the contribution is the triple **(formal composition proof P1–P5) + (on-chain Mode B enforcement) + (ERC-8004 validation economic loop)**. Mirror `CONTEXT §28` RQ1–RQ4 and the umbrella success criteria. Keep the honesty caveats (CLB proves binding not competence; accountability not atomicity; Mode B predicate enforcement is the hardest/most novel part).

- [ ] **Step 2: Add a claim→artifact map** (a table): each RQ/claim → the checked-in artifact that backs it (e.g. RQ2 prevention → `phase7-caveat.json` + Tamarin P4/P5; RQ1/RQ3 composition → `baseline-comparison.md` + `five-attacks-comparison.md`; RQ4 costs → gas/latency/storage reports + `phase7-confidential.json`).

- [ ] **Step 3: Verify each cited artifact exists** Run: `for f in experiments/benchmarks/baseline-comparison.md experiments/benchmarks/five-attacks-comparison.md experiments/benchmarks/phase7-caveat-gas.md formal/tamarin/proofs/SUMMARY.md; do test -e "$f" && echo "OK $f" || echo "MISSING $f"; done`
      Expected: all OK (or the artifact's owning sub-phase is still pending — note it, don't fabricate).

- [ ] **Step 4: Commit** `git add docs/paper-outline.md && git commit -m "docs(paper): composition-theorem framing + claim->artifact map"`

---

## Task 2: Related-work section (honest positioning)

**Files:** Modify `docs/paper-outline.md`

- [ ] **Step 1: Write the related-work paragraph** positioning against each competitor (one honest sentence of overlap + one of distinction each):
  - **Five-Attacks (2605.11781):** formal x402 analysis + reproducible attacks — but **x402-only**; no identity/authorization composition; we _build on_ their testbed (7D) and prove the composition they don't model.
  - **eBay Zero-Trust (2602.06345):** AP2 context-binding + consume-once — but an **off-chain runtime monitor**, single-protocol, no proofs, no in-protocol enforcement; we enforce on-chain and prove P1–P5.
  - **A402 (2603.01179):** payment-delivery **atomicity** via TEE adaptor signatures — a **new rail** with heavy TEE trust; we are a binding over existing rails and claim accountability, not atomicity (cite as the fair-exchange alternative).
  - **SoK A2A (2604.03733):** names "weak intent binding / payment-service decoupling / limited accountability" as **open** — we close them with a concrete construction + proofs + economic loop.
  - **SoK LLM-agent security (2604.15367):** decision-layer/LLM risk taxonomy — orthogonal; we _instrument_ the decision layer (7D) but explicitly do not claim competence.

- [ ] **Step 2: Commit** `git add docs/paper-outline.md && git commit -m "docs(paper): related-work positioning vs 5 competitor papers"`

---

## Task 3: Threat-model alignment

**Files:** Modify `docs/threat-model.md`

- [ ] **Step 1: Align adversary + properties** — Dolev–Yao A2A adversary, malicious shopping/merchant agent, curious facilitator (per CLB.md §8); assets; the **proven** P1–P5 mapped to the verifier rules (R1–R17 + R14b) and the on-chain guard.

- [ ] **Step 2: Explicit out-of-scope** (one place, authoritative): decision-layer competence (instrumented, not enforced), payment-delivery atomicity (A402's domain), HTTP/proxy-layer attacks (Five-Attacks III — cite their fix), production-grade ERC-7710 enforcer (adapter seam shipped, hardened enforcer future), full zkML proof in the validation entry (schema reserved).

- [ ] **Step 3: Commit** `git add docs/threat-model.md && git commit -m "docs(threat-model): align with proven P1-P5 + explicit out-of-scope"`

---

## Task 4: Artifact consolidation + evaluation index

**Files:**

- Create: `experiments/benchmarks/README.md` (the evaluation index)

- [ ] **Step 1: Write the index** — a table listing every Phase 7 artifact, the command that regenerates it, and the paper claim it supports:

| Artifact                           | Regenerate with                                 | Backs                            |
| ---------------------------------- | ----------------------------------------------- | -------------------------------- |
| `baseline-comparison.md`           | `bun run e2e:phase7-baselines`                  | composition matters (RQ1)        |
| `five-attacks-comparison.md`       | `bun run experiments/five-attacks-repro/run.ts` | eliminated/mitigated map (RQ2)   |
| `p5-attack-matrix.md`              | `bun run e2e:phase4b`                           | predicate soundness (P5)         |
| `phase7-caveat.json` + gas         | `bun run e2e:phase7-caveat`                     | on-chain Mode B prevention (RQ2) |
| `formal/tamarin/proofs/SUMMARY.md` | `cd formal/tamarin && make prove`               | P1–P5 formal soundness           |
| validation-loop result             | `bun test services/verifier-service`            | economic loop (RQ-econ)          |
| `phase7-confidential.json`         | `bun run e2e:phase7-confidential`               | privacy cost (RQ4)               |

- [ ] **Step 2: Verify regenerability** — run each listed command whose owning sub-phase is complete; mark any pending artifact as "pending <sub-phase>" rather than asserting it exists.

- [ ] **Step 3: Commit** `git add experiments/benchmarks/README.md && git commit -m "docs(eval): benchmark index mapping artifact -> command -> claim"`

---

---

## Task 5: Demo walkthrough — how on-chain and off-chain verification is shown

**Files:**

- Create: `docs/demo-script.md` (or update if it already exists at `docs/demo-walkthrough.md`)

> This task is documentation for the **conference/paper demo**, not a code change. It explains exactly what a reviewer or investor sees when they ask "how do I know this is real?" It also serves as the script for a live presentation.

- [ ] **Step 1: Write the three-layer verification walkthrough** — a table the presenter reads from during a demo, covering what is shown in the UI and what the reviewer can independently verify on their own machine:

| Layer                              | What the demo UI shows                                                                                     | What the reviewer can independently verify                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User intent → CLB commitment C** | Research-mode panel: `identityRef`, `mandateDigest`, `settlementDescriptor`, computed `C` (hex)            | Recompute `C = keccak256(EIP712(identityRef, mandateDigest, settlementDescriptor))` using the displayed inputs — deterministic, no trust needed          |
| **x402 payment nonce**             | Settlement step: `nonce = keccak256(C)` and the payment payload (from, to, value, nonce)                   | Verify `nonce == keccak256(C)` from the displayed C; the nonce matches the `Authorization.nonce` field in the settlement payload                         |
| **On-chain USDC transfer**         | Basescan link (clickable): `settlementTxHash` → shows USDC transfer from shopping-agent to merchant wallet | Paste `settlementTxHash` into `https://sepolia.basescan.org`; see the EIP-3009 USDC transfer, the nonce field, the to/value/asset                        |
| **Evidence hash chain**            | Evidence graph: 9 nodes with hash arrows; any event click shows `objectHash` and `previousEventHash`       | Download the raw event JSON → verify `event_i.objectHash == keccak256(canonicalJson(event_i))` and `event_{i+1}.previousEventHash == event_i.objectHash` |
| **Merkle root**                    | Anchor step: `merkleRoot` = leaf hashes → binary tree root; displayed hex                                  | Recompute: take the 9 `eventHashes` in order, compute binary Merkle root → must match `merkleRoot` shown                                                 |
| **On-chain anchor**                | Basescan link: `anchorTxHash` → `AgenticAuditAnchor.anchorTrace(traceId, merkleRoot, ...)`                 | Call `getTraceAnchor(traceId)` on the deployed contract (Basescan read → returns stored root + timestamp); root must equal the computed merkleRoot       |
| **Verifier certificate**           | Verifier result screen: PASS / FAIL, 17 rules, `certificateHash`                                           | Recompute the certificate hash from the displayed certificate fields — same deterministic function                                                       |
| **LLM agent decision**             | Discovery step: candidate list, rationale text, `llmProvider` badge (OpenAI/Grok/heuristic)                | The `DECISION_CONTEXT` event in research mode shows the rationale text + `llmProvider`; the event is part of the hash chain (auditable, not enforced)    |
| **R14b delivery binding**          | Delivery step: `deliveryBinding` signature; merchant signed `keccak256(settlementTxHash, reportHash)`      | Recover the signer from `deliveryBinding` using `settlementTxHash` + `reportHash`; must match the merchant's known payment key                           |

- [ ] **Step 2: Add the "skeptic questions" section** — five questions a conference reviewer might ask, and the exact answer:

```
Q: "How do I know the settlement is real and not simulated?"
A: The settlementTxHash is a Base Sepolia transaction. Paste it in Basescan — you will see
   a real EIP-3009 USDC transferWithAuthorization from the shopping-agent wallet to the merchant.

Q: "How do I know the nonce pins this payment to exactly this mandate?"
A: nonce = keccak256(C). C is computed from (identityRef || mandateDigest || settlementDescriptor).
   Verify: displayed C → keccak256(C) → matches the nonce field in the on-chain tx.

Q: "How do I know the evidence graph hasn't been tampered with?"
A: Recompute any event's objectHash from its JSON and verify the hash chain.
   Then recompute the Merkle root from the event hashes — it must match what was anchored on-chain.

Q: "How do I know the LLM didn't make a security decision?"
A: The verifier (R1–R17) is deterministic TypeScript — no LLM call. The LLM only generated
   the rationale text in DECISION_CONTEXT, which is auditable evidence, never enforcement input.

Q: "Is this real money?"
A: No. All assets are testnet tokens on Base Sepolia with zero real-world monetary value.
   The ETH is from a free faucet; the USDC is from Circle's testnet faucet.
```

---

## Acceptance (7G complete when)

- [ ] `docs/paper-outline.md` has the composition-theorem framing, the claim→artifact map, and the 5-paper related-work section.
- [ ] `docs/threat-model.md` matches the proven P1–P5 and states the out-of-scope in one authoritative place.
- [ ] `experiments/benchmarks/README.md` maps every artifact → regeneration command → claim; every referenced artifact either exists or is explicitly marked pending its sub-phase.
- [ ] No claim in the outline lacks a backing artifact (or is flagged as future work honestly).
- [ ] `docs/demo-script.md` has the three-layer verification table (what UI shows vs. what a reviewer independently verifies on Basescan / from raw JSON) and the skeptic Q&A covering: real money? LLM making security decisions? tampering? nonce binding? on-chain anchor.

## Self-review checklist

- [ ] Every arXiv id is correct (2605.11781, 2602.06345, 2603.01179, 2604.03733, 2604.15367).
- [ ] Honesty caveats from CONTEXT §28 are preserved (binding not competence; accountability not atomicity).
- [ ] No artifact is cited that no sub-phase produces.
