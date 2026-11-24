# R3-C2 — Formal-model delta: items 52–60 (tools available, proofs actually run)

**Status change vs the prior report.** The earlier `formal-model-reconciliation.md`
marked 52–56/58 **NOT DONE** because Tamarin/ProVerif binaries were unavailable.
That condition no longer holds: both tools were obtained and run in this session.
All results below are **tool output**, not inference. The pre-existing proof and
result files were **not** modified (SHA-256 evidence in §5).

---

## 0. Tool procurement and exact commands

| Tool | How obtained | Where | Version check |
|---|---|---|---|
| Tamarin | GitHub release asset `tamarin-prover-1.12.0-linux64-ubuntu.tar.gz` (13,048,539 bytes) | WSL Ubuntu-22.04, `~/tools/tamarin/tamarin-prover` | `tamarin-prover --version` → `tamarin-prover 1.12.0` |
| Maude | `apt-get install -y maude graphviz` in WSL | system | `maude --version` → `3.1`; `dot -V` → `2.43.0` |
| ProVerif | official Windows binary `https://bblanche.gitlabpages.inria.fr/proverif/proverifbin2.05.tar.gz` | `C:\Users\Hp\AppData\Local\Temp\opencode\proverif\proverif2.05\proverif.exe` | banner `Proverif 2.05` |

Docker Desktop was installed but its daemon was not running; choco/scoop/opam/brew
were absent. The static-binary path avoided a heavyweight build.

**Baseline reproductions (sanity — tools agree with the archived record):**

```
wsl$ tamarin-prover test
  Cases: 55  Tried: 55  Errors: 0  Failures: 0
  *** TEST SUMMARY ***  All tests successful.

wsl$ tamarin-prover --prove clb.spthy          # copy in isolated dir
  exec_modeA … P5_predicate_soundness: all 7 verified  (processing time: 2.10s)

PS> proverif.exe formal\proverif\clb-offchain.pv   # pre-alignment file
  RESULT event(Settled(p)) ==> event(Authorized(p)) is true.
  RESULT inj-event(Settled(p)) ==> inj-event(Authorized(p)) is false.
```

**New runs (the ones that produced the archived artifacts):**

```
wsl$ tamarin-prover --prove clb-aligned.spthy \
       --output=proofs/clb-aligned.proof --derivcheck-timeout=0
  processing time: 8.04s
  exec_aligned_modeB (exists-trace): verified (22 steps)
  P1_identity_binding (all-traces): verified (10 steps)
  P2_authorization_integrity (all-traces): verified (18 steps)
  P3_no_replay (all-traces): verified (96 steps)
  P4_non_transferability (all-traces): verified (16 steps)
  P5_predicate_soundness (all-traces): verified (18 steps)
  P6_principal_anchor (all-traces): verified (6 steps)
  P7_failed_settlement_recovery (exists-trace): verified (25 steps)
  /* All wellformedness checks were successful. */

PS> proverif.exe formal\proverif\clb-offchain.pv
  RESULT event(Settled(pid,pd,payee,val)) ==> event(Authorized(pid,pd,payee,val)) is true.
  RESULT inj-event(Settled(pid,pd,payee,val)) ==> inj-event(Authorized(pid,pd,payee,val)) cannot be proved.
  RESULT event(Settled(pid,pd,payee,val)) ==> event(Registered(pid,pd)) is true.
  RESULT not attacker(skH[]) is true.
```

Archives: `formal/tamarin/proofs/clb-aligned.proof` (50,207 bytes),
`formal/tamarin/proofs/clb-aligned.result.txt` (full stdout),
`formal/proverif/clb-offchain-aligned.result.txt` (full stdout).

---

## 1. Implementation change → model change map

The R3-C1 fixes and the R3-C2 guard edits by other agents were read from the
current sources (not from the older reports):

