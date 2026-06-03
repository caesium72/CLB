# Cross-Layer Binding (CLB) for Agentic Payments — System Design

**Scope:** A protocol-level mechanism that binds three independently-keyed layers — ERC-8004 (identity), AP2 (authorization), x402 (settlement) — so a single verifier can prove the agent that was _trusted_ is the agent that was _authorized_ is the key that _paid_, for exactly one fresh transaction. Planning only; no code.

**Status:** design draft. Decisions marked **[D]**, open questions marked **[Q]**, assumptions marked **[A]**.

---

## 1. Goal and non-goals

**Goal.** Define the data structures, message flow, trust boundaries, and verification function for an end-to-end binding that is (a) enforceable in-protocol (not by an external monitor), (b) replay- and transplant-resistant, and (c) covers the human-not-present (delegated) case via predicates, not just exact carts.

**Non-goals.**

- Not a new payment rail, not a new mandate format — CLB _reuses_ x402, AP2, ERC-8004 and adds a binding layer over them.
- Not solving custody, refunds, or dispute resolution.
- Not solving agent _capability_ trust (whether the agent is competent) — only _binding_ (the three identities/actions refer to the same transaction).
- No fiat/card path in v1 — crypto settlement only (the seam that is actually formalizable on-chain).

---

## 2. Actors and keys

| Actor                     | Key / identity                                                | Role                                                      |
| ------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| Human principal (P)       | `k_user` (and/or a DID)                                       | Signs AP2 Mandates; ultimate authority                    |
| Shopping agent (S)        | ERC-8004 `agentId`, controls `k_pay` (or delegated authority) | Proposes/executes the purchase                            |
| Merchant agent (M)        | endpoint + on-chain payment address `addr_M`                  | Sells the resource, sets x402 terms                       |
| Credentials provider (CP) | issuer key                                                    | Holds/issues AP2 payment credentials (AP2 role)           |
| Facilitator (F)           | own key, pays gas                                             | Broadcasts/settles x402 transfer; never custodies         |
| Validator (V)             | validator contract                                            | _Optional_ ERC-8004 Validation Registry attestation       |
| Verifier (Vf)             | —                                                             | Checks the binding; may be M, F, or a third-party auditor |

**[A]** `k_pay` may be an EOA or an ERC-4337/smart-contract account. The smart-account case is the interesting one (enables ERC-1271 + ERC-7710 delegation) and is the **primary** design target; EOA is the degraded fallback.

---

## 3. The three layers as-is (what CLB consumes)

- **Identity (ERC-8004):** `identity_ref = (chainId, registryAddr, agentId)` → ERC-721 → agent card (JSON on IPFS/HTTPS) listing endpoints + payment address(es). CLB requires the card (or an on-chain statement) to **authorize `addr(k_pay)`** as a spending key for `agentId`.
- **Authorization (AP2):** Intent Mandate (constraints, human-not-present), Cart Mandate (finalized cart, human-present), Payment Mandate (authorizes transfer). AP2 already hashes intent↔cart↔payment internally. CLB **extends the Payment/Intent Mandate's signed payload** to also cover `identity_ref` and settlement parameters (or a predicate over them).
- **Settlement (x402):** EVM `exact` scheme; EIP-3009 `transferWithAuthorization(from,to,value,validAfter,validBefore,nonce,sig)` for USDC, or ERC-7710 delegation for smart accounts. CLB **derives the nonce from the binding commitment** so the on-chain transfer is pinned to one mandate.

---

## 4. The binding object

Central artifact:

```
C = H( identity_ref ‖ mandate_digest ‖ settlement_descriptor )
```

- `identity_ref` = `(chainId, registryAddr, agentId)`
- `mandate_digest` = AP2's existing intent/cart hash (reused, not replaced)
- `settlement_descriptor` = depends on mode (below)

**Two modes [D]:**

**Mode A — Human-present (exact).**
`settlement_descriptor = (asset, addr_M, value, validBefore)`.
The human's Cart/Payment Mandate signature covers `C`. The x402 transfer uses `nonce = H(C)`. Verification is equality checks.

**Mode B — Human-not-present (delegated / predicate).**
At authorization time, settlement params don't exist yet. So:
`settlement_descriptor = predicate_id` where the human signs an **Intent Mandate** committing to a predicate `π` (e.g., `asset ∈ {USDC}`, `addr_M ∈ allowedSet`, `value ≤ V_max`, `now ≤ expiry`).
At settlement, the concrete `settlement_params` must satisfy `π`. Enforcement is the hard part (§6).

