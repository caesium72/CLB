# Phase 4 Gas Report

| Component | Metric | Gas | Notes |
| --- | --- | --- | --- |
| AgenticAuditAnchor.sol | anchorTrace | Run `forge test --gas-report` | Mode A anchor. |
| PredicatePaymentGuard.sol | deployment | Pending live forge gas parse | Mode B caveat enforcer. |
| PredicatePaymentGuard.sol | validateAndConsume | 50396 | C' recompute + predicate + nonce consume. |

_Numbers parsed live from `forge test --match-contract PredicatePaymentGuardTest --gas-report`._
