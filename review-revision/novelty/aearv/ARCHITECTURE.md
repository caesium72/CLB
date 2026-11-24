# AEARV architecture (Novelty 5)

Adaptive Evidence Assurance and Risk-Based Verification (AEARV): a thin risk-tier
policy layer around the deterministic verifier. Implementation lives entirely in
`packages/verifier-core/src/adaptive.ts`; `verifier-core/src/index.ts` is NOT modified.

## 1. What this novelty does

The caller supplies five bounded signals in `[0,1]`; the layer computes one score
and selects one of three verification levels. Higher levels only ADD checks.

```
R = 0.20*(1-I) + 0.25*A + 0.20*S + 0.20*D + 0.15*H
```

| Symbol | Input | Direction | Weight |
|---|---|---|---|
| I | identity assurance | higher is better | 0.20 (applied as `1-I`) |
| A | authorization risk | higher is worse | 0.25 |
| S | settlement risk | higher is worse | 0.20 |
| D | delivery risk | higher is worse | 0.20 |
| H | history risk | higher is worse | 0.15 |

Weights sum to 1; inputs are clamped to `[0,1]` (non-finite throws); `R` is
bounded in `[0,1]` and rounded to six decimals.

| Level | Trigger | Additive checks (cumulative) |
|---|---|---|
| V1 | `R < 0.34` | none |
| V2 | `0.34 <= R < 0.67` | `IDENTITY_PROVENANCE`, `DELIVERY_PROVENANCE`, `TRUSTED_ROOT_ANCHOR` |
| V3 | `R >= 0.67` | all V2 + `FULL_PROVENANCE`, `HUMAN_APPROVAL_GATE` |

CRITICAL INVARIANT: every level calls the SAME `verifyTrace(bundle, ...)`.
The mandatory cryptographic rules `R1, R2, R5, R6, R8, R9, R10, R17` are
evaluated at V1, V2 and V3 with no exception and no relaxation. Adaptive checks
only ADD; they never skip, weaken or parameterise a mandatory rule. Final
decision is `base PASS AND every executed adaptive check PASS`, so any adaptive
outcome is at least as strict as fixed V1.

## 2. Where it fits

A wrapper/policy layer sitting BETWEEN transaction inputs and the verifier
certificate; `verifyTrace` remains the untouched deterministic core.

```
   transaction inputs            AEARV wrapper              verifier core
   +----------------+       +---------------------+       +--------------+
   | TraceBundle    |------>| risk score -> tier  |------>| verifyTrace  |
   | (untrusted)    |       | + additive checks   |       | (unchanged)  |
   +----------------+       +---------------------+       +------+-------+
   +----------------+       | trusted context     |              |
   | I/A/S/D/H      |------>| (caller-supplied)   |              v
   | root/approval  |       +---------------------+       +--------------+
   +----------------+                                      | certificate  |
                                                           | + verdict    |
                                                           +--------------+
```

## 3. Architecture diagram (Input -> Processing -> Output)

```
 [INPUT]  caller-supplied, trusted out-of-band     untrusted input
 -------  ------------------------------------     ---------------
  I  identity assurance  [0,1] --+
  A  authorization risk  [0,1] --+
  S  settlement risk     [0,1] --+--> +--------------------+
  D  delivery risk       [0,1] --+    | TraceBundle        |
  H  history risk        [0,1] --+    | events / mandate / |
                                      | payment / settlement|
                                      +---------+----------+
                                                |
 [PROCESSING]                                   |
 -----------                                    |
  +-----------------------+                      |
  | RISK SCORER           |                      |
  | computeRiskScore()    |                      |
  | clamp [0,1], R, 6dp   |                      |
  +-----------+-----------+                      |
              | R in [0,1]                       |
              v                                  |
  +-----------------------+                      |
  | TIER SELECTOR         |                      |
  | selectVerification    |                      |
  | Level(R) -> V1/V2/V3  |                      |
  +-----------+-----------+                      |
              | level                            |
              v                                  |
  +-----------------------+   +------------------+
  | BASE verifyTrace      |<--| TRUSTED CONTEXT  |
  | UNCHANGED at all tiers|   | principal, root, |
  | mandatory: R1 R2 R5 R6|   | approval         |
  |            R8 R9 R10  |   +---------+--------+
  |            R17        |<-------------+
  +-----------+-----------+
              | base verdict + certificate + all rule outcomes
              v
  +-----------------------+
  | ADDITIVE CHECKS       |  checksForLevel(level): V1=0, V2=3, V3=5
  | only ADD to the base  |  identity / delivery / root /
  +-----------+-----------+  full provenance / human approval
              | additive outcomes
              v
  +-----------------------+
  | COMBINED VERDICT      |  decision = base PASS AND all checks PASS
  +-----------+-----------+
              v
 [OUTPUT] AdaptiveVerifyOutput { base, level, riskScore, decision,
          failedRules, failedAdaptiveChecks, extraChecksExecuted }
 -------

 STRATEGY BRANCH (same corpus, same base call; only level source differs)
 +---------------+------------------+-----------------+
 | fixed V1      | adaptive         | always V3       |
 | level = V1    | level = f(R)     | level = V3      |
 | 0 extra       | 3 or 5 extra     | 5 extra         |
 | verifyAtLevel | verifyAdaptive   | verifyAtLevel   |
 +---------------+------------------+-----------------+
```

