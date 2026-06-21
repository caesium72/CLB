# Five Attacks on x402 — Honest Reproduction Harness

## What this does

This harness maps the five published x402 attacks (arXiv:2605.11781) to our
CLB-ACEL stack and reproduces the **Attack II (replay) defense** live.

Two things happen when you run it:

1. **Artifact citation** — `run.ts` reads the committed
   `attack2_real.json` from the Five-Attacks artifact at
   `reference-papers/Five Attacks on x402/x402-attack-FDF1 (attack simulation)/results/attack2/attack2_real.json`
   and parses the no-idempotency DGR series (vanilla x402 grants n resources for
   n replayed requests).

2. **Defense reproduction** — `run.ts` calls our own
   `buildValidBundle()` + `markReplayAttempt()` and asserts:
   - `replay.prevented === true` (local x402 facilitator raised
     `NonceAlreadyConsumedError` on the second settlement attempt), and
   - `verifyTrace().result.failedRules` includes `R9_NONCE_CONSUMED_EXACTLY_ONCE`.

   Both assertions must pass or the script exits 1.

The output is written to
`experiments/benchmarks/five-attacks-comparison.md`.
It is fully deterministic — no wall-clock timestamps, latencies, or transaction
hashes are written, so `git diff --exit-code` can be used as a drift guard.

## What we do NOT do

- The Five-Attacks artifact is **referenced by path only** and is NOT
  re-vendored, copied, or re-committed anywhere in this harness.
- Re-running their own `npm run attack2` reproduces `attack2_real.json` but
  requires their separate Hardhat testbed (local chain + proxy containers) and is
  intentionally **NOT** part of our CI.
- We do not run any Docker, Hardhat, or npm scripts from the artifact tree.

## Honest mapping summary

| Attack | Our result |
| --- | --- |
| I-A/I-B revert-grant / settlement preemption | **Partially mitigated** (optimistic-grant timing window remains) |
| II replay / missing idempotency | **Eliminated** (R9 consume-once; reproduced live) |
| III proxy/cache header manipulation | **Out of scope** (web-layer; cite their `Cache-Control` fix) |
| IV server-selection manipulation | **Mitigated when discovery is bound** (Phase 7B + 7D decision instrumentation) |

## How to run

```bash
bun run e2e:five-attacks
```

This command is defined in the root `package.json` as:

```json
"e2e:five-attacks": "bun run experiments/five-attacks-repro/run.ts"
```

Expected output: the parsed DGR series, assertion results (both `PASSED`), and
the path of the written markdown file. Exit code 0 on success.
