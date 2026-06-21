# CLB-ACEL — Project Overview & Conference Study Guide

> **What this file is.** A self-contained study guide for the CLB-ACEL project. Read this and you should
> understand the research contribution, the methodology, what was actually built, what is real vs. mocked,
> the evaluation results, and the current state — without reading the code or the repo. It is written for a
> human preparing a conference demo, and is also legible to an LLM agent that needs the full picture.
>
> **Project codename:** CLB-ACEL · **Current branch:** `project-v3` (the live demo rebuild) · **Testnet:** Base Sepolia (chainId 84532).

---

## Table of contents

1. [One-paragraph summary](#1-one-paragraph-summary)
2. [The problem: protocol composition leaves a gap](#2-the-problem-protocol-composition-leaves-a-gap)
3. [The contribution: CLB + ACEL](#3-the-contribution-clb--acel)
4. [CLB in depth — the cryptographic binding](#4-clb-in-depth--the-cryptographic-binding)
5. [ACEL in depth — the evidence layer](#5-acel-in-depth--the-evidence-layer)
6. [End-to-end methodology (the working steps)](#6-end-to-end-methodology-the-working-steps)
7. [The live demo (current product)](#7-the-live-demo-current-product)
8. [System architecture](#8-system-architecture)
9. [What is REAL vs. adapter/mock — the honesty matrix](#9-what-is-real-vs-adaptermock--the-honesty-matrix)
10. [Evaluation & results](#10-evaluation--results)
11. [Current condition & status](#11-current-condition--status)
12. [Honest scope & limitations](#12-honest-scope--limitations)
13. [Paper framing](#13-paper-framing)
14. [Conference demo script & talking points](#14-conference-demo-script--talking-points)
15. [Likely Q&A](#15-likely-qa)
16. [Glossary & key facts to memorize](#16-glossary--key-facts-to-memorize)
17. [Paper artifacts & figures — how to generate / where to get](#17-paper-artifacts--figures--how-to-generate--where-to-get)

---

## 1. One-paragraph summary

**CLB-ACEL proves that a payment made by an AI agent can be cryptographically and auditably bound across
all the layers it touches — identity, authorization, settlement, delivery, and feedback — so that "the
agent that was trusted is the agent that was authorized is the key that paid, for exactly one fresh
transaction."** It does this by composing three emerging agent-economy standards that today each prove only
their own layer in isolation — **ERC-8004** (agent identity), **AP2** (human authorization mandates), and
**x402** (HTTP-native settlement) — and adding two things on top: (1) **CLB (Cross-Layer Binding)**, a single
EIP-712 commitment `C` that ties the three layers together and is enforced *in-protocol* (the on-chain payment
nonce is derived from `C`, and in the delegated case an on-chain guard rejects any settlement that violates the
human's signed predicate); and (2) **ACEL (Agentic Commerce Evidence Layer)**, a tamper-evident evidence graph,
a deterministic non-LLM verifier (17 rules), an on-chain Merkle audit anchor, and an attack simulator that shows
weaker baselines miss attacks that CLB-ACEL catches or prevents. The result is a working demo running on **Base
Sepolia with real on-chain identity, real LLM agents, and real reverted-on-chain rejection transactions**.

**The two claims, separated honestly:**
- **CLB** proves *binding* (transaction integrity across layers). It does **not** prove the agent made a *good*
  decision.
- **ACEL** provides *auditability and dispute evidence*. It does **not** provide payment↔delivery *atomicity* or
  automatic dispute resolution.

---

## 2. The problem: protocol composition leaves a gap

The agent economy is converging on a stack of four protocols. Each is well-designed **for its own layer**, and
each explicitly declares the others out of scope:

| Protocol | Layer it owns | What it proves | What it explicitly leaves out |
| --- | --- | --- | --- |
| **ERC-8004** | Identity / reputation / validation | Agent has a registered on-chain identity (an ERC-721 `agentId`, agent card, payment keys) | Says **payments are orthogonal / not covered** |
| **AP2** (Agent Payments Protocol) | Authorization | Human signed a mandate constraining the agent (Intent / Cart / Payment mandates) | Says the **commerce protocol details (catalog, checkout) are out of scope**; automated checkout-evidence retrieval is "future work" |
| **x402** | Settlement | An HTTP `402 Payment Required` was satisfied and settled by a facilitator | Facilitator checks **payment** only — not whether it matches a valid mandate or checkout |
| **ACP** (Agentic Commerce Protocol) | Checkout / task state | Buyer↔agent↔seller checkout session | Is a commerce protocol, **not a cross-protocol audit layer** |

**The gap is not "there is no authorization" (AP2 has that). The gap is that no standard binds these layers
together into one verifiable trace.** When you *compose* independently-keyed protocols, new failure modes appear
that none of them detects alone, because each one only checks its own slice:

- The **mandate** authorizes Merchant A, but the **x402 settlement** pays Wallet B. (Each layer is internally valid.)
- The **mandate** caps spend at 2 USDC, but the settlement is 3. (x402 doesn't read the mandate.)
- The agent whose **identity/reputation** you trusted (Agent A) is not the **key that actually paid** (Agent B).
- The same mandate/nonce is **replayed**, or **transplanted to another chain**.
- A signed receipt exists, but the **delivered artifact** is unrelated to the paid task.
- **Feedback/reputation** is posted with no verified transaction behind it.

**The standing research question the project keeps asking:**
> *What new failure mode appears when ERC-8004, AP2, x402, and ACP are composed — and can we detect or prevent it,
> and measure the cost of doing so?*

---

## 3. The contribution: CLB + ACEL

The project has two tightly-related parts. **Do not think of them as two apps.**

```
CLB  = the narrow, novel cryptographic/protocol binding (the "proof")
ACEL = the production system around it: evidence graph, deterministic verifier,
       on-chain audit anchor, attack simulator, and the evaluation/demo layer
```

### 3.1 CLB — Cross-Layer Binding (the protocol contribution)

CLB binds the three independently-keyed layers with one commitment:

```
C = H( identity_ref ‖ mandate_digest ‖ settlement_descriptor )
H = keccak256 over a canonical EIP-712 typed-data encoding
```

- `identity_ref` = `(chainId, registryAddr, agentId)` — the ERC-8004 identity
- `mandate_digest` = AP2's existing intent/cart hash (reused, not replaced)
- `settlement_descriptor` = the x402 settlement parameters (Mode A) or a predicate id (Mode B)

**Target claim:** *the agent that was trusted is the agent that was authorized is the key that paid, for exactly
one fresh transaction.* The binding is **enforced in-protocol**, not by an external monitor: the on-chain payment
nonce is set to `H(C)` so the transfer is pinned to exactly one mandate, and (Mode B) an on-chain guard re-checks
the predicate before the transfer executes.

### 3.2 ACEL — Agentic Commerce Evidence Layer (the system wrapper)

ACEL is a **"black-box recorder + deterministic verifier"** for the whole transaction. It is *not* a new payment
rail. It watches every step and builds a tamper-evident trace:

```
User intent → ERC-8004 identity → AP2 mandate → ACP-like checkout/task
            → x402 payment requirement → settlement → delivery artifact
            → verification certificate → (optional) ERC-8004 feedback
```

ACEL's claim: *a deterministic evidence graph can detect cross-protocol inconsistencies that are missed when each
protocol is verified in isolation.*

### 3.3 How they relate

| | CLB | ACEL |
| --- | --- | --- |
| Scope | Narrow cryptographic binding | Broad observability + audit |
| Output | A commitment `C`, a pinned nonce, an on-chain guard decision | An evidence graph, a Merkle root, a verification certificate |
| Enforced or observed? | **Enforced** (in-protocol, on-chain) | **Observed** (audit/detection), plus it *surfaces* CLB's enforcement |
| Paper role | The novel mechanism + formal properties | The reference implementation + evaluation |

---

## 4. CLB in depth — the cryptographic binding

### 4.1 The five security properties (the formal targets)

These are the invariants CLB is designed to guarantee. They are the spine of both the verifier and the
**machine-checked formal proofs (see §4.4)**. Adversary model: **Dolev–Yao** control of the agent-to-agent network, a malicious shopping agent, a
malicious merchant, a curious-but-honest facilitator, full visibility of chain state, and the ability to replay any
message (including cross-chain).

| ID | Property | Plain meaning |
| --- | --- | --- |
| **P1** | Identity binding | The key that paid is authorized by the ERC-8004 `agentId` named in the mandate |
| **P2** | Authorization integrity | The settled `(asset, payee, value)` equals what the human authorized (Mode A) or satisfies the signed predicate π (Mode B) |
| **P3** | Freshness / non-replay | Each human authorization yields **at most one** successful settlement (`nonce = H(C)`, consumed once) |
| **P4** | Non-transferability | A mandate cannot be redeemed under a different identity, merchant, chain, asset, amount, task, or expiry than committed |
| **P5** | Predicate soundness (Mode B) | No settlement that violates the signed predicate π can complete |

### 4.2 Mode A — Human-present (exact)

The first and simpler flow. The human is present and approves an exact payment.

- `settlement_descriptor = (asset, payTo, value, validBefore)` — concrete, known at signing time.
- The human's Cart/Payment Mandate signature **covers `C`**.
- The x402 transfer uses **`nonce = H(C)`**, so it is pinned to that one mandate.
- Verification is a set of **equality checks**: human sig over `C`, identity authorizes the payer key, settled
  params == descriptor, `nonce == H(C)`, nonce consumed exactly once, chain/domain match.

### 4.3 Mode B — Human-not-present (delegated / predicate)

The hard, novel part. At authorization time the exact settlement params **do not exist yet** — the agent will
choose them later, autonomously. So the human signs a **predicate** instead of an exact cart:

```ts
type SpendingPredicate = {
  allowedAssets:  string[];        // e.g. [USDC]
  allowedPayees:  `0x${string}`[]; // merchant allowlist
  maxValue:       string;          // spending cap
  validUntil:     string;          // deadline
  allowedChainIds: number[];
  allowedAgentIds: string[];
  taskHash?:      `0x${string}`;
};
```

- At settlement the agent forms concrete params and a fresh commitment
  `C' = H(identity_ref ‖ mandate_digest ‖ predicate_id ‖ concrete_settlement_params)`.
- **Enforcement** is the crux: the predicate is checked **on-chain by a guard contract** at settlement time
  (`PredicatePaymentGuard.sol`, a demo stand-in for an ERC-7710 caveat enforcer). The transfer only executes if
  `π(params) == true`, the payee/asset/chain/amount are in-policy, and the nonce `H(C')` has not been consumed.
- **Key design insight:** Mode B converts off-chain human intent into an **on-chain-enforceable delegation**, so the
  binding predicate is checked by the chain at settlement rather than trusted to the agent or an external watcher.

> **This is the headline of the whole project.** In the demo, a violating Mode B settlement (e.g. 9 USDC against a
> 5 USDC cap) is **broadcast and reverted on Base Sepolia** with a real, BaseScan-viewable failure
> (`AmountExceedsMax`) — not just flagged after the fact. That on-chain reverted tx *is* the proof.

### 4.4 Formal verification — machine-checked soundness (Phase 7C)

> **For the paper-writing agent.** This subsection is the self-contained source for the paper's *Formal Soundness*
> section. Everything below is backed by a committed artifact; file paths and reproduction commands are exact.
> Suggested paper section title: **"Formal Soundness of the Composed Protocol."** Do **not** overstate: the proofs
> cover the *abstract protocol under symbolic (perfect) cryptography*, not the TS/Solidity code.

**What was done.** The composed protocol is modelled in **Tamarin** (`tamarin-prover 1.12.0`) under a **Dolev–Yao**
attacker with perfect symbolic cryptography and unbounded sessions, and all five security properties P1–P5 are
**machine-checked**. The model mirrors the deployed design: Mode A `C = h(chainId, agentId, mandate, asset, payee,
value)` with `nonce = H(C)`; Mode B a settlement-time `C'` with the `PredicatePaymentGuard` modelled as a *guarded
transition* that fires only on an admissible tuple and consumes the single-use nonce once. Each model carries an
`exists-trace` sanity lemma so the security lemmas are never vacuously true.

**Result table (paper-ready — every row verified):**

| Lemma | Property | Tamarin form | Maps to verifier rule | Result |
| --- | --- | --- | --- | --- |
| **P1** | Identity binding | `Paid(aid,K) ⇒ ∃ KeyAuthorized(aid,K)` | R4 | ✅ verified |
| **P2** | Authorization integrity | `Settled(…) ⇒ ∃ Authorized(…)` | R7/R11/R12/R13 | ✅ verified |
| **P3** | Freshness / non-replay | `Consumed(n)@i & Consumed(n)@j ⇒ i=j` | R8/R9 | ✅ verified |
| **P4** | Non-transferability | `Settled(…,cid) ⇒ ∃ Authorized(…,cid)` | R10 | ✅ verified |
| **P5** | Predicate soundness (Mode B) | `SettledB(…) ⇒ ∃ AdmitB(…)` | R17 | ✅ verified |

**The headline formal result — attack-found → patched-model-proven.** An ablation model that drops `chainId` from
the commitment (`formal/tamarin/clb-naive.spthy`) keeps P2 but **falsifies P4**: Tamarin *constructs* a concrete
**cross-chain transplant** (the human authorizes for `intendedChain`, the adversary replays the signed mandate so it
settles on a different `settleChain`). Restoring the chain/domain separation (the deployed `clb.spthy`) makes P4
verify. This proves the EIP-712 chain/domain separation is **load-bearing, not decorative**. The counterexample is
committed as a rendered graph (`formal/tamarin/proofs/clb-naive-P4-attack.{pdf,svg,png}`) — **use it as a paper figure.**

A companion **Mode-B ablation** (`formal/tamarin/clb-naive-modeb.spthy`) removes the on-chain guard (settlement
verifies only the predicate *signature*, not the predicate *fields*): **P5 is falsified** — a delegated settlement
completes for params the human never admitted (e.g. unapproved payee / over budget). Restoring the guard
(`Settle_ModeB` requiring the `!Admissible` fact + single-use nonce = `PredicatePaymentGuard.validateAndConsume`)
makes P5 verify. Graph: `formal/tamarin/proofs/clb-naive-modeb-P5-attack.{pdf,svg,png}` — the Mode-B paper figure
that motivates the guard.

**Independent cross-check (ProVerif).** A ProVerif model of the *off-chain* sub-protocol
(`formal/proverif/clb-offchain.pv`, applied pi-calculus, unbounded sessions) confirms authentication (P2) holds from
the messages alone (`event(Settled) ⇒ event(Authorized)` is **true**) while injective non-replay (P3) does **not**
(`inj-event` query is **false**). This formally *locates* replay resistance in the on-chain single-use nonce `H(C)`,
not the off-chain exchange — two tools, two semantics, one consistent story.

**Honest scope (state in the paper).** (1) Proofs cover the abstract protocol logic; code-level correctness comes
from the TS↔Solidity `C'` parity tests + the deterministic verifier. (2) Perfect-crypto assumption (no primitive
breaks). (3) P5's `value ≤ max` ordering is abstracted as **allow-set membership**, so the proof establishes that
*no settlement bypasses the guard* (guard-placement soundness), not integer arithmetic — note this in a footnote.

**Artifacts & reproduction (exact):**

```
formal/tamarin/clb.spthy              # full model, P1–P5 all verified (both modes)
formal/tamarin/clb-naive.spthy        # Mode-A ablation: P2 verified, P4 falsified (transplant)
formal/tamarin/clb-naive-modeb.spthy  # Mode-B ablation: P5 falsified (settlement bypasses the guard)
formal/tamarin/replay-demo.spthy      # minimal teaching model (P3 verified vs. naive falsified)
formal/tamarin/prove.sh               # regenerates every proof artifact
formal/tamarin/proofs/*.proof         # committed proof output (text)
formal/tamarin/proofs/clb-naive-P4-attack.{pdf,svg,png}        # Mode-A cross-chain-transplant graph (paper figure)
formal/tamarin/proofs/clb-naive-modeb-P5-attack.{pdf,svg,png}  # Mode-B guard-bypass graph (paper figure)
formal/proverif/clb-offchain.pv       # ProVerif cross-check
formal/proverif/clb-offchain.result.txt        # committed ProVerif output

# reproduce:
formal/tamarin/prove.sh                          # all Tamarin lemmas (~1s)
proverif formal/proverif/clb-offchain.pv         # the cross-check
```

**Suggested contribution sentence for the abstract:** *We give a machine-checked Tamarin proof that the composed
protocol satisfies five cross-layer security properties (P1–P5) under a Dolev–Yao adversary, and show via an
ablation that the commitment's chain/domain separation is necessary — without it the prover finds a cross-chain
transplant attack that the full model provably excludes.*

---

## 5. ACEL in depth — the evidence layer

### 5.1 The canonical evidence event & the hash chain

Every service emits a signed, canonical event. The `previousEventHash` field chains them so any tampering with an
earlier event breaks every later hash.

```ts
type EvidenceEvent = {
  traceId; eventId;
  protocol: "USER" | "ERC8004" | "AP2" | "ACP" | "X402" | "CHAIN" | "DELIVERY" | "VERIFIER" | "ATTACK";
  objectType; actor; timestamp;
  objectHash;                 // keccak256(canonical_json(event_without_signature))
  previousEventHash?;         // ← the tamper-evident chain link
  publicFields;               // selectively disclosed (hashed into the trace)
  privateRef?;                // pointer to encrypted full payload (S3/DB)
  signature;
};
```

The evidence **graph** has typed nodes (USER_INTENT, ERC8004_AGENT_IDENTITY, AP2_*_MANDATE, ACP_CHECKOUT_OR_TASK,
X402_PAYMENT_REQUIREMENT/PAYLOAD, CHAIN_SETTLEMENT, DELIVERY_PROOF, VERIFICATION_CERTIFICATE, ERC8004_FEEDBACK) and
typed edges (AUTHORIZES, BINDS_TO, PAYS_FOR, SETTLES, DELIVERS, VALIDATES, RATES). A **DECISION_CONTEXT** node also
records the LLM's merchant-selection reasoning (audit-only — see 5.4).

```
event_hash = keccak256(canonical_json(event_without_signature))
trace_root = merkle_root(event_hashes)
on-chain   = anchorTrace(traceId, merkleRoot, traceHash, metadataURI)   // AgenticAuditAnchor.sol
```

Only the **root** goes on-chain — rich evidence stays off-chain (encrypted), the chain stores a tamper-timestamp.

### 5.2 The deterministic verifier (the research heart)

The verifier is **deterministic code, never an LLM**. It is explainable, testable, and mode-aware
(`MODE_A_EXACT` / `MODE_B_PREDICATE`). It outputs a PASS/FAIL certificate listing exactly which rules failed.

**Implemented rules (17 deterministic checks):**

| Rule | Checks |
| --- | --- |
| R1_HASH_CHAIN_INTACT | Event hash chain unbroken |
| R2_SIGNATURES_VALID | Every event signature verifies |
| R3_AGENT_IDENTITY_RESOLVES | ERC-8004 identity resolves to a live agent |
| R4_AGENT_PAYMENT_KEY_AUTHORIZED | Payer key ∈ agent card's authorized payment keys (**P1**) |
| R5_MANDATE_SIGNATURE_VALID | Human mandate signature valid |
| R6_CLB_COMMITMENT_RECOMPUTES | `C` recomputes from trace inputs and matches the signed `C` |
| R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR | On-chain params == committed descriptor (**P2/P4**) |
| R8_PAYMENT_NONCE_EQUALS_HASH_C | `nonce == H(C)` (**P3**) |
| R9_NONCE_CONSUMED_EXACTLY_ONCE | No replay (**P3**) |
| R10_CHAIN_DOMAIN_MATCHES | No cross-chain transplant (**P4**) |
| R11_AMOUNT_WITHIN_MANDATE | Settled value ≤ mandate max |
| R12_PAYEE_MATCHES_CHECKOUT_OR_TASK | Payee == authorized merchant |
| R13_ASSET_ALLOWED | Settled asset ∈ allowed assets |
| R14_DELIVERY_AFTER_SETTLEMENT | Delivery timestamp ≥ settlement timestamp |
| R14b_DELIVERY_BOUND_TO_SETTLEMENT | Merchant signed `keccak256(settlementTxHash, reportHash)` — the artifact is bound to **this** settlement |
| R15_TASK_HASH_MATCHES | Delivered artifact's input hash == paid task hash |
| R17_PREDICATE_TRUE_FOR_MODE_B | Predicate π holds for the concrete settlement (**P5**) |

> Two checks are handled at the **audit layer** rather than as numbered deterministic rules: *feedback must follow a
> verification certificate* (the original "R16") and *discovery must stay within `allowedPayees`* (decision-steering).
> They appear in the attack matrix as `audit:` rows.

### 5.3 R14/R14b — accountability, not atomicity (be precise here)

R14 and R14b give a verifier/court a **signed, cross-checkable claim**: "this report was issued for that on-chain
settlement." A merchant cannot later substitute a different report for the same payment without invalidating R14b.
They explicitly **do not** guarantee payment↔delivery atomicity — that is A402's domain (a different, new rail using
TEE adaptor signatures). CLB-ACEL **binds existing protocols and adds evidentiary binding**; it does not replace x402.

### 5.4 The LLM is audit-only — never trusted for verification

The shopping agent uses a **real LLM** (Grok via `GROK_MODEL`, default `grok-4.3`, or OpenAI, behind a provider
adapter, with a deterministic heuristic fallback) to: understand intent, **choose** a merchant from discovered
candidates, summarize the result, and explain the verification/feedback in plain language. That reasoning is recorded
in a `DECISION_CONTEXT` evidence node (candidates, selected merchant, rationale, model provider, prompt-injection scan).

**Crucially: the verifier never reads the LLM output.** An adversary who manipulates the agent's reasoning (e.g. via
prompt injection) cannot thereby pass verification — they can only leave a *tamper-evident record of the manipulated
rationale*. This cleanly separates **auditable narrative** from **enforced binding**, consistent with the explicit
non-goal of "agent capability trust."

### 5.5 The attack simulator & baselines

Attacks are **reproducible fixtures** (fixed seed). Each generates a full trace and an expected verifier result. The
key evaluation device is the **baseline matrix** — comparing four stacks of increasing strength:

```
B0  Vanilla x402            — payment only, no binding
B1  AP2 + x402              — mandate exists, but no nonce/commitment binding to settlement
B2  ACEL audit-only         — detects post-hoc, but does not prevent
B3  Full CLB + ACEL         — binds in-protocol; predicate-guard PREVENTS at settlement; R-rules audit
```

The research point: **every weaker stack ACCEPTs (misses) at least one cross-layer attack that full CLB-ACEL
REJECTs**, proving the binding rules and predicate semantics are load-bearing (not decorative). The three baselines
are **real runnable verifiers**, not narrative — they actually run and actually miss attacks (see §10).

---

## 6. End-to-end methodology (the working steps)

### 6.1 Normal successful trace (the happy path)

```
1.  Human creates an AP2 mandate (Mode A: exact Cart/Payment; Mode B: Intent + predicate π).
2.  Shopping agent resolves the merchant agent via ERC-8004 identity (agentId → card → payment keys).
3.  Merchant exposes a service endpoint protected by x402.
4.  Agent requests it → receives 402 Payment Required with terms.
5.  CLB computes the commitment C (Mode A) / C' (Mode B).
6.  The settlement nonce is pinned to H(C).
7.  x402 settlement happens on Base Sepolia (Mode B: the predicate guard re-checks π on-chain first).
8.  Merchant returns a signed delivery artifact (report hash bound to the settlement tx — R14b).
9.  ACEL logs every step as a signed evidence event, builds the Merkle root, anchors it on-chain.
10. The deterministic verifier runs R1–R17 → emits a PASS certificate.
11. (Optional) ERC-8004 feedback is written on-chain, pointing at the evidence anchor (not the bare payment).
```

### 6.2 Attack path

```
1.  Human mandate says (e.g.) max 2 USDC, merchant = A.
2.  A malicious agent/merchant tries to break one binding dimension (pay B, pay 3, wrong asset, replay, wrong chain…).
3.  In a weak baseline, the payment may technically settle.
4.  In CLB-ACEL:
      Mode A → the verifier flags the exact failed rule (e.g. R11_AMOUNT_WITHIN_MANDATE), trace marked INVALID.
      Mode B → the on-chain predicate guard REVERTS the settlement before it completes; R17 also fails on audit.
5.  No valid verification certificate ⇒ no valid feedback credential.
```

---

## 7. The live demo (current product)

The current branch `project-v3` is a **guided, animated, in-process demo deployed on Vercel** (the web app's
`/api/*` routes call the monorepo orchestrator/adapters directly — no separate Fastify backend at runtime), running
against **real Base Sepolia, real Grok LLM, and the real canonical ERC-8004 registry**.

### 7.1 Use case & agents

The original "token-risk report" use case was **retired from the demo** in favor of two simple, instantly-understandable
agents so any conference visitor gets it immediately:

| Role | Agent | ERC-8004 id | Wallet |
| --- | --- | --- | --- |
| Service agent #1 | **Grammar checker** (proofread/correct text) | **6827** | `0x54Db78…` (merchant) |
| Service agent #2 | **Weather** (forecast for a city) | **6823** | `0x1028D6B0…` |
| Shopping agent | **CLB-ACEL Agent Orchestrator** (buyer) | **6861** | `0x59509b7C…` |

The orchestrator has its **own** ERC-8004 identity, so **buyer ≠ merchant** (a real composition, not a self-deal).
Merchant selection is **fully LLM-driven** discovery.

### 7.2 The screens (a guided 3-act story)

The web UI walks the protocol as a narrative, with a **research-mode** toggle that exposes raw hashes/objects, and
**Mode A (sky accent) / Mode B (violet accent)** styling. Mode B **autoplays** the whole delegated run.

```
Overview  → the contribution, surfaced up front
Act 1  Intent      — human states the task, budget, allowed asset/merchant (Mode B: picks the predicate deadline)
       Discovery   — ERC-8004 identity resolution + agent card; LLM chooses the merchant (with recorded reasoning)
       Quote       — the service quote
Act 2  Mandate     — AP2 mandate + the CLB commitment C (interactive "mandate formula" panel, live prepare values)
       Checkout    — the x402 402 challenge / session
       Payment     — payment payload + on-chain settlement
Act 3  Evidence    — the evidence graph (nodes/edges; click a node for detail, incl. the reasoning DAG)
       Verifier    — PASS/FAIL with the exact rule list, plain-language explanation
       Anchor      — the Merkle root + the on-chain anchor tx
+ Attack Lab        — run attacks, baseline matrix, real on-chain Mode B rejection
+ Privacy Lab       — confidential commit-and-prove comparison
```

### 7.3 Attack Lab

- **Binding attacks (Mode A)** and **Predicate attacks (Mode B)** tabs.
- The competitor matrix runs the **three real baseline verifiers** (Vanilla x402 / AP2+x402 / eBay monitor) live —
  so the "missed by baseline, caught by CLB" cells are real outcomes, not hardcoded narrative.
- **Real on-chain Mode B rejection (the headline):** the selected scenario (PAYEE / AMOUNT / ASSET / EXPIRED / HAPPY)
  is force-broadcast to the deployed `PredicatePaymentGuard` on Base Sepolia; a violation is **mined-and-reverted**
  with the matching custom error (`AmountExceedsMax`, `PayeeNotAllowed`, `AssetNotAllowed`, `PredicateExpired`), and
  HAPPY produces a real success tx. The check order isolates one error per scenario and reverts before consuming the
  nonce, so it is repeatable.

### 7.4 Privacy Lab (confidential commit-and-prove)

Shows a two-real-transaction comparison: a naive on-chain settlement marker vs. an **anchor that publishes only a
commitment**. The confidential variant computes a value commitment, a payee commitment, and a **range proof
(value ≤ max, 64-bit)** off-chain — so the verifier discharges R11 *without ever reading the plaintext amount*, and
neither the payee nor the amount is revealed on-chain.

> **Honesty note baked into the demo:** the demo's x402 settlement does **not** move USDC — it sends a **0-value
> commitment marker** (a keccak of the authorization) to the payee EOA, with no ERC-20 Transfer event. So the amount
> is never on-chain in cleartext; only the payee leaks (as the tx `to`). A production deployment would add EIP-3009
> USDC settlement — at which point the amount *would* leak in a Transfer event, which is exactly what the confidential
> commit-and-prove variant is designed to keep private.

### 7.5 The reputation loop (feedback)

Feedback is written as **real on-chain ERC-8004 `giveFeedback`** on Base Sepolia, and the `feedbackURI` points at the
**evidence anchor** (the Merkle-root commitment), not the bare payment tx — because a settlement only proves "money
moved," whereas the anchor carries the binding. Reviews are read live from the public ERC-8004 explorer (8004scan),
filtered to the agent's `tokenId`. (The contract rejects self-feedback, so the funded client signs.)

---

## 8. System architecture

A **Bun + TypeScript monorepo**. "Real core, swappable adapters" is the standing rule: every protocol integration
sits behind an adapter so a mock can be swapped for the real SDK/contract without touching the verifier or schemas.

### 8.1 Layout (the parts that matter)

```
packages/   (the reusable core)
  schemas/          Shared Zod types (events, mandates, descriptors, certificates)
  clb-core/         The commitment C / C', EIP-712 typed data, nonce = H(C), predicate evaluation
  evidence-core/    Canonical JSON, event hashing, the hash chain, Merkle root
  verifier-core/    The deterministic rules R1–R15 + R14b + R17 (mode-aware)
  ap2-adapter/      AP2-style mandates (Intent / Cart / Payment), predicate mandates
  x402-adapter/     x402 client/server + facilitator (local / HTTP / on-chain modes)
  erc8004-adapter/  Identity reader — mock OR canonical (live Base Sepolia registry)
  predicate-adapter/Mode B predicate guard / caveat adapter (ERC-7710 stand-in)
  delivery-core/    Report hashing + delivery binding (R14b)
  attack-core/      Attack fixtures + the B0–B3 baseline matrix (Mode A + Mode B/P5)
  anchor-core/      Audit-anchor contract client
  llm-adapter/      Grok/OpenAI behind a provider interface + heuristic fallback

apps/
  web-demo/         Next.js UI + in-process /api/demo/* routes (the deployed demo)
  agent-orchestrator/  The shopping agent: Mode A (runHumanPresent) + Mode B (runDelegated) flow
  merchant-agent-api/  x402-protected service endpoint(s)

services/  (standalone Fastify versions, used for the multi-service evaluation; the demo runs in-process)
  evidence-service · identity-service · mandate-service · verifier-service · attack-simulator

contracts/  (Foundry)
  AgenticAuditAnchor.sol        — anchors (traceId, merkleRoot, traceHash, metadataURI); one per traceId
  PredicatePaymentGuard.sol     — Mode B on-chain enforcement; validateAndConsume re-checks π + consumes nonce
  CLBCaveatEnforcer.sol         — ERC-7710-style caveat seam
  CrossLayerBindingValidator.sol— Phase 7E: turns a PASS certificate into an on-chain validation entry
  MockERC8004IdentityRegistry.sol — offline/test fallback behind the same interface

experiments/   benchmarks (attack matrices, gas, latency, confidential), five-attacks reproduction, risk-scoring
```

### 8.2 What is deployed on Base Sepolia (chainId 84532)

| Thing | Address (prefix) | Role |
| --- | --- | --- |
| Canonical ERC-8004 **Identity** Registry | `0x8004A8…` | Live registry; the demo's agents resolve from it (no mock on the happy path) |
| `AgenticAuditAnchor` | `0x9ED52C…` | Merkle-root evidence anchor |
| `PredicatePaymentGuard` | `0x201835…` | Mode B on-chain rejection (real reverted txs) |
| ERC-8004 **Reputation** Registry | `0x8004B6…` | Real `giveFeedback` writes |
| x402 test asset (USDC-like) | `0x036CbD…` | Settlement asset reference |

LLM: `LLM_PROVIDER=grok`, `GROK_MODEL=grok-4.3`. Facilitator: `X402_FACILITATOR_MODE=chain`. Traces/intents persist
in Neon Postgres so the proof pages survive serverless cold starts on Vercel.

---

## 9. What is REAL vs. adapter/mock — the honesty matrix

**This is the single most important table for conference Q&A.** Being precise here is what makes the work credible
rather than a "blockchain AI" demo.

| Capability | Status in the demo |
| --- | --- |
| ERC-8004 **identity** | **REAL** — live canonical registry on Base Sepolia; agents visible on public explorers (8004scan / 8004agents.ai) |
| LLM agent reasoning / discovery | **REAL** — Grok `grok-4.3` (heuristic only as fallback); audit-only, never trusted for verification |
| CLB commitment `C` / nonce binding | **REAL** — EIP-712, computed and verified deterministically; TS↔Solidity `C'` parity tested |
| Mode B on-chain predicate enforcement | **REAL** — `PredicatePaymentGuard` on Base Sepolia; violations **mined-and-reverted** (BaseScan-viewable) |
| Evidence anchor (Merkle root on-chain) | **REAL** — `AgenticAuditAnchor` on Base Sepolia |
| ERC-8004 **feedback** (read + write) | **REAL** — on-chain `giveFeedback`; reviews read from the live explorer |
| Deterministic verifier R1–R17 | **REAL** — runs on every trace |
| Baseline verifiers (B0/B1/B2) | **REAL** — three runnable verifiers, actually miss attacks live |
| x402 **settlement** | **PARTIAL / honestly labelled** — a **0-value commitment marker**, not a USDC transfer. Prod needs EIP-3009 |
| Mode B guard as ERC-7710 caveat | **ADAPTER** — `PredicatePaymentGuard` is a demo stand-in; real ERC-7710/4337 delegation is the production seam |
| ERC-8004 **Validation** Registry (Phase 7E economic loop) | **GATED** — no canonical Validation Registry exists on any chain yet (open item **O1**). The project ships its **own** `CrossLayerBindingValidator.sol` as the real on-chain target, **pre-wired against the confirmed canonical ABI** so it lights up as a config flip the day O1 resolves |
| Formal (Tamarin) proofs P1–P5 | **REAL (machine-checked)** — `formal/tamarin/clb.spthy` verifies P1–P5 under Dolev–Yao (Tamarin 1.12.0); the `clb-naive.spthy` ablation falsifies P4 (cross-chain transplant) then the domain-separated model verifies it — an attack-found→patched result. ProVerif cross-check (`formal/proverif/`) confirms P2 holds off-chain while P3/replay-resistance is on-chain. Scope: abstract protocol, perfect crypto |
| Confidential commit-and-prove | **REAL (off-chain)** — range proof + commitments computed; on-chain confidential settlement is the next step |

---

## 10. Evaluation & results

### 10.1 Mode A binding-attack matrix (B0–B3)

Ten binding attacks; `Allowed` = missed, `Detected`/`Prevented` = caught. Baselines B0 (vanilla x402) and B1
(AP2+x402) **miss every binding attack**; ACEL audit (B2) **detects all**; full CLB+ACEL (B3) detects all and
**prevents** replay in-protocol.

| Attack | B0 | B1 | B2 | B3 |
| --- | --- | --- | --- | --- |
| PAYEE_SUBSTITUTION / AMOUNT_ESCALATION / ASSET_SWITCH | Allowed | Allowed | Detected | Detected |
| CHAIN_TRANSPLANT / AGENT_IDENTITY_SWAP / CART_OR_TASK_SWITCH | Allowed | Allowed | Detected | Detected |
| PAYMENT_WITHOUT_DELIVERY / FAKE_FEEDBACK / PROMPT_INJECTION_SELECTION | Allowed | Allowed | Detected | Detected |
| **MANDATE_REPLAY** | Allowed | Allowed | Detected | **Prevented** |

### 10.2 Mode B predicate-attack matrix (P5 — predicate soundness)

| Scenario | B0 | B1 | B2 | B3 (guard + R17) |
| --- | --- | --- | --- | --- |
| Stay within limits (happy path) | Allowed | Allowed | Allowed | **Allowed** ✅ |
| Pay an unapproved merchant | Allowed | Allowed | Detected | **Prevented** |
| Spend above the limit | Allowed | Allowed | Detected | **Prevented** |
| Pay with the wrong token | Allowed | Allowed | Detected | **Prevented** |
| Settle after the deadline | Allowed | Allowed | Detected | **Prevented** |

> Honest nuance: because a Mode B mandate mirrors the predicate fields into `mandate.constraints` for AP2
> compatibility, the AP2+x402 and eBay-monitor baselines can *incidentally* catch a single field (e.g. payee) — but
> each still misses the dimensions it doesn't check, and **none binds the full predicate to the settlement commitment
> `C'` or prevents it on-chain.** Only CLB-ACEL evaluates the predicate as one cryptographically-bound rule and
> prevents the violation in-protocol.

### 10.3 "Five Attacks on x402" reproduction (arXiv:2605.11781)

Honest mapping (their offense numbers from their committed artifact; the project reproduces only the **defense**):

| Their attack | CLB-ACEL result | Mechanism |
| --- | --- | --- |
| I-A/I-B optimistic-grant / settlement preemption | **Partially mitigated** | `nonce = H(C)` + R8/R9 pin a grant to one settlement; the web-layer timing window itself is not removed |
| **II replay / missing idempotency** | **Eliminated** | single-use nonce + R9 consume-once. Their DGR (deliveries-granted-ratio) goes 1→1, 5→5, 10→10, 50→50 (no idempotency); under R9 it **collapses to 1** |
| III proxy/cache header manipulation | **Out of scope** | web/HTTP-layer; cite the authors' own `Cache-Control` fix |
| IV server-selection manipulation | **Mitigated when discovery is bound** | ERC-8004 identity + decision-layer instrumentation make merchant choice auditable against `allowedPayees`; not a claim of agent "competence" |

### 10.4 Cost (latency / gas / storage / privacy)

| Metric | Value |
| --- | --- |
| Verifier latency | **p50 ≈ 3.7 ms, p95 ≈ 6.6 ms** (10 fixtures) |
| Settlement-replay check | p50 ≈ 1.5 ms |
| `PredicatePaymentGuard.validateAndConsume` gas | **≈ 50–53k** (forge avg) / **76k** live Anvil happy path — C' recompute + predicate + single-use nonce |
| Mode B violation | reverts with `AmountExceedsMax` / etc. **before any transfer**; replay reverts with `NonceAlreadyConsumed` |
| Confidential variant | range proof 64-bit, ≈ 23.9 KB; payee & amount **not** revealed on-chain; verifier discharges R11 by range proof with `readPlaintextAmount = null` |

**One-line takeaway for slides:** *CLB adds cross-layer binding in-protocol for ~50–76k gas and single-digit-
millisecond verification, while every weaker baseline misses at least one composition attack it catches.*

---

## 11. Current condition & status

- **All seven planned demo phases (P0–P7) are complete and committed on `project-v3`.** The demo is an in-process-
  on-Vercel app with the two real agents, LLM-driven discovery, the guided 3-act story, the Attack Lab (incl. real
  on-chain Mode B rejection), and the Privacy Lab.
- **Live and verified on Base Sepolia:** Mode A and Mode B end-to-end runs; the on-chain predicate-guard rejection;
  the audit anchor; real ERC-8004 feedback read+write; the canonical identity resolution.
- **v2 / Phase 7 research hardening** (the conference-paper track) is largely landed: 7A on-chain predicate
  enforcement (headline), 7B real identity + evidentiary delivery (R14b), 7D composition evaluation with runnable
  baselines + Five-Attacks reproduction, 7E economic loop (canonical-ready validator), **7C Tamarin formal proofs
  (done — P1–P5 machine-checked in `formal/tamarin/clb.spthy`, plus the chainId-ablation attack-found→patched result
  and a ProVerif cross-check)**. Remaining stretch/optional items: **7F confidential on-chain settlement** (off-chain
  part done), **7G paper consolidation** (in progress — `docs/paper-outline.md`).
- **Known caveats** (not regressions): the demo's settlement is a 0-value marker (EIP-3009 USDC is the prod step); the
  Validation-Registry canonical path is gated on O1; a full `bun test` shows env-driven failures because Bun auto-loads
  the live `.env` (run targeted suites for a green signal); end-to-end durable trace verification by a third party needs
  the persisted-trace + public verify page (Neon persistence landed; the public verify page is the remaining gap).

---

## 12. Honest scope & limitations

**State these proactively at the conference — they make the work stronger, not weaker.**

- **CLB proves binding, not agent competence.** It cannot prove the agent picked the *best* merchant — only that what
  happened was consistent with auditable constraints.
- **ACEL provides auditability, not automatic dispute resolution**, and **not payment↔delivery atomicity** (that's
  A402's domain via a new rail; CLB-ACEL binds *existing* protocols).
- **The LLM is never trusted for verification** — only for planning/explanation; the verifier is deterministic.
- **The demo settlement is a commitment marker, not a USDC transfer** — production needs EIP-3009.
- **Mode B's guard is an ERC-7710 stand-in**, clearly labelled; real smart-account delegation is the production seam.
- **Formal proofs (P1–P5) are machine-checked** in Tamarin (`formal/tamarin/`), but cover the **abstract protocol
  under perfect (symbolic) cryptography** — not the TS/Solidity line-by-line (that comes from the parity tests +
  deterministic verifier).
- **No canonical ERC-8004 Validation Registry exists yet** — the economic loop ships against the project's own
  validator, pre-wired to flip to canonical.
- Out of scope by design: key compromise, custody/refunds, fiat/card rails, and "solving agentic-commerce security."

---

## 13. Paper framing

**Working title:**
> *Composable Accountability for Agentic Payments: Cross-Layer Binding of Identity, Authorization, and Settlement.*

**Research questions:**
- **RQ1** — Which failures appear when agent identity, authorization, checkout/task state, and settlement are composed
  across emerging protocols?
- **RQ2** — Can a CLB commitment prevent identity/authorization/settlement **transplant and replay**?
- **RQ3** — Can an evidence graph **detect** delivery/feedback/checkout inconsistencies that settlement-only checks miss?
- **RQ4** — What are the **latency, gas, storage, and privacy** costs of adding this layer?

**Main contribution statement:**
> We define and evaluate a cross-layer binding mechanism and evidence graph for agentic payments, binding ERC-8004
> identity, AP2-style authorization, x402 settlement, ACP-like task/checkout state, and delivery evidence into a single
> verifiable trace — enforced in-protocol for the delegated case and audited deterministically end-to-end.

**Positioning vs. related work (the wedge):**
- *Five Attacks on x402* — attacks the payment layer only; CLB-ACEL **reproduces their defense** and adds the binding.
- *eBay-style runtime monitor* — AP2 replay/context-binding, **off-chain external monitor only**; CLB enforces
  **in-protocol** and adds the ERC-8004 identity layer.
- *A402* — a **new atomic rail** (TEE adaptor signatures); CLB-ACEL **binds existing rails**, complementary not competing.
- *AP2 / x402 / ERC-8004 / ACP themselves* — each owns one layer; the novelty is **the composition boundary**.

---

## 14. Conference demo script & talking points

**The 90-second pitch:** "Four protocols are converging for AI-agent payments — identity, authorization, settlement,
checkout — but each only checks its own layer. When you compose them, new failure modes appear: the agent you trusted
isn't the key that paid; the mandate said 2 dollars but the settlement was 3; the receipt is real but the delivery is
unrelated. We add one EIP-712 commitment that binds identity + authorization + settlement, derive the payment nonce
from it, and — for delegated payments — enforce the human's spending predicate **on-chain** so a violating payment is
literally reverted on the blockchain. Around that we build an evidence graph and a 17-rule deterministic verifier that
catches the inconsistencies single-protocol checks miss. It's running live on Base Sepolia with real agents."

**Live demo arc:**
1. **Mode A** — create an intent, watch ERC-8004 discovery + the LLM's recorded reasoning, sign the mandate (see `C`),
   pay, then open the **evidence graph** and the **PASS verifier certificate**; open the **anchor tx** on BaseScan.
2. **Attack Lab** — flip one dimension (e.g. amount) and show the **baseline matrix**: B0/B1 accept, CLB-ACEL rejects
   with the exact rule.
3. **Mode B headline** — autoplay a delegated run, then trigger an over-budget settlement and show the **real reverted
   transaction on Base Sepolia** (`AmountExceedsMax`). *"That's not a flag after the fact — the chain refused it."*
4. **Privacy Lab** — show the commitment-only anchor and the range proof (amount never revealed) vs. a naive settlement.
5. **Feedback** — show on-chain ERC-8004 feedback pointing at the evidence anchor.

**Numbers to have ready:** ~3.7 ms p50 verification; ~50–76k gas for the guard; replay DGR collapses to 1; payee+amount
hidden in the confidential variant; agents `6827`/`6823`/`6861` live on Base Sepolia.

---

## 15. Likely Q&A

- **"Is the payment real USDC?"** — No. The demo settles a **0-value commitment marker**; production needs EIP-3009
  USDC. *Everything else* on-chain is real (identity, guard rejection, anchor, feedback). This is stated openly.
- **"Isn't this just integrating four protocols?"** — Integration is engineering. The contribution is the **binding at
  the composition boundary** + **in-protocol predicate enforcement** + the **deterministic cross-layer verifier**, with
  an evaluation showing baselines miss what it catches.
- **"Does the LLM verify anything?"** — Never. It plans/explains; the deterministic verifier decides. Prompt injection
  can only leave a tamper-evident record, not pass verification.
- **"How is Mode B enforced, not just detected?"** — An on-chain guard re-checks the human's predicate at settlement
  and **reverts** violations before any transfer (real reverted tx on Base Sepolia).
- **"What about delivery atomicity?"** — Explicitly **not** claimed. R14/R14b give accountability/dispute evidence;
  atomicity is A402's separate rail.
- **"ERC-7710? Real ERC-8004 validation?"** — The guard is a labelled ERC-7710 **stand-in**; the validation loop is
  **canonical-ready but gated** because no canonical Validation Registry exists yet (O1).
- **"Are the baselines strawmen?"** — They're **runnable** verifiers, and the matrix is honest about where a baseline
  *incidentally* catches a single field.

---

## 16. Glossary & key facts to memorize

| Term | Meaning |
| --- | --- |
| **CLB** | Cross-Layer Binding — the commitment `C = H(identity_ref ‖ mandate_digest ‖ settlement_descriptor)` tying identity + authorization + settlement |
| **ACEL** | Agentic Commerce Evidence Layer — evidence graph + deterministic verifier + audit anchor + attack simulator |
| **C / C'** | The CLB commitment (Mode A: over exact params; Mode B: over the predicate + concrete params at settlement) |
| **nonce = H(C)** | The settlement nonce is derived from the commitment, pinning the payment to one mandate (freshness/replay defense) |
| **Mode A** | Human-present, exact payment — equality checks |
| **Mode B** | Human-not-present, delegated — human signs a **predicate**, enforced **on-chain** at settlement (the novel part) |
| **P1–P5** | Identity binding, Authorization integrity, Freshness/non-replay, Non-transferability, Predicate soundness |
| **R1–R17** | The deterministic verifier rules (R1–R15 + R14b + R17 implemented; R16/feedback + decision-steering are audit-level) |
| **B0–B3** | Baselines: vanilla x402 / AP2+x402 / ACEL audit-only / full CLB+ACEL |
| **AgenticAuditAnchor** | Contract storing `(traceId, merkleRoot, traceHash, metadataURI)` — one anchor per trace |
| **PredicatePaymentGuard** | Contract enforcing Mode B predicates on-chain (`validateAndConsume`); a demo ERC-7710 stand-in |
| **DECISION_CONTEXT** | The evidence node recording the LLM's merchant-selection reasoning — **audit-only** |
| **R14b** | "Merchant signed `keccak256(settlementTxHash, reportHash)`" — binds the delivered artifact to *this* settlement |
| **O1** | The open item: no canonical ERC-8004 Validation Registry is deployed yet → the economic loop uses the project's own validator |
| **Agents** | Grammar `6827`, Weather `6823`, Orchestrator/buyer `6861` — all live on Base Sepolia (chainId 84532) |
| **Stack** | Bun + TypeScript monorepo · Next.js demo · Foundry contracts · Grok `grok-4.3` LLM · Base Sepolia · Neon Postgres |

**The two sentences to never get wrong:**
1. *CLB proves the transaction is **bound** (same trusted = authorized = paid, once, freshly) — it does not prove the
   agent chose **well**.*
2. *ACEL provides **auditability and dispute evidence** — it does not provide payment↔delivery **atomicity** or automatic
   dispute resolution.*

---

## 17. Paper artifacts & figures — how to generate / where to get

> **For the paper-writing agent.** This is the catalogue of figures/tables the paper can use, **where each comes from**,
> and **the exact command to (re)generate it**. Prefer regenerating from the listed source over inventing numbers.
> Tooling already installed locally: `tamarin-prover 1.12.0`, `proverif 2.05`, GraphViz `dot` 15.0.

### 17.1 Formal attack-trace graph (Tamarin) — **the marquee figure**

- **What it is:** the cross-chain-transplant counterexample that falsifies P4 in the no-`chainId` ablation. A clean
  node/edge graph showing the human authorizing for `intendedChain` while the adversary replays so it settles on a
  different `settleChain`.
- **Where:** `formal/tamarin/proofs/clb-naive-P4-attack.png` (already committed; 858×671 PNG).
- **Regenerate / re-style:**
  ```
  tamarin-prover --prove formal/tamarin/clb-naive.spthy \
     --output-dot=formal/tamarin/proofs/clb-naive-P4-attack.dot --with-dot=$(which dot)
  dot -Tpng formal/tamarin/proofs/clb-naive-P4-attack.dot -o clb-naive-P4-attack.png   # or -Tpdf / -Tsvg for vector
  ```
  Use `-Tpdf` or `-Tsvg` for a crisp vector figure in LaTeX. The `.dot` is editable (relabel/recolour) before rendering.
- **Caption to use:** *"Tamarin-found cross-chain transplant: with `chainId` omitted from the commitment, a signed
  mandate authorized for one chain is replayed to settle on another. Re-adding chain/domain separation makes the
  property verify (P4)."*

### 17.2 Formal proof-tree / interactive exploration (Tamarin)

- **What it is:** the proof tree for a verified lemma (e.g. P3), useful as a supplementary figure or appendix.
- **How:** `tamarin-prover interactive formal/tamarin/clb.spthy` → open `http://127.0.0.1:3001` → pick a lemma →
  the dependency/proof graph renders in-browser and can be exported as PNG/SVG. Text proofs are in
  `formal/tamarin/proofs/*.proof`.

### 17.3 Results tables (formal + empirical) — copy-ready

- **P1–P5 verification table:** §4.4 above.
- **Mode A binding-attack matrix (B0–B3):** §10.1, source data `experiments/benchmarks/attack-matrix.md` +
  `baseline-comparison.json`.
- **Mode B / P5 predicate matrix:** §10.2, source `experiments/benchmarks/p5-attack-matrix.md` + `p5-results.json`.
- **Five-Attacks reproduction:** §10.3, source `experiments/benchmarks/five-attacks-comparison.md`.
- **Cost (latency/gas/storage/privacy):** §10.4, source `experiments/benchmarks/latency-report.md`,
  `gas-report.md`, `phase7-caveat-gas.md`, `phase7-confidential.json`, `results.csv`/`results.json`.
- **Regenerate the empirical numbers:** the benchmark suites under `experiments/` write these files (see
  `experiments/benchmarks/README.md`); `results.csv` is the tidy source for any bar/line chart.

### 17.4 Charts from the benchmark data (you must plot these — no chart images are committed)

- **Source of truth:** `experiments/benchmarks/results.csv` / `results.json` (+ the per-topic JSONs above).
- **Suggested figures:** (a) verifier latency p50/p95 bar; (b) guard gas bar; (c) the "missed-by-baseline vs.
  caught-by-CLB" matrix as a heatmap; (d) the replay **DGR collapses to 1** line (1→1/5→5/10→10/50→50 vs. CLB flat 1).
- **How:** load the CSV/JSON and plot with matplotlib/Vega-Lite. There is **no committed chart image** — generate from data.

### 17.5 ACEL evidence-graph figure (the typed node/edge DAG)

- **What it is:** the per-trace evidence graph (USER_INTENT → … → VERIFICATION_CERTIFICATE, with the DECISION_CONTEXT
  reasoning node) — see §5.1 for the node/edge vocabulary.
- **Where it lives:** rendered live in the demo's **Evidence** screen (`apps/web-demo`); the graph is built by
  `packages/evidence-core` from a trace. For a paper figure, export a trace's nodes/edges to JSON and render with
  GraphViz/Mermaid, **or** screenshot the demo's Evidence screen in research-mode.
- **Note:** this is a *system* figure (illustrates the architecture), distinct from the *formal* attack graph in 17.1.

### 17.6 Protocol / sequence & architecture diagrams (author-drawn)

- The happy-path and attack-path step lists (§6.1/§6.2) and the architecture layout (§8.1) are the source for a
  sequence diagram and a system-architecture diagram. These are **not auto-generated** — draw them in
  TikZ/Mermaid/draw.io from those sections. The on-chain address table is §8.2.

### 17.7 On-chain evidence (screenshots, not generated)

- Real BaseScan transactions (Mode B revert `AmountExceedsMax`, the audit anchor, ERC-8004 feedback) are demo-time
  artifacts — capture as screenshots with the tx hash visible. Addresses/agent ids in §8.2 / §16.
```
