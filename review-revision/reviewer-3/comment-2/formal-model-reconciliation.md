# R3-C2 — Formal-model reconciliation (Tamarin / ProVerif vs implementation)

**Status update (supersedes the earlier "tools unavailable" version).** Tamarin 1.12.0
and ProVerif 2.05 were obtained and actually run in this session; new model and proof
artifacts were generated and archived. Every result quoted here is tool output. The
pre-existing `.proof` / `.result.txt` files were **not** touched (hashes in §6). The
full per-item change log, exact commands and assumption/boundary table are in the
companion `formal-model-delta.md`.

---

## 1. Evidence inventory

| Artifact | Status | Content |
|---|---|---|
| `formal/tamarin/proofs/clb.proof` | **preserved, unchanged** | 632 lines, 82 `qed`, all wellformedness checks successful. Header: Tamarin 1.12.0, Maude 3.5.1, `2026-03-08 09:49:47 UTC`. Reproduced here with local Tamarin 1.12.0: all 7 lemmas verified in 2.10s. |
| `formal/tamarin/proofs/clb-naive.proof` + attack images | preserved | Mode-A chainId ablation: **P4 falsified** (cross-chain transplant). Valid for the *old* model. |
| `formal/tamarin/proofs/clb-naive-modeb.proof` + attack images | preserved | Mode-B guard ablation: **P5 falsified** (predicate bypass). Valid for the *old* model. |
| `formal/tamarin/clb.spthy` | preserved, unchanged | Original verified model (P1–P5). |
| `formal/tamarin/clb-aligned.spthy` | **NEW** | Aligned model: registration, anchored principal, C′ predicateDigest binding, actual settlement fields, failed-settlement recovery. |
| `formal/tamarin/proofs/clb-aligned.proof` + `clb-aligned.result.txt` | **NEW** | 8 lemmas verified, 8.04s, all wellformedness checks successful. |
| `formal/proverif/clb-offchain.pv` | **updated** | Now the aligned model (anchor, registration event/token, C′ binding, on-chain nonce token). Historical note in its header points to the old result. |
| `formal/proverif/clb-offchain.result.txt` | **preserved, unchanged** | Pre-alignment off-chain-only result: Q1 true, Q2 false, with two-session replay trace. |
| `formal/proverif/clb-offchain-aligned.result.txt` | **NEW** | Aligned result: Q1 true · Q2 *cannot be proved* · Q3 true · Q4 true. |

Filename note (item 60): the on-disk original is `clb-offchain.result.txt`;
`clb-offchain.pv.result.txt` (as named in the task brief) does not exist. The new file
is `clb-offchain-aligned.result.txt`. No file was renamed.

---

## 2. P1–P5 revisited against the actual authorization lifecycle (item 57)

Model references below are to the **aligned** model (`clb-aligned.spthy`); implementation
references are line-pinned to current `contracts/src/PredicatePaymentGuard.sol` (`sol:`),
`packages/` (`core:`, `adapter:`), and `packages/verifier-core/src/index.ts` (`verifier:`).

