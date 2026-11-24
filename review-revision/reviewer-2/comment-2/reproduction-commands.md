# Reviewer #2, Comment 2 — reproduction commands

Run from `E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2` in PowerShell. Bun 1.4.5 and Foundry
1.10.0 (`~/.foundry/bin`) are the versions used; Foundry was installed with the official
installer into the default `~/.foundry` location (not the brain folder).

```powershell
$env:Path = "$env:USERPROFILE\.bun\bin;$env:USERPROFILE\.foundry\bin;$env:Path"

# 1. Main evidence: compile + deploy to local Anvil + exercise the guard
bun run scripts/e2e-reviewer2-comment2.ts
# => attempts 11, reverts 8, allowed 3, asExpected 11/11, publicNetworkEvidence false
# writes experiments/benchmarks/reviewer2/comment2/onchain-guard-results.{json,csv}

# 2. Typecheck
bun run typecheck
# => tsc --build, exit 0, no diagnostics

# 3. Relevant tests
bun test packages/predicate-adapter/test
# => 17 pass, 0 fail, 33 expect() calls, 3 files

# 4. Full suite (for context — 3 pre-existing failures outside this change's scope)
bun test
# => 195 pass, 3 fail, 911 expect() calls, 198 tests / 48 files
# failures: apps/merchant-agent-api/test/merchant-agent-api.test.ts
#           services/identity-service/test/identity-service.test.ts (2 cases)
```

Mock fallback (no chain; produces `executionEnvironment: "mock-contract-semantics"` and zero
tx hashes). **Re-run step 1 afterwards to restore the real local-chain artifact:**

```powershell
$env:COMMENT2_MODE = 'mock'
bun run scripts/e2e-reviewer2-comment2.ts
Remove-Item Env:COMMENT2_MODE
```

The harness writes `forge-out/` and `forge-cache/` inside the artifacts directory only; it
starts Anvil on `127.0.0.1:18545` (override with `COMMENT2_ANVIL_PORT`) and kills it in a
`finally` block. Only `src/PredicatePaymentGuard.sol` is compiled, so the missing
`contracts/lib/forge-std` submodule does not block the build.

## BLOCKER — what still cannot be reproduced here

Public Base Sepolia evidence requires credentials that are **absent** in this environment:

```powershell
$env:RPC_URL_BASE_SEPOLIA = '<https://...base-sepolia-rpc...>'
$env:DEPLOYER_PRIVATE_KEY = '<0x... funded key...>'
# then either deploy a fresh guard:
bun run scripts/deploy-predicate-guard-sepolia.ts
# and set the printed address:
$env:PREDICATE_GUARD_ADDRESS = '<0x...deployed guard...>'
```

`SHOPPING_AGENT_PRIVATE_KEY` is an alternative signer accepted by
`runLiveOnChainRejection`. With those set, call that function (or extend the harness to
point its `publicClient`/`walletClient` at `baseSepolia`) to obtain mined, BaseScan-viewable
transactions. **Until then, every tx hash and block number in the artifact is explicitly
labeled LOCAL ANVIL ONLY; no public-network claim is made.**

## Verification of honesty guards in the artifact

- `PUBLIC_NETWORK_EVIDENCE: false`
- `ON_CHAIN_EXECUTION_CLAIM`: capital-letter statement of local-only execution
- `credentialsPresent`: all five credential flags are `false`
- `credentialBlocker`: the full blocker text
- `caveat`: reverted attempts are simulation-captured, so no revert tx hash exists
