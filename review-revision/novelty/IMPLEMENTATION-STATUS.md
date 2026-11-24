# Five Novelty Directions — Implementation Status

All five were implemented in `A3C-v2` by parallel agents with disjoint file ownership. No manuscript file was edited; paste-ready text lives in each novelty's `review-revision/novelty/<id>/` folder. **No literature-priority claims were added** — novelty qualification is limited to the user-provided text; no citations were invented.

| ID | Status | Core deliverable | Measured result |
|---|---|---|---|
| **N1 RCLB** | ✅ Implemented | Epochs (`E_I`, `E_M`), revocation-aware `C_t = keccak256(abi.encode(C,E_I,E_M,T,N))`, verifier R18, new `RevocationAwareGuard.sol`, 8 attack scenarios | 7/7 adversarial prevention, stale acceptance 0/1, false rejection 0/1, race resistance 1/1, revocation-latency median 0.0456 ms (n=200), gas overhead +54,065 (LOCAL ANVIL / DEMO) |
| **N2 IRCV** | ✅ Implemented (scoped) | Formal-trace generator from committed model artifacts, implementation-trace normalizer, differential engine, serialization checker, cross-language PBT, generated executable counterexample reproduction | differential 6/6 PASS, serialization 17/17, PBT 64/64 (512/512 field comparisons vs real Solidity), counterexample PASS (stale identity epoch rejected). **No new Tamarin proof** — statuses copied from committed artifacts |
| **N3 CDEP** | ✅ Implemented | `C_exec = H(C_parent,D_child,A_action,P_policy,H_input,H_output)`, causal DAG verifier (17 finding codes), 7 fixtures | 1 honest pass, 6/6 substitution attacks detected, 0 FP/FN |
| **N4 CFRSC** | ✅ Implemented (code-level) | 9-state durable recovery machine, idempotency keys, CAS store, hash-chained evidence, verifyRecoveryEvidence | 9 unit tests, 6/6 fault-injection scenarios, all properties code-enforced. **Tamarin lemmas specified but UNVERIFIED — no model run** |
| **N5 AEARV** | ✅ Implemented (prototype) | Deterministic `R=0.20(1-I)+0.25A+0.20S+0.20D+0.15H`, V1/V2/V3 tiers, 5 additive checks; all mandatory rules run at every tier | adaptive 15/15 attacks + 15/15 policy gaps, 0/9 honest FP, +0.959 ms vs V1 vs always-V3's 6/9 FP and +1.699 ms (n=39) |

## Verification (after all five integrations)

```
bun run typecheck       clean
bun test                421 pass / 2 skip / 0 fail (423 tests / 69 files, 2427 expect calls)
bun run reproduce:all   exit 0 · all 11 steps PASS · version check PASS · validator 49/49
forge (full suite)      87 tests pass (includes new RevocationAwareGuard)
novelty:aearv           exit 0
novelty:ircv            OVERALL PASS
cdep run                7 scenarios: 1 honest pass / 6 attacks detected
rclb metrics            regenerated
cfrsc fault injection   6/6 pass
```

## Genuine findings from the implementations

1. **IRCV found a real bug**: `computePredicateConfigDigest` throws `InvalidAddressError` for ≥2 payees because `allowedPayees.map(getAddress)` passes the array index as viem's `chainId` argument. Reported, not fixed (outside the IRCV agent's ownership).
2. **IRCV**: implementation event `nonce` not in the formal model alphabet; RCLB out of the Mode B model — scoped gaps, documented.
3. **CDEP**: self-committed certificates degrade to internal-consistency checking if anchors are caller-supplied.
4. **CFRSC**: no clock, single-process store, no symbolic proof.
5. **AEARV**: risk weights a priori, n=39, no confidence intervals.
6. **RCLB**: R18 is opt-in (callers must supply trusted epoch snapshot); metrics use small denominators (1 honest/1 stale), no CRL/distributed revocation.

## Command index

```
bun run reproduce:all
bun run novelty:aearv
bun run novelty:ircv
bun run experiments/novelty/cdep/run.ts
bun run experiments/novelty/rclb/generate-metrics.ts
# CFRSC: bun test packages/service-kit/test/recovery.test.ts + artifacts in experiments/novelty/cfrsc/
```

## Honest conclusion

All five are implemented as working research prototypes with executed evidence. None are claimed as validated novelty against literature; several sub-claims (formal refinement, symbolic recovery properties, calibrated risk model) are explicitly NOT PROVEN and must stay that way in any paper text.
