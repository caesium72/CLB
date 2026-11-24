# Novelty 2 — IRCV: implementation summary

**Status: PASS**. Tool versions: bun 1.4.5, viem 2.51.3, TypeScript ^5.8.3, forge forge Version: 1.10.0, solc 0.8.28. Tamarin 1.12.0 / Maude 3.1 come from the committed proof file; Tamarin was not executed.

| Component | Result |
| --- | --- |
| Formal vocabulary | 7 rules, 11 action labels, 8 lemmas (8 verified in committed result) |
| Differential engine | 6/6 PASS |
| Serialization consistency | 17/17 matched |
| Cross-language PBT | PASS (64/64 cases), seed 20261125 |
| Counterexample reproduction | PASS |

Detailed artifacts: `model-trace.json/.md`, `implementation-traces.json/.md`, `differential-report.json/.md`, `serialization-report.json/.md`, `property-tests.json/.md`, `counterexample-report.json/.md`.

## Coverage achieved

- modelRules: 7
- modelActionLabels: 11
- modelLemmasWithCommittedStatus: 8
- constraintsEvaluated: 6
- comparableScenarios: 4
- totalScenarios: 6
- observedKindsMapped: 10
- observedKindsTotal: 11
- serializationChecks: 17
- propertyCases: 64
- propertySeed: 20261125
- propertyComparisons: 512

## What remains NOT PROVEN

- Mode A exact traces are outside the Mode B model alphabet.
- RCLB / revocation epochs are absent from clb-aligned.spthy; the stale-epoch counterexample is executable but out-of-model.
- No new Tamarin proof was attempted; existing 'verified' statuses were copied from the committed result file.
- The normalization is an abstract event projection, not a bisimulation proof; field-level symbolic equality is approximated by concrete digests/addresses.
- Fixture-level predicate attacks settle in the direct facilitator path; the pre-settlement guard is a separate earlier gate.
- Concrete commitments/nonces embed fixture wall-clock timestamps; counts and verdicts are stable, raw digests are not byte-stable across runs.

## Honest findings

- FINDING-MULTI-PAYEE-GETADDRESS (medium): computePredicateConfigDigest throws for >=2 allowedPayees: InvalidAddressError (viem getAddress receives the map index as chainId). Core source was NOT modified; this framework reports only.
