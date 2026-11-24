# CDEP experiments and evidence

## Setup

- Code: `packages/evidence-core/src/causal.ts`, `packages/attack-core/src/causal-delegation.ts`
- Fixtures: one honest three-node DAG and six single-defect variants, all fixed
  (no clocks, keys, network or randomness).
- Runner: `bun run experiments/novelty/cdep/run.ts` → `experiments/novelty/cdep/results.json`
- Tests: 13 evidence-core tests + 5 attack-core tests, all green.

## Method

Each scenario declares the finding codes it expects before verification. The
engine returns a list of findings; the runner records observed codes and marks
the case `matchedExpectation` only when the honest case has no findings and each
attack case has **all** of its expected codes. No expected code is inferred from
the output, so a false negative cannot be hidden by rewriting expectations.

## Counts (from generated `results.json`)

| Metric | Value |
| --- | --- |
| Scenarios | 7 |
| Honest cases / passed with zero findings | 1 / 1 |
| Attack cases / detected with expected code(s) | 6 / 6 |
| False positives | 0 |
| False negatives | 0 |

| Attack | Mutation | Detected by |
| --- | --- | --- |
| Intermediate agent substitution | reissue intermediate with attacker child, relink child | `PARENT_CHILD_AUTHORITY_MISMATCH` |
| Action substitution | reissue terminal action attributed to another agent | `ACTION_ATTRIBUTION_MISMATCH` |
| Expanded delegation | terminal cap 1.50 → 5.00, reissued | `NON_EXPANDING_DELEGATION_VIOLATED` |
| Broken parent link | terminal `C_parent` replaced by unrelated digest, reissued | `PARENT_LINK_MISMATCH` |
| Branch substitution | sibling attacker branch presented as terminal | `BRANCH_SUBSTITUTION_DETECTED`, `CROSS_AGENT_ATTRIBUTION_FAILED` |
| Payee substitution | settlement `payTo` → attacker address | `PAYMENT_EXECUTION_LINEAGE_BROKEN` (detail: `payTo`) |

The single-defect variants reissue certificates where necessary so each attack
isolates its intended check rather than trivially failing the hash recomputation.
A separate unit test confirms that tampering *without* reissuing is caught by
`CAUSAL_COMMITMENT_MISMATCH`.

## Verification commands and results

```
bun test packages/evidence-core/test/causal-delegation.test.ts   # 13 pass / 0 fail
bun test packages/attack-core/test/causal-delegation.test.ts     #  5 pass / 0 fail
bun run typecheck                                                # clean
bun test                                                         # 421 pass / 2 skip / 0 fail
```

The 421 total includes unrelated test files added concurrently in the shared
workspace; the count quoted at task start was 360 pass / 2 skip, and the two
CDEP test files add 18 tests (13 + 5).

## Limitations

- Synthetic in-memory DAG; **no real multi-agent network**, registry, or
  on-chain settlement is involved. Counts are defect-detection counts, not
  field measurements of a deployed system.
- Certificates are self-committed placeholders without signature verification.
  Root/terminal anchors are caller-supplied; the verifier does not fetch them.
  Without independent anchors, a writer controlling the full DAG can reissue a
  self-consistent set — the same residual limitation as evidence R1 without a
  trusted Merkle root.
- Completeness of the DAG against an external event log is not proven; only the
  presented path is checked.
- Payment lineage is scoped to the delegation branch. It complements, and does
  not replace, the existing `verifyTrace` rules on the actual settlement
  (R10–R13, R12 in particular).
- No novelty claim over the literature is made. This is a deterministic
  engineering extension inside CLB-ACEL, with no cited external result.
