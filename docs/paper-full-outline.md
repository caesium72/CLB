# CLB-ACEL — Full End-to-End Paper Outline

> **What this file is.** A complete, section-by-section outline for the CLB-ACEL paper, written so it can be fed to
> an AI paper-writing / literature-search agent. Each section lists: (a) what to argue, (b) the claims to make and
> the exact numbers/artifacts that back them, (c) the related work to cite / search for, and (d) the figures/tables
> to include. **Companion file:** [`paper-artifacts.md`](paper-artifacts.md) (every artifact + how to (re)generate it).
> **Source of truth for facts/numbers:** [`../PROJECT_OVERVIEW.md`](../PROJECT_OVERVIEW.md).
>
> **Working title:** *Composable Accountability for Agentic Payments: Cross-Layer Binding of Identity,
> Authorization, and Settlement.*
> **Venue class:** security / systems (e.g. usable-security, blockchain/DeFi security, or an agent-economy workshop).
> **Honesty rule (non-negotiable):** never claim real USDC movement, real ERC-7710 enforcement, a canonical
> Validation Registry, or code-level (vs. protocol-level) formal proofs. See §"Threats to validity".

---

## Abstract (write last)

Compress: the gap (composing ERC-8004 + AP2 + x402 + ACP leaves an unbound seam) → the mechanism (one EIP-712
commitment `C`, `nonce = H(C)`, on-chain predicate guard for the delegated case) → the system (ACEL evidence graph +
17-rule deterministic verifier + audit anchor) → the evidence (machine-checked P1–P5, runnable baselines miss what we
catch, costs are small, live on Base Sepolia). One sentence each.

**Reusable contribution sentence (formal):** *We give a machine-checked Tamarin proof that the composed protocol
satisfies five cross-layer security properties (P1–P5) under a Dolev–Yao adversary, and show via an ablation that the
commitment's chain/domain separation is necessary — without it the prover finds a cross-chain transplant attack that
the full model provably excludes.*

---

## 1. Introduction

- **Hook:** AI agents are starting to pay each other; a stack of four protocols is converging (identity,
  authorization, settlement, checkout), each proving only its own layer.
- **Problem in one line:** no standard binds the layers together, so *composition* creates failure modes none of
  them detects alone (wrong payee, amount escalation, identity≠payer, replay, cross-chain transplant, delivery
  mismatch, unbacked feedback).
- **Insight:** bind the layers with a single EIP-712 commitment and enforce it *in-protocol* (nonce derived from it;
  on-chain predicate guard for delegated payments), then wrap it in a deterministic, auditable evidence layer.
- **Contributions (bulleted):**
  1. **CLB** — the cross-layer commitment `C`, `nonce = H(C)`, and the Mode-B on-chain predicate guard.
  2. **Five security properties P1–P5**, **machine-checked in Tamarin** (+ ProVerif cross-check) — incl. an
     attack-found→patched ablation proving chain/domain separation is load-bearing.
  3. **ACEL** — tamper-evident evidence graph + a 17-rule deterministic (non-LLM) verifier.
  4. **Evaluation** — runnable baselines (B0–B3) that *miss* attacks CLB-ACEL catches; a Five-Attacks-on-x402
     reproduction; latency/gas/storage/privacy costs; a live Base-Sepolia deployment.
- **Search prompts for the agent:** "agent payments protocol security", "AP2 mandate", "x402 HTTP 402 settlement",
  "ERC-8004 agent identity reputation validation", "agentic commerce protocol ACP", "cross-protocol composition
  attacks", "EIP-712 typed data signing", "replay / cross-chain replay protection nonce".

## 2. Background & threat model

- **2.1 The four protocols** (one paragraph each, what each owns and explicitly leaves out): ERC-8004, AP2, x402,
  ACP. Use the table in PROJECT_OVERVIEW §2.
- **2.2 Adjacent crypto building blocks:** EIP-712 domain separation, EIP-3009 transfer-with-authorization,
  ERC-7710/ERC-4337 delegation/smart accounts, Merkle commitments.
- **2.3 Threat model:** Dolev–Yao network control over the agent-to-agent channel; malicious shopping agent;
  malicious merchant; curious-but-honest facilitator; full chain visibility; replay incl. cross-chain. **Out of
  scope:** key compromise, custody/refunds, fiat rails, "agent picks the best merchant" competence.
- **Cite/search:** Dolev–Yao model; symbolic protocol analysis; "AP2 agent payments"; "x402 specification";
  "ERC-8004"; "ERC-7710 caveat enforcer"; "EIP-3009".

## 3. The composition gap (motivation)

- Enumerate the concrete cross-layer failures (PROJECT_OVERVIEW §2 bullet list) and map each to "which single layer
  would have to catch it, and why it can't."
- State the research questions:
  - **RQ1** — Which failures appear when identity + authorization + checkout/task + settlement are composed?
  - **RQ2** — Can a CLB commitment prevent identity/authorization/settlement **transplant and replay**?
  - **RQ3** — Can an evidence graph **detect** delivery/feedback/checkout inconsistencies settlement-only checks miss?
  - **RQ4** — What are the **latency, gas, storage, privacy** costs?
  - **RQ5 (formal)** — Can the composed protocol's security properties be **machine-checked**, and is the
    chain/domain separation provably necessary?