`H` **[D]** = keccak256 over an EIP-712 typed-data encoding so the same structure is signable off-chain and recomputable on-chain.

---

## 5. Message flow

### Flow A — Human-present

1. **Discovery/trust.** S resolves M (and/or M resolves S) via ERC-8004; Vf later re-checks `agentId` ↔ `addr(k_pay)`.
2. **Terms.** S requests resource → M returns x402 `402` with terms (asset, addr_M, value, validBefore).
3. **Cart + commit.** S assembles cart; computes `mandate_digest`; computes `settlement_descriptor`; computes `C`.
4. **Human authorization.** P signs Cart/Payment Mandate whose payload includes `C`. (k_user)
5. **Payment.** S (or CP) produces EIP-3009 authorization with `nonce = H(C)`, signed by `k_pay`.
6. **Settle.** F calls `/settle`; on-chain transfer consumes `nonce` (single-use) → `200 OK`.
7. **Verify.** Vf checks: human sig over `C` valid; `identity_ref` registered and card authorizes `addr(k_pay)`; on-chain `to/value/asset` == descriptor; `nonce == H(C)`; not previously consumed.

### Flow B — Human-not-present

1–2 as above, but P pre-signs an **Intent Mandate** binding predicate `π` and `identity_ref` (before any cart). 3. Later, S autonomously builds `settlement_params`. 4. **Predicate enforcement at settlement [D]:** express the Intent Mandate as an **ERC-7710 delegation** from P (or P's smart account) to S, carrying a **binding-commitment caveat enforcer** that, at redemption, checks `π(settlement_params) == true` and that the redeemed transfer's nonce equals `H(C')` for the freshly-formed `C'`. The transfer only executes if the caveat passes. 5. Settle + verify as in Flow A, with the extra on-chain caveat evaluation replacing the human's per-transaction signature.

**Key design insight:** Mode B converts off-chain human intent into an _on-chain-enforceable delegation_, so the binding predicate is checked by the smart account at settlement rather than trusted to the agent or an external watcher.

---

## 6. Trust boundaries and where binding can break

| Boundary                          | Risk if unbound                          | CLB defense                                                        |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| A2A transport (untrusted)         | MITM swaps cart/recipient                | `C` signed by human; descriptor immutable post-sign                |
| Off-chain VC ↔ on-chain transfer  | Mandate authorizes M but funds go to M′  | `addr_M` inside `C`; nonce = H(C) pins it                          |
| Mandate reuse across transactions | Replay / transplant                      | nonce single-use on-chain; freshness in `C`                        |
| Cross-chain replay                | Same nonce/sig replayed on chain 2       | `chainId` in `identity_ref` _and_ EIP-712 domain                   |
| Identity substitution             | Agent A's reputation, Agent B's key pays | card must authorize `addr(k_pay)`; ERC-1271 for SC accounts        |
| Facilitator (semi-trusted)        | sees metadata; could censor/reorder      | can't alter to/value (EIP-3009 signed); metadata privacy = **[Q]** |
| Delegated predicate (Mode B)      | agent pays outside constraints           | ERC-7710 caveat enforces `π` at redemption                         |

---

## 7. Verification function (abstract)

`verify(C, humanSig, identityProof, onchainTx, [delegationProof]) → {bound, reasons[]}`

Checks, in order:

1. `humanSig` (or delegation chain) validates over `C` under P's key/DID.
2. `identity_ref` resolves to a live ERC-8004 agent; card authorizes `addr(k_pay)`.
3. Recompute `C` from `onchainTx` params + `mandate_digest` + `identity_ref`; must equal committed `C`.
4. `onchainTx.nonce == H(C)`; nonce status == consumed-exactly-once.
5. Mode B: predicate `π(onchainTx.params) == true` (re-evaluated off-chain by Vf to match the on-chain caveat result).
6. Domain/`chainId` match (no cross-chain transplant).

Output is a binding certificate (the tuple + result), itself hashable into an ERC-8004 reputation/validation entry **[Q]**.

---

## 8. Threat model (for the formal analysis)

**Adversary capabilities:** controls the A2A network (Dolev–Yao), can run a malicious shopping agent, a malicious merchant, and a curious-but-honest facilitator; can observe all chain state; can replay any past message; can attempt cross-chain replay.

**Security properties to prove (injective-agreement style):**

- **P1 Identity binding:** settled payer key is authorized by the `agentId` named in the mandate.
- **P2 Authorization integrity:** settled `(asset, to, value)` equals what P authorized (Mode A) or satisfies `π` (Mode B).
- **P3 Freshness / non-replay:** each human authorization yields at most one successful settlement.
- **P4 Non-transferability:** a mandate cannot be redeemed under a different identity, merchant, chain, or amount than committed.
- **P5 (Mode B) Predicate soundness:** no settlement that violates `π` can complete.

---

## 9. Formal verification plan

- **Tool [D]:** Tamarin (handles stateful single-use nonce consumption — the crux). Fallback/cross-check: ProVerif for the pure off-chain sub-protocol.
- **Model:** agents, keys, the A2A channel, an abstract chain with a nonce-consumption state fact, the EIP-712 commitment, the ERC-7710 caveat as a guarded transition.
- **Lemmas:** P1–P5 as trace properties + injective-agreement lemmas; expect the tool to surface a transplant/cross-chain attack on a naive `C` (no `chainId`), motivating the domain-separation fix.
- **Deliverable:** either machine-checked proofs of the fixed model, or a documented attack + patched model that then verifies.

---

## 10. Evaluation plan (implementation phase, later)

- **Testbed:** x402 EVM `exact` scheme + a facilitator on Base Sepolia; AP2 reference impl (Python) for mandates; ERC-8004 reference contracts on testnet; a smart-account wallet for Mode B (ERC-4337 + ERC-7710).
- **Baselines:** (i) vanilla x402 (no binding), (ii) AP2+x402 via the existing A2A x402 extension (implementation-level binding, no proofs), (iii) the eBay-style external runtime monitor.
- **Metrics:** added settlement latency (ms), gas overhead of the caveat enforcer, verifier cost, and an attack-success-rate table reproducing known x402/AP2 exploits with vs. without CLB.
- **Target claim:** CLB blocks the binding-class attacks _in-protocol_ at bounded gas/latency overhead, where baselines (i)/(ii) fail and (iii) only mitigates externally.

---

## 11. Assumptions

- **[A1]** USDC/EIP-3009 (or a smart-account equivalent) is the settlement asset; USDT/DAI excluded in v1 (no EIP-3009).
- **[A2]** ERC-8004 agent card faithfully reflects on-chain `agentId` ownership; key-authorization statement is available on-chain or in a signed card.
- **[A3]** Human key / DID PKI is sound; key compromise is out of scope.
- **[A4]** Facilitator cannot alter signed EIP-3009 fields (protocol guarantee) but is untrusted for privacy.

---

## 12. Open questions / risks

- **[Q1]** Predicate language for Mode B: how expressive before the caveat enforcer becomes too gas-heavy or unanalyzable? (merchant allowlist + value cap + expiry is the minimal viable set.)
- **[Q2]** Metadata privacy: `C` and descriptor may leak merchant/amount on-chain or to F. Worth a confidential variant (commit-and-prove)? Possibly a second paper.
- **[Q3]** Does the binding certificate feed ERC-8004 Reputation/Validation, closing the loop to identity? Scope creep risk.
- **[Q4]** Cross-chain identity: agent registered on chain X, paying on chain Y — how does `identity_ref.chainId` interact with the settlement domain? Needs explicit resolution rule.
- **[R1] Prior-art risk:** the A2A x402 extension binds AP2→x402 at implementation level; the eBay runtime-verification paper (arXiv:2602.06345) covers AP2 replay/context-binding empirically. **Wedge:** three-layer (incl. ERC-8004 identity) + formal proofs + in-protocol enforcement via caveats. Re-check arXiv/IACR monthly; pivot if a formal cross-layer model appears.
- **[R2] Hardness risk:** Mode A is near-engineering; the contribution lives in Mode B (off-chain VC ↔ on-chain predicate enforcement) and the formal proofs. Budget effort there.

---

## 13. Milestones

1. Freeze threat model + properties P1–P5; lock Mode A/B descriptors.
2. Tamarin model of Mode A; prove P1–P4 (or extract attack → patch).
3. Extend to Mode B (ERC-7710 caveat as guarded transition); prove P5.
4. Reference implementation over real x402/AP2/ERC-8004 testnets.
5. Attack-reproduction + latency/gas benchmark vs. three baselines.
6. Write-up: model, construction, proofs, evaluation.
