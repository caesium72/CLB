# AEARV evaluation — fixed V1 vs adaptive vs always-V3

Artifacts: `experiments/novelty/aearv/aearv-evaluation.json` (raw) and
`experiments/novelty/aearv/SUMMARY.md` (generated summary). Reproduce with
`bun run novelty:aearv` from the repository root. These results were generated
at `2026-11-24T20:29:47.805Z`.

## Method

One seeded corpus is verified by all three strategies. Seeds:
`1800000000000, 1800000000017, 1800000000042`.

| Case class | Per seed | Total n | Description |
|---|---|---|---|
| honest | 3 | 9 | one low-risk (R=0.000), one medium-risk (R=0.350), one high-risk with human approval (R=1.000) |
| attack | 5 | 15 | payee substitution, amount escalation, nonce replay, delivery forgery, chain transplant — all fail mandatory CLB rules |
| policy-gap | 5 | 15 | identity omission, delivery omission, self-consistent rewrite with a trusted root, missing approval, missing `USER_INTENT` — all pass V1 but violate an additive assurance check |

Total `n = 39`. Every strategy calls the same base `verifyTrace` with the same
principal anchor; only additive checks differ. The script asserts on every case
that all eight mandatory rules were evaluated and present in the certificate.
Latency is wall-clock around one verification call per strategy per case; it is
a single-run measurement, not a benchmark.

## Results (exact, from the final run)

| Strategy | n | Mandatory attacks detected | Policy gaps detected | Honest false positives | Latency mean / p95 (ms) | Extra checks (total / per case) | V1/V2/V3 cases |
|---|---|---|---|---|---|---|---|
| fixed V1 | 39 | 15/15 (100%) | 0/15 (0%) | 0/9 (0%) | 7.638 / 10.212 | 0 / 0.00 | 39 / 0 / 0 |
| adaptive | 39 | 15/15 (100%) | 15/15 (100%) | 0/9 (0%) | 8.597 / 10.998 | 156 / 4.00 | 3 / 12 / 24 |
| always-V3 | 39 | 15/15 (100%) | 15/15 (100%) | 6/9 (66.7%) | 9.337 / 12.026 | 195 / 5.00 | 0 / 0 / 39 |

Derived: adaptive latency overhead vs V1 is **+0.959 ms/case** (≈12.6%),
always-V3 is **+1.699 ms/case** (≈22.2%). Adaptive executes **20.0% fewer**
additive checks than always-V3 (156 vs 195). Always-V3's six false positives are
the low- and medium-risk honest bundles that carry no approval; they are
rejected solely by the V3 approval gate. Adaptive detects the same threats
without imposing that gate on those bands.

## Invariant evidence

- `adaptive.test.ts`: bundles failing each of `R1, R2, R5, R6, R8, R9, R10, R17`
  are rejected at **all three levels**, with the rule present in `failedRules`
  and `outcomes` (8 rules × 3 levels × assertions).
- At every level and every corpus case, all eight mandatory rules appear in the
  base certificate `rulesChecked` and outcomes (script-level assertion,
  `n × 3 = 117` verification paths).
- Monotonicity on the seeded corpus: V1 rejects 0 policy gaps, V2/V3 reject 15;
  V3 additionally rejects the 2 approval/provenance-only gaps per seed that V2
  passes. Full suite: `421 pass / 2 skip / 0 fail`; `bun run typecheck` clean.

## Limits

- The corpus is synthetic and small (`n=39`, 3 seeds); rates are descriptive,
  not confidence-interval estimates.
- The risk model is a deterministic prototype with a priori weights and
  thresholds. It is not calibrated or validated on external incident data and
  is not claimed to be defensible beyond this prototype setting.
- Latency includes fixture-level signing/hashing work and is machine-dependent;
  the p95/mean values above are from this one run and will vary.
- Detection of the policy gaps assumes the caller supplies a correct trusted
  root and approval when required. Wrong or missing anchors cause fail-closed
  rejections, including of honest bundles, by design.
- No external citations or performance claims from other work are made here.
