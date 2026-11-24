# CDEP architecture - Causal Delegation and Execution Provenance
Documents the implementation as it exists here. No literature claim, no manuscript edit.

## 1. What this novelty does
Binds a settlement to ONE branch of a multi-agent delegation DAG. Each certificate
commits to the branch that authorized it and what that branch could do:

```
C_exec = H(C_parent, D_child, A_action, P_policy, H_input, H_output)
H      = keccak256(UTF-8 bytes of canonicalJson(ordered tuple))
D_child  = keccakCanonical(child identity incl. authorizedPaymentKeys)
A_action = keccakCanonical({actionId, targetAgentId, parametersHash})
P_policy = keccakCanonical({policyId, scope})
H_input / H_output = caller-supplied artifact digests
C_parent = ZERO_HASH at the human-authorized root
```

`computeCausalExecution()` hashes the six fields in that exact order using the
existing `keccakCanonical`/`canonicalJson`/`ZERO_HASH` helpers of the evidence hash
chain; `issueDelegationCertificate()` attaches `cExec`. Every child repeats its
parent's `C_exec` as `C_parent`, so changing an ancestor changes all descendants.

| Property | Mechanism | Finding code |
| --- | --- | --- |
| Parent-child authority | `child.issuer == parent.child` (`sameAgent`: agentId + registryAddr + chainId) | `PARENT_CHILD_AUTHORITY_MISMATCH` |
| Non-expanding delegation | `scopeIsSubset(child.scope, parent.scope)` on actions, assets, payees, chains, cap | `NON_EXPANDING_DELEGATION_VIOLATED` |
| Causal trace integrity | recompute each `C_exec`; `C_parent` == recomputed parent `C_exec` | `CAUSAL_COMMITMENT_MISMATCH`, `PARENT_LINK_MISMATCH` |
| Cross-agent attribution | terminal `child` == `executingAgent` (incl. keys); settlement key authorized; action targets terminal | `CROSS_AGENT_ATTRIBUTION_FAILED`, `ACTION_ATTRIBUTION_MISMATCH` |
| Branch-substitution prevention | terminal id == `expectedTerminalCertificateId`; action in terminal scope | `BRANCH_SUBSTITUTION_DETECTED`, `ACTION_NOT_IN_SCOPE` |
| Payment-to-execution lineage | `payTo`, `asset`, `chainId`, `value` inside terminal branch scope | `PAYMENT_EXECUTION_LINEAGE_BROKEN` |
| DAG well-formedness | unique ids, one root, root `C_parent == 0`, trusted root anchor, no dangling parent, no cycle | `DUPLICATE_CERTIFICATE_ID`, `MISSING_ROOT`, `MULTIPLE_ROOTS`, `ROOT_PARENT_NOT_ZERO`, `ROOT_ANCHOR_MISMATCH`, `UNKNOWN_TERMINAL_CERTIFICATE`, `MISSING_PARENT_CERTIFICATE`, `CYCLIC_DELEGATION` |

Findings are additive; `ok` is true iff the findings array is empty.

## 2. Where it fits
Built ON existing primitives. Pipeline: after delegation issuance, before
settlement verification. It complements (not replaces) R10-R13 / R12.

```
 human mandate / ERC-8004 identity --(existing)--> CLB commitment --> settlement
        |                                                               |
        +--> delegation issuance (CDEP: issueDelegationCertificate)   payee
        |                                                               |
        +--> CDEP verifyCausalExecution <-- DAG + trusted anchors + settlement
                    |
                    +--> existing deterministic verifier (verifyTrace: R10/R11/R12/R13, R1)
```
```
evidence-core/src/index.ts (existing graph/hash code, untouched)
  keccakCanonical / canonicalJson / ZERO_HASH -> reused by CDEP
  export * from "./causal"                    -> CDEP entry point
evidence-core/src/causal.ts (new): types, computeCausalExecution,
  issueDelegationCertificate, verifyCausalExecution, scopeIsSubset,
  sameDelegationIdentity, causalHash
attack-core/src/causal-delegation.ts (new): 7 fixtures + runCausalScenarios
```
CDEP checks the payee against the DELEGATION BRANCH scope; R12 checks the same
actual settlement against the human mandate/predicate allowlist and registered
merchant keys; R10/R11/R13 bind chain, amount, asset. Both must run on the same
settlement.

