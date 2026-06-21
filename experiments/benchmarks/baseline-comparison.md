# Phase 7D — Baseline Composition Comparison

Each weaker stack ACCEPTs (misses) at least one cross-layer attack that full CLB-ACEL REJECTs (catches), confirming that the binding rules and predicate semantics are load-bearing.

| Attack | Mode | Vanilla x402 | AP2 + x402 | eBay monitor | Full CLB-ACEL | CLB detection |
| --- | --- | --- | --- | --- | --- | --- |
| Settlement payee is swapped to an attacker address. | A | Accepted | Rejected | Rejected | Rejected | R12_PAYEE_MATCHES_CHECKOUT_OR_TASK |
| Settlement amount exceeds the human mandate max amount. | A | Accepted | Rejected | Accepted | Rejected | R11_AMOUNT_WITHIN_MANDATE |
| Settlement asset changes from the allowed USDC asset. | A | Accepted | Rejected | Accepted | Rejected | R13_ASSET_ALLOWED |
| Settlement receipt is transplanted to the wrong chain domain. | A | Accepted | Accepted | Accepted | Rejected | R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR, R10_CHAIN_DOMAIN_MATCHES |
| Payer settlement key is not authorized by the bound ERC-8004 agent card. | A | Accepted | Accepted | Accepted | Rejected | R4_AGENT_PAYMENT_KEY_AUTHORIZED |
| The same CLB-derived x402 nonce is submitted twice. | A | Accepted | Accepted | Rejected | Rejected | R9_NONCE_CONSUMED_EXACTLY_ONCE |
| Mandate taskHash and delivered report inputDataHash diverge. | A | Accepted | Accepted | Accepted | Rejected | R15_TASK_HASH_MATCHES |
| Delivery proof is invalid after payment settlement. | A | Accepted | Accepted | Accepted | Rejected | R2_SIGNATURES_VALID, R14b_DELIVERY_BOUND_TO_SETTLEMENT |
| ERC-8004 feedback appears without a verifier certificate predecessor. | A | Accepted | Accepted | Accepted | Rejected | audit: Feedback event has no prior VERIFICATION_CERTIFICATE evidence |
| Discovery is steered to a merchant outside the mandate allowedPayees constraint. | A | Accepted | Accepted | Accepted | Rejected | audit: Discovery selected a merchant outside allowedPayees |
| Agent stays within your limits | B | Accepted | Accepted | Accepted | Accepted | — |
| Pay an unapproved merchant | B | Accepted | Rejected | Rejected | Rejected | R12_PAYEE_MATCHES_CHECKOUT_OR_TASK, R17_PREDICATE_TRUE_FOR_MODE_B |
| Spend above your limit | B | Accepted | Rejected | Accepted | Rejected | R11_AMOUNT_WITHIN_MANDATE, R17_PREDICATE_TRUE_FOR_MODE_B |
| Pay with the wrong token | B | Accepted | Rejected | Accepted | Rejected | R13_ASSET_ALLOWED, R17_PREDICATE_TRUE_FOR_MODE_B |
| Settle after your deadline | B | Accepted | Accepted | Rejected | Rejected | R17_PREDICATE_TRUE_FOR_MODE_B |

> **Legend:** For the three baseline columns, `Accepted` on an attack row means the attack was **missed** by that baseline. `Rejected` means it was caught. For the CLB-ACEL column, `Rejected` is the correct outcome for attacks.

> **Mode B note:** For AP2 compatibility, a Mode B mandate mirrors the human-signed `SpendingPredicate` fields (payee / amount / asset / validUntil) into `mandate.constraints`. Baselines that read those constraints can therefore *incidentally* catch a single-field violation — AP2+x402 flags the payee/amount/asset rows, and the eBay monitor flags the payee/expiry rows. But each baseline still misses the dimensions it does not check (AP2+x402 misses the expiry deadline; the eBay monitor misses amount and asset), and none of them bind the full predicate to the settlement commitment C′ or enforce it at the on-chain guard + R17. Only CLB-ACEL evaluates the predicate as one cryptographically-bound rule and prevents the violation in-protocol; the baselines, at best, detect one field after the fact.