## 4. Design: Cross-Layer Binding (CLB)

- **4.1 The commitment.** `C = H(identity_ref ‖ mandate_digest ‖ settlement_descriptor)`, keccak256 over canonical
  EIP-712 typed data; `identity_ref = (chainId, registryAddr, agentId)`. Define each input.
- **4.2 In-protocol enforcement.** `nonce = H(C)` pins the transfer to one mandate (freshness/replay). Contrast with
  external monitors.
- **4.3 Mode A (human-present, exact).** Equality checks; signature over `C`.
- **4.4 Mode B (delegated, predicate).** The novel part: human signs a `SpendingPredicate`; agent later forms
  concrete params + `C'`; **on-chain `PredicatePaymentGuard.validateAndConsume`** recomputes `C'`, checks the
  predicate (payee/asset/chain/amount/expiry), and consumes the nonce once — reverting violations *before* transfer.
- **Figure:** protocol sequence diagram (Mode A and Mode B), author-drawn from PROJECT_OVERVIEW §6.1.
- **Cite/search:** "delegated authorization smart accounts", "spending limits on-chain enforcement", "session keys",
  "intent-based execution".

## 5. Formal soundness (P1–P5)  ← built from PROJECT_OVERVIEW §4.4

- **5.1 Properties.** P1 identity binding, P2 authorization integrity, P3 freshness/non-replay, P4
  non-transferability, P5 predicate soundness. State each as an English invariant **and** its Tamarin lemma form.
- **5.2 Model.** Tamarin (1.12.0), Dolev–Yao, symbolic crypto, unbounded sessions; ERC-8004 key-authorization fact;
  AP2 signature over `C`; abstract chain with a single-use `NonceUnused` linear fact; guard as a guarded transition.
  Mention the `exists-trace` sanity lemmas (no vacuous proofs).
- **5.3 Results.** The P1–P5 table (all verified) — copy from PROJECT_OVERVIEW §4.4; include the lemma↔verifier-rule
  mapping column (ties proof to implementation).
- **5.4 Attack-found → patched (the headline).** Two ablations, one per mode:
  - **Mode A** — `clb-naive.spthy` drops `chainId`: P2 holds, **P4 falsified** (cross-chain transplant); restoring
    chain/domain separation makes P4 verify. **Figure F3a** `clb-naive-P4-attack.pdf`.
  - **Mode B** — `clb-naive-modeb.spthy` removes the on-chain guard (only the predicate *signature* is checked):
    **P5 falsified** (a delegated settlement bypasses the predicate — unapproved payee / over budget); restoring the
    guard (`validateAndConsume`) makes P5 verify. **Figure F3b** `clb-naive-modeb-P5-attack.pdf`.
  - Takeaway: both the EIP-712 chain/domain separation **and** the on-chain predicate guard are *provably*
    load-bearing, not decorative.
- **5.5 Cross-tool check.** ProVerif on the off-chain sub-protocol: authentication (P2) holds, injective non-replay
  (P3) does **not** → freshness is necessarily on-chain. Two tools, one story.
- **Threats to validity (formal):** abstract protocol not code; perfect-crypto assumption; P5 ordering abstracted as
  allow-set membership (guard-placement soundness, not integer arithmetic). State explicitly.
- **Cite/search:** "Tamarin prover", "ProVerif", "symbolic verification of payment/authentication protocols",
  "injective agreement", "formal analysis EMV / TLS / Signal" (as methodology exemplars), "Five Attacks on x402".

## 6. Design: ACEL evidence layer

- **6.1 Canonical evidence event + hash chain** (`previousEventHash`), the typed node/edge **evidence graph**, and
  the Merkle `trace_root` anchored on-chain (`AgenticAuditAnchor`). Only the root goes on-chain.
- **6.2 The deterministic verifier (R1–R17).** Non-LLM, explainable, mode-aware; emits a PASS/FAIL certificate. Table
  of rules + which property each supports.
- **6.3 R14/R14b — accountability, not atomicity.** Be precise: signed `keccak256(settlementTxHash, reportHash)`
  binds the artifact to *this* settlement; does **not** claim payment↔delivery atomicity (that's A402's rail).
- **6.4 LLM is audit-only.** Reasoning recorded in `DECISION_CONTEXT`; the verifier never reads LLM output, so prompt
  injection only leaves a tamper-evident record. Separation of *auditable narrative* from *enforced binding*.
