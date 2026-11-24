# Reproduction record

Generated 2026-11-24T21:26:45.522Z by bun run reproduce:all. Every number below is parsed from the JSON artifacts produced by this run. Some artifacts carry the fixed fixture timestamp 2026-05-30T05:00:00.000Z as generatedAt; the authoritative run time is the timestamp on this line.

## 1. Purpose and scope

This record reproduces the A³C-VPEAL evaluation pipeline end to end. It runs every evidence-generating benchmark, records tool versions and per-step exit codes, validates generated artifacts against canonical JSON sources, and writes this report.

Scope: deterministic local runs only. No public-network evidence is claimed (requires Base Sepolia credentials — see §6). The Forge/Anvil-dependent step is skipped when Foundry is unavailable. Three pre-existing test failures in apps/merchant-agent-api and services/identity-service are outside this reproduction set (see §18).

## 2. Supported operating systems and architecture

- Operating systems: Windows, Linux
- Architecture: x64
- This run: win32 (x64), Windows_NT 10.0.26300

## 3. Runtime versions (probed by this run)

Each row is the live stdout of the command shown, not a documented expectation. Exit codes are the probe's real exit codes; SKIPPED means the tool is absent and no version is claimed.

| Tool | Command | Version (probed) | Exit | Status | Minimum | Check |
|---|---|---|---|---|---|---|
| Bun | bun --version | 1.4.5 | 0 | OK | ≥ 1.4 | PASS |
| Node | node --version | v26.13.1 | 0 | OK | ≥ 20 | PASS |

Overall version check: PASS.

## 4. Foundry / Anvil / Solidity versions (full profile, probed)

| Tool | Command | Version (probed) | Exit | Status |
|---|---|---|---|---|
| forge | forge --version | forge Version: 1.10.0 | 0 | OK |
| anvil | anvil --version | anvil Version: 1.10.0 | 0 | OK |
| solc | solc --version | not installed | -1 | SKIPPED |

- Compile target: contracts/src/PredicatePaymentGuard.sol, source pragma pragma solidity ^0.8.28;
- Anvil chain: 84532, port 18545 (configuration, not a version claim)
- Override binaries via FORGE_BIN / ANVIL_BIN environment variables
- Foundry-dependent steps are SKIPPED when forge/anvil are absent; no version is asserted for them.

## 4b. Dependencies (install status and lockfile identity)

| Field | Value |
|---|---|
| Install command | bun install --frozen-lockfile |
| Install status / exit | PASS / 0 |
| Install log summary | Checked 746 installs across 808 packages (no changes) [79.00ms] |
| Lockfile | bun.lock (203833 bytes) |
| Lockfile SHA-256 | 0824867ad6b7f94f1ecfb8f2e7ad63736a80f46739360c57c17fa50f2da8dc07 |

## 5. Clean installation instructions

From the repository root:

powershell
$env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
bun install --frozen-lockfile


Foundry (optional, for full profile): install via the official installer at https://foundry.paradigm.xyz, then add ~/.foundry/bin to PATH.

## 6. Environment-variable names and safe configuration

| Variable | Purpose | Example |
|---|---|---|
| RPC_URL_BASE_SEPOLIA | Base Sepolia RPC endpoint | https://sepolia.base.org |
| RPC_URL | Fallback RPC endpoint | |
| DEPLOYER_PRIVATE_KEY | Funded signer key for deployment | 0x... (never commit) |
| SHOPPING_AGENT_PRIVATE_KEY | Alternate signer key | 0x... (never commit) |
| PREDICATE_GUARD_ADDRESS | Already-deployed guard address | 0x... |
| COMMENT2_MODE | Force mock mode (mock) | mock |
| COMMENT2_ANVIL_PORT | Anvil port override | 18545 |
| REVIEWER2_ATTACK_SEED | Base seed for adversarial matrix | 1800000000000 |
| FORGE_BIN | Custom forge binary path | |
| ANVIL_BIN | Custom anvil binary path | |

Never store API keys, private credentials, or secret values in this report or in committed files. Use .env (gitignored) for local secrets.

