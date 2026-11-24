# Reviewer #2, Comment 1 — Evaluation Summary

Generated 2026-11-24T21:26:38.958Z from seed base 1800000000000.

## 1. Compositional adversarial matrix

- Attack primitives: 9 (merchant, agent, settlement, delivery, evidence families)
- Scenarios per seed: 93 (9 singles + 72 ordered pairs + 12 curated chains)
- Seeds: 5
- Total executed scenarios: 465
- Detected: 465 (100.00%)
- Undetected scenarios: none

| Steps in chain | Scenarios | Detected | Detection rate |
|---|---|---|---|
| 1 | 45 | 45 | 100.0% |
| 2 | 360 | 360 | 100.0% |
| 3 | 60 | 60 | 100.0% |

| Attack family | Scenarios | Detected | Detection rate |
|---|---|---|---|
| merchant | 210 | 210 | 100.0% |
| agent | 215 | 215 | 100.0% |
| settlement | 200 | 200 | 100.0% |
| delivery | 215 | 215 | 100.0% |
| evidence | 105 | 105 | 100.0% |

## 2. Pre-settlement prevention (Mode B delegated flow)

| Scenario | Guard denied | Settlement attempted | Receipt issued | Prevented |
|---|---|---|---|---|
| MALICIOUS_MERCHANT_PAYEE_SUBSTITUTION | true | false | false | true |
| MALICIOUS_MERCHANT_REVOKED_IDENTITY | true | false | false | true |
| COMPROMISED_AGENT_AMOUNT_ESCALATION | true | false | false | true |
| COMPROMISED_AGENT_ASSET_SWITCH | true | false | false | true |
| COMPROMISED_AGENT_CHAIN_SWITCH | true | false | false | true |
| COMPROMISED_AGENT_TASK_SUBSTITUTION | true | false | false | true |
| EXPIRED_AUTHORIZATION | true | false | false | true |
| MULTI_STEP_SELECTION_THEN_SUBSTITUTION | true | false | false | true |
| MULTI_STEP_ESCALATION_THEN_REPLAY | true | true | false | true |

Prevented: 9/9.

## 3. Concurrent settlement

| Concurrency | Trials per mode | Settled (same nonce) | Settled (distinct nonces) | Settled (mixed) | Anomalies |
|---|---|---|---|---|---|
| 2 | 20 | 20 | 40 | 40 | 0 |
| 4 | 20 | 20 | 80 | 60 | 0 |
| 8 | 20 | 20 | 160 | 100 | 0 |
| 16 | 20 | 20 | 320 | 180 | 0 |
| 32 | 20 | 20 | 640 | 340 | 0 |

- Total concurrent attempts: 3720
- Total settled: 2060
- Total rejected on nonce: 1660
- Other errors: 0
- Anomalies: 0
- Limitation: the nonce reservation is in-process; cross-replica deployments need a shared nonce store.

## 4. Named composed sequences (post-settlement detection)

- MERCHANT_SUBSTITUTION_WITH_SELECTION_MANIPULATION: detected=true, stage=post-settlement, failed=R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR; R12_PAYEE_MATCHES_CHECKOUT_OR_TASK
- COMPROMISED_AGENT_WITH_AMOUNT_ESCALATION: detected=true, stage=post-settlement, failed=R4_AGENT_PAYMENT_KEY_AUTHORIZED; R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR; R11_AMOUNT_WITHIN_MANDATE
- MALICIOUS_MERCHANT_WITH_FORGED_DELIVERY: detected=true, stage=post-settlement, failed=R2_SIGNATURES_VALID; R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR; R12_PAYEE_MATCHES_CHECKOUT_OR_TASK; R14b_DELIVERY_BOUND_TO_SETTLEMENT
