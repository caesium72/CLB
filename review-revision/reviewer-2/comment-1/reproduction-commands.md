# Reviewer #2 Comment 1 – Reproduction

Requires Bun 1.4+ and Node 22+. From the repository root:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test packages/attack-core/test/attack-core.test.ts
bun test packages/x402-adapter/test/x402-adapter.test.ts
bun run e2e:reviewer2:comment1
```

`e2e:reviewer2:comment1` writes to `experiments/benchmarks/reviewer2/comment1/`:

| File | Content |
|---|---|
| `adversarial-matrix.json` / `.csv` | 465 compositional scenarios (9 singles + 72 ordered pairs + 12 chains, 5 seeds) |
| `presettlement-results.json` / `.csv` | 9 pre-settlement prevention scenarios |
| `concurrency-results.json` / `.csv` | 300 trials across 5 concurrency levels and 3 shapes |
| `composed-attack-results.json` / `.csv` | 3 named composed sequences (post-settlement detection) |
| `SUMMARY.md` | Manuscript-ready tables |

Seed base is overridable: `REVIEWER2_ATTACK_SEED=1800000000123 bun run e2e:reviewer2:comment1`.

Expected invariants:

- matrix detection rate `1.0`, `undetected: []`;
- every scenario's `expectedRulesCovered: true`;
- all nine pre-settlement scenarios `prevented: true` and `receiptIssued: false`;
- concurrency `summary.anomalyCount: 0`, and each same-nonce trial settling exactly once.

Also re-run the original benchmarks to confirm nothing regressed:

```bash
bun run e2e:phase3
bun run e2e:phase7-baselines
bun run e2e:five-attacks
```

Known unrelated failures on a machine without the app env vars:
`apps/merchant-agent-api` (expected price `0.0000001`, receives `2.00`) and
`services/identity-service` (expected agent id `analysis-agent-001`, receives a
port-derived id). Their sources are unchanged from `A3C-V1`.