## 7. Standard profile command


bun run reproduce:all


Requires Bun only. Foundry-dependent steps are reported as SKIPPED when Foundry is unavailable. Never claims skipped experiments were reproduced.

## 8. Full profile command


bun run reproduce:all


Same command; profile is selected implicitly by whether Foundry is installed. Requires Bun + Foundry + Anvil. Runs all applicable experiments and fails if any required step fails.

## 9. Pipeline step descriptions

| Step | Command | Purpose |
|---|---|---|
| preflight-install | bun install --frozen-lockfile | Install locked dependencies before type checking |
| typecheck | bun run typecheck | TypeScript project build check |
| core-tests | bun test packages/attack-core/test packages/x402-adapter/test packages/predicate-adapter/test | Core package unit tests |
| phase3-mode-a | bun run e2e:phase3 | Mode A attack matrix (10 attacks × 4 baselines) |
| phase4-mode-b | bun run e2e:phase4 | Mode B predicate fixtures (5 attacks) |
| phase4b-p5-matrix | bun run e2e:phase4b | Mode B predicate attack matrix |
| phase7-baselines | bun run e2e:phase7-baselines | Live B0–B3 baseline comparison |
| five-attacks | bun run e2e:five-attacks | Five Attacks on x402 reproduction |
| reviewer2-comment1 | bun run e2e:reviewer2:comment1 | Compositional adversarial matrix + prevention + concurrency |
| reviewer2-comment2-local-evm | bun run e2e:reviewer2:comment2 | On-chain guard evaluation (Foundry/Anvil) |
| validate-artifacts | bun run scripts/validate-artifacts.ts | Canonical artifact validation (49 checks) |

## 10. Baseline definitions B0–B3

| ID | Name | Description | Role |
|---|---|---|---|
| B0 | Vanilla x402 | Settlement well-formedness only, no cross-layer rules | Baseline |
| B1 | AP2 + x402 | AP2 mandate + x402, no ERC-8004 identity binding, no C′ recompute | Baseline |
| B2 | eBay-style external monitor | AP2 context-binding + consume-once, single-protocol, audit-only | Baseline |
| B3 | Full CLB-ACEL | Full stack: CLB binding, ACEL evidence, deterministic verifier, on-chain prevention | Target system |

## 11. Attack-case definitions and fixture locations

| Matrix | Fixture location | Attack IDs |
|---|---|---|
| Mode A binding | packages/attack-core/src/index.ts | PAYEE_SUBSTITUTION, AMOUNT_ESCALATION, ASSET_SWITCH, CHAIN_TRANSPLANT, AGENT_IDENTITY_SWAP, MANDATE_REPLAY, CART_OR_TASK_SWITCH, PAYMENT_WITHOUT_DELIVERY, FAKE_FEEDBACK, PROMPT_INJECTION_SELECTION |
| Mode B predicate | packages/attack-core/src/mode-b.ts | PREDICATE_HAPPY_PATH, PREDICATE_PAYEE_VIOLATION, PREDICATE_AMOUNT_VIOLATION, PREDICATE_ASSET_VIOLATION, PREDICATE_EXPIRED |
| Compositional | packages/attack-core/src/adversarial-matrix.ts | 9 primitives × singles + ordered pairs + 3-step chains |
| Pre-settlement prevention | packages/attack-core/src/presettlement.ts | 9 prevention scenarios |

## 12. Outcome classification

| Outcome | Meaning |
|---|---|
| PREVENTED | Attack rejected before the protected operation |
| DETECTED | Attack identified, but prevention is not established |
| EXPLOITED | Attack achieved its defined objective |
| PARTIALLY_MITIGATED | Some but not all attack effects were prevented |
| NOT_APPLICABLE | Attack is outside the baseline's defined scope |
| ERROR | Experiment did not produce a valid result |
| SKIPPED | Required experimental tool or prerequisite was unavailable |

Detection (DETECTED) is never collapsed into prevention (PREVENTED). B0–B2 are verifiers, not enforcers: they can detect but not prevent. Only B3 prevents.

