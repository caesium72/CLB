# Reviewer 3, Comment 1 — Performance measurement (R3-C1, items 15–25)

**Status: all 11 items MEASURED.** No metric is marked `NOT MEASURED`; the caveats on what could not be isolated are listed at the end.

## Harness and evidence

| Item | Value |
| --- | --- |
| Script | `scripts/e2e-performance.ts` (new; existing scripts untouched) |
| Command | `bun run scripts/e2e-performance.ts` (Bun 1.4.5) |
| Samples | **N = 100** per series, plus 2 unrecorded warmup iterations (`PERF_SAMPLES` override supported) |
| Raw observations | `experiments/benchmarks/performance-raw.json` — 16 series × 100 samples, sha256 `f598bd1d35d5abee79a802db5c159aba2654df8ec1475bcd8dacb8ad6279f895` |
| Summary | `experiments/benchmarks/performance-results.json` |
| Human-readable | `experiments/benchmarks/performance-report.md` |
| Gas environment | **LOCAL ANVIL / DEMO — NOT MAINNET AND NOT A PUBLIC TESTNET** (`gasStatus: RUN`, chainId 84532, local RPC `127.0.0.1:18547`) |
| Typecheck | `bun run typecheck` clean |

Values below are **mean ± sample standard deviation (n−1)**, with median in parentheses. Latency in ms, gas in gas units.

## 11 measured items

### 15. Commitment-generation latency
- `computeCommitment` (Mode A C): **0.1776 ± 0.0330 ms** (median 0.1717).
- `computeModeBSettlementCommitment` (Mode B C′): **0.2558 ± 0.2424 ms** (median 0.2266).
- **Boundary:** exactly one `computeCommitment(clbInput)` / `computeModeBSettlementCommitment(input)` call; the CLB input (including `computeMandateDigest`) is prepared outside the timer.

### 16. Signature-verification latency
- `verifyPaymentPayload` (x402 authorization EIP-712): **1.2559 ± 0.4611 ms** (median 1.0918).
- `verifyCommitmentSignature` (CLB EIP-712): **1.0712 ± 0.5552 ms** (median 0.8787).
- **Boundary:** exactly one `await verifyPaymentPayload(payload)` / `await verifyCommitmentSignature(input, signature, expectedSigner)` call — viem typed-data recovery plus expected-signer equality; signatures and inputs precomputed.

### 17. Authorization-verification latency
- `guardAssertSettlementAllowed`: **0.2788 ± 0.1639 ms** (median 0.2529).
- **Boundary:** exactly one `await InMemoryPredicateGuard.assertSettlementAllowed(guardInput)` call — predicate evaluation + C′ recompute + `expectedNonce == H(C′)` binding check + allow/deny decision. No I/O inside the span.

### 18. Predicate-evaluation latency
- `evaluatePredicate`: **0.0021 ± 0.0019 ms** (median 0.0015).
- `guardEvaluateOffChain`: **0.0020 ± 0.0012 ms** (median 0.0018).
- **Boundary:** one pure `evaluatePredicate(predicate, params, now, observedTaskHash)` call, and one `guard.evaluateOffChain(...)` adapter delegation to the same evaluator. Fixed timestamp; no commitment recomputation.

### 19. Evidence-generation latency
- `evidenceChainGeneration`: **0.4434 ± 0.1571 ms** (median 0.4109).
- `confidentialRangeProofEvidence`: **424.9829 ± 38.0130 ms** (median 429.8908).
- **Boundary:** `linkEvidenceEvents(events)` → `events.map(hashEvidenceEvent)` → `buildMerkleRoot(hashes)` for the hash-chained evidence path (7 events; input events built outside the timer); separately, one `commitConfidential({valueAtomic, maxValueAtomic, payTo}, {rng})` call for the Pedersen commitment + 64-bit per-bit range-proof evidence path (deterministic RNG).

