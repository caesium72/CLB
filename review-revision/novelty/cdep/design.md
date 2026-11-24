# CDEP design — Causal Delegation and Execution Provenance

## 1. Goal and non-goal

Goal: bind the final settlement to **one specific branch** of a multi-agent
delegation DAG, so that substituting an intermediate agent, an action, a policy,
or a sibling branch cannot be presented as the authority for a payment.

Non-goal: authenticating certificates. The engine is offline and deterministic;
trusted anchors (root commitment, terminal certificate id) come from the caller,
exactly as verifier rule R1 needs a trusted expected Merkle root. Without them a
writer who controls the whole DAG can reissue every hash consistently.

## 2. Architecture map

```
 human anchor (out of band)
   |  expectedRootExecCommitment, expectedTerminalCertificateId
   v
+-------------------------------------------------------------+
| verifyCausalExecution(input)                                |
|  +---------------------+   +-----------------------------+  |
|  | evidence-core       |   | attack-core                 |  |
|  | causal.ts           |   | causal-delegation.ts        |  |
|  | - C_exec formula    |   | - honest DAG + 6 attacks    |  |
|  | - deterministic     |<--| - deterministic runner      |  |
|  |   findings          |   +-----------------------------+  |
|  +---------------------+                                    |
|            |                                                |
|            v                                                |
|  proof obligations: authority | non-expansion | trace      |
|  integrity | attribution | branch | payment lineage        |
+-------------------------------------------------------------+
```

## 3. Data flow

```
Input: DelegationCertificate[] + terminal id + observed agent + settlement
   |
   +-- build id map, find single root, check trusted root anchor
   |
   +-- walk terminal -> root (detect unknown parent / cycle)
   |      root -> middle -> terminal       [path]
   |
   +-- recompute C_exec for every node on path
   |      compare declared C_exec and each C_parent with the recomputed parent
   |
   +-- per edge: issuer == parent.child ; child.scope subset of parent.scope
   |
   +-- terminal: action attributed to delegate ; action in scope
   |             observed agent + payment key == terminal delegate
   |             payTo / asset / value / chainId in terminal scope
   v
Output: { ok, findings[], pathExecCommitments[], terminalExecCommitment }
```

## 4. File / module map

| File | Job |
| --- | --- |
| `packages/evidence-core/src/causal.ts` | Types, `computeCausalExecution`, `issueDelegationCertificate`, `verifyCausalExecution`, `scopeIsSubset`, `sameDelegationIdentity` |
| `packages/evidence-core/src/index.ts` | Re-exports `./causal` and adds `keccakCanonical`; existing functions untouched |
| `packages/evidence-core/test/causal-delegation.test.ts` | Formula, honest chain, per-field tampering, structural and lineage unit tests |
| `packages/attack-core/src/causal-delegation.ts` | Seven fixed scenarios + `runCausalScenarios()` |
| `packages/attack-core/test/causal-delegation.test.ts` | Honest pass, per-attack reason codes, deterministic counts |
| `experiments/novelty/cdep/run.ts` | Regenerates `results.json` from the same runner |
| `experiments/novelty/cdep/results.json` | Generated counts and observed codes |

## 5. Commitment encoding

```
D_child = keccakCanonical(child identity incl. authorized payment keys)
A_action = keccakCanonical({ actionId, targetAgentId, parametersHash })
P_policy = keccakCanonical({ policyId, scope })
C_exec  = keccakCanonical([C_parent, D_child, A_action, P_policy, H_input, H_output])
```

`keccakCanonical` is keccak256 over the UTF-8 bytes of `canonicalJson(value)`
(implemented with the same noble keccak used by the evidence hash chain, and
byte-identical to viem's `keccak256(toBytes(canonicalJson(value)))`). Root
`C_parent` is the zero hash, matching `ZERO_HASH`.

## 6. Proof obligations and their checks

| Obligation | Check | Finding code |
| --- | --- | --- |
| Parent-child authority | `child.issuer == parent.child` on every edge | `PARENT_CHILD_AUTHORITY_MISMATCH` |
| Non-expanding delegation | child scope ⊆ parent scope (actions, assets, payees, chains, max cap) | `NON_EXPANDING_DELEGATION_VIOLATED` |
| Causal trace integrity | recompute every `C_exec`; `C_parent == recomputed(C_exec of parent)` | `CAUSAL_COMMITMENT_MISMATCH`, `PARENT_LINK_MISMATCH` |
| Cross-agent attribution | terminal `child == observed agent`; settlement key authorized; action targets the terminal agent | `CROSS_AGENT_ATTRIBUTION_FAILED`, `ACTION_ATTRIBUTION_MISMATCH` |
| Branch substitution | trusted terminal id anchor; action in terminal policy | `BRANCH_SUBSTITUTION_DETECTED`, `ACTION_NOT_IN_SCOPE` |
| Payment-to-execution lineage | `payTo`, `asset`, `chainId`, `value` within terminal branch scope | `PAYMENT_EXECUTION_LINEAGE_BROKEN` |
| DAG well-formedness | unique ids, one root, root `C_parent == 0`, no dangling parent, no cycle | structural finding codes |

Findings are additive: one tamper may yield several codes, each with the
certificate id and a human-readable detail. Tests assert expected codes are
present and that honest input produces an empty findings array.

## 7. Trust boundary / interaction with existing rules

- CDEP does **not** duplicate verifier R12 semantics. R12 checks the settlement
  payee against the human mandate/predicate allowlist and the registered merchant
  keys. CDEP checks the payee against the *delegation branch* scope. They are
  complementary: a payment must satisfy both to be authorized.
- R1's trusted-root caveat applies here too: matching a Merkle root or a C_exec
  to a self-declared value is internal consistency. The anchor arguments must be
  independent. This is documented in the API comments and in the experiment
  limitations.
- No new runtime dependency was added to `evidence-core` (it keeps noble hashes
  + local packages only); no package manifest was changed.
