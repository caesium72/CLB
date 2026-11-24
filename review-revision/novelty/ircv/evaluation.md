# Novelty 2 — IRCV: evaluation

All numbers below are produced by `bun run novelty:ircv` and stored in `experiments/novelty/ircv/*.json` / `*.md`. Counts, verdicts, seeds and tool versions are stable across runs. Concrete commitments/nonces are **not** byte-stable: the existing mandate fixtures embed wall-clock timestamps, so raw digests differ between runs.

## Headline result

| Component | Result |
| --- | --- |
| Formal vocabulary | 7 rules, 11 action labels, 8 lemmas (8 verified statuses copied from committed result file) |
| Differential engine | 6/6 scenarios matched recorded expectations; 4 comparable, 2 out-of-model |
| Serialization consistency | 17/17 checks matched |
| Cross-language PBT | PASS: 64/64 cases, 512/512 field comparisons, seed 20261125 |
| Counterexample | PASS: expected rejection == actual rejection |
| Overall | PASS |

## Tool versions recorded

- Bun 1.4.5; TypeScript ^5.8.3; viem 2.51.3.
- forge Version 1.10.0; solc 0.8.28.
- Tamarin 1.12.0 and Maude 3.1 **read from the committed proof footer**, not executed.

## Differential detail

| Scenario | Conformance | Violated | Verifier | Result |
| --- | --- | --- | --- | --- |
| MODE_A_HONEST | NOT COMPARABLE | — | PASS | PASS |
| MODE_B_HONEST | CONFORMANT | — | PASS | PASS |
| MODE_B_PAYEE_ATTACK | NON-CONFORMANT | MC-P4 | FAIL (R12, R17) | PASS |
| MODE_B_AMOUNT_ATTACK | NON-CONFORMANT | MC-P4 | FAIL (R11, R17) | PASS |
| MODE_B_REPLAY_ATTACK | CONFORMANT (prevention recorded) | — | FAIL (R9) | PASS |
| RCLB_STALE_IDENTITY_EPOCH | NOT COMPARABLE | — | FAIL (R18) | PASS |

Event-kind coverage: 10 of 11 observed kinds map to the model alphabet; `nonce` is implementation-only (it is a model *term*, not an action fact). No model kind was unobserved.

## Honest finding

`FINDING-MULTI-PAYEE-GETADDRESS` (medium): `computePredicateConfigDigest` throws `InvalidAddressError` for two or more `allowedPayees` because `Array.map(getAddress)` passes the index as viem's `chainId` argument. This framework reports the defect; the core source was not modified.

## What is NOT proven

1. **No new formal proof.** Lemma statuses are copied from `proofs/clb-aligned.result.txt`; IRCV does not establish any new Tamarin result.
2. **No general refinement theorem.** Only six concrete scenarios and six abstract constraints were checked. PASS means "observed trace matched the recorded expectation", not "implementation refines model for all traces".
3. **Mode A is outside the model alphabet** (`clb-aligned.spthy` is Mode B only).
4. **Revocation/RCLB is outside the model alphabet**; the stale-epoch counterexample is executable against TS + local facilitator but has no Tamarin action fact in `clb-aligned.spthy`.
5. **Fixture-level divergence**: the Mode B attack fixtures call the facilitator directly and settle despite predicate rejection; the real pre-settlement guard (`draftModeBPayment` + `InMemoryPredicateGuard`) is a separate earlier gate. IRCV reports this rather than hiding it.
6. **Abstract equality**: symbolic term equality in Tamarin is approximated by concrete digests/addresses/ids; no symbolic execution of Solidity was performed.
7. **Serialization checker is TS↔TS** for its fixed vectors; genuine cross-language evidence comes from the 64-case forge run, which is limited to the commitment fields exposed by `PredicatePaymentGuard`.

## Reproduction commands

```
bun run novelty:ircv
bun run typecheck
bun test
```