### 20. Verification latency
- `verifyTrace`: **10.6211 ± 1.1611 ms** (median 10.6262).
- **Boundary:** exactly one `await verifyTrace(validModeABundle)` call — all deterministic rules R1–R17 and certificate hashing; the valid bundle is prebuilt outside the timer.

### 21. Complete end-to-end transaction latency
- `e2eModeATransaction`: **19.2737 ± 2.3766 ms** (median 19.0025).
- **Boundary:** from the start of `buildValidBundle({traceId})` through `await verifyTrace(bundle)` — mandate issue → C/nonce derivation → x402 payment signing → local-facilitator settlement → evidence chain + report/delivery signatures → full verification. Fresh trace ID and in-memory nonce store per sample; preparation outside the span.

### 22. Complete payment-related gas consumption — LOCAL ANVIL / DEMO
- `guardOnlyGas`: **75,988 ± 11 gas** (median 75,994).
- `completePaymentGas`: **98,267 ± 13 gas** (median 98,274).
- **Boundary:** `gasUsed` from the mined receipt of a successful `PredicatePaymentGuard.validateAndConsume` transaction; "complete payment" adds the `gasUsed` of the demo on-chain settlement transfer issued by `createOnChainFacilitator` (75,988 + 22,278 ≈ 98,267). Contract deployment and predicate registration are excluded. Local Anvil only; no mainnet or public-testnet gas is claimed.

### 23. Successful and reverted transaction costs — LOCAL ANVIL / DEMO
- `successfulGuardGas`: **75,988 ± 11 gas** (median 75,994).
- `successfulSettlementTxGas`: **22,278 ± 7 gas** (median 22,280).
- `revertedGuardGas`: **42,445 ± 9 gas** (median 42,452).
- **Boundary:** success = mined `validateAndConsume` receipt, plus the separate settlement-transfer receipt. Revert = a `PayeeNotAllowed` `validateAndConsume` transaction **broadcast with an explicit gas limit** so Anvil mines it and exposes real `gasUsed` (viem's default simulate-then-send path never broadcasts reverts, so no receipt exists there). The guard aborts before the transfer, so there is no settlement-transfer cost on the reverted path.

### 24. Mean, median, standard deviation, sample count
- **MEASURED** in `performance-results.json` for all 16 series: mean = arithmetic mean; median = middle order statistic; stddev = sample (n−1) standard deviation; `sampleCount` = 100 for every series; min/max also recorded. Raw precision is kept in the summary JSON; the markdown table rounds for display.

### 25. Preserve raw benchmark results
- **MEASURED**: `experiments/benchmarks/performance-raw.json` retains every one of the 1,600 raw observations (16 series × 100), with per-series unit, metric ID, timing boundary, configuration, environment and gas labels. File sha256 recorded in both the results JSON and the report.

## What could not be isolated / caveats

- **No production token settlement contract exists in the repo.** "Complete payment gas" is the demo guard call plus the demo native-transfer receipt from `createOnChainFacilitator`; it is **not** an ERC-3009 token transfer or a real x402 facilitator charge. All gas numbers are local Anvil measurements and must not be presented as mainnet/Base Sepolia costs.
- **End-to-end latency is in-process.** It uses the deterministic local facilitator and local fixtures, so it excludes RPC, mempool, block time and network jitter. It is an application-path latency, not a network transaction latency.
- **Reverted-cost isolation required bypassing viem simulation.** The 42,445-gas figure is a mined reverted guard tx; a normal viem `writeContract` revert is caught at simulation and has no `gasUsed`. No gas estimate was substituted for a measurement.
- **Confidential proof generation is a separate evidence path.** Its ~425 ms mean is not included in the Mode A end-to-end figure; the deterministic RNG removes CSPRNG variance but the bigint curve work is genuinely measured.
- **Per-metric boundaries exclude fixture construction, input preparation and warmup** as documented above; the numbers are not "full request" latencies except where item 21 explicitly says so.