- **Figure:** the evidence graph (export a trace from `evidence-core` or screenshot the demo's Evidence screen).
- **Cite/search:** "tamper-evident logging", "Merkle audit", "verifiable credentials", "provenance graph",
  "prompt injection", "LLM agent security".

## 7. Implementation

- Bun + TypeScript monorepo; "real core, swappable adapters." Map packages → roles (PROJECT_OVERVIEW §8.1).
- Foundry contracts: `AgenticAuditAnchor`, `PredicatePaymentGuard`, `CLBCaveatEnforcer`,
  `CrossLayerBindingValidator`. TS↔Solidity `C'` parity testing.
- Live deployment on **Base Sepolia (84532)** — address table (PROJECT_OVERVIEW §8.2). LLM: Grok `grok-4.3`.
- **Honesty matrix** (PROJECT_OVERVIEW §9) — reproduce as a table; this is what makes the paper credible.

## 8. Evaluation

- **8.1 Binding-attack matrix (Mode A, B0–B3)** — every weaker stack misses ≥1 attack CLB-ACEL catches; replay is
  *prevented* in-protocol. Source: `experiments/benchmarks/attack-matrix.md` + `baseline-comparison.json`.
- **8.2 Predicate-attack matrix (Mode B / P5)** — guard prevents all four violation classes; honest note on
  *incidental* single-field catches by baselines. Source: `p5-attack-matrix.md` + `p5-results.json`.
- **8.3 Five-Attacks-on-x402 reproduction** — honest mapping (II eliminated via single-use nonce; I partially
  mitigated; III out of scope; IV mitigated when discovery is bound). Source: `five-attacks-comparison.md`. The
  **DGR collapses to 1** line is a strong figure.
- **8.4 Cost** — verifier latency p50≈3.7 ms/p95≈6.6 ms; guard gas ≈50–76k; confidential range proof ≈23.9 KB.
  Sources: `latency-report.md`, `gas-report.md`, `phase7-caveat-gas.md`, `phase7-confidential.json`, `results.csv`.
- **8.5 Privacy (confidential commit-and-prove)** — verifier discharges R11 (amount ≤ max) by 64-bit range proof
  without reading the plaintext amount; payee+amount not on-chain.
- **Figures:** baseline heatmap; latency/gas bars; DGR line. **Plot from `results.csv` — no chart images committed.**

## 9. Discussion / limitations / threats to validity

- CLB proves binding, not agent competence. ACEL provides auditability, not atomicity/auto-dispute-resolution.
- Demo settlement is a 0-value marker (prod needs EIP-3009). Guard is an ERC-7710 stand-in. Validation Registry gated
  (O1). Formal proofs are protocol-level under perfect crypto.
- LLM is never trusted for verification.

## 10. Related work (positioning — the wedge)

- *Five Attacks on x402* — payment-layer only; we reproduce their **defense** and add binding + proofs.
- *eBay-style runtime monitor* — AP2 replay/context-binding, **off-chain monitor only**; we enforce **in-protocol**
  and add the identity layer.
- *A402* — a **new atomic rail** (TEE adaptor sigs); we **bind existing rails**, complementary.
- *AP2 / x402 / ERC-8004 / ACP themselves* — each owns one layer; our novelty is the **composition boundary**.
- **Search prompts:** "x402 attacks", "agent payment replay monitor eBay", "A402 atomic settlement TEE", "delegated
  payment caveats", "cross-chain replay EIP-712 domain", "machine-checked smart contract protocol".

## 11. Conclusion & future work

- Restate: composition is where the risk lives; bind it, enforce it on-chain for delegation, audit it
  deterministically, prove it. Future: EIP-3009 real settlement; canonical ERC-7710 + Validation Registry;
  on-chain confidential settlement; extend the formal model to multi-merchant sessions.

---

## Appendix candidates

- Full Tamarin lemma listings + proof summaries (`formal/tamarin/proofs/*.proof`).
- ProVerif model + output (`formal/proverif/`).
- Full R1–R17 rule definitions.
- Complete attack matrices and raw benchmark data.

## Figure/table checklist (cross-ref to `paper-artifacts.md`)

| # | Figure / table | Source | Auto-gen? |
| --- | --- | --- | --- |
| F1 | Protocol sequence (Mode A/B) | PROJECT_OVERVIEW §6.1 | author-drawn |
| F2 | System architecture | PROJECT_OVERVIEW §8.1 | author-drawn |
| F3a | **Tamarin Mode-A attack graph** (cross-chain transplant, P4) | `formal/tamarin/proofs/clb-naive-P4-attack.pdf` | ✅ generated |
| F3b | **Tamarin Mode-B attack graph** (guard bypass, P5) | `formal/tamarin/proofs/clb-naive-modeb-P5-attack.pdf` | ✅ generated |
| F4 | Evidence graph (typed DAG) | `evidence-core` trace / demo screenshot | export/screenshot |
| F5 | Baseline heatmap (B0–B3) | `experiments/benchmarks/baseline-comparison.json` | plot from data |
| F6 | Latency & gas bars | `latency-report.md` / `gas-report.md` / `results.csv` | plot from data |
| F7 | DGR-collapse line | `five-attacks-comparison.md` | plot from data |
| T1 | P1–P5 verification table | PROJECT_OVERVIEW §4.4 | copy |
| T2 | R1–R17 rules | PROJECT_OVERVIEW §5.2 | copy |
| T3 | Honesty matrix (real vs. mock) | PROJECT_OVERVIEW §9 | copy |
| T4 | Cost table | PROJECT_OVERVIEW §10.4 | copy |
