# Phase 3 Attack Matrix

| Attack | Vanilla x402 (B0) | AP2 + x402 (B1) | ACEL audit-only (B2) | Full CLB + ACEL (B3) |
| --- | --- | --- | --- | --- |
| PAYEE_SUBSTITUTION | Allowed | Allowed | Detected | Detected |
| AMOUNT_ESCALATION | Allowed | Allowed | Detected | Detected |
| ASSET_SWITCH | Allowed | Allowed | Detected | Detected |
| CHAIN_TRANSPLANT | Allowed | Allowed | Detected | Detected |
| AGENT_IDENTITY_SWAP | Allowed | Allowed | Detected | Detected |
| MANDATE_REPLAY | Allowed | Allowed | Detected | Prevented |
| CART_OR_TASK_SWITCH | Allowed | Allowed | Detected | Detected |
| PAYMENT_WITHOUT_DELIVERY | Allowed | Allowed | Detected | Detected |
| FAKE_FEEDBACK | Allowed | Allowed | Detected | Detected |
| PROMPT_INJECTION_SELECTION | Allowed | Allowed | Detected | Detected |

B0 = Vanilla x402: No CLB binding.
B1 = AP2 + x402: AP2 mandate without nonce binding.
B2 = ACEL audit-only: Audit-only detection.
B3 = Full CLB + ACEL: Full CLB + ACEL with x402 replay prevention.
