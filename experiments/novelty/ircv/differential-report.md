# IRCV — differential report

Model source: `formal/tamarin/clb-aligned.spthy` (parsed only). Constraints evaluated: MC-P1, MC-P2, MC-P3, MC-P4, MC-P5, MC-P6.

| Scenario | Conformance | Violated constraints | Verifier | Result |
| --- | --- | --- | --- | --- |
| MODE_A_HONEST | NOT COMPARABLE | — | PASS | PASS |
| MODE_B_HONEST | CONFORMANT | — | PASS | PASS |
| MODE_B_PAYEE_ATTACK | NON-CONFORMANT | MC-P4 | FAIL | PASS |
| MODE_B_AMOUNT_ATTACK | NON-CONFORMANT | MC-P4 | FAIL | PASS |
| MODE_B_REPLAY_ATTACK | CONFORMANT | — | FAIL | PASS |
| RCLB_STALE_IDENTITY_EPOCH | NOT COMPARABLE | — | FAIL | PASS |

## Concrete differences

- MODE_B_PAYEE_ATTACK / MC-P4: expected predicate_decision(predicateId=predicate-001, decision=allow); actual predicate-001:reject
- MODE_B_AMOUNT_ATTACK / MC-P4: expected predicate_decision(predicateId=predicate-001, decision=allow); actual predicate-001:reject

## Coverage

- Observed event kinds (11): commitment, delegation, key_authorization, nonce, nonce_consumption, predicate_decision, predicate_registration, principal_anchor, settlement, settlement_failure, verification_verdict
- Mapped to model alphabet (10): commitment, delegation, key_authorization, nonce_consumption, predicate_decision, predicate_registration, principal_anchor, settlement, settlement_failure, verification_verdict
- Implementation-only (1): nonce
- Model kinds not observed (0): none

Summary: 6 scenarios, 4 comparable, 6 PASS, 0 FAIL, 1 conformant honest, 3 detected attacks.

**Scope statement:** a PASS means the observed trace matched the recorded expectation for that scenario. It does NOT prove that the implementation refines the model in general: Mode A and RCLB are outside the model alphabet, fixture-level pre-settlement bypasses are reported explicitly, and the proof record was not re-checked.
