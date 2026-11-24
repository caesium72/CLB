# AEARV risk model (Novelty 5) — specification and status

Implementation: `packages/verifier-core/src/adaptive.ts`. No core verifier file was modified.

## 1. Inputs

`R = f(I, A, S, D, H)`, where each input is a caller-supplied scalar in `[0, 1]`:

| Symbol | Name | Direction | Meaning (trusted, out-of-band source) |
|---|---|---|---|
| `I` | identity assurance | higher is better | Independent identity/registry assurance for the payer and merchant agents. |
| `A` | authorization risk | higher is worse | Policy/mandate deviation signals (unusual payee, amount, scope). |
| `S` | settlement risk | higher is worse | Chain/counterparty and settlement-domain signals. |
| `D` | delivery risk | higher is worse | Delivery-provenance and report-authenticity signals. |
| `H` | history risk | higher is worse | Prior anomalies / repeat-offender signals for the agents involved. |

All inputs are **clamped to `[0, 1]`**; non-finite inputs throw. They are never read
from the untrusted `TraceBundle`. The caller must obtain them from independent
systems (registry, policy engine, settlement monitor, history store).

## 2. Scoring function (deterministic, no ML)

```
R = 0.20*(1 - I) + 0.25*A + 0.20*S + 0.20*D + 0.15*H
```

Weights sum to 1.0, so `R` is bounded in `[0, 1]`. The score is rounded to six
decimals before comparison/reporting. The function is pure, reproducible and
auditable: the same five inputs always produce the same score and tier.

| Level | Trigger | Additional checks (cumulative) |
|---|---|---|
| V1 | `R < 0.34` | none — standard CLB checks only |
| V2 | `0.34 <= R < 0.67` | `IDENTITY_PROVENANCE`, `DELIVERY_PROVENANCE`, `TRUSTED_ROOT_ANCHOR` |
| V3 | `R >= 0.67` | all V2 checks + `FULL_PROVENANCE`, `HUMAN_APPROVAL_GATE` |

Thresholds were chosen a priori as round cut-points, not fitted to data.

## 3. What each additional check does

- `IDENTITY_PROVENANCE`: the trace must contain an `ERC8004_AGENT_IDENTITY`
  event and an AP2 mandate event, both bound to the trace id. An agent can omit
  these and heal the hash chain/Merkle root without a secret; V1 cannot see the
  omission without a completeness policy, V2 rejects it.
- `DELIVERY_PROVENANCE`: exactly one `DELIVERY_PROOF` event, as the final trace
  leaf, bound into the recomputed Merkle root.
- `TRUSTED_ROOT_ANCHOR`: fail closed unless the caller supplies an independently
  anchored root; compare it (case-insensitively) with the bundle root. This is
  what detects a self-consistent rewrite that V1 accepts.
- `FULL_PROVENANCE`: require the full canonical evidence set (`USER_INTENT`,
  identity, AP2 mandate, `X402_PAYMENT_REQUIREMENT`, `X402_PAYMENT_PAYLOAD`,
  `CHAIN_SETTLEMENT`, `DELIVERY_PROOF`).
- `HUMAN_APPROVAL_GATE`: an ECDSA personal-sign approval from the independently
  anchored human principal over a canonical message binding trace id, Merkle
  root, tier and score. Missing, mismatched or invalid approvals fail closed.
  This is the "stronger attestation" step: it imposes a human decision only on
  the highest-risk band.

## 4. Safety invariant

Every level calls the **same** `verifyTrace(bundle, { expectedHumanPrincipal })`
with no additional options. `verifyTrace` evaluates all rules, including the
mandatory cryptographic set `R1, R2, R5, R6, R8, R9, R10, R17`, on every path.
A level's final decision is `base PASS AND all executed adaptive checks PASS`,
so adaptive verification is a **superset** of V1 rejections. Tests:
`packages/verifier-core/test/adaptive.test.ts` constructs a bundle failing each
of the eight mandatory rules and asserts `FAIL` at V1, V2 and V3; it also
asserts that V2/V3 reject strictly more seeded bundles than V1.

## 5. Status and limitations (important)

This is a **deterministic prototype**, not a validated risk model. The weights
and thresholds are engineering choices; they were **not** calibrated against
external incident/loss data and the model is **not** claimed to be defensible
or empirically validated. Inputs are assumed to be trustworthy scalars; the
module does not derive them, detect their manipulation, or learn from outcomes.
The human-approval and trusted-root controls fail closed when their anchors are
absent, which is safe but creates false positives when an anchor cannot be
supplied. Empirical calibration on labelled honest/incident traces is required
before any operational use; no such claim is made here. No external sources or
citations are asserted in this document.