| Property | What the aligned model proves | What the code does today | Divergence |
|---|---|---|---|
| **P1** identity binding | `Register_Agent` mints `!AgentKey`; `Paid(aid,K) ⇒ KeyAuthorized(aid,K)`. | Anchored principal gate at `verifyTrace` (R2/R5); facilitator chain binding. The guard has **no `msg.sender` or payer-key check** (`sol:212-244`); `payerAgentId` is only hashed into C′ (`sol:117`). | **HIGH — model stronger than guard.** Verified in model, not a property of `validateAndConsume`. |
| **P2** authorization integrity | `Eq(verify(sig,Cp,pkH),true)` + `Eq(Cp_in,Cp)`; settled params equal human-signed C′. | `verifyMandate` with anchored signer off-chain; C′ binds `predicateDigest` and `valueAtomic` on-chain (`sol:56-59,117,127-166`). The guard verifies **no human signature** — only C′ self-consistency (`sol:225-229`). | **HIGH for the on-chain claim**; off-chain integrity is real but a separate layer. |
| **P3** freshness / non-replay | `NonceUnused` is linear; `Consumed(n)` at most once. | `consumed[nonce]` mapping (`sol:232,241`); revert-before-write; `NonceReplayRejected` and `FailedSettlementLeavesNonceUnconsumedAndRecoverable` pass. | **LOW/MEDIUM — closest match.** Cross-replica/cross-facilitator nonce store is per-instance (`adapter/index.ts`); ProVerif Q2 unproved for tool reasons. |
| **P4** non-transferability | chain, agentId and all params inside C′; `AdmitB` ties settlement to the authorized tuple. | Domain separator (`sol:77-86`), `id.chainId` in C′ (`sol:117`), `p.chainId ∈ allowedChainIds` (`sol:237`), `ChainMismatchError` at facilitator. But the three chain fields are never cross-checked on-chain. | **MEDIUM/HIGH** (`test_Gap_IdentityChainNotCrossCheckedWithSettlementChain`). |
| **P5** predicate soundness | `pd` recomputed from the **registered** config must equal the `pd` the human signed; `!Admissible` gate. Permissionless registration cannot swap content under a signed ID. | **Changed by other agents:** `predicateDigestWithExtras` is derived from the registered config and bound into C′ (`sol:137-166,225-229`), so predicate-content substitution now fails `CommitmentMismatch`; field checks at `sol:235-239`. Still no human signature in the guard; `taskHash`/agent IDs are bound by the human signature over C′ but not semantically compared to config; `evaluatePredicate` is off-chain. | **MEDIUM (improved from HIGH).** Content binding is now real on-chain; semantic taskHash enforcement and caller authentication remain gaps. |
| **P6** principal anchor (new) | `!Anchored(H)` premise; `PrincipalAnchored` action. | `verifyTrace({expectedHumanPrincipal})`; R2/R5 fail closed without it (`verifier:187-196,517-523`). | **Verifier-side only**, not in the guard contract. |
| **P7** failed settlement / recovery (new) | `NonceUnused → NonceAvailable → Consumed`; exists-trace lemma shows a failed attempt followed by success with the same nonce. | Revert before `consumed[nonce]=true` gives EVM atomicity; adversarial Solidity test proves recovery. | **Effect-level abstraction**; no cancel/release API; nonce can be front-run/burned. |

**Net conclusion:** the proofs are sound for the abstract aligned protocol and now include
the C′ `predicateDigest` binding that the code actually implements. P1/P2/P4 as stated
are still **not** properties of `PredicatePaymentGuard.sol` (no caller authentication, no
signature verification, no chain cross-check). The naive ablation counterexamples remain
valid evidence for the design choices (chainId in C, guard placement) and are not
invalidated.

---

## 3. Items 52–60 — final status

| # | Item | Status | Rationale |
|---|---|---|---|
| 52 | Align Tamarin models with actual authorization lifecycle | **VERIFIED** | New `clb-aligned.spthy`, full lifecycle, 8 lemmas verified; see delta §2/52. |
| 53 | Model predicate registration and authorization | **VERIFIED** | `Register_Predicate` + `UniquePredicateRegistration`; ProVerif Q3 true. |
| 54 | Model human-principal-to-mandate relationship | **VERIFIED** | `Anchor_Principal` + H/mandateDigest/pd inside signed C′; P6. |
| 55 | Model actual settlement operations | **VERIFIED** | named params incl. `valueAtomic`/`taskHash`/`pd`; field-level allow-set abstraction disclosed. |
| 56 | Model failed settlement and nonce recovery | **VERIFIED** | `Failed_Settle_ModeB` + `Settle_Recovered` + non-vacuous P7 exists-trace. |
| 57 | Revisit P1–P5 assumptions | **IMPLEMENTED** (documentation) | §2 of this file and delta §3 (P1–P7). |
| 58 | Regenerate and archive proof outputs | **DONE** | 3 new artifacts; originals preserved (§6); naive ablations not regenerated (delta §4). |
| 59 | Reconcile ProVerif results with updated construction | **PARTIAL** | Tools run; Q1/Q3/Q4 true; Q2 *cannot be proved* due to private-channel token abstraction — carried by Tamarin P3 + Solidity test instead. |
| 60 | Document formal-model assumptions and implementation boundaries | **IMPLEMENTED** | this file + `formal-model-delta.md`. |

