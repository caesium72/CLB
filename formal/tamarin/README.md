# Formal proofs (Tamarin) — Phase 7C

Machine-checked soundness of the **composed** CLB-ACEL protocol under a
Dolev–Yao attacker with perfect (symbolic) cryptography. This answers the
reviewer question *"Five-Attacks has proofs and you don't"* by proving — not
just testing — that the five security properties hold against **all** attacker
behaviours, not only the attacks in `packages/attack-core`.

## What is proven (target)

| Lemma | Property | Plain meaning | Maps to verifier rule |
| --- | --- | --- | --- |
| **P1** | Identity binding | the key that paid is authorized by the ERC-8004 `agentId` in the mandate | R4 |
| **P2** | Authorization integrity | settled `(asset, payee, value)` = committed (Mode A) / satisfies π (Mode B) | R7 / R17 |
| **P3** | Freshness / non-replay | each authorization yields ≤ 1 settlement (`nonce = H(C)`, consumed once) | R8 / R9 |
| **P4** | Non-transferability | a mandate can't be redeemed under a different identity/chain/asset/amount/expiry | R10 |
| **P5** | Predicate soundness (Mode B) | no settlement that violates the signed predicate π can complete | R17 |

The model mirrors the deployed design: `C = EIP712(identityRef{chainId,
registryAddr, agentId}, mandateDigest, settlementDigest)`, `nonce = H(C)`
(Mode A); `C' = EIP712(identityRef, mandateDigest, predicateId,
settlementParamsDigest)`, with the `PredicatePaymentGuard` modelled as a
guarded transition (Mode B).

> **Scope (honest):** Tamarin proves the **abstract protocol logic**, not the
> TypeScript/Solidity line-by-line, and assumes perfect cryptography. Code-level
> correctness comes from the TS↔Solidity `C'` parity tests and the
> deterministic verifier. A `verified` result is only as strong as the model —
> which is why every model includes an `exists-trace` sanity lemma so the
> security lemmas are never vacuously true.

## Install

```bash
# Tamarin (note: from the project's own tap, which must be trusted first on brew >= 5.1):
brew trust tamarin-prover/tap
brew install tamarin-prover/tap/tamarin-prover   # pulls Maude + GraphViz
tamarin-prover test                              # sanity-check the install

# ProVerif (via opam; not packaged for Homebrew). gtk+ is for its optional GUI:
brew install opam pkgconf expat gtk+
opam init -y --disable-sandboxing && eval "$(opam env)"
opam install -y proverif --assume-depexts        # installs proverif 2.05
```

## Run

```bash
# the hello-world replay model (fast):
tamarin-prover --prove formal/tamarin/replay-demo.spthy

# the full model (slower):
tamarin-prover --prove formal/tamarin/clb.spthy
```

Expected for `replay-demo.spthy`:

```
sane_settle      verified     # honest settlement is reachable
no_replay        verified     # CLB design: nonce consumed once
naive_no_replay  falsified    # baseline without a nonce: replay succeeds
```

The `falsified` line is intentional and load-bearing: it is the
**attack-found** half of the "attack-found → patched-model-proven" narrative
(see the cross-chain transplant ablation for P4 in `clb.spthy`).

## Results (machine-checked)

`clb.spthy` — the full composed protocol, all properties **verified**:

```
exec_modeA              verified     # honest Mode A settlement reachable (not vacuous)
exec_modeB              verified     # honest Mode B settlement reachable (not vacuous)
P1_identity_binding     verified     # paid key is an authorized key of the committed agentId
P2_authorization_integrity verified  # settled (payee,asset,value) == authorized
P3_no_replay            verified     # each nonce H(C) consumed at most once (Mode A + B)
P4_non_transferability  verified     # identity + chain bound; no transplant
P5_predicate_soundness  verified     # no Mode B settlement bypasses the guard
```

`clb-naive.spthy` — the ablation (chainId removed from `C`): **attack-found → patched**:

```
P2_authorization_integrity verified  # payee/asset/value still bound
P4_non_transferability  falsified    # cross-chain transplant trace found
```

Patching the model (adding chainId back = `clb.spthy`) makes P4 verify. This is
the publishable result: the deployed design's chain/domain separation is
**load-bearing, not decorative**.

`replay-demo.spthy` — teaching/sanity model: `no_replay` verified for the CLB
nonce design, `naive_no_replay` falsified for a baseline without a nonce.

## ProVerif cross-check (`../proverif/clb-offchain.pv`)

Independent confirmation in a different tool (applied pi-calculus, unbounded
sessions) on the **off-chain** mandate exchange:

- **Q1 authentication (P2):** `event(Settled) ==> event(Authorized)` — **true**.
- **Q2 injective non-replay (P3):** `inj-event(...) ==> inj-event(...)` — **false**.

The Q2 "false" is intentional and agrees with Tamarin: replay resistance comes
from the **on-chain single-use nonce** `H(C)`, not the off-chain messages. Two
tools, one consistent story. Run: `proverif formal/proverif/clb-offchain.pv`.

## Files

| File | Role |
| --- | --- |
| `replay-demo.spthy` | minimal teaching/sanity model: P3 verified for CLB, falsified for the naive baseline |
| `clb.spthy` | the full model + lemmas P1–P5 (all verified) |
| `clb-naive.spthy` | Mode-A ablation (no chainId/domain sep): P4 falsified → cross-chain transplant |
| `clb-naive-modeb.spthy` | Mode-B ablation (no on-chain guard): P5 falsified → delegated settlement bypasses the predicate |
| `../proverif/clb-offchain.pv` | ProVerif cross-check of the off-chain sub-protocol |
| `proofs/` | committed proof output and found-attack traces |
| `prove.sh` | regenerates all proof artifacts |