| Implementation change (observed on disk) | Model change made here |
|---|---|
| `verifyTrace(opts)` takes `expectedHumanPrincipal`; R2/R5 fail closed with `HUMAN_PRINCIPAL_NOT_INDEPENDENTLY_ANCHORED` when absent (`packages/verifier-core/src/index.ts:39-46,187-196,510-523`) | `Anchor_Principal` rule + `!Anchored(H)` premise on settlement + `P6_principal_anchor` |
| `C′` now contains `predicateDigest`; TS `computePredicateDigest` / Solidity `predicateDigestWithExtras` (`clb-core/src/index.ts:227-317`; `PredicatePaymentGuard.sol:56-59,127-166`) | `pd = h(<cfg>)` recomputed from the **registered** config in `Settle_ModeB`; human signs `pd` in `Cp`; `P5_predicate_soundness` proves `pd_guard = pd_signed` |
| `extraFieldsDigest` binds `agentIdHashes` + `taskHash` into C′ (`sol:146-166`, `clb-core:200-208`) | abstract `taskHash` field included in `params` inside `Cp` |
| `valueAtomic` added to `settlementParamsDigest` (`sol:117`, `clb-core:259-285`) | `valueAtomic` is a named field in `params` inside `Cp` and in `AdmitB` |
| `ChainMismatchError` at the facilitator (`x402-adapter`) | `chain` is a named field in `Cp` and `AdmitB`; `P4_non_transferability` |
| Permissionless `registerPredicate` (`sol:94-107`) | `Register_Predicate` takes config via `In(...)`; duplicate registration restricted; ProVerif `registrar()` has no auth |
| `consumed[nonce]` single-use + revert atomicity (`sol:232,241`; adversarial test `FailedSettlementLeavesNonceUnconsumedAndRecoverable`) | `NonceUnused → NonceAvailable → Consumed` linear-token chain; `Failed_Settle_ModeB`, `Settle_Recovered`, `P7` exists-trace |

---

## 2. Per-item delta (52–60)

### 52 — Align Tamarin models with actual authorization lifecycle — **VERIFIED (with stated abstractions)**
- **Change:** new `formal/tamarin/clb-aligned.spthy` (the original `clb.spthy` and its proof are
  left untouched as the historical record). Lifecycle is now
  `Anchor_Principal`/`Register_Agent` → `Register_Predicate` → `Authorize_ModeB` →
  `Settle_ModeB` | `Failed_Settle_ModeB` → `Settle_Recovered`.
- **Why:** the old model minted `!Admissible` at delegation with no registration step and
  no independent principal anchor; it therefore could not represent the R3-C1/R3-C2 fixes.
- **Status:** all 8 lemmas verified; wellformedness checks successful (exact output §0).
- **Boundary:** the smart-contract field checks are still an allow-set abstraction
  (`!Admissible`), not a re-derivation of `_contains`/integer comparison.

### 53 — Model predicate registration and authorization — **VERIFIED**
- **Change:** `Register_Predicate` rule; digest `pd = h(<payee,asset,chain,max,until>)`
  is derived from the stored config. `UniquePredicateRegistration` restriction models
  `PredicateAlreadyRegistered`. ProVerif `registrar()` emits `Registered(pid,pd)` and a
  private-channel registration token the guard must possess.
- **Why:** registration was completely absent from `clb.spthy`; `registerPredicate` is
  permissionless in the deployed guard (`sol:94-107`). Modelling it permissionless and
  still proving content binding is the non-obvious result: binding comes from the human
  signature over C′, not from registration authority.
- **Status:** Tamarin proof verified; ProVerif Q3 (`Settled ⇒ Registered`) is **true**.

### 54 — Model human-principal-to-mandate relationship — **VERIFIED**
- **Change:** `Anchor_Principal` mints `!Anchored($H)`, `!HumanPk`, `!HumanSk`;
  `Authorize_ModeB` signs `Cp = h(<H, mandateDigest, pid, pd, params>)`, so the
  anchored principal, the mandate digest and the predicate content are one signed object.
  `P6_principal_anchor` requires every settlement to trace to `PrincipalAnchored(H)`.
- **Why:** the old model's `$H` was never connected to `mandateDigest` or `predicateId`;
  code now enforces the anchor at `verifyTrace`.
- **Status:** verified. **Boundary:** the anchor is a verifier-side fact in code, not an
  on-chain check; the model treats it as trusted setup.

