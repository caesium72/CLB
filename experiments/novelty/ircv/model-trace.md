# IRCV — normalized formal trace vocabulary

Source: `formal/tamarin/clb-aligned.spthy` (parsed only; Tamarin was NOT executed).
Committed proof: `formal/tamarin/proofs/clb-aligned.proof`; result: `formal/tamarin/proofs/clb-aligned.result.txt`.
Toolchain from committed artifacts: Tamarin 1.12.0, Maude 3.1.

Theory **CLBAligned**: 7 rules, 11 action labels, 8 lemmas.
All lemma statuses below are copied from the committed result file — **no new proof was run**.

## Rules and observable action facts

| Rule | Action facts |
| --- | --- |
| Anchor_Principal | PrincipalAnchored |
| Register_Agent | KeyAuthorized |
| Register_Predicate | PredicateRegistered |
| Authorize_ModeB | DelegatedB, AdmitB |
| Settle_ModeB | Eq, Eq, Paid, GuardPassed, SettledB, Consumed |
| Failed_Settle_ModeB | FailedSettle |
| Settle_Recovered | Eq, Eq, Paid, GuardPassed, SettledB, Consumed |

## Lemmas (committed statuses)

| Lemma | Quantifier | Status from committed result |
| --- | --- | --- |
| exec_aligned_modeB | exists-trace | verified (22 steps) |
| P1_identity_binding | all-traces | verified (10 steps) |
| P2_authorization_integrity | all-traces | verified (18 steps) |
| P3_no_replay | all-traces | verified (96 steps) |
| P4_non_transferability | all-traces | verified (16 steps) |
| P5_predicate_soundness | all-traces | verified (18 steps) |
| P6_principal_anchor | all-traces | verified (6 steps) |
| P7_failed_settlement_recovery | exists-trace | verified (25 steps) |

## Structural constraints used by the differential engine

- **MC-P1** (P1_identity_binding): A settlement's paying key must be an authorized key of the same agentId.
- **MC-P2** (P2_authorization_integrity): A settlement must trace to a human delegation with the same commitment and nonce.
- **MC-P3** (P3_no_replay): A nonce may be consumed at most once.
- **MC-P4** (P4_non_transferability): Settlement fields must equal those the predicate decision admitted.
- **MC-P5** (P5_predicate_soundness): The predicate digest bound in the settlement must be the delegated one.
- **MC-P6** (P6_principal_anchor): Every settlement traces to an anchored human principal.

## Honest limits

- Tamarin was NOT executed: this generator only parses committed artifacts.
- Model vocabulary is Mode B (delegated/predicate) only; Mode A exact traces are outside the model alphabet.
- Revocation epochs (RCLB) are absent from clb-aligned.spthy; RCLB scenarios are reported as out-of-model.
