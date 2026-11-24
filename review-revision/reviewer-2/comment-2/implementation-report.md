# Reviewer #2, Comment 2 — public/production-like network evaluation

## What was executed

`bun run scripts/e2e-reviewer2-comment2.ts` compiles the real
`PredicatePaymentGuard.sol`, deploys it to an **isolated local Anvil EVM**, and drives
`ContractPredicateGuard.settleOnChain` over the ten pre-settlement plans (eleven attempts,
counting the replay). Every commitment/nonce was recomputed off-chain and matched the input
passed to the contract (`commitment_parity_ok = true` in all rows).

| Item | Value |
|---|---|
| `executionEnvironment` | `local-anvil-evm` |
| `PUBLIC_NETWORK_EVIDENCE` | `false` |
| Chain | local Anvil, chain id 84532, deterministic genesis 2026-05-30T05:00:00Z |
| Foundry | forge/anvil 1.10.0, installed to `~/.foundry` |
| Guard (local, ephemeral) | `0x5fbdb2315678afecb367f032d93f642f64180aa3` (deploy tx `0x08320a9a…3c9c`, block 1) |
| Attempts | 11 — 8 reverted, 3 allowed, **11/11 as expected** |

> **THE DEPLOYMENT AND ALL TRANSACTIONS ABOVE ARE ON A LOCAL ANVIL EVM. NOTHING WAS
> BROADCAST TO BASE SEPOLIA OR ANY PUBLIC NETWORK. NO PUBLIC TX HASH OR BLOCK NUMBER IS CLAIMED.**

## Results (local Anvil)

| Scenario | Expected Solidity error | Result | nonce consumed after | local tx hash? |
|---|---|---|---|---|
| HAPPY_PATH | — | allowed | yes | yes (local, block 3) |
| MALICIOUS_MERCHANT_PAYEE_SUBSTITUTION | `PayeeNotAllowed` | reverted | no | no |
| MALICIOUS_MERCHANT_REVOKED_IDENTITY | `PayeeNotAllowed` | reverted | no | no |
| COMPROMISED_AGENT_AMOUNT_ESCALATION | `AmountExceedsMax` | reverted | no | no |
| COMPROMISED_AGENT_ASSET_SWITCH | `AssetNotAllowed` | reverted | no | no |
| COMPROMISED_AGENT_CHAIN_SWITCH | `ChainNotAllowed` | reverted | no | no |
| COMPROMISED_AGENT_TASK_SUBSTITUTION | — | **allowed** | yes | yes (local, block 10) |
| EXPIRED_AUTHORIZATION | `PredicateExpired` | reverted | no | no |
| MULTI_STEP_SELECTION_THEN_SUBSTITUTION | `PayeeNotAllowed` | reverted | no | no |
| MULTI_STEP_ESCALATION_THEN_REPLAY (1) | — | allowed | yes | yes (local, block 14) |
| MULTI_STEP_ESCALATION_THEN_REPLAY (2) | `NonceAlreadyConsumed` | reverted | yes (from attempt 1) | no |

Full data: `experiments/benchmarks/reviewer2/comment2/onchain-guard-results.{json,csv}`.

## What "before any transfer" means here

The guard is a **validating enforcer** called before the settlement path. For every reverted
attempt the artifact records:

- `reverted: true` with the exact Solidity custom-error name decoded by viem;
- `nonceConsumedAfter: false` (read from the contract's `consumed` mapping) and no
  `SettlementConsumed` log — i.e. no guard state change;
- `facilitatorInvoked: false` — the harness never calls the x402 facilitator, so no value
  transfer path is exercised at all.

Reverts are captured at `simulateContract`/validation time: no reverted transaction is
broadcast, so there is deliberately **no revert tx hash**. On a public chain this could be
upgraded to a mined-and-reverted tx via `runLiveOnChainRejection`'s manual-gas path.

## Honest gaps found

1. **Task substitution is not enforced on-chain.** `validateAndConsume` checks
   payee / asset / chain / `valueAtomic` / expiry / nonce only. A `taskHash` mismatch
   (`COMPROMISED_AGENT_TASK_SUBSTITUTION`) is *allowed* by the contract and is still blocked
   only by the in-process `evaluatePredicate(observedTaskHash)`. This is recorded as
   `expectedReason: null` with an explanatory `note` — not silently omitted.
2. **Local ≠ public.** Anvil reproduces EVM/Solidity semantics but not public mempool,
   gas market, finality, or BaseScan verifiability. No production-like uptime/throughput
   claim is supported by this artifact.
3. **Mock fallback exists** (`COMMENT2_MODE=mock`) and is labeled
   `executionEnvironment: "mock-contract-semantics"` with zero tx hashes; it was verified
   separately but is **not** the artifact currently on disk.

## BLOCKER — public Base Sepolia evidence still required

**PUBLIC NETWORK EVIDENCE IS NOT AVAILABLE.** The environment has **no**
`RPC_URL_BASE_SEPOLIA` / `RPC_URL`, **no funded** `DEPLOYER_PRIVATE_KEY` (or
`SHOPPING_AGENT_PRIVATE_KEY`), and **no deployed** `PREDICATE_GUARD_ADDRESS`. Those are
required by `scripts/deploy-predicate-guard-sepolia.ts` and
`apps/web-demo/src/server/clb/predicate-guard.ts::runLiveOnChainRejection`. Until they are
supplied, this comment can only claim local-EVM execution, which is **not** equivalent to
the reviewer's requested public/production-like evaluation.

## Code added

- `packages/predicate-adapter/src/onchain.ts` — `consumed` in ABI + `makeViemGuardReader`.
- `packages/predicate-adapter/src/mock-guard-chain.ts` — faithful offline revert model.
- `packages/predicate-adapter/test/revert-mapping.test.ts` — 5 revert-mapping tests.
- `scripts/e2e-reviewer2-comment2.ts` — the harness.
- root `package.json` + `bun.lock` — `viem` devDependency (root scripts could not resolve it
  otherwise; the lockfile was refreshed by `bun install` as a side effect).
