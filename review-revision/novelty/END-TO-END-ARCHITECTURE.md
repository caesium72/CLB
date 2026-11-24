# A³C-VPEAL — End-to-End Architecture with Novelties N1–N5

Legend:

```
[N1] RCLB   revocation-aware temporal cross-layer binding
[N2] IRCV   implementation-refined compositional verification
[N3] CDEP   causal delegation and execution provenance
[N4] CFRSC  cross-layer failure recovery and settlement consistency
[N5] AEARV  adaptive evidence assurance and risk-based verification

-->  data / control flow
==>  enforcement gate
~~>  feedback / audit / tooling loop
```

## Full system diagram

```
===============================================================================
 A^3C-VPEAL END-TO-END SYSTEM  (base protocol + N1/N2/N3/N4/N5)
===============================================================================

+-------------------------------------------------------------------------------+
| 0. ACTORS & OFF-CHAIN DECISION                                                |
+-------------------------------------------------------------------------------+

 [HUMAN PRINCIPAL]
        |
        | signs AP2 mandate / spending predicate
        v
 [AP2 MANDATE / PREDICATE] ----> [ERC-8004 REGISTRY + AGENT CARDS]
        |                                      |
        |                                      v
        |                              [SHOPPING AGENT]
        |                                      |
        |              +-----------------------+-----------------------+
        |              |                                               |
        |              v                                               v
        |        [RESEARCH AGENT]                              [PAYMENT AGENT]
        |              |                                               |
        |              +------ recommendation / selection evidence ----+
        |                                      |
        |                                      v
        |                           [MERCHANT SELECTION EVENT]
        |                                      |
        +--------------------+-----------------+
                             v

+-------------------------------------------------------------------------------+
| 1. BINDING LAYER  (CLB + N1 temporal authority + N3 causal lineage)           |
+-------------------------------------------------------------------------------+

 [CLB C = H(EIP712(identityRef, mandateDigest, settlementDigest))]     (Mode A)
 [CLB C'= H(EIP712(identityRef, mandateDigest, predicateId,
                   predicateDigest, settlementParamsDigest))]          (Mode B)
        |
        | [N1] AuthorityEpochRegistry: E_I (identity), E_M (mandate), T_expiry
        |       revokeIdentity / revokeMandate / rotateIdentityKey
        v
 [N1] C_t = keccak256(abi.encode(C, E_I, E_M, T_expiry, N))
        |
        | [N3] Delegation DAG:
        |      C_exec = H(C_parent, D_child, A_action, P_policy, H_input, H_output)
        v
 [N3] Causal verifier:
        parent-child authority  /  non-expanding scope  /  branch attribution
        causal trace integrity  /  settlement payee lineage
        |
        v

+-------------------------------------------------------------------------------+
| 2. EXECUTION LAYER  (x402 + guard + N4 recovery)                              |
+-------------------------------------------------------------------------------+

 [x402 PAYMENT AUTHORIZATION] -- nonce = H(C) or H(C_t) -->
        |
        ==> [N1] RevocationAwareGuard.sol ==>
        |      accept iff E_I == current AND E_M == current
        |                 AND t <= T_expiry AND N not consumed
        |      revocation wins races: atomic revert before nonce consume
        v
 [FACILITATOR: local / HTTP / on-chain]  (chain-bound: ChainMismatchError)
        |
        v
 [N4] RECOVERY STATE MACHINE
   AUTHORIZED --> RESERVED --> SETTLEMENT_PENDING --> SETTLED --> FULFILLMENT_PENDING --> COMPLETED
        |              |              |                   |              |
        |              |              +--- TIMEOUT -------+              +--- DISPUTED --> COMPENSATION_PENDING
        |              +--- idempotency key + CAS store + hash-chained recovery evidence
        v
 [SETTLEMENT RECEIPT] --> [DELIVERY REPORT + deliveryBinding]
        |
        v

+-------------------------------------------------------------------------------+
| 3. EVIDENCE & VERIFICATION LAYER  (R1-R18 + N5 adaptive policy)               |
+-------------------------------------------------------------------------------+

 [EVIDENCE EVENTS: USER / ERC8004 / AP2 / X402 / CHAIN / DELIVERY / DECISION_CONTEXT]
        |
        v
 [HASH CHAIN + MERKLE ROOT] <== trusted root / strict mode (R1 hardening)
        |
        +--> [N1] trusted epoch snapshot --> R18 REVOCATION_AWARE_BINDING
        |
        +--> [N5] risk signals I,A,S,D,H --> R --> tier V1 / V2 / V3
        |           mandatory R1,R2,R5,R6,R8,R9,R10,R17 at EVERY tier
        |           additive checks only (identity / provenance / delivery)
        v
 [DETERMINISTIC VERIFIER R1-R17 + R18] --> [VERIFICATION CERTIFICATE]
        |
        v
 [AgenticAuditAnchor.sol]  (on-chain Merkle root / trace hash)

+-------------------------------------------------------------------------------+
| 4. EVALUATION & BASELINES                                                     |
+-------------------------------------------------------------------------------+

 [B0 Vanilla x402] [B1 AP2+x402] [B2 eBay monitor] [B3 Full CLB-ACEL]
        |
        v
 [Attack simulator / 465-scenario matrix / 21 extended attacks]
        |
        v
 [Metrics: latency / gas / scaling / variance / overhead vs plain x402]
        |
        v
 [N5 comparison: fixed V1  vs  adaptive  vs  always-V3  (n=39)]

+-------------------------------------------------------------------------------+
| 5. [N2] IRCV VERIFICATION TOOLING LOOP  (sits beside all four layers)         |
+-------------------------------------------------------------------------------+

 Tamarin clb-aligned.spthy / committed proofs
        |
        v
 [MODEL TRACE GENERATOR] --> tau_model (normalized formal trace)
        |                                      |
        |                                      v
        |                          [DIFFERENTIAL ENGINE] <---------------+
        |                                      |                        |
        |                                      v                        |
        +--> [SERIALIZATION CHECKER] ----> 17 TS <-> EIP712/ABI checks   |
        |                                                               |
        +--> [CROSS-LANGUAGE PBT / forge script] --> tau_impl -----------+
        |          64 seeded cases / 512 field comparisons              |
        |                                                               |
        +--> [COUNTEREXAMPLE REPRODUCER] --> executable adversarial test +
                                                                        |
                                                                        v
                                                             PASS / FAIL report
                                                                        |
                                                                        v
                                                  experiments/novelty/ircv/ artifacts
```