## 3. ASCII architecture diagram
```
 INPUT                        PROCESSING                       OUTPUT
 (DAG + anchors + settlement) (verifyCausalExecution)          (result)

 [Human] anchors: expectedRootExecCommitment,
         expectedTerminalCertificateId -----------------------------+
    |  cert-root: C_parent=0; C_exec(root)=H(0,D_child,A,P,H_in,H_out)
    v
 [Shopping Agent] root-orchestrator
    |  cert-middle: C_parent=C_exec(root); C_exec(middle)=H(C_exec(root),...)
    v
 [Research Agent] / [Payment Agent]        <-- delegation fork
    |  honest cert-terminal: C_parent=C_exec(middle)
    |  sibling cert-sibling-attacker (substituted-branch attack)
    v
 [Merchant]  payTo=merchantAddress, paymentKey=merchantAddress
    |
    v
 [Settlement] asset=USDC, value=1.50, chainId=84532 -----------------+
                                                                    |
       +------------------------------------------------------------+
       v
 +--------------------------------------------------------------+
 | CAUSAL VERIFIER verifyCausalExecution({certificates,          |
 |   terminalCertificateId, executingAgent, settlement, anchors})|
 |                                                              |
 | terminal -> root walk; recompute every C_exec                 |
 |  +-- DAG well-formedness (unique ids, one root, no cycle)     |
 |  +-- issuer == parent.child; child.scope subset parent.scope  |
 |  +-- C_parent == recomputed parent C_exec                     |
 |  +-- action targets terminal; agent + key == terminal         |
 |  +-- terminal id == trusted anchor                            |
 |  +-- payTo / asset / value / chainId in terminal scope        |
 +--------------------------------------------------------------+
       |
       v
 { ok, findings[], pathExecCommitments[], terminalExecCommitment }
```
Each vertical edge carries a certificate whose `cExec` links to its parent via
`C_parent`. The verifier checks one presented terminal path; siblings are rejected
by the branch anchor and attribution checks. The fixture reduces the fork to a
single root -> middle -> terminal chain.

## 4. Execution flow (exact call order)
Honest (`HONEST_DAG`):
```
 1 issueDelegationCertificate(root)     -> computeCausalExecution -> cExec(root)
 2 issueDelegationCertificate(middle)   -> parentExecCommitment=cExec(root) -> cExec(middle)
 3 issueDelegationCertificate(terminal) -> parentExecCommitment=cExec(middle) -> cExec(terminal)
 4 verifyCausalExecution(input + both trusted anchors), internal order:
    a byId map                          -> DUPLICATE_CERTIFICATE_ID
    b roots filter                      -> MISSING_ROOT / MULTIPLE_ROOTS /
                                           ROOT_PARENT_NOT_ZERO / ROOT_ANCHOR_MISMATCH
    c byId.get(terminalCertificateId)   -> UNKNOWN_TERMINAL_CERTIFICATE (early return)
    d terminal id vs anchor             -> BRANCH_SUBSTITUTION_DETECTED
    e walk terminal -> middle -> root   -> MISSING_PARENT_CERTIFICATE / CYCLIC_DELEGATION
    f computeCausalExecution per node   -> CAUSAL_COMMITMENT_MISMATCH
    g per edge: sameAgent(issuer,parent.child) -> PARENT_CHILD_AUTHORITY_MISMATCH
               C_parent == recomputed parent   -> PARENT_LINK_MISMATCH
               compareScopes/scopeIsSubset     -> NON_EXPANDING_DELEGATION_VIOLATED
    h terminal action target + in-scope -> ACTION_ATTRIBUTION_MISMATCH / ACTION_NOT_IN_SCOPE
    i sameDelegationIdentity(child,executingAgent) + key -> CROSS_AGENT_ATTRIBUTION_FAILED
    j lineage payTo/asset/chainId/value -> PAYMENT_EXECUTION_LINEAGE_BROKEN
    k return {ok:true, findings:[], pathExecCommitments, terminalExecCommitment}
 5 runCausalScenarios(): detected=true (zero findings)
```
Substituted branch (`SUBSTITUTED_BRANCH`):
```
 1 buildHonestCausalInput()  (steps 1-3 above)
 2 issueDelegationCertificate({...terminal, certificateId:"cert-sibling-attacker",
    child:causalAttackerAgent, issuer:middle.child, parentExecCommitment:middle.cExec,
    action:{...terminal.action, targetAgentId:causalAttackerAgent.agentId}})
 3 input' = {...input, certificates:[root,middle,terminal,sibling],
             terminalCertificateId:"cert-sibling-attacker"}
 4 verifyCausalExecution(input'):
    root/anchor ok; sibling found; anchor cert-terminal != cert-sibling-attacker
      -> BRANCH_SUBSTITUTION_DETECTED
    walk sibling -> middle -> root; recomputed C_exec all consistent (no mismatch)
    edge sibling->middle: issuer, C_parent, scope subset all ok
    action target = attacker = sibling child, ok
    sameDelegationIdentity(attacker, terminal-executor) -> CROSS_AGENT_ATTRIBUTION_FAILED
    settlement key merchantAddress not in attacker keys -> CROSS_AGENT_ATTRIBUTION_FAILED
    payTo merchantAddress still in copied terminal scope -> lineage ok
    -> ok:false, three findings
 5 runCausalScenarios(): detected=true (all expected codes present)
```