**Counts:** VERIFIED/DONE 7 (52,53,54,55,56,58,60) · IMPLEMENTED-doc 1 (57) ·
PARTIAL 1 (59). The earlier "NOT DONE" marks for 52–56 and 58 are resolved.

---

## 4. ProVerif reconciliation (item 59)

The archived `clb-offchain.result.txt` models only the off-chain human→agent exchange
(Q1 true, Q2 false with an explicit two-session replay trace). That result is **still
correct for the pre-alignment model** and is preserved.

The aligned `clb-offchain.pv` additionally binds the principal anchor, mandateDigest,
predicateId and predicateDigest into C′, requires a registration token, and represents
the on-chain nonce as a private-channel token. Its archived output:

- **Q1 authentication — true.** Every `Settled` has a prior `Authorized`; this now
  reflects a signature over the fuller C′.
- **Q3 registration/content binding — true.** After fixing an initial event-ordering bug
  (the `Registered` event had been emitted after the token), no `Settled` can occur
  without a matching `Registered(pid,pd)`.
- **Q4 key secrecy — true.** `attacker(skH)` is false.
- **Q2 injective replay — cannot be proved.** ProVerif's Horn-clause abstraction of a
  private-channel token is monotone (a message can be input by multiple sessions), so it
  cannot express one-shot linear consumption. This is a tool limitation, not a found
  attack: the aligned trace shows a single `out(nonceStore,...)` consumed by the settling
  session. Injective replay is proved by Tamarin P3 (`NonceUnused` linear fact) and by the
  Solidity `NonceReplayRejected` adversarial test.

Claim scope remains: *off-chain authentication and registration binding hold; replay
resistance is an on-chain property proved in Tamarin, not by this ProVerif abstraction.*

---

## 5. Claim language that is defensible today

- **Defensible:** "Tamarin verifies P1–P7 for the aligned abstract CLB-ACEL protocol,
  including predicate-content binding through C′ and failed-settlement nonce recovery;
  naive ablations reproduce the chain-separation and guard-placement attacks; ProVerif
  independently confirms off-chain authentication, registration binding and key secrecy."
- **Not defensible:** "P1–P5 are verified for the deployed `PredicatePaymentGuard`", or
  "task substitution is prevented by the formal model" — the guard still has no caller
  authentication, no human-signature verification, no stored principal/mandate digest and
  no on-chain chain cross-check (G1–G8 in `predicate-formal-spec.md`).

---

## 6. Artifact integrity and what was not checked

```
48DFD04BDAB08AEB0BA58B7767F29C4EF384309BC60F6C7DBA792650C671661D  formal/tamarin/proofs/clb.proof
558F8E9AD7150AED42E61B3EE1E1715041B86A1853C1320B976B14A4F719C5AA  formal/proverif/clb-offchain.result.txt
5B1F899B1DD10E80BB7FFEAC06DAF2A149F8B0F05C6D298BB9F4289D9B3E0DEA  formal/tamarin/clb.spthy
```
Identical to the pre-run hashes.

- No manuscript, contract, package, script or existing proof/result file was modified.
- The naive ablation proofs were not regenerated; they are not evidence about the aligned model.
- `bun run typecheck` was run as a non-formal regression check; exact output is reported
  to the parent session and was unaffected by these documentation/model-only edits.
