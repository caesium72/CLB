# IRCV — counterexample reproduction

- Status: **PASS**
- Source: built-in sample
- Parsed scenario: SETTLE_AFTER_IDENTITY_REVOCATION
- Expected rejection: true; actual rejection: true
- Generated executable script: `E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2\experiments\novelty\ircv\reproduce-stale-identity-epoch.ts`

## Execution

- RCLB acceptance violations: IDENTITY_EPOCH_STALE
- Local facilitator accepted the payment: true
- verifyTrace status: FAIL / failed rules: R18_REVOCATION_AWARE_BINDING
- Payment nonce: 0x5685014776e638d963b925559ce9a1c7675278e2956876b1fc40f49dfd641a63

The local x402 facilitator accepts the stale C_t payment nonce; rejection comes from the opt-in R18 RCLB gate (IDENTITY_EPOCH_STALE). RCLB is absent from clb-aligned.spthy, so this counterexample is executable but outside the formal model's alphabet.
