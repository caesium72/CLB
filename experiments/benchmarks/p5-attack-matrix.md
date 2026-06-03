# Phase 4 (P5) Predicate Attack Matrix — Mode B

Separate from the Phase 3 binding matrix: this evaluates **predicate soundness**
(P5) for the delegated flow. Violations fail R17 and are prevented at the
predicate guard; the happy path settles and passes.

| Scenario | Predicate attack | Vanilla x402 (B0) | AP2 + x402 (B1) | ACEL audit-only (B2) | Full CLB + ACEL (B3) | Failed rules |
| --- | --- | --- | --- | --- | --- | --- |
| Agent stays within your limits | PREDICATE_HAPPY_PATH | Allowed | Allowed | Allowed | Allowed | — |
| Pay an unapproved merchant | PREDICATE_PAYEE_VIOLATION | Allowed | Allowed | Detected | Prevented | R12_PAYEE_MATCHES_CHECKOUT_OR_TASK, R17_PREDICATE_TRUE_FOR_MODE_B |
| Spend above your limit | PREDICATE_AMOUNT_VIOLATION | Allowed | Allowed | Detected | Prevented | R11_AMOUNT_WITHIN_MANDATE, R17_PREDICATE_TRUE_FOR_MODE_B |
| Pay with the wrong token | PREDICATE_ASSET_VIOLATION | Allowed | Allowed | Detected | Prevented | R13_ASSET_ALLOWED, R17_PREDICATE_TRUE_FOR_MODE_B |
| Settle after your deadline | PREDICATE_EXPIRED | Allowed | Allowed | Detected | Prevented | R17_PREDICATE_TRUE_FOR_MODE_B |

B0 = Vanilla x402, B1 = AP2 + x402, B2 = ACEL audit-only, B3 = Full CLB + ACEL (guard + R17).

