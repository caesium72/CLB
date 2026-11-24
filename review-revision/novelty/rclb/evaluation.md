# RCLB evaluation (local, reproducible, DEMO)

All numbers below were produced by executing the code in this repository on
2026-11-24/25. Raw data: `experiments/novelty/rclb/metrics.json`; forge log:
`experiments/novelty/rclb/forge-rclb.log`; regenerator:
`experiments/novelty/rclb/generate-metrics.ts`.

Environment: Bun 1.4.5, Foundry forge 1.10.0, solc 0.8.28, Windows x64,
forge-std cloned to TEMP and passed via `--remappings` (never into the repo).
Gas is **LOCAL EVM / ANVIL CLASS, DEMO** — not a testnet or mainnet measurement.

## Metrics

| Metric | Measured value | Definition / method |
|---|---|---|
| Adversarial prevention | **7/7** | scenarios with `expectedAccepted=false` that were actually rejected |
| Stale acceptance rate | **0 / 1 = 0.00** | one `STALE_REGISTRY_READ` scenario where a cached snapshot would accept; execution-time read accepted 0 |
| False rejection rate | **0 / 1 = 0.00** | one `HONEST_CONTROL`; it was accepted |
| Race resistance | **1 / 1 = 1.00** | revocation committed between pre-check and settlement; settlement rejected and N left unconsumed |
| Revocation latency (median) | **0.0456 ms** | 200 in-process samples: `revokeIdentity()` + one acceptance decision |
| Revocation latency (mean / p95 / max) | **0.0672 / 0.0892 / 2.3342 ms** | same sample; max includes cold-start noise |
| Gas — baseline accept | **5,769 gas** | same-shape accept: recompute C_t, check H(C_t), one storage write, no epoch reads/expiry |
| Gas — RCLB guard | **59,834 gas** | `RevocationAwareGuard.validateAndConsume`, from forge `-vv` event log |
| Gas overhead | **54,065 gas** | guard − baseline |

`revocationLatencyMs` explicitly **excludes** network propagation, RPC latency,
consensus finality and CRL distribution. It measures only the in-process
decision cost. The gas delta also includes cold account access, ABI decoding
and the settlement event, not just the two epoch comparisons; interpret it as
an upper-bound implementation overhead on this local EVM, not an isolated
microbenchmark.

## Scenario outcomes (from `metrics.json`)

| Scenario | Accepted | Violation |
|---|---|---|
| SETTLE_AFTER_IDENTITY_REVOCATION | no | `IDENTITY_EPOCH_STALE` |
| SETTLE_AFTER_MANDATE_REVOCATION | no | `MANDATE_EPOCH_STALE` |
| KEY_ROTATION_INVALIDATES_OLD_COMMITMENT | no | `IDENTITY_EPOCH_STALE` |
| STALE_REGISTRY_READ | no | `IDENTITY_EPOCH_STALE` (cached snapshot would accept) |
| REVOCATION_VS_SETTLEMENT_RACE | no | `MANDATE_EPOCH_STALE` |
| DELAYED_MESSAGE_EXPIRED | no | `COMMITMENT_EXPIRED` |
| NONCE_REPLAY_AFTER_HONEST_SETTLEMENT | no | `NONCE_ALREADY_CONSUMED` |
| HONEST_CONTROL | yes | — |

## Golden vector (cross-language parity)

```
C    = 0xb037baea2770d584aaa7db43383b9b79d31ad22d4dc17f4e6d71f3bf60bc01c3
E_I  = 1, E_M = 1, T_expiry = 1800000000, N = 0x11..11
C_t  = 0x0762bd5e6332d3e17a575c4710a59140be62a8271ae1bc0243479c4b229b04cd
nonce= 0x5685014776e638d963b925559ce9a1c7675278e2956876b1fc40f49dfd641a63
```

The Solidity test uses a second vector with `C = 0x11..11`, `N = 0x22..22`:
`C_t = 0x89f2259d2fd8d40cb851d89e3b976a1a52978204f2515c8d690014cd46895758`,
`nonce = 0x44998b1e24797bdcecf5e641dc5e566de4e79ce21c48014e7dc61a73861596dd`.
Both are computed by `clb-core` and asserted in `RevocationAwareGuard.t.sol`.

## Reproduction

```bash
# from repository root; PATH includes ~/.bun/bin and ~/.foundry/bin
bun test packages/clb-core/test/epochs.test.ts \
         packages/verifier-core/test/revocation.test.ts \
         packages/attack-core/test/revocation-scenarios.test.ts
bun run typecheck
bun test

# forge with a TEMP forge-std clone, not the repo-local lib
git clone --depth 1 https://github.com/foundry-rs/forge-std.git "$TEMP/rclb-forge-std"
cd contracts
forge test --remappings "forge-std/=$TEMP/rclb-forge-std/src/" \
           --match-contract RevocationAwareGuardTest -vv

cd ..
bun run experiments/novelty/rclb/generate-metrics.ts
```

Observed results at generation time:

- new bun test files: **28 pass / 0 fail** (83 expect calls)
- `bun run typecheck`: clean
- full `bun test`: **421 pass / 2 skip / 0 fail** (69 files)
- `forge test` with TEMP remap, full suite: **87 tests passed / 0 failed** (9 suites)
- guard suite: **13 passed / 0 failed**

## Limits

- Single authority / single epoch pair; no distributed revocation or CRL.
- Epoch state is an in-memory demo registry in TypeScript and a single-owner
  mapping in Solidity. No live ERC-8004 deployment was consulted.
- Rates are over 8 scripted scenarios, not a sampled operational workload;
  0/1 denominators are reported explicitly rather than generalised.
- Gas number is a local EVM demo probe. No mainnet gas price or USD cost is claimed.
- No claim of literature novelty or priority is made here.
