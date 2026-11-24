# AEARV — paste-ready text (no citations asserted)

Two blocks below: a Methodology description and a Results description. Neither
block cites external work; no citation placeholders are invented. Both describe
a deterministic prototype, not a validated risk model.

## Methodology (paste-ready)

```
To make assurance proportional to transaction risk without weakening the
cryptographic core, we introduced an adaptive evidence-assurance layer. For each
trace the caller supplies five bounded signals in [0,1]: identity assurance I,
authorization risk A, settlement risk S, delivery risk D and history risk H. We
compute a deterministic score R = 0.20(1-I) + 0.25A + 0.20S + 0.20D + 0.15H
(weights sum to one, inputs clamped to [0,1]) and select one of three levels:
V1 for R < 0.34, V2 for 0.34 <= R < 0.67, and V3 for R >= 0.67. V1 performs the
standard CLB verification. V2 adds identity-provenance, delivery-provenance and
trusted-root-anchor checks; V3 additionally requires full evidence-set
completeness and a human approval signed over the trace id, evidence root, tier
and score. Crucially, every level invokes the identical base verifier, which
evaluates the mandatory cryptographic rules (R1, R2, R5, R6, R8, R9, R10, R17)
on every path. Higher levels can only add rejections: the adaptive decision is a
conjunction of the unchanged base verdict and all checks active at the selected
level. Risk signals and approval/anchor artefacts are supplied from trusted
out-of-band systems and are never read from the untrusted trace bundle.
```

## Results (paste-ready)

```
We compared fixed V1, the adaptive policy, and always-V3 on one seeded corpus of
39 traces (three seeds; nine honest, fifteen mandatory-rule attacks, and fifteen
traces that pass V1 but violate an additive assurance check). All three
strategies detected all 15 mandatory-rule attacks (15/15). Fixed V1 detected
0/15 of the additive-only violations, whereas adaptive and always-V3 each
detected 15/15. On honest traces fixed V1 and adaptive each produced 0/9 false
positives; always-V3 produced 6/9, rejecting the low- and medium-risk honest
traces solely because the human-approval gate was imposed on them. Adaptive
executed 156 additive checks versus 195 for always-V3 (20.0% fewer), with a
mean verification latency of 8.597 ms versus 9.337 ms (fixed V1: 7.638 ms;
single-run, machine-dependent measurements). These numbers show that tiered
assurance can concentrate stronger checks on higher-risk traces while leaving
the mandatory cryptographic verification unchanged at every tier.

The risk function is a deterministic prototype: its weights and thresholds were
chosen a priori and were not calibrated against external incident data. We do
not claim an empirically validated or defensible risk model; calibration on
labelled honest and incident traces is required before operational use.
```

## Where the evidence lives

- Code: `packages/verifier-core/src/adaptive.ts`
- Tests: `packages/verifier-core/test/adaptive.test.ts`
- Runner: `scripts/e2e-aearv.ts` (`bun run novelty:aearv`)
- Raw results: `experiments/novelty/aearv/aearv-evaluation.json`
- Generated summary: `experiments/novelty/aearv/SUMMARY.md`
- Full method/limits: `review-revision/novelty/aearv/RISK-MODEL.md`, `EVALUATION.md`
