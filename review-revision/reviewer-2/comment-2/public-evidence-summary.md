# Reviewer #2 Comment 2 — Public Base Sepolia evidence

**Status: RESOLVED (technical).** Real public-network evaluation executed on Base Sepolia (chain 84532).

## LATEST run (2026-11-24/25) — supersedes the table below

The artifact currently at `experiments/benchmarks/reviewer2/comment2/public/onchain-guard-results.public.json`
is from a second, genuine public run after the guard was hardened:

| Field | Value |
|---|---|
| Deployed guard | `0xB1c8273F74365c146c9b8b233b7286a441ac2652` |
| Deploy tx | `0xb519166199bebf4d4c244013578985ac8d95b8b6c29ebf838f7ef550365e3176` (status 0x1, block 63090452) |
| HAPPY_PATH tx | `0x02514915602e91362e678dee2d16148fd53f6b5ba480d10a254362a94c3fc1a4` (status 0x1, block 63090479, 92,520 gas) |
| Payee substitution tx | `0x5008789266f996951bd9617399f0ba40fee6b8feb558c6` (status **0x0**, block 63090504, 68,727 gas) |
| Attempts | 11 mined, 11/11 as expected |
| Registration | `registerPredicateBound` (human-signed binding) |

Both public runs are real; the earlier guard `0xd52430439eA87A11580C37a6E9C20BAE26d6aa4E`
remains valid evidence, but the current artifact is the one named above.
## What changed from the earlier local-only state (first public run)

| Before | After |
|---|---|
| Local Anvil EVM only | **Base Sepolia public testnet**, 11 mined transactions |
| `PUBLIC_NETWORK_EVIDENCE: false` | `PUBLIC_NETWORK_EVIDENCE: true` |
| No tx hashes / blocks | Real tx hashes, block numbers, gas, BaseScan links |
| Funding blocked | PoW-mined Sepolia ETH → canonical bridge → Base Sepolia |

## Artifacts

- `experiments/benchmarks/reviewer2/comment2/public/onchain-guard-results.public.json`
- `experiments/benchmarks/reviewer2/comment2/public/onchain-guard-results.public.csv`
- Local Anvil artifacts remain intact and untouched.

## Execution record

| Field | Value |
|---|---|
| Network | Base Sepolia (chain 84532) |
| RPC | `https://sepolia.base.org` |
| Signer | `0x8eEd4275420870c43C06f370Af3AD53FFdB3B005` |
| Deployed guard | `0xd52430439eA87A11580C37a6E9C20BAE26d6aa4E` |
| Attempts | 11 |
| Mined transactions | 11 |
| As expected | 11/11 |
| Public evidence flag | `true` |

Sample verified receipts (queried directly from the public RPC):

| Scenario | txHash | Receipt status | Block | BaseScan |
|---|---|---|---|---|
| HAPPY_PATH | `0x26eb801b2ddbbc7c27cced084a92433add90f79d40d603ee465b1c2484d9d494` | `0x1` (success) | `0x3c236f8` | https://sepolia.basescan.org/tx/0x26eb801b2ddbbc7c27cced084a92433add90f79d40d603ee465b1c2484d9d494 |
| MALICIOUS_MERCHANT_PAYEE_SUBSTITUTION | `0x66eb5efae5e7b97d2b0d5782df7dd3c5402a7aa3b785128a849d055905a1550c` | `0x0` (reverted before transfer) | `0x3c23711` | https://sepolia.basescan.org/tx/0x66eb5efae5e7b97d2b0d5782df7dd3c5402a7aa3b785128a849d055905a1550c |

## Reproduce

```powershell
$env:Path="$env:USERPROFILE\.bun\bin;$env:USERPROFILE\.foundry\bin;$env:Path"
cd "E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2"
bun run e2e:reviewer2:comment2:public
```

Prerequisites documented in `base-sepolia-implementation.md` and `funding-guide.md` (RPC + funded signer or pre-deployed guard).

## Honest limits

- Both public runs are genuine. The latest run registers via `registerPredicateBound`; the older run used `registerPredicate`. The legacy path is now settlement-inert in the hardened contract (R3-C2).
- Only 0.001 ETH was bridged and used; no mainnet funds were touched.
- Cross-replica nonce replay (same chain, separate facilitator stores) remains a documented limit, not claimed solved.

## Verification after the public run

```
typecheck clean
full suite 360 pass / 2 skip / 0 fail
reproduce:all exit 0 · version check PASS · validator 49/49
```

