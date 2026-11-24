# R3-C1 Performance Benchmark (latency + gas)

- Samples per operation: **100** (warmup 2, excluded).
- Gas label: **LOCAL ANVIL / DEMO — NOT MAINNET AND NOT A PUBLIC TESTNET**.
- Gas status: **RUN** — Foundry available; real transactions executed on a local Anvil EVM.
- Raw observations: `experiments/benchmarks/performance-raw.json` (sha256 `e2682d22ea563852adcfc2ee36d1f03ead842eefc6aa34ff2d388209910f6c86`).
- Machine: **12th Gen Intel(R) Core(TM) i5-1240P** · 16 logical cores · win32/x64. **ONE MACHINE ONLY** — no multi-machine, multi-OS or cloud claim.
- Base Sepolia: **NOT MEASURED HERE — public-network results are recorded at `experiments/benchmarks/reviewer2/comment2/public/onchain-guard-results.public.json`.**

| Metric | Series | Unit | Mean | Median | p95 | Stddev | Count | Min | Max |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| M15 Commitment-generation latency | `computeCommitment` | ms | 0.2108 | 0.2032 | 0.2554 | 0.0507 | 100 | 0.1725 | 0.5745 |
| M15 Commitment-generation latency | `computeModeBSettlementCommitment` | ms | 0.4273 | 0.3663 | 0.4639 | 0.3280 | 100 | 0.3149 | 2.8146 |
| M16 Signature-verification latency | `verifyPaymentPayload` | ms | 1.3241 | 1.1516 | 2.3839 | 0.4345 | 100 | 0.9913 | 3.3176 |
| M16 Signature-verification latency | `verifyCommitmentSignature` | ms | 1.2500 | 1.1189 | 2.3784 | 0.4271 | 100 | 0.9132 | 2.9608 |
| M17 Authorization-verification latency | `guardAssertSettlementAllowed` | ms | 0.3752 | 0.3535 | 0.4228 | 0.1319 | 100 | 0.3191 | 1.6192 |
| M18 Predicate-evaluation latency | `evaluatePredicate` | ms | 0.0023 | 0.0017 | 0.0046 | 0.0025 | 100 | 0.0014 | 0.0247 |
| M18 Predicate-evaluation latency | `guardEvaluateOffChain` | ms | 0.0022 | 0.0016 | 0.0057 | 0.0019 | 100 | 0.0014 | 0.0157 |
| M19 Evidence-generation latency | `evidenceChainGeneration` | ms | 0.6154 | 0.5830 | 0.6790 | 0.1878 | 100 | 0.5303 | 2.0249 |
| M19 Evidence-generation latency | `confidentialRangeProofEvidence` | ms | 692.8574 | 693.0974 | 738.3580 | 29.1415 | 100 | 632.1998 | 784.4589 |
| M20 Verification latency | `verifyTrace` | ms | 7.7622 | 7.8399 | 9.2508 | 1.0237 | 100 | 5.9550 | 10.3839 |
| M21 Complete end-to-end transaction latency | `e2eModeATransaction` | ms | 12.2062 | 12.1723 | 13.8158 | 0.9448 | 100 | 9.7388 | 14.1931 |
| M22 Complete payment-related gas consumption | `guardOnlyGas` | gas | 92478 | 92484 | 92484 | 10 | 100 | 92448 | 92484 |
| M22 Complete payment-related gas consumption | `completePaymentGas` | gas | 114756 | 114764 | 114764 | 13 | 100 | 114710 | 114764 |
| M23 Successful and reverted transaction costs | `successfulGuardGas` | gas | 92478 | 92484 | 92484 | 10 | 100 | 92448 | 92484 |
| M23 Successful and reverted transaction costs | `revertedGuardGas` | gas | 68781 | 68787 | 68787 | 8 | 100 | 68763 | 68787 |
| M23 Successful and reverted transaction costs | `successfulSettlementTxGas` | gas | 22278 | 22280 | 22280 | 8 | 100 | 22250 | 22280 |
| M26 Overhead of the full CLB-ACEL path vs plain x402 | `plainX402Accept` | ms | 2.4278 | 2.1686 | 3.7862 | 0.6014 | 100 | 1.8850 | 4.0374 |
| M26 Overhead of the full CLB-ACEL path vs plain x402 | `clbAcelAcceptAndVerify` | ms | 10.6263 | 10.6835 | 11.9826 | 0.9003 | 100 | 8.6972 | 12.7775 |

## Reviewer #4 Comment 4 — overhead vs plain x402