All three strategies converge on the same combined-verdict path.

## 4. Execution flow (exact function names, in order)

`verifyAdaptive(bundle, risk, context)` - risk-driven path:

1. `computeRiskScore(risk)` - clamp and weight I/A/S/D/H, round to 6dp -> `score`.
2. `selectVerificationLevel(score)` - map bounded score to `V1|V2|V3`.
3. `verifyAtLevel(bundle, level, context, risk)` - run the chosen level:
   - `verifyTrace(bundle, { expectedHumanPrincipal, ...confidential })`: the
     unchanged core; produces certificate + all rule outcomes.
   - additive checks executed inline by level (`checksForLevel(level)` declares
     the set): V1 none; V2 `identityProvenance`, `deliveryProvenance`,
     `trustedRootAnchor`; V3 adds `fullProvenance` and `humanApprovalGate`.
   - `humanApprovalGate` -> `approvalMessage(bundle, level, score)` then
     `verifyMessage(...)` against `expectedHumanPrincipal`.
   - combine: `decision = base.result.status === "PASS" && no failed checks`.
4. return `AdaptiveVerifyOutput`.

`verifyAtLevel(bundle, level, context, risk?)` - fixed-level entry point used by
fixed-V1 and always-V3; identical body, level supplied by caller. Caller-side V3
helpers: `approvalMessage`, `createHumanApproval`.

## 5. Data flow: one signal (identity assurance I)

```
caller RiskFactors.identityAssurance = I (1.0 strong, 0.0 weak)
   v  clampUnit(I)
identityRisk = 1 - I            (strong I -> 0, weak I -> 1)
   v  weight 0.20
contribution = 0.20 * (1 - I)   (max 0.20 of R)
   v  + 0.25A+0.20S+0.20D+0.15H, round 6dp
R  (I=1,A=S=D=H=0 -> 0.000; I=0,A=S=D=H=1 -> 1.000)
   v  selectVerificationLevel(R)
tier: high I suppresses R -> V1; zero I pushes R to 0.67+ -> V3
   v  additive check at V2/V3
IDENTITY_PROVENANCE: ERC8004_AGENT_IDENTITY bound to traceId + AP2 mandate
   v  combined decision
outcome = base PASS AND IDENTITY_PROVENANCE (and other active checks) PASS
```

I is never read from the untrusted bundle; it steers tier selection only.

## 6. Integration points and boundaries

- Deterministic prototype: no ML, pure, reproducible. Weights (0.20/0.25/0.20/
  0.20/0.15) and cut-points (0.34, 0.67) are a priori; no external calibration,
  no incident/loss data, no empirical validation claimed.
- Corpus: `n=39` synthetic traces, 3 seeds (9 honest, 15 attacks, 15 policy gaps);
  rates are descriptive, not confidence intervals.
- Trust boundary: risk factors, trusted Merkle root and human approval come from
  the caller out-of-band; none are fields of the untrusted `TraceBundle`.
- Fail closed: `TRUSTED_ROOT_ANCHOR` and `HUMAN_APPROVAL_GATE` reject when their
  trusted anchors are missing/malformed; safe, but honest bundles can be rejected.
- Scope: wrapper only; `verifier-core/src/index.ts` and mandatory rules untouched,
  so adaptive decisions can only be stricter than fixed V1.

## 7. Verification pointers

Reproduce (from the repository root):

```
bun run novelty:aearv
```

Runs `scripts/e2e-aearv.ts` (key `novelty:aearv` in `package.json`) and writes
`experiments/novelty/aearv/aearv-evaluation.json` and generated `SUMMARY.md`.

Headline numbers (see `review-revision/novelty/aearv/EVALUATION.md`):

- Mandatory-rule attacks detected: 15/15 (100%) for fixed V1, adaptive and V3.
- Additive-only policy gaps detected: 0/15 fixed V1; 15/15 adaptive and V3.
- Honest false positives: 0/9 fixed V1 and adaptive; 6/9 always-V3.
- Adaptive mean-latency overhead vs fixed V1: +0.959 ms/case (single-run,
  machine-dependent, indicative only).
- Additive checks: adaptive 156 vs always-V3 195 across 39 cases (20% fewer).

Invariants: `packages/verifier-core/test/adaptive.test.ts` rejects each mandatory
rule at all three levels and checks strict monotonicity; `scripts/e2e-aearv.ts`
asserts all eight mandatory rules are in the certificate on every path.
