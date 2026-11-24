# Reviewer #2 – Comment 1: Implementation Report

**Status: RESOLVED (technical).** Implementation executed, artifacts generated, invariants tested. No manuscript change is required for this comment.

## Reviewer concern

> The evaluation is based on a relatively small and deterministic set of modelled attack scenarios. The reviewer requests broader adversarial evaluation covering more complex multi-step attacks, malicious merchants, compromised agents, and concurrent transactions.

## What was missing before

The previous working copy added three hand-written sequences and two unit tests, but:

- nothing had been executed (no Bun, no dependencies, no artifacts);
- the three sequences were labelled `prevented: false` / `post-settlement` by construction, because the fixture settled *before* asking the guard;
- there was no combinatorial coverage, no seed sweep, and no concurrency statistics.

## What this revision adds

### 1. Compositional adversarial matrix (`packages/attack-core/src/adversarial-matrix.ts`)

Nine independent attack primitives, each mapped to the rule that must catch it:

| Primitive | Family | Expected rule |
|---|---|---|
| `PAYEE_SUBSTITUTION` | merchant | R12 |
| `MERCHANT_REVOCATION` | merchant | R12 (R12 also requires the merchant agent to be ACTIVE) |
| `AMOUNT_ESCALATION` | agent | R11 |
| `AGENT_KEY_DEAUTHORIZATION` | agent | R4 |
| `ASSET_SWITCH` | settlement | R13 |
| `CHAIN_TRANSPLANT` | settlement | R10 |
| `TASK_SWITCH` | delivery | R15 |
| `DELIVERY_FORGERY` | delivery | R2 / R14b |
| `SELECTION_INJECTION` | evidence | audit layer (no verifier rule) |

Scenarios executed per seed: **93** = 9 singles + 72 ordered pairs (every ordered pair of distinct primitives) + 12 curated three-step chains (`ATTACK_CHAINS`). Seeds: **5**, varying amount, asset, attacker payee, task hash and token, so a pass is not tied to one fixed trace.

Total: **465 executed scenarios**.

### 2. Pre-settlement prevention (`packages/attack-core/src/presettlement.ts`)

`buildValidModeBBundle` was split into `draftModeBPayment` (everything before settlement) plus the existing settle path. The new harness asks the predicate guard **before** calling the facilitator and only settles when the guard allows. `receiptIssued === false` is therefore direct evidence that no value moved.

Nine scenarios: payee substitution, revoked merchant identity, amount escalation, asset switch, chain switch, task substitution, expired authorization, selection-then-substitution (multi-step), escalation-then-replay (multi-step).

### 3. Concurrency harness (`packages/x402-adapter/src/concurrency.ts`)

Bursts at concurrency 2/4/8/16/32, 20 trials per level, in three shapes:

- `same-nonce`: N concurrent attempts on one nonce → exactly 1 may settle;
- `distinct-nonce`: N concurrent attempts on N nonces → all N settle;
- `mixed`: a duplicated nonce plus distinct nonces → 1 + floor(N/2) settle.

Total: **300 trials / 3,720 concurrent attempts**.

### 4. Executed results

`bun run e2e:reviewer2:comment1` (Bun 1.4.5, Windows x64) writes to `experiments/benchmarks/reviewer2/comment1/`:

| Artifact | Content |
|---|---|
| `adversarial-matrix.json` / `.csv` | 465 scenarios with failed rules and expected-rule coverage |
| `presettlement-results.json` / `.csv` | 9 prevention scenarios with receipt status |
| `concurrency-results.json` / `.csv` | 300 trials with settled/rejected counts |
| `composed-attack-results.json` / `.csv` | 3 named composed sequences |
| `SUMMARY.md` | Manuscript-ready tables |

Headline numbers:

| Metric | Result |
|---|---|
| Matrix scenarios detected | 465 / 465 (100%) |
| Expected rule covered by the failing rules | 465 / 465 |
| Singles / pairs / chains detected | 45/45 · 360/360 · 60/60 |
| Pre-settlement scenarios prevented | 9 / 9 (0 receipts issued) |
| Concurrent attempts | 3,720 |
| Same-nonce double settlements | 0 |
| Concurrency anomalies | 0 |

### 5. Tests

- `packages/attack-core/test/attack-core.test.ts`: full matrix shape (93 scenarios), 100% detection, expected-rule coverage per scenario, pre-settlement `prevented` + `receiptIssued === false` for all nine scenarios.
- `packages/x402-adapter/test/x402-adapter.test.ts`: concurrency invariants at levels 4 and 8 across all three shapes.

### 6. Scope limits stated in the manuscript text

- The matrix measures **detection**; only the pre-settlement set measures prevention, and only for the delegated (Mode B) flow where a guard exists. Mode A has no pre-settlement gate beyond the human's signature over the exact descriptor.
- The nonce reservation is in-process; a cross-replica facilitator needs a shared nonce store. This is stated as a limitation rather than claimed as solved.
- Seeds vary parameters, not attacker strategy: the primitives are still modelled, not discovered by fuzzing the protocol.

## Verification

```
bun install --frozen-lockfile          # 708 packages, 85s
bun run typecheck                      # tsc --build, clean
bun test packages/attack-core          # 7 pass
bun test packages/x402-adapter         # 7 pass
bun run e2e:reviewer2:comment1         # 465 + 9 + 300 trials, 0 anomalies
bun run e2e:phase3                     # 10/10 Mode A fixtures
bun run e2e:phase7-baselines           # B0–B2 composition comparison passes
bun run e2e:five-attacks               # Five Attacks reproduction passes
```

Three tests in `apps/merchant-agent-api` and `services/identity-service` fail on this machine; their source is byte-identical to `A3C-V1`, so the failures are pre-existing and environment-driven (env-supplied price and agent id), not caused by this change.