## Novelty placement summary

| Novelty | Layer(s) | What it adds | Does NOT replace |
|---|---|---|---|
| **N1 RCLB** | 1 → 2 → 3 | Epoch registry, `C_t`, R18, `RevocationAwareGuard`, revocation/settlement race ordering | Existing `C`/`C'`, predicate guard, verifier R1–R17 |
| **N2 IRCV** | 5 (tooling loop) | Model/implementation trace normalization, differential engine, serialization checker, PBT, counterexample-to-test | Protocol enforcement; no new Tamarin proof claimed |
| **N3 CDEP** | 0 → 1 → 3 | `C_exec` per delegation edge, DAG verifier, payee lineage | `verifyTrace` R10–R13/R12; complements them |
| **N4 CFRSC** | 2 → 3 | Durable recovery state machine, idempotency, CAS store, hash-chained recovery evidence | Guard, facilitator, delivery-core |
| **N5 AEARV** | 3 → 4 | Risk score `R`, tiers V1/V2/V3, additive checks | Mandatory cryptographic rules — they run at every tier |

## End-to-end data flow in one line

```
Human intent --> AP2 mandate --> ERC-8004 identity --> CLB C/C'
   --> [N1] C_t with live epochs --> [N3] C_exec delegation lineage
   --> x402 authorization --> [N1] guard --> facilitator
   --> [N4] recovery state machine --> settlement receipt --> delivery report
   --> evidence events --> hash chain/Merkle --> [N5] risk tier
   --> verifier R1-R17 + R18 --> certificate --> on-chain anchor
   --> baselines/attacks --> metrics --> [N2] differential verification loop
```

## Honest boundaries of this diagram

- `AgenticAuditAnchor.sol` exists, but the verifier does **not** yet read the anchor by default — trusted-root/strict mode is caller-supplied.
- `[N1]` R18 is opt-in; callers must supply the trusted epoch snapshot.
- `[N2]` validates a scoped event vocabulary — not a general refinement theorem; no new Tamarin proof.
- `[N3]` certificates are self-committed unless external anchors are supplied.
- `[N4]` store is single-process and has no clock; formal properties are code-enforced, not symbolically proved.
- `[N5]` risk weights are a priori and uncalibrated; mandatory rules are never downgraded.
- Gas figures are LOCAL ANVIL / DEMO; public Base Sepolia evidence is a separate artifact.
