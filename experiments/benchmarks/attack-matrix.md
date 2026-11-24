# Phase 3 Attack Matrix

| Attack | Vanilla x402 (B0) | AP2 + x402 (B1) | eBay monitor (B2) | Full CLB + ACEL (B3) |
| --- | --- | --- | --- | --- |
| PAYEE_SUBSTITUTION | Allowed | Detected | Detected | Detected |
| AMOUNT_ESCALATION | Allowed | Detected | Allowed | Detected |
| ASSET_SWITCH | Allowed | Detected | Allowed | Detected |
| CHAIN_TRANSPLANT | Allowed | Allowed | Allowed | Detected |
| AGENT_IDENTITY_SWAP | Allowed | Allowed | Allowed | Detected |
| MANDATE_REPLAY | Allowed | Allowed | Detected | Prevented |
| CART_OR_TASK_SWITCH | Allowed | Allowed | Allowed | Detected |
| PAYMENT_WITHOUT_DELIVERY | Allowed | Allowed | Allowed | Detected |
| FAKE_FEEDBACK | Allowed | Allowed | Allowed | Detected |
| PROMPT_INJECTION_SELECTION | Allowed | Allowed | Allowed | Detected |

B0 = Vanilla x402: No CLB binding.
B1 = AP2 + x402: AP2 mandate without nonce binding.
B2 = eBay monitor: Audit-only detection.
B3 = Full CLB + ACEL: Full CLB + ACEL with x402 replay prevention.