Every `baselineComparison` cell in results.json / p5-results.json and every row of baseline-comparison.json carries an `outcome` field with one of these categories, derived at runtime by `deriveOutcome()` in `packages/attack-core/src/types.ts`.

## 13. Latency measurement boundaries

TBD — The current harness records settlementLatencyMs from performance.now() in markReplayAttempt() (an internal detail). End-to-end step-level latency boundaries are not yet documented.

## 14. Gas measurement boundaries

TBD — comment2 records tx hashes, block numbers, and revert reasons but not gas used. Guard-only gas vs. complete payment/settlement gas boundaries are not yet documented.

## 15. Raw result locations

| Artifact | Path |
|---|---|
| Baseline comparison | experiments/benchmarks/baseline-comparison.json |
| Mode A results | experiments/benchmarks/results.json |
| Mode B predicate results | experiments/benchmarks/p5-results.json |
| Compositional matrix | experiments/benchmarks/reviewer2/comment1/adversarial-matrix.json |
| Pre-settlement prevention | experiments/benchmarks/reviewer2/comment1/presettlement-results.json |
| Concurrency results | experiments/benchmarks/reviewer2/comment1/concurrency-results.json |
| Composed attack results | experiments/benchmarks/reviewer2/comment1/composed-attack-results.json |
| On-chain guard results | experiments/benchmarks/reviewer2/comment2/onchain-guard-results.json |

## 16. Generated report locations

| Report | Path |
|---|---|
| Reproduction record | experiments/benchmarks/REPRODUCIBILITY.md (this file) |
| Mode A attack matrix | experiments/benchmarks/attack-matrix.md |
| Mode B predicate matrix | experiments/benchmarks/p5-attack-matrix.md |
| Baseline comparison | experiments/benchmarks/baseline-comparison.md |
| Five Attacks comparison | experiments/benchmarks/five-attacks-comparison.md |
| R2-C1 summary | experiments/benchmarks/reviewer2/comment1/SUMMARY.md |
| Step logs | experiments/benchmarks/reproduction-logs/ |

## 17. Artifact validation command


bun run scripts/validate-artifacts.ts


Run as the final step of bun run reproduce:all. Performs 49 checks across 15 categories: schema validation, unknown baseline/attack IDs, baseline coverage, duplicate detection, applicability matrix coverage, NOT_APPLICABLE representation, matrix/baselineComparison consistency, DETECTED vs PREVENTED separation, JSON↔Markdown, JSON↔CSV, report counts, skipped/failed integrity, timestamp integrity, stale artifact detection, phase artifact presence. Exits non-zero on any failure.

## 18. Known test prerequisites and failures

| Test file | Status | Prerequisites |
|---|---|---|
| apps/merchant-agent-api/test/merchant-agent-api.test.ts |  Pre-existing failure | X402_PRICE env var defaults to "2.00"; test expects "0.0000001" |
| services/identity-service/test/identity-service.test.ts |  Pre-existing failure | Seeding order registers agent "6827" first; test expects "analysis-agent-001" |
| apps/agent-orchestrator/test/agent-orchestrator.test.ts |  Pre-existing failure | Test expects 7 evidence events; implementation emits 8 |

All three are deterministic test-setup mismatches, resolved by aligning test expectations (option A). None require network, credentials, or external services. They are excluded from this reproduction set.

## 19. Meaning of PASS, FAIL, SKIPPED and NOT RUN

| Status | Meaning |
|---|---|
| PASS | Step exited 0 and produced expected artifacts |
| FAIL | Step exited non-zero; pipeline halts |
| SKIPPED | Required tool absent (e.g., Foundry); step not run, artifact not regenerated |
| NOT RUN | Step not reached due to earlier failure |

Overall status: PASS only when every required step for the selected profile passes. Skipped steps are allowed in the standard profile but must not be claimed as reproduced.

## 20. Limitations of the reproduction environment

