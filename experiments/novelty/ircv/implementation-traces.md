# IRCV — normalized implementation traces

Every trace uses `ircv-trace/v1`, the same schema as the model trace. Scenarios are existing fixtures; no protocol source was changed.

| Scenario | Kind | verifyTrace | Failed rules | Events |
| --- | --- | --- | --- | --- |
| MODE_A_HONEST | out-of-model | PASS | — | 7 |
| MODE_B_HONEST | honest | PASS | — | 10 |
| MODE_B_PAYEE_ATTACK | attack | FAIL | R12_PAYEE_MATCHES_CHECKOUT_OR_TASK, R17_PREDICATE_TRUE_FOR_MODE_B | 11 |
| MODE_B_AMOUNT_ATTACK | attack | FAIL | R11_AMOUNT_WITHIN_MANDATE, R17_PREDICATE_TRUE_FOR_MODE_B | 11 |
| MODE_B_REPLAY_ATTACK | attack | FAIL | R9_NONCE_CONSUMED_EXACTLY_ONCE | 11 |
| RCLB_STALE_IDENTITY_EPOCH | out-of-model | FAIL | R18_REVOCATION_AWARE_BINDING | 8 |

Notes per scenario:

- **MODE_A_HONEST**: Honest exact-settlement trace (Mode A). Expected: NOT COMPARABLE (model is Mode B only); verifier PASS. 
- **MODE_B_HONEST**: Honest delegated settlement inside the human-signed predicate. Expected: CONFORMANT (all MC constraints hold); verifier PASS. 
- **MODE_B_PAYEE_ATTACK**: Settlement routes to a payee outside the human-signed predicate. Expected: NON-CONFORMANT (MC-P4); verifier FAIL. The mode-b fixture calls the facilitator directly and therefore settles despite the predicate rejection; the pre-settlement guard path (draftModeBPayment + InMemoryPredicateGuard) is a separate, earlier gate.
- **MODE_B_AMOUNT_ATTACK**: Settlement amount exceeds the human-signed predicate cap. Expected: NON-CONFORMANT (MC-P4); verifier FAIL. Fixture-level divergence: the direct facilitator path settles before the off-chain predicate gate; see MODE_B_PAYEE_ATTACK note.
- **MODE_B_REPLAY_ATTACK**: Second settlement attempt with the same C' nonce. Expected: CONFORMANT after prevention (MC-P3 holds); verifier FAIL flags the attempt. The second attempt was rejected by the local x402 facilitator before a second nonce consumption was recorded.
- **RCLB_STALE_IDENTITY_EPOCH**: Settlement presents C_t signed under an identity epoch that has since been revoked. Expected: NOT COMPARABLE (RCLB absent from clb-aligned.spthy); verifier R18 FAIL. R18 is additive and opt-in; the model has no revocation fact, so this scenario is reported as out-of-model.