- Plain x402 (verify + local settle): mean **2.4278 ms**, median 2.1686 ms, p95 3.7862 ms, stddev 0.6014 ms, n=100.
- Full CLB-ACEL (commitment + signature + guard + evidence + verifyTrace + settle): mean **10.6263 ms**, median 10.6835 ms, p95 11.9826 ms, stddev 0.9003 ms, n=100.
- Paired absolute overhead (CLB − plain, same iteration): mean **8.1985 ms**, median 8.3221 ms, p95 9.8872 ms, stddev 1.1696 ms.
- Ratio of means: **4.38×**. Both spans end in a local-facilitator settlement. The CLB-ACEL span additionally performs commitment recomputation, CLB signature verification, the predicate guard decision, evidence chain/Merkle construction and full verifyTrace (which internally re-verifies the x402 authorization). Components use the prebuilt M15/M16/M17/M19/M20 fixtures; the summed span is a cost model, not one coherent end-to-end trace.

## Exact timing / measurement boundaries

- `computeCommitment` (M15, ms): computeCommitment(clbInput) — Mode A C = keccak256(EIP712(identityRef, mandateDigest, settlementDigest)); input prepared outside timer.
- `computeModeBSettlementCommitment` (M15, ms): computeModeBSettlementCommitment(input) — Mode B C' = keccak256(EIP712(identityRef, mandateDigest, predicateId, settlementParamsDigest)).
- `verifyPaymentPayload` (M16, ms): await verifyPaymentPayload(payload) — EIP-712 recovery + expected-signer equality for the x402 authorization.
- `verifyCommitmentSignature` (M16, ms): await verifyCommitmentSignature(clbInput, signature, expectedSigner) — CLB EIP-712 signature recovery.
- `guardAssertSettlementAllowed` (M17, ms): await InMemoryPredicateGuard.assertSettlementAllowed(guardInput) — predicate eval + C' recompute + expectedNonce binding + allow/deny decision.
- `evaluatePredicate` (M18, ms): evaluatePredicate(predicate, params, now, observedTaskHash) — pure rule evaluation only.
- `guardEvaluateOffChain` (M18, ms): guard.evaluateOffChain(predicate, params, now, observedTaskHash) — adapter entry point, same pure evaluator.
- `evidenceChainGeneration` (M19, ms): linkEvidenceEvents(events) + events.map(hashEvidenceEvent) + buildMerkleRoot(hashes) — hash-chained evidence plus Merkle root; input events prepared outside timer.
- `confidentialRangeProofEvidence` (M19, ms): commitConfidential({valueAtomic, maxValueAtomic, payTo}, {rng}) — Pedersen commitment + 64-bit per-bit range proof evidence (deterministic RNG).
- `verifyTrace` (M20, ms): await verifyTrace(validModeABundle) — all deterministic rules R1–R17 and certificate hash; bundle prebuilt outside timer.
- `e2eModeATransaction` (M21, ms): buildValidBundle({traceId}) + verifyTrace(bundle) — full Mode A: mandate issue, C/nonce, x402 signing, local facilitator settle, evidence chain, report/delivery signatures, verification.
- `plainX402Accept` (M26, ms): await verifyPaymentPayload(payload) + await facilitator.settle(payload) on a fresh local facilitator — plain x402 authorization + settlement. Payload and fresh facilitator prepared outside timer.
- `clbAcelAcceptAndVerify` (M26, ms): computeCommitment + verifyCommitmentSignature + guard.assertSettlementAllowed + (link/hash/Merkle over 7 events) + verifyTrace(bundle) + facilitator.settle(payload) — full CLB-ACEL acceptance/verification pipeline. All inputs, including a fresh facilitator, prepared outside timer.
- `guardOnlyGas` (M22, gas): LOCAL ANVIL / DEMO — NOT MAINNET AND NOT A PUBLIC TESTNET: gasUsed of the successful PredicatePaymentGuard.validateAndConsume receipt (C' recompute + predicate checks + nonce consume); deployment/registration excluded.
- `completePaymentGas` (M22, gas): LOCAL ANVIL / DEMO — NOT MAINNET AND NOT A PUBLIC TESTNET: gasUsed(validateAndConsume success) + gasUsed(on-chain settlement transfer from createOnChainFacilitator), summed per iteration; deployment/registration excluded.
- `successfulGuardGas` (M23, gas): LOCAL ANVIL / DEMO — NOT MAINNET AND NOT A PUBLIC TESTNET: gasUsed of the successful validateAndConsume receipt (same observations as guardOnlyGas, reported under the success/revert split).
- `revertedGuardGas` (M23, gas): LOCAL ANVIL / DEMO — NOT MAINNET AND NOT A PUBLIC TESTNET: gasUsed of a MINED reverted validateAndConsume tx (PayeeNotAllowed). The guard aborts before the settlement transfer, so no settlement tx exists for the reverted path.
- `successfulSettlementTxGas` (M23, gas): LOCAL ANVIL / DEMO — NOT MAINNET AND NOT A PUBLIC TESTNET: gasUsed of the demo on-chain settlement transfer receipt on the successful path.

Items 24 and 25 are the summary-statistics and raw-preservation deliverables, reported in `performance-results.json` and `performance-raw.json` respectively.