- Single local environment (Windows, x64); results may differ on other OS/arch
- No public-network evidence (Base Sepolia credentials required — see §6)
- No end-to-end latency or gas capture (§13, §14 TBD)
- Some artifacts carry fixed fixture timestamps (2026-05-30T05:00:00.000Z); the report's top timestamp is authoritative
- The nonce reservation in the local facilitator is in-process; multi-replica deployments need a shared nonce store

---

## Commands

| Step | Command | Status | Exit | Log |
|---|---|---|---|---|
| preflight-install | bun install --frozen-lockfile | PASS | 0 | experiments/benchmarks/reproduction-logs/preflight-install.log |
| typecheck | bun run typecheck | PASS | 0 | experiments/benchmarks/reproduction-logs/typecheck.log |
| core-tests | bun test packages/attack-core/test packages/x402-adapter/test packages/predicate-adapter/test | PASS | 0 | experiments/benchmarks/reproduction-logs/core-tests.log |
| phase3-mode-a | bun run e2e:phase3 | PASS | 0 | experiments/benchmarks/reproduction-logs/phase3-mode-a.log |
| phase4-mode-b | bun run e2e:phase4 | PASS | 0 | experiments/benchmarks/reproduction-logs/phase4-mode-b.log |
| phase4b-p5-matrix | bun run e2e:phase4b | PASS | 0 | experiments/benchmarks/reproduction-logs/phase4b-p5-matrix.log |
| phase7-baselines | bun run e2e:phase7-baselines | PASS | 0 | experiments/benchmarks/reproduction-logs/phase7-baselines.log |
| five-attacks | bun run e2e:five-attacks | PASS | 0 | experiments/benchmarks/reproduction-logs/five-attacks.log |
| reviewer2-comment1 | bun run e2e:reviewer2:comment1 | PASS | 0 | experiments/benchmarks/reproduction-logs/reviewer2-comment1.log |
| reviewer2-comment2-local-evm | bun run e2e:reviewer2:comment2 | PASS | 0 | experiments/benchmarks/reproduction-logs/reviewer2-comment2-local-evm.log |
| validate-artifacts | bun run scripts/validate-artifacts.ts | PASS | 0 | experiments/benchmarks/reproduction-logs/validate-artifacts.log |

All executed steps exited 0.


## Baseline composition (live evaluators)

Source: baseline-comparison.json (generated 2026-05-30T05:00:00.000Z). "missed" means the weaker stack accepted the attacked trace.

