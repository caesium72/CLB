# CDEP experiment — causal delegation and execution provenance

## What is measured

A deterministic engine (`verifyCausalExecution` in `packages/evidence-core/src/causal.ts`)
checks a delegation DAG against seven fixed fixtures in
`packages/attack-core/src/causal-delegation.ts`. Each fixture declares the finding
codes it expects **before** the run; the runner records what the engine actually
returned. No clocks, signing keys, network calls or random inputs are involved.

Commitment under test:

```
C_exec = H(C_parent, D_child, A_action, P_policy, H_input, H_output)
H      = keccak256(canonicalJson(ordered tuple))
```

## Reproduction

```
bun run experiments/novelty/cdep/run.ts
bun test packages/evidence-core/test/causal-delegation.test.ts
bun test packages/attack-core/test/causal-delegation.test.ts
```

`run.ts` rewrites `results.json` deterministically; the JSON is the source of the
counts below.

## Results

| Scenario | Expected finding | Observed | Outcome |
| --- | --- | --- | --- |
| HONEST_DAG | none | none | PASS (no false positive) |
| SUBSTITUTED_INTERMEDIATE_AGENT | PARENT_CHILD_AUTHORITY_MISMATCH | same | detected |
| SUBSTITUTED_ACTION | ACTION_ATTRIBUTION_MISMATCH | same | detected |
| EXPANDED_DELEGATION | NON_EXPANDING_DELEGATION_VIOLATED | same | detected |
| BROKEN_PARENT_LINK | PARENT_LINK_MISMATCH | same | detected |
| SUBSTITUTED_BRANCH | BRANCH_SUBSTITUTION_DETECTED, CROSS_AGENT_ATTRIBUTION_FAILED | both (agent + key variants of the latter) | detected |
| SUBSTITUTED_PAYEE | PAYMENT_EXECUTION_LINEAGE_BROKEN | same | detected |

| Count | Value |
| --- | --- |
| Scenarios | 7 |
| Honest cases / passed | 1 / 1 |
| Attack cases / detected | 6 / 6 |
| False positives | 0 |
| False negatives | 0 |

## Limitations (honest)

- Synthetic fixtures only: **no real multi-agent network**, registry lookup, or
  on-chain settlement is exercised. The DAG is supplied in memory.
- Certificates are self-committed but **not signature-authenticated**. The root
  and terminal anchors must be supplied by the caller from a trusted source; the
  verifier does not fetch them. Without anchors, a writer controlling every
  certificate can reissue a self-consistent DAG.
- The engine proves consistency of the *presented* DAG; it cannot prove the DAG
  is complete relative to an external event log.
- Settlement lineage is checked against the **delegation branch scope**. It does
  not replace verifier rules R10–R13/R12, which bind the actual settlement to the
  human mandate and registered merchant keys. Both layers must run on the same
  settlement.
- No literature-novelty claim is made here; this is an engineering extension
  inside CLB-ACEL.
