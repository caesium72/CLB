# Reviewer #2, Comment 2 — Base Sepolia public-network implementation

## UPDATE — public run completed (2026-11-24/25)

The signer was funded (~0.00397 SepETH via PoW-mined Sepolia ETH bridged to Base
Sepolia). A real public evaluation ran: guard
`0xB1c8273F74365c146c9b8b233b7286a441ac2652` (deploy tx
`0xb519166199bebf4d4c244013578985ac8d95b8b6c29ebf838f7ef550365e3176`),
11 mined txs, 11/11 as expected, `PUBLIC_NETWORK_EVIDENCE: true`. Independently
verified against `https://sepolia.base.org` (HAPPY_PATH status 0x1, payee
substitution status 0x0). Registration uses `registerPredicateBound`.
The "NOT RUN" section below is kept as the historical pre-funding state.
## Status (historical, before funding)

**NOT RUN on the public network.** The configured throwaway signer
`0x8eEd4275420870c43C06f370Af3AD53FFdB3B005` has **0 ETH** on Base Sepolia, so no
deployment or transaction was attempted. The executed evidence remains the
**local Anvil EVM** run documented in `implementation-report.md`
(`PUBLIC_NETWORK_EVIDENCE: false`). The code path below is ready to run the moment
the key is funded or a pre-deployed guard address is supplied.

| Artifact                                                                             | Meaning                                       |
| ------------------------------------------------------------------------------------ | --------------------------------------------- |
| `experiments/benchmarks/reviewer2/comment2/onchain-guard-results.json`               | Local Anvil, executed default (unchanged)     |
| `experiments/benchmarks/reviewer2/comment2/public/onchain-guard-results.public.json` | Public harness, currently `status: "NOT RUN"` |
| `experiments/benchmarks/reviewer2/comment2/public/onchain-guard-results.public.csv`  | Same result in tabular form                   |

## Exact command

```bash
bun run e2e:reviewer2:comment2:public
# equivalent: bun run scripts/e2e-reviewer2-comment2-public.ts
```

Foundry on PATH is required for `forge create`; the script falls back to
`~/.foundry/bin/forge` (override with `FORGE_BIN`). It reads `.env` automatically —
do **not** paste keys on the command line.

## Prerequisites

Set in `.env` (gitignored — keep it that way):

| Variable                                                 | Required | Purpose                                                             |
| -------------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| `RPC_URL_BASE_SEPOLIA` (or `RPC_URL`)                    | yes      | Public RPC; must report `eth_chainId == 84532`                      |
| `DEPLOYER_PRIVATE_KEY` (or `SHOPPING_AGENT_PRIVATE_KEY`) | yes      | Throwaway testnet signer, **funded with a little Base Sepolia ETH** |
| `PREDICATE_GUARD_ADDRESS`                                | no       | Reuse an already-deployed guard; skips `forge create`               |

- Free testnet ETH: <https://www.alchemy.com/faucets/base-sepolia>
- Foundry (`forge`) for the deployment branch only. Reusing `PREDICATE_GUARD_ADDRESS` skips it.
- The signer key is never printed or written to any artifact. `forge create` receives it
  as an argv value, and any error output is redacted before being stored.

## What happens

```
.env credentials ──► preflight (eth_chainId, eth_getBalance)
                          │
              balance == 0 ──► NOT RUN artifact, exit 0 (no tx, no deploy)
                          │ funded
             PREDICATE_GUARD_ADDRESS? ──yes──► reuse guard
                          │ no
             forge create --broadcast --constructor-args 84532
                          │
             registerPredicate (idempotent: isRegistered check)
                          │
             10 PLANS / 11 attempts via ContractPredicateGuard.settleOnChain
                          │
       simulate to decode error ──► writeContract(gas: 400000n) ──► mined receipt
                          │
                public JSON + CSV (PUBLIC_NETWORK_EVIDENCE true only if all 11
                attempts match expectations AND all 11 txs were mined)
```

1. **Preflight.** `eth_chainId` must be 84532 and `eth_getBalance` must be > 0.
   A zero balance with no guard address means **no deployment is attempted**.
2. **Guard.** Without `PREDICATE_GUARD_ADDRESS`, deploys via
   `forge create src/PredicatePaymentGuard.sol:PredicatePaymentGuard --rpc-url <rpc>
--private-key <key> --broadcast --constructor-args 84532` and parses `Deployed to:`.
   With the address set, reuses it and only registers missing predicates.
3. **Registration.** Uses `registerPredicate` (not `registerPredicateBound`). The bound
   path would add a chain cross-check and a taskHash pin, changing the expected results
   of `COMPROMISED_AGENT_CHAIN_SWITCH` and `COMPROMISED_AGENT_TASK_SUBSTITUTION`, and
   requires a separate human EIP-191 signature. Keeping the legacy registration makes
   the ten PLANS byte-for-byte comparable with the local harness while the guard still
   enforces C'/nonce/payee/asset/chain/amount/expiry on-chain.
4. **Settlement.** Each violation is first simulated to decode the Solidity custom
   error, then the **same calldata is force-broadcast with an explicit 400,000 gas
   limit** so it is _mined and reverted_ — a real failed public transaction. Happy
   paths are mined successful transactions. No x402 facilitator is called; the guard
   transfers no funds.
5. **Clock.** Local Anvil uses a fixed 2026-05-30 timestamp; on the public chain the
   harness moves each predicate's `validUntil` to `now + 1 day` (except the deliberate
   `EXPIRED_AUTHORIZATION` plan) so only the intended scenario expires.

## Unfunded behaviour (verified in this workspace)

Exact observed output:

```text
$ bun run e2e:reviewer2:comment2:public
{
  "status": "NOT RUN",
  "reason": "signer unfunded on Base Sepolia",
  "outputDir": "E:\\RESEARCH\\A3C-VPEAL [ICCIT-26]\\A3C-v2\\experiments\\benchmarks\\reviewer2\\comment2\\public"
}
```

The artifact records `status: "NOT RUN"`, `reason: "signer unfunded on Base Sepolia"`,
`PUBLIC_NETWORK_EVIDENCE: false`, `balanceAtPreflightWei: "0"`, the signer address,
tool versions and timestamps. No tx hash or block number is present. Exit code is 0.

## Verifying a funded run on BaseScan

After a funded run, every result row carries `txHash`, `blockNumber`, `gasUsed`,
`reverted`, `reason`, `asExpected` and an `explorerUrl` of the form
`https://sepolia.basescan.org/tx/<hash>`. Open that URL:

- Violations show **Status: Failed** with the decoded custom error in the transaction
  details (e.g. `PayeeNotAllowed`, `AmountExceedsMax`).
- Happy paths show **Status: Success** and a `SettlementConsumed` log from the guard.
- Cross-check the `blockNumber` and `gasUsed` in the artifact against BaseScan.

`PUBLIC_NETWORK_EVIDENCE` is set to `true` **only** when all 11 attempts match their
expected outcome and all 11 mined receipts exist. Partial or failed runs stay `false`
with `status: "FAILED"`.

## Honest statement

Local Anvil evidence remains the executed default for this reviewer comment. This file
adds a _ready-to-run_ public path, not public evidence. Nothing here claims Base Sepolia
execution, throughput, uptime, or production-readiness until a funded run produces the
real transaction hashes described above.