| Attack | Vanilla x402 | AP2 + x402 | eBay monitor | Full CLB-ACEL | Detection rule | Outcome taxonomy (B0 / B1 / B2 / B3) |
|---|---|---|---|---|---|---|
| PAYEE_SUBSTITUTION | missed | caught | caught | caught | R12_PAYEE_MATCHES_CHECKOUT_OR_TASK | EXPLOITED / DETECTED / DETECTED / DETECTED |
| AMOUNT_ESCALATION | missed | caught | missed | caught | R11_AMOUNT_WITHIN_MANDATE | EXPLOITED / DETECTED / EXPLOITED / DETECTED |
| ASSET_SWITCH | missed | caught | missed | caught | R13_ASSET_ALLOWED | EXPLOITED / DETECTED / EXPLOITED / DETECTED |
| CHAIN_TRANSPLANT | missed | missed | missed | caught | R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR, R10_CHAIN_DOMAIN_MATCHES | EXPLOITED / EXPLOITED / EXPLOITED / DETECTED |
| AGENT_IDENTITY_SWAP | missed | missed | missed | caught | R4_AGENT_PAYMENT_KEY_AUTHORIZED | EXPLOITED / EXPLOITED / EXPLOITED / DETECTED |
| MANDATE_REPLAY | missed | missed | caught | caught | R9_NONCE_CONSUMED_EXACTLY_ONCE | EXPLOITED / EXPLOITED / DETECTED / DETECTED |
| CART_OR_TASK_SWITCH | missed | missed | missed | caught | R15_TASK_HASH_MATCHES | EXPLOITED / EXPLOITED / EXPLOITED / DETECTED |
| PAYMENT_WITHOUT_DELIVERY | missed | missed | missed | caught | R2_SIGNATURES_VALID, R14b_DELIVERY_BOUND_TO_SETTLEMENT | EXPLOITED / EXPLOITED / EXPLOITED / DETECTED |
| FAKE_FEEDBACK | missed | missed | missed | caught | audit: Feedback event has no prior VERIFICATION_CERTIFICATE evidence | EXPLOITED / EXPLOITED / EXPLOITED / DETECTED |
| PROMPT_INJECTION_SELECTION | missed | missed | missed | caught | audit: Discovery selected a merchant outside allowedPayees | EXPLOITED / EXPLOITED / EXPLOITED / DETECTED |
| PREDICATE_HAPPY_PATH | missed | missed | missed | missed | — | EXPLOITED / EXPLOITED / EXPLOITED / EXPLOITED |
| PREDICATE_PAYEE_VIOLATION | missed | caught | caught | caught | R12_PAYEE_MATCHES_CHECKOUT_OR_TASK, R17_PREDICATE_TRUE_FOR_MODE_B | EXPLOITED / DETECTED / DETECTED / PREVENTED |
| PREDICATE_AMOUNT_VIOLATION | missed | caught | missed | caught | R11_AMOUNT_WITHIN_MANDATE, R17_PREDICATE_TRUE_FOR_MODE_B | EXPLOITED / DETECTED / EXPLOITED / PREVENTED |
| PREDICATE_ASSET_VIOLATION | missed | caught | missed | caught | R13_ASSET_ALLOWED, R17_PREDICATE_TRUE_FOR_MODE_B | EXPLOITED / DETECTED / EXPLOITED / PREVENTED |
| PREDICATE_EXPIRED | missed | missed | caught | caught | R17_PREDICATE_TRUE_FOR_MODE_B | EXPLOITED / EXPLOITED / DETECTED / PREVENTED |

## Mode A matrix

Source: results.json (generated 2026-11-24T21:26:22.768Z).

| Attack | B0 | B1 | B2 | B3 |
|---|---|---|---|---|
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

## Mode B predicate matrix

Source: p5-results.json (generated 2026-05-30T05:00:00.000Z).

| Scenario | B0 | B1 | B2 | B3 |
|---|---|---|---|---|
| PREDICATE_HAPPY_PATH | Allowed | Allowed | Allowed | Allowed |
| PREDICATE_PAYEE_VIOLATION | Allowed | Detected | Detected | Prevented |
| PREDICATE_AMOUNT_VIOLATION | Allowed | Detected | Allowed | Prevented |
| PREDICATE_ASSET_VIOLATION | Allowed | Detected | Allowed | Prevented |
| PREDICATE_EXPIRED | Allowed | Allowed | Detected | Prevented |

## Broader adversarial evaluation

Source: reviewer2/comment1/adversarial-matrix.json (generated 2026-11-24T21:26:33.221Z).

| Metric | Value |
|---|---|
| Scenarios | 465 |
| Detected | 465 |
| Detection rate | 100.0% |
| Undetected | 0 |

## On-chain guard (local EVM)

Source: reviewer2/comment2/onchain-guard-results.json (generated 2026-11-24T21:26:41.452Z).

| Field | Value |
|---|---|
| Execution environment | local-anvil-evm |
| Public network evidence | false |
| Attempts (reverts / as expected) | 11 (8 / 11) |

## Stale artifact warnings

None.

All regenerated markdown matrices agree with the live JSON baselines.

## Artifact validation

Source: scripts/validate-artifacts.ts (run as the final step of reproduce:all).

| Check | Status |
|---|---|
| Artifact validation | PASS | exit 0 |

All artifact validation checks passed. Generated Markdown/CSV agree with canonical JSON; no stale or duplicate records.

## Scope

- The local facilitator and Anvil runs are deterministic; no public-network evidence is claimed.
- Three unrelated pre-existing test failures in apps/merchant-agent-api and services/identity-service are outside this reproduction set.