## 5. Data flow (one delegation scope, issue -> settlement)
```
 rootScope     = {actions:[delegate, analysis.report], assets:[USDC],
                  allowedPayees:[merchantAddress], allowedChainIds:[84532], maxAmount:"2.00"}
 terminalScope = {actions:[analysis.report], assets:[USDC],
                  allowedPayees:[merchantAddress], allowedChainIds:[84532], maxAmount:"1.50"}
 [issue]   P_policy(root) -> keccakCanonical -> cert-root.cExec
           P_policy(term) -> keccakCanonical -> cert-terminal.cExec
 [subset]  compareScopes(terminalScope, rootScope):
             analysis.report in root.actions   ok
             USDC in root.assets               ok
             merchantAddress in root.payees    ok
             84532 in root.chains              ok
             1.50 <= 2.00                      ok
           -> scopeIsSubset = true
 [action]  cert-terminal.action = {actionId:"analysis.report",
             targetAgentId:"terminal-executor", parametersHash:artifact("terminal-action")}
           target == child.agentId; actionId in terminalScope.actions
 [payee]   settlement = {payTo:merchantAddress, asset:"USDC", value:"1.50",
                         chainId:84532, paymentKey:merchantAddress}
           payTo in allowedPayees; asset in assets; chain in allowedChainIds;
           value <= maxAmount; paymentKey in child.authorizedPaymentKeys
 [tamper]  cap 1.50 -> 5.00  -> NON_EXPANDING_DELEGATION_VIOLATED
           payTo -> attacker -> PAYMENT_EXECUTION_LINEAGE_BROKEN (detail: payTo)
```

## 6. Integration points and boundaries
- Reuses evidence graph's `keccakCanonical`, `canonicalJson`, `ZERO_HASH`; `index.ts`
  is only extended by `export * from "./causal"`.
- Identity extends `IdentityRef` (agentId, registryAddr, chainId) with
  `authorizedPaymentKeys`; authority edges compare agent identity, full attribution
  compares the key set.
- Certificates are SELF-COMMITTED only: issuance computes a hash, never signs.
- Root/terminal anchors are CALLER-SUPPLIED; the verifier never fetches them. Without
  independent anchors a writer controlling every certificate can reissue a
  self-consistent DAG (same boundary as R1 without a trusted root).
- Fixtures are a SYNTHETIC IN-MEMORY DAG: no real multi-agent network, registry
  lookup or on-chain settlement.
- Proves consistency of the presented path, not completeness vs an external log.
- Complements, never replaces, R10-R13 / R12 on the actual settlement. No new runtime
  dependency or package manifest change.

## 7. Verification pointers
```
bun run experiments/novelty/cdep/run.ts
bun test packages/evidence-core/test/causal-delegation.test.ts
bun test packages/attack-core/test/causal-delegation.test.ts
```
`run.ts` regenerates `experiments/novelty/cdep/results.json` deterministically:

```
scenarios           7
honest passed       1 / 1   (zero findings, no false positive)
attacks detected    6 / 6   (all expected finding codes observed)
false positives     0
false negatives     0
```
| Scenario | Observed finding code(s) |
| --- | --- |
| HONEST_DAG | none |
| SUBSTITUTED_INTERMEDIATE_AGENT | PARENT_CHILD_AUTHORITY_MISMATCH |
| SUBSTITUTED_ACTION | ACTION_ATTRIBUTION_MISMATCH |
| EXPANDED_DELEGATION | NON_EXPANDING_DELEGATION_VIOLATED |
| BROKEN_PARENT_LINK | PARENT_LINK_MISMATCH |
| SUBSTITUTED_BRANCH | BRANCH_SUBSTITUTION_DETECTED, CROSS_AGENT_ATTRIBUTION_FAILED (x2) |
| SUBSTITUTED_PAYEE | PAYMENT_EXECUTION_LINEAGE_BROKEN |
