# RCLB artifacts

| File | Contents |
|---|---|
| `metrics.json` | Machine-readable, generated from live execution (scenarios, rates, latency, gas, golden vector) |
| `forge-rclb.log` | Exact `forge test --match-contract RevocationAwareGuardTest -vv` output with a TEMP forge-std remap |
| `generate-metrics.ts` | Regenerator for `metrics.json` |
| `../../review-revision/novelty/rclb/` | Design, implementation, evaluation and paste-ready text |

**Scope:** DEMO / LOCAL EVM / IN-PROCESS. No testnet or mainnet measurement,
no literature-priority claim, no invented citations.

Regenerate with `bun run experiments/novelty/rclb/generate-metrics.ts` from the
repository root after running the forge command in
`../../review-revision/novelty/rclb/evaluation.md`.