### 55 — Model actual settlement operations — **VERIFIED (field-level abstraction)**
- **Change:** settlement params are now the named tuple
  `<chain, agentId, payee, asset, valueAtomic, taskHash>` plus `mandateDigest`, `pid`,
  `pd`; `Settle_ModeB` recomputes C′ from the **registered** config digest, checks
  `Eq(Cp_in, Cp)` and `Eq(verify(sig,Cp,pkH),true)`.
- **Why:** the old model used an undifferentiated 6-tuple; code now binds
  `predicateDigest` and `valueAtomic` in C′ (`sol:56-59,117,127-166`).
- **Status:** verified. **Boundary:** `network`, `value` (decimal string), `validBefore`,
  `registryAddr`, and the Solidity `abi.encode` byte layout are not modelled; C′ is a
  free collision-resistant hash.

### 56 — Model failed settlement and nonce recovery — **VERIFIED (effect-level abstraction)**
- **Change:** `Failed_Settle_ModeB` consumes `NonceUnused(nonce)` and emits
  `NonceAvailable(nonce)`; `Settle_Recovered` is the identical guard call on the recovered
  token. `P7_failed_settlement_recovery` is an `exists-trace` lemma requiring
  `FailedSettle(n) @ #f & Consumed(n) @ #s & #f < #s` — i.e. a reverted attempt is followed
  by a successful settlement with the **same** nonce.
- **Why:** the old model had no failed transition at all; code gets recovery from EVM
  revert atomicity (`consumed[nonce]` written only after all checks, `sol:234-242`).
- **Status:** verified (non-vacuous: the lemma is `exists-trace` and solved in 25 steps).
- **Boundary:** the model represents the *effect* of a revert (state restored), not EVM
  rollback semantics; a distinct fact name (`NonceAvailable`) is used to avoid an
  unbounded self-loop in the symbolic search. No cancel/release API exists in code.

### 57 — Revisit P1–P5 assumptions — **IMPLEMENTED (documentation)**
- P1–P5 re-derived against current code in §3 below; the aligned model adds P6 (anchor)
  and P7 (recovery). No claim is made that these hold line-by-line in the deployed guard.

### 58 — Regenerate and archive proof outputs — **DONE**
- New artifacts: `proofs/clb-aligned.proof`, `proofs/clb-aligned.result.txt`,
  `formal/proverif/clb-offchain-aligned.result.txt`.
- Originals `clb.proof`, `clb-offchain.result.txt` untouched — hashes in §5.
- The naive ablations (`clb-naive*.proof`) were **not** regenerated; they remain valid for
  the *old* model and are not evidence about the aligned one (see §4).

### 59 — Reconcile ProVerif results with updated construction — **PARTIAL (tool run, one query unresolved)**
- `formal/proverif/clb-offchain.pv` is now the aligned model (principal anchor in C′,
  predicate registration, `Registered` event, on-chain nonce token). Its output is in
  `clb-offchain-aligned.result.txt`.
- Q1 authentication **true** (unchanged); Q3 registration/content binding **true** (new);
  Q4 key secrecy **true** (new).
- **Q2 injective replay: "cannot be proved"** — not `false`, but unproved. Cause: ProVerif's
  Horn-clause translation models a private-channel token as a monotone message store, so
  it cannot express one-shot linear consumption. This is a known tool abstraction limit,
  not a found attack. Replay is instead proved by Tamarin P3 (linear `NonceUnused`) and by
  the Solidity `NonceReplayRejected` test. The archived off-chain-only Q2 `false` remains
  the correct result for the old model and is preserved in `clb-offchain.result.txt`.
- Initial Q3 attempts returned `false`; the cause was an event-ordering bug (the
  registrar emitted `Registered` *after* the token), fixed by moving the event before the
  token. This is disclosed so the result is reproducible.

### 60 — Document formal-model assumptions and implementation boundaries — **IMPLEMENTED**
- This file plus the rewritten `formal-model-reconciliation.md`.

**Counts:** VERIFIED/DONE 7 (52,53,54,55,56,58,60) · IMPLEMENTED-doc 1 (57) ·
PARTIAL 1 (59 — Q2 unproved in ProVerif).

---

## 3. P1–P5 (extended P1–P7): assumption vs implementation boundary

