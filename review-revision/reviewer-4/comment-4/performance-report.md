# Reviewer #4, Comment 4 — performance reporting: resolution status

**Reviewer comment:** "Performance reporting is limited: one machine, short traces, and gas from a mock guard on a local chain. Report scaling, variance, overhead against plain x402, and Base Sepolia results."

| Part | Status | Evidence |
| --- | --- | --- |
| Scaling (trace length) | **DONE** | `bun run perf:scaling` → `experiments/benchmarks/scaling-results.json`, `scaling-report.md` |
| Variance (explicit, with raw samples) | **DONE** | `bun run perf:all` → `performance-results.json`, `performance-raw.json` (1,800 raw samples, 18 series) |
| Overhead vs plain x402 | **DONE** | M26 series in `performance-results.json` / `performance-report.md` |
| Base Sepolia results | **NOT RUN — signer unfunded; see reviewer-2/comment-2/funding-guide.md; public harness ready at e2e:reviewer2:comment2:public** | No public-network number is claimed anywhere in these artifacts |
| One-machine limitation | **STATED, NOT RESOLVED** | Recorded CPU/core count below; no multi-machine, multi-OS or cloud result exists |

## Environment (one machine)

- Bun 1.4.5, Node v26.3.0, win32/x64.
- CPU: **12th Gen Intel(R) Core(TM) i5-1240P**, 16 logical cores.
- `machineCount: 1` in both result JSONs. All timings are from this single host.

## 1. Scaling — trace length

Synthetic **valid** evidence traces (hash chain, `eventHashes` and Merkle root recomputed; R1–R17 asserted PASS outside the timed span) at 7, 16, 32, 64 and 128 events; n = 100 per size, warmup 2 excluded. Raw samples are preserved in `scaling-results.json`.

| Series | Events | Mean (ms) | Median | p95 | Stddev | n | Min | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `evidenceChain` | 7 | 0.5821 | 0.5587 | 0.6869 | 0.0824 | 100 | 0.5131 | 1.1788 |
| `verifyTrace` | 7 | 6.9791 | 7.0598 | 8.2055 | 0.8136 | 100 | 5.3230 | 9.2803 |
| `evidenceChain` | 16 | 1.3666 | 1.3184 | 1.5964 | 0.2139 | 100 | 1.1879 | 2.5025 |
| `verifyTrace` | 16 | 7.4979 | 7.3342 | 9.6667 | 1.0833 | 100 | 5.5574 | 11.8457 |
| `evidenceChain` | 32 | 2.7078 | 2.6381 | 3.6795 | 0.3543 | 100 | 2.3541 | 4.1079 |
| `verifyTrace` | 32 | 8.0243 | 7.9509 | 9.9309 | 0.9635 | 100 | 6.1719 | 10.6986 |
| `evidenceChain` | 64 | 5.6712 | 5.4561 | 7.1856 | 0.7205 | 100 | 4.8421 | 8.2236 |
| `verifyTrace` | 64 | 10.8290 | 10.2748 | 14.4007 | 2.1189 | 100 | 7.9633 | 17.9505 |
| `evidenceChain` | 128 | 13.0906 | 12.4111 | 17.0709 | 1.9043 | 100 | 10.8606 | 22.4744 |
| `verifyTrace` | 128 | 13.6448 | 13.6615 | 15.4623 | 1.0600 | 100 | 11.6767 | 16.2255 |

**Complexity trend (log–log least squares):**

- Evidence chain / Merkle: slope **1.062**; 0.5821 → 13.0906 ms (22.49× for 18.29× events), marginal 0.1159 ms/event at the largest step. Approximately linear over this range — the Merkle reduction is O(n log n) but log₂(n) ≤ 7 here. `linkEvidenceEvents` reallocates its array per event, so a larger-n run could show superlinear growth.
- `verifyTrace`: slope **0.235**; 6.9791 → 13.6448 ms (1.96× for 18.29× events), marginal 0.0440 ms/event at the largest step. Sublinear over this range because size-independent ECDSA checks and certificate hashing dominate; the per-event hash-chain work is present but masked.
- Honest limit: the longest measured trace is 128 events. This extends the previously reported 7-event trace but is not a large-scale result.

## 2. Variance

Every series in `performance-results.json` and `scaling-results.json` reports mean, median, p50, p95, sample (n−1) standard deviation, count, min and max. Every raw observation is retained in the matching raw/results JSON. M24 in `performance-results.json` records the definitions; M25 records 1,800 raw samples across 18 series (sha256 `618877085df95f8d65b9421cdd0061915a2c272e6cf04decf297a4538bb69494`). Scaling results sha256: `0fab1c79dd85908b4a1d3ae027a984dc107f39503911283e7f9f4f9d240ec8b3`.

## 3. Overhead vs plain x402 (M26)

Both spans end in a local-facilitator settlement; inputs (including a fresh facilitator/nonce store) are prepared outside the timed span; n = 100 for both.

| Span | Mean (ms) | Median | p95 | Stddev | n | Min | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Plain x402 (authorization signature verify + local settle) | **1.9378** | 1.6861 | 3.0505 | 0.5906 | 100 | 1.3466 | 3.8429 |
| Full CLB-ACEL (commitment + signature + guard + evidence + verifyTrace + settle) | **8.5492** | 8.5218 | 10.0402 | 0.9400 | 100 | 6.4592 | 12.3110 |
| Paired absolute overhead (CLB − plain, same iteration) | **6.6114** | 6.5858 | 8.2402 | 1.1174 | 100 | 4.1944 | 10.7313 |

**Ratio of means: 4.41×** (8.5492 / 1.9378 ms).

Boundary note: the CLB-ACEL span additionally performs commitment recomputation, CLB signature verification, the predicate guard decision, evidence chain/Merkle construction and full `verifyTrace` (which internally re-verifies the x402 authorization). Its components use the prebuilt M15/M16/M17/M19/M20 fixtures, so the summed span is a component-cost model, not one coherent end-to-end Mode B trace. It is a strict superset of the plain span in operations performed, which makes the difference a defensible overhead estimate rather than a comparison of unrelated workloads.

## 4. Gas and Base Sepolia

- Gas remains **LOCAL ANVIL / DEMO — NOT MAINNET AND NOT A PUBLIC TESTNET**: guard-only 81,038 gas (stddev 10, n=100); complete payment 103,316 gas (stddev 13, n=100). This part of the reviewer's criticism stands and is not claimed to be resolved.
- Base Sepolia: **NOT RUN — signer unfunded; see reviewer-2/comment-2/funding-guide.md; public harness ready at e2e:reviewer2:comment2:public**. No public-network latency, gas or transaction hash is fabricated. Once the signer is funded, the public harness produces the missing evidence.

## Reproduce

```powershell
$env:Path="$env:USERPROFILE\.bun\bin;$env:USERPROFILE\.foundry\bin;$env:Path"
cd "E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2"
bun run perf:scaling
bun run perf:all          # or: bun run scripts/e2e-performance.ts
bun run typecheck
bun test
```

Artifacts: `experiments/benchmarks/scaling-results.json`, `scaling-report.md`, `performance-results.json`, `performance-report.md`, `performance-raw.json`. Paste-ready manuscript text: `manuscript-insert.md` in this directory.
