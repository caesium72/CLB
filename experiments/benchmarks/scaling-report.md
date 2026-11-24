# Reviewer #4 Comment 4 — Scaling (trace length)

- Samples per size: **100** (warmup 2, excluded).
- Sizes (events): **7, 16, 32, 64, 128**.
- Machine: **12th Gen Intel(R) Core(TM) i5-1240P** · 16 logical cores · win32/x64 · 1.4.5.
- **ONE MACHINE ONLY** — no multi-machine, multi-OS or cloud claim is made.
- Base Sepolia: **NOT RUN — signer unfunded; see reviewer-2/comment-2/funding-guide.md; public harness ready at e2e:reviewer2:comment2:public.**
- Raw samples + full precision: `experiments/benchmarks/scaling-results.json` (sha256 `0fab1c79dd85908b4a1d3ae027a984dc107f39503911283e7f9f4f9d240ec8b3`).

All synthetic bundles passed R1–R17 with a valid hash chain, eventHashes and Merkle root before timing (asserted outside the timed span).

| Series | Events | Mean (ms) | Median | p50 | p95 | Stddev | n | Min | Max | ms/event |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `evidenceChain_n7` | 7 | 0.5821 | 0.5587 | 0.5587 | 0.6869 | 0.0824 | 100 | 0.5131 | 1.1788 | 0.0832 |
| `verifyTrace_n7` | 7 | 6.9791 | 7.0598 | 7.0598 | 8.2055 | 0.8136 | 100 | 5.3230 | 9.2803 | 0.9970 |
| `evidenceChain_n16` | 16 | 1.3666 | 1.3184 | 1.3184 | 1.5964 | 0.2139 | 100 | 1.1879 | 2.5025 | 0.0854 |
| `verifyTrace_n16` | 16 | 7.4979 | 7.3342 | 7.3342 | 9.6667 | 1.0833 | 100 | 5.5574 | 11.8457 | 0.4686 |
| `evidenceChain_n32` | 32 | 2.7078 | 2.6381 | 2.6381 | 3.6795 | 0.3543 | 100 | 2.3541 | 4.1079 | 0.0846 |
| `verifyTrace_n32` | 32 | 8.0243 | 7.9509 | 7.9509 | 9.9309 | 0.9635 | 100 | 6.1719 | 10.6986 | 0.2508 |
| `evidenceChain_n64` | 64 | 5.6712 | 5.4561 | 5.4561 | 7.1856 | 0.7205 | 100 | 4.8421 | 8.2236 | 0.0886 |
| `verifyTrace_n64` | 64 | 10.8290 | 10.2748 | 10.2748 | 14.4007 | 2.1189 | 100 | 7.9633 | 17.9505 | 0.1692 |
| `evidenceChain_n128` | 128 | 13.0906 | 12.4111 | 12.4111 | 17.0709 | 1.9043 | 100 | 10.8606 | 22.4744 | 0.1023 |
| `verifyTrace_n128` | 128 | 13.6448 | 13.6615 | 13.6615 | 15.4623 | 1.0600 | 100 | 11.6767 | 16.2255 | 0.1066 |

## Complexity trend (log–log least squares)

- Evidence chain: slope **1.062**, endpoint 0.5821 → 13.0906 ms (22.49× for 18.29× events), marginal 0.1159 ms/event at the largest step — approximately linear in trace length; the Merkle reduction is O(n log n) but log2(n) <= 7 here, so the trend is near-linear.
- verifyTrace: slope **0.235**, endpoint 6.9791 → 13.6448 ms (1.96× for 18.29× events), marginal 0.0440 ms/event at the largest step — sublinear over this range: a size-independent cost (ECDSA signature checks / certificate hashing) dominates the per-event term; the per-event hash work is still present but masked.

## Exact timing boundaries

- `evidenceChain`: linkEvidenceEvents(events) + events.map(hashEvidenceEvent) + buildMerkleRoot(hashes) — hash-chained evidence plus Merkle root; raw events prepared outside timer.
- `verifyTrace`: await verifyTrace(validSyntheticBundle, {expectedHumanPrincipal}) — R1–R17 rules + certificate hash; valid bundle (chain, eventHashes, Merkle root) prepared outside timer.