| # | Aligned-model assumption | Enforced in code today | Boundary / not modelled |
|---|---|---|---|
| **P1** identity binding | `!AgentKey(agentId,~sk)` required for `Paid` | Anchored principal gate at `verifyTrace` (R2/R5); facilitator chain binding | **Guard has no `msg.sender`/payer-key check** (`sol:212-244`). Model is stronger than the contract. |
| **P2** authorization integrity | human signature over C′ verified in the model | `verifyMandate` with anchored signer off-chain; C′ binds `predicateDigest` and `valueAtomic` on-chain (`sol:56-59,117`) | **Guard never verifies a human signature** — it checks C′ self-consistency only (`sol:225-229`). |
| **P3** freshness / non-replay | `NonceUnused` linear fact, one consume | `consumed[nonce]` single-use (`sol:232,241`), EVM atomicity, same-facilitator replay rejected | Cross-**replica**/cross-facilitator nonce store is per-instance; ProVerif Q2 unproved (§2/59). |
| **P4** non-transferability | chain + agentId + params inside C′ | `chainId` in C′ and domain separator; `ChainMismatchError` at facilitator | `id.chainId`, `p.chainId`, domain chain are **not cross-checked on-chain** (`sol:117,237`). |
| **P5** predicate soundness | `pd` from registered config must equal signed `pd`; `!Admissible` gate | `predicateDigestWithExtras` derived from **registered** config and bound in C′ (`sol:137-166,225-229`); swapping content under same ID → `CommitmentMismatch`; field checks `sol:235-239` | `taskHash`/agent IDs are bound via the human signature over C′ but **not semantically compared to config-stored expectations** on-chain; `evaluatePredicate` remains off-chain and bypassable by `settleOnChain`. |
| **P6** principal anchor (new) | `!Anchored(H)` + `PrincipalAnchored` | `expectedHumanPrincipal`, fails closed when absent (`verifier:187-196,517-523`) | Verifier-side only; not in the guard contract. |
| **P7** failed-settlement recovery (new) | revert restores a spendable nonce token | revert-before-write + `test_Adversarial_FailedSettlementLeavesNonceUnconsumedAndRecoverable` | No on-chain cancel/release API; anyone can front-run/burn the nonce (`test_Gap_AnyCallerCanFrontRunNonceConsumption`). |

**Net claim that is defensible:** *Tamarin verifies P1–P7 for the aligned abstract
protocol, including predicate-content binding via C′; ProVerif confirms off-chain
authentication, registration binding and key secrecy for the same construction.*
**Not defensible:** *"P1–P5 are verified for `PredicatePaymentGuard.sol`"* — the guard
still lacks caller authentication, human-signature verification, principal/mandate storage
and cross-field chain checks.

---

## 4. What remains NOT DONE

1. **No line-by-line TS/Solidity verification.** The model is a symbolic abstraction;
   `_contains`, `abi.encode` byte layout and decimal↔atomic derivation are outside it.
2. **ProVerif Q2 injective replay remains unproved** (tool state abstraction). Carried by
   Tamarin P3 + a Solidity test, not by ProVerif.
3. **No paired ablation for the aligned model.** The existing `clb-naive*.proof`
   counterexamples (chainId removed, guard removed) still support the *design choices*
   but were not regenerated against the aligned construction.
4. **Code gaps G1–G8 remain open** (permissionless registration, no principal/mandate
   storage, no on-chain taskHash semantics, chain cross-checks, decimal/atomic parity,
   front-running, cross-facilitator nonce store). The aligned model proves content binding
   *despite* permissionless registration; it does not prove those gaps closed.
5. **No manuscript edits** (outside this subagent's file ownership).

---

## 5. Artifact integrity (originals untouched)

```
48DFD04BDAB08AEB0BA58B7767F29C4EF384309BC60F6C7DBA792650C671661D  formal/tamarin/proofs/clb.proof
558F8E9AD7150AED42E61B3EE1E1715041B86A1853C1320B976B14A4F719C5AA  formal/proverif/clb-offchain.result.txt
5B1F899B1DD10E80BB7FFEAC06DAF2A149F8B0F05C6D298BB9F4289D9B3E0DEA  formal/tamarin/clb.spthy
```
These match the hashes recorded before the tools were run.
