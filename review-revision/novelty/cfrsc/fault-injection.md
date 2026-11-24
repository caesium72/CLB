# CFRSC fault-injection method and results

## Method

The unit under test is the pure transition function of
`packages/service-kit/src/recovery.ts`, driven through `RecoveryMachine.dispatch`
against `createInMemoryRecoveryStore`. A fault is injected by choosing a command
sequence that a real system produces after a failure: a timeout, a process
restart, a missing delivery artifact, a premature refund request, a completion
without a receipt, or a conflicting (reorged) transaction hash.

Each scenario records:

- the full command trace (`command`, `idempotencyKey`, `outcome`, resulting
  state, rejection reason);
- the final durable snapshot and its `state`;
- boolean outcomes for the properties it targets;
- `verifyRecoveryEvidence(snapshot)` on the final evidence log.

A scenario passes only if **all** its targeted properties hold, the evidence
chain verifies, and every command that produced a rejection reason is recorded
with outcome `REJECTED`. All inputs use fixed ISO timestamps so evidence hashes
are reproducible.

## Results

Executed under Bun 1.4.5: **6 / 6 scenarios passed**; full suite green
(`416 pass / 2 skip / 0 fail` at the time of this run; the baseline before
concurrent work was `360 pass / 2 skip / 0 fail`).

| Scenario | Injected fault | Final state | Key observation |
|---|---|---|---|
| `duplicate-retry-after-timeout` | `TIMEOUT` + identical `SUBMIT_SETTLEMENT` | `SETTLED` | Retry returned `REPLAYED` with the original evidence hash; exactly one accepted confirmation. |
| `crash-between-reserved-and-settled` | Machine dropped before confirmation | `SETTLED` | Durable state reloaded as `SETTLEMENT_PENDING`; evidence sequences stayed 1→4. |
| `settlement-success-delivery-unknown` | `COMPLETE` early / wrong txHash / empty attestation | `COMPLETED` | Three attempts rejected `NO_FALSE_COMPLETION`; the bound report completed. |
| `premature-refund-attempt` | `REFUND` + `DISPUTE` during uncertainty; compensation while merely settled | `COMPENSATED` | Rejected until `SETTLED → DISPUTED → COMPENSATION_PENDING`; one refund. |
| `false-completion-attempt` | `COMPLETE` from `RESERVED` with no receipt | `RESERVED` | Rejected `NO_FALSE_COMPLETION`; no completion record created. |
| `reorg-stale-settlement-evidence` | Conflicting `txHash` after a receipt exists | `SETTLED` | Rejected `STALE_SETTLEMENT_EVIDENCE`; receipt unchanged; canonical replay identical. |

Machine-readable output: `experiments/novelty/cfrsc/fault-injection-results.json`.
The JSON is the generated artifact; the accompanying
`fault-injection-results.md` is a rendered summary of it.

## Reproduction

```bash
$env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"   # PowerShell
cd "E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2"
bun test packages/service-kit/test/recovery.test.ts
bun run typecheck
bun test
```

## What this does not establish

- No symbolic/Tamarin proof is claimed. The lemmas in
  `state-machine-spec.md` §7 are textual and UNVERIFIED.
- The in-memory store demonstrates the contract for a single process. A
  multi-replica deployment must supply a genuinely atomic `writeAtomic`.
- Injected faults cover the six listed classes only; other interleavings (e.g.
  partial writes inside the storage layer) are out of scope.
