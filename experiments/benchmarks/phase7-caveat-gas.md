# Phase 7A Gas Report — On-chain Mode B Prevention

| Path | Method | Gas | Notes |
| --- | --- | --- | --- |
| Happy settlement | validateAndConsume (live Anvil) | 76006 | C' recompute + predicate + single-use nonce. |
| Forge gas report | validateAndConsume (avg) | 52590 | From `forge test --gas-report`. |

Violating (over-budget) settlement reverted on-chain with **AmountExceedsMax** before any transfer.
Replay of the happy nonce reverted with **NonceAlreadyConsumed**.

