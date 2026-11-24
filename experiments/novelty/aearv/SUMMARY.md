# AEARV evaluation — fixed V1 vs adaptive vs always-V3

Generated 2026-11-24T20:49:20.429Z. Seeds: 1800000000000, 1800000000017, 1800000000042. Cases: n=39 (9 honest, 15 mandatory-rule attacks, 15 base-clean policy gaps).

All three strategies verify the same seeded corpus with the same unchanged base `verifyTrace` call; the mandatory cryptographic rules R1, R2, R5, R6, R8, R9, R10, R17 are evaluated on every path. Higher levels only ADD checks.

> LIMITATION: the risk score is a deterministic prototype with a priori weights (0.20/0.25/0.20/0.20/0.15) and cut-points (0.34, 0.67). It is NOT calibrated or validated on external incident data. These numbers describe this prototype on this synthetic corpus only.

| Strategy | n | Mandatory-attack detected | Policy-gap detected | Honest FP | Latency mean ms | Latency p95 ms | Extra checks (total/mean) | V1/V2/V3 cases |
|---|---|---|---|---|---|---|---|---|
| fixedV1 | 39 | 15/15 (100.0%) | 0/15 (0.0%) | 0/9 (0.0%) | 7.280 | 8.767 | 0 (0.00/case) | 39/0/0 |
| adaptive | 39 | 15/15 (100.0%) | 15/15 (100.0%) | 0/9 (0.0%) | 8.267 | 10.354 | 156 (4.00/case) | 3/12/24 |
| alwaysV3 | 39 | 15/15 (100.0%) | 15/15 (100.0%) | 6/9 (66.7%) | 8.635 | 11.367 | 195 (5.00/case) | 0/0/39 |

## Derived comparisons

- Latency overhead vs fixed V1: adaptive 0.987 ms/case; always-V3 1.355 ms/case. Timings are single-run measurements and are noisy; treat them as indicative, not a benchmark.
- Adaptive reduces additive checks from 195 (always-V3) to 156 across 39 cases (20.0% fewer).
- Adaptive preserves 100% mandatory-rule attack detection while matching fixed V1's 0.0% honest false-positive rate; always-V3 rejects 6/9 honest bundles that carry no approval (low- and medium-risk), solely because the V3 human-approval gate is imposed on them.

## Per-case decisions

| case | seed | kind | risk R | V1 | adaptive (level) | V3 | failed adaptive checks (adaptive) |
|---|---|---|---|---|---|---|---|
| 1800000000000-honest-low | 1800000000000 | honest | 0.000 | PASS | PASS (V1) | FAIL | - |
| 1800000000000-honest-medium | 1800000000000 | honest | 0.350 | PASS | PASS (V2) | FAIL | - |
| 1800000000000-honest-high-approved | 1800000000000 | honest | 1.000 | PASS | PASS (V3) | PASS | - |
| 1800000000000-gap-identity-omission | 1800000000000 | policy-gap | 0.350 | PASS | FAIL (V2) | FAIL | IDENTITY_PROVENANCE |
| 1800000000000-gap-delivery-omission | 1800000000000 | policy-gap | 0.350 | PASS | FAIL (V2) | FAIL | DELIVERY_PROVENANCE |
| 1800000000000-gap-unanchored-rewrite | 1800000000000 | policy-gap | 0.350 | PASS | FAIL (V2) | FAIL | TRUSTED_ROOT_ANCHOR |
| 1800000000000-gap-approval-gate | 1800000000000 | policy-gap | 1.000 | PASS | FAIL (V3) | FAIL | HUMAN_APPROVAL_GATE |
| 1800000000000-gap-full-provenance | 1800000000000 | policy-gap | 1.000 | PASS | FAIL (V3) | FAIL | FULL_PROVENANCE |
| 1800000000000-attack-payee | 1800000000000 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000000-attack-amount | 1800000000000 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000000-attack-replay | 1800000000000 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000000-attack-delivery-forgery | 1800000000000 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000000-attack-chain-transplant | 1800000000000 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000017-honest-low | 1800000000017 | honest | 0.000 | PASS | PASS (V1) | FAIL | - |
| 1800000000017-honest-medium | 1800000000017 | honest | 0.350 | PASS | PASS (V2) | FAIL | - |
| 1800000000017-honest-high-approved | 1800000000017 | honest | 1.000 | PASS | PASS (V3) | PASS | - |
| 1800000000017-gap-identity-omission | 1800000000017 | policy-gap | 0.350 | PASS | FAIL (V2) | FAIL | IDENTITY_PROVENANCE |
| 1800000000017-gap-delivery-omission | 1800000000017 | policy-gap | 0.350 | PASS | FAIL (V2) | FAIL | DELIVERY_PROVENANCE |
| 1800000000017-gap-unanchored-rewrite | 1800000000017 | policy-gap | 0.350 | PASS | FAIL (V2) | FAIL | TRUSTED_ROOT_ANCHOR |
| 1800000000017-gap-approval-gate | 1800000000017 | policy-gap | 1.000 | PASS | FAIL (V3) | FAIL | HUMAN_APPROVAL_GATE |
| 1800000000017-gap-full-provenance | 1800000000017 | policy-gap | 1.000 | PASS | FAIL (V3) | FAIL | FULL_PROVENANCE |
| 1800000000017-attack-payee | 1800000000017 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000017-attack-amount | 1800000000017 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000017-attack-replay | 1800000000017 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000017-attack-delivery-forgery | 1800000000017 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000017-attack-chain-transplant | 1800000000017 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000042-honest-low | 1800000000042 | honest | 0.000 | PASS | PASS (V1) | FAIL | - |
| 1800000000042-honest-medium | 1800000000042 | honest | 0.350 | PASS | PASS (V2) | FAIL | - |
| 1800000000042-honest-high-approved | 1800000000042 | honest | 1.000 | PASS | PASS (V3) | PASS | - |
| 1800000000042-gap-identity-omission | 1800000000042 | policy-gap | 0.350 | PASS | FAIL (V2) | FAIL | IDENTITY_PROVENANCE |
| 1800000000042-gap-delivery-omission | 1800000000042 | policy-gap | 0.350 | PASS | FAIL (V2) | FAIL | DELIVERY_PROVENANCE |
| 1800000000042-gap-unanchored-rewrite | 1800000000042 | policy-gap | 0.350 | PASS | FAIL (V2) | FAIL | TRUSTED_ROOT_ANCHOR |
| 1800000000042-gap-approval-gate | 1800000000042 | policy-gap | 1.000 | PASS | FAIL (V3) | FAIL | HUMAN_APPROVAL_GATE |
| 1800000000042-gap-full-provenance | 1800000000042 | policy-gap | 1.000 | PASS | FAIL (V3) | FAIL | FULL_PROVENANCE |
| 1800000000042-attack-payee | 1800000000042 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000042-attack-amount | 1800000000042 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000042-attack-replay | 1800000000042 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000042-attack-delivery-forgery | 1800000000042 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |
| 1800000000042-attack-chain-transplant | 1800000000042 | attack | 1.000 | FAIL | FAIL (V3) | FAIL | - |

Raw per-run data: `experiments/novelty/aearv/aearv-evaluation.json`.
