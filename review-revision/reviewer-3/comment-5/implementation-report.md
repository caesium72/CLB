# Reviewer #3, Comment 5 — Reproducibility and baseline comparison

**Comment:** "Insufficient reproducibility and baseline comparison."

**Status: RESOLVED** (one-command reproduction, generated report, baseline inconsistency fixed at source).

## What was missing

- Several independent `e2e:*` commands with no single entry point.
- No record of tool versions, exit codes, or which artifact came from which command.
- **Two different baseline methodologies** produced conflicting tables:
  - `attack-matrix.md` / `p5-attack-matrix.md` used *static fixture labels* for B0–B2.
  - `baseline-comparison.json` used *live B0–B2 verifiers*.
  - Result: B1 (AP2 + x402) was "Allowed" in one table and "caught" in the other.

## What changed

### 1. One-command reproduction (`scripts/reproduce-all.ts`)

`bun run reproduce:all` runs, in order:

```
preflight (bun install --frozen-lockfile)
typecheck
core tests (attack-core, x402-adapter, predicate-adapter)
e2e:phase3          Mode A matrix
e2e:phase4          Mode B fixtures
e2e:phase4b         P5 predicate matrix
e2e:phase7-baselines live B0–B2 baseline comparison
e2e:five-attacks    Five Attacks reproduction
e2e:reviewer2:comment1  compositional matrix + prevention + concurrency
e2e:reviewer2:comment2  local Anvil guard evaluation
```

Each step's stdout/stderr is saved to `experiments/benchmarks/reproduction-logs/<step>.log`, with exit code and status (`PASS`/`FAIL`/`SKIP`) recorded. The script exits non-zero if any step fails.

If Foundry is absent, the local-EVM step is **skipped explicitly** rather than crashing the run; the report states that its artifact was not regenerated. A clean checkout therefore works with Bun alone, and gains the on-chain artifact once Foundry is installed.

### 2. Generated report (`experiments/benchmarks/REPRODUCIBILITY.md`)

Contains:

- tool versions (Bun, Node, Foundry, OS);
- command table with exit codes and log paths;
- live baseline composition table, Mode A matrix, Mode B matrix;
- R2-C1 headline numbers and R2-C2 execution environment / evidence flag;
- a **stale-artifact check** that detects markdown matrices disagreeing with the live JSON baselines.

All numbers are parsed from JSON artifacts — none are hand-copied.

### 3. Root-cause fix for the conflicting baselines

| File | Change |
|---|---|
| `packages/attack-core/src/baselines.ts` | `buildBaselineMatrix` now prefers live `baselineComparison` cells over the stale static fixture labels |
| `packages/attack-core/src/mode-b.ts` | `buildP5Matrix` now does the same; `runAllPredicateAttacks` passes the live cells through |
| `package.json` | Added `e2e:reviewer2:comment2` and `reproduce:all` scripts |

After this fix all three baseline tables agree, and the generated report says `Stale artifact warnings: None.`

## Verification

```
bun run reproduce:all
  PASS typecheck
  PASS core-tests
  PASS phase3-mode-a
  PASS phase4-mode-b
  PASS phase4b-p5-matrix
  PASS phase7-baselines
  PASS five-attacks
  PASS reviewer2-comment1
  PASS reviewer2-comment2-local-evm
  Wrote REPRODUCIBILITY.md (0 failed steps)
```

## Scope limits

- Some artifacts carry the fixed fixture timestamp `2026-05-30T05:00:00.000Z` as `generatedAt`; the report's top timestamp is the authoritative run time.
- The local facilitator and Anvil runs are deterministic; no public-network evidence is claimed.
- The reproduction set excludes three pre-existing environment-driven failures in `apps/merchant-agent-api` and `services/identity-service`.
- R2-C1 already supplies the broader adversarial artifacts; this work does not duplicate them.
