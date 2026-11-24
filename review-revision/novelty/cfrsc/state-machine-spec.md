# Novelty 4 — CFRSC: Cross-Layer Failure Recovery and Settlement Consistency

**Status of claims:** the state-machine properties below are **enforced in code**
(`packages/service-kit/src/recovery.ts`) and exercised by fault-injection tests.
The Tamarin-style lemmas at the end are **textual specifications only —
UNVERIFIED**. No `.spthy` model was created and no symbolic proof was run.

## 1. Problem and scope

The payment layer (x402 + facilitator) and the service layer (merchant delivery)
can finish in either order, or not at all. A client that times out cannot tell
whether money moved; a retry may double-settle; a crash between reservation and
settlement loses the in-memory view of the transaction; a reorg can invalidate a
previously observed receipt. CFRSC makes that uncertainty an explicit state and
makes every legally possible move a guarded, evidenced transition.

```
   ┌─────────────┐   commands        ┌──────────────────────────┐
   │  Caller /   │ ────────────────► │  RecoveryMachine         │
   │  recovery   │                  │  (pure transition logic) │
   │  worker     │ ◄──────────────── │  guards · idempotency    │
   └─────────────┘   TransitionResult└───────────┬──────────────┘
                                                 │ read / writeAtomic
                                                 ▼
                                   ┌───────────────────────────┐
                                   │ RecoveryStore (interface) │
                                   │ in-memory (tests) | SQL/KV│
                                   └───────────────────────────┘
                                                 │
                                                 ▼
                                   append-only hash-chained evidence log
```

The machine performs no network I/O and takes no cryptography beyond SHA-256 for
evidence digests. Settlement receipts and delivery artifacts are supplied by the
caller as command payloads; the machine decides only whether they may change the
state.

## 2. States

```
                         AUTHORIZED
                              │ RESERVE
                              ▼
                           RESERVED ◄──────────────┐
                              │ SUBMIT_SETTLEMENT   │ RECONCILE(ABSENT)
                              ▼                     │
                    SETTLEMENT_PENDING ──────────────┘
                       │  │   │
      TIMEOUT          │  │   └──── RECONCILE(SETTLED) ─┐
      (stays here,     │  │                            │
       uncertain=true) │  └── CONFIRM_SETTLEMENT ──────┤
                       │          (txHash)             ▼
                       │                            SETTLED
                       │                              │ START_FULFILLMENT
                       │                              ▼
                       │                     FULFILLMENT_PENDING
                       │                              │ COMPLETE(bound report)
                       │                              ▼
                       │                           COMPLETED
                       │
                       └── DISPUTE (only from SETTLED / FULFILLMENT_PENDING / COMPLETED)
                                          │
                                          ▼
                                       DISPUTED
                                          │ START_COMPENSATION
                                          ▼
                                 COMPENSATION_PENDING
                                          │ REFUND
                                          ▼
                                       COMPENSATED
```

| State | Meaning |
|---|---|
| `AUTHORIZED` | Order exists; no funds reserved. |
| `RESERVED` | Funds/capacity reserved; no settlement submitted. |
| `SETTLEMENT_PENDING` | Settlement submitted; outcome may be unknown after `TIMEOUT`. |
| `SETTLED` | A receipt with a single `txHash` is recorded; no delivery yet. |
| `FULFILLMENT_PENDING` | One service execution started; delivery not yet accepted. |
| `COMPLETED` | A report bound to the recorded receipt was accepted. |
| `DISPUTED` | A settled transaction was contested. |
| `COMPENSATION_PENDING` | Refund authorized by a dispute; not yet executed. |
| `COMPENSATED` | Terminal: refund executed exactly once. |

`COMPENSATED` is the one addition to the eight states named in the task: a
completed refund needs a terminal state distinct from `COMPENSATION_PENDING`.

## 3. Transitions and guards

Every command carries an `idempotencyKey`. The machine first checks
`commandResults[key]`: if present, it returns `REPLAYED` with the **original**
evidence hash and performs no write. Otherwise the guard below runs. A failed
guard returns `REJECTED` with a reason code and appends a `REJECTION` evidence
entry (no state change).

| Command | From | Guard | To | Evidence detail |
|---|---|---|---|---|
| `AUTHORIZE` | *(no record)* | first command only | `AUTHORIZED` | `orderRef` |
| `RESERVE` | `AUTHORIZED` | no existing reservation | `RESERVED` | `reservationId` |
| `SUBMIT_SETTLEMENT` | `RESERVED`, or `SETTLEMENT_PENDING` with `outcome=ABSENT` | no confirmed receipt; same `settlementId` replays; a second submit while `PENDING` is refused as `UNCERTAIN_SETTLEMENT` | `SETTLEMENT_PENDING` | `settlementId` |
| `TIMEOUT` | `SETTLEMENT_PENDING` with `outcome=PENDING` | marks `uncertain=true`; state unchanged | `SETTLEMENT_PENDING` | `settlementId`, `uncertain` |
| `RECONCILE(SETTLED)` | `SETTLEMENT_PENDING` | requires `txHash`; writes the one receipt | `SETTLED` | `txHash`, `settlementId` |
| `RECONCILE(ABSENT)` | `SETTLEMENT_PENDING` | no receipt exists | `RESERVED` | `settlementId`, `outcome=ABSENT` |
| `CONFIRM_SETTLEMENT` | `SETTLEMENT_PENDING` | requires `txHash`; same hash when already `SETTLED` replays; different hash → `STALE_SETTLEMENT_EVIDENCE` | `SETTLED` | `txHash` |
| `START_FULFILLMENT` | `SETTLED` with confirmed receipt | one `executionId` per transaction | `FULFILLMENT_PENDING` | `executionId` |
| `COMPLETE` | `FULFILLMENT_PENDING` | `reportHash` and `attestation` non-empty, `delivery.settlementTxHash === receipt.txHash`, optional `executionId` matches | `COMPLETED` | `reportHash`, `settlementTxHash` |
| `DISPUTE` | `SETTLED` / `FULFILLMENT_PENDING` / `COMPLETED` | reason recorded | `DISPUTED` | `reason` |
| `START_COMPENSATION` | `DISPUTED` with confirmed receipt | no confirmed receipt → `NO_PREMATURE_REFUND` | `COMPENSATION_PENDING` | `reason` |
| `REFUND` | `COMPENSATION_PENDING` | refund id once; any other state → `NO_PREMATURE_REFUND` | `COMPENSATED` | `refundId` |

Rejection codes: `INVALID_TRANSITION`, `NO_PREMATURE_REFUND`,
`NO_FALSE_COMPLETION`, `STALE_SETTLEMENT_EVIDENCE`,
`MISSING_SETTLEMENT_EVIDENCE`, `AT_MOST_ONCE_SETTLEMENT`,
`AT_MOST_ONCE_EXECUTION`, `UNCERTAIN_SETTLEMENT`.

## 4. Evidence model

Each accepted or rejected command appends one record:

```
{ sequence, kind, commandType, idempotencyKey,
  from, to, at, accepted, reason?, detail,
  previousHash, hash }
```

`hash = SHA-256( canonicalJson(record without hash) )` and `previousHash` links
to the prior record (genesis = 64 zeroes). `verifyRecoveryEvidence(record)`
recomputes every hash and checks sequence, chain linkage, and that no two
*accepted* effects share a `commandType:idempotencyKey` pair. A replay reuses the
original entry, so retries leave the log byte-identical. Rejections are logged
with `accepted=false`, which preserves the audit trail of attempted violations
without changing the business state.

## 5. Storage contract

```
interface RecoveryStore {
  read(txId): Promise<RecoveryRecord | null>
  writeAtomic(record, expectedVersion): Promise<boolean>  // compare-and-set
}
```

`writeAtomic` must not let two writers win for the same version. The in-memory
implementation relies on the single JS event loop; a real database should use a
conditional `UPDATE ... WHERE version = ?` or an equivalent transaction. The
machine retries on a lost write (8 attempts) and reads the winner's version
before recomputing. A crash is recovered by constructing a new `RecoveryMachine`
over the same store and `txId` and calling `snapshot()`.

## 6. Properties — enforced in code

| Property | Mechanism | Test |
|---|---|---|
| At-most-once financial settlement | one settlement slot; `CONFIRM`/`RECONCILE(SETTLED)` only from `SETTLEMENT_PENDING`; confirmed receipt never overwritten; same-key retry replays | `duplicate retry after TIMEOUT`, `reorg-style stale evidence`, `confirmed ABSENT then fresh settlement` |
| At-most-once service execution where enforceable | one `executionId`; duplicate id rejected, same id replayed | `at-most-once service execution` |
| No premature refund | `REFUND` valid only from `COMPENSATION_PENDING`, reachable only from `DISPUTED` after a confirmed receipt | `premature refund attempt` |
| No false completion | `COMPLETE` requires `FULFILLMENT_PENDING`, confirmed receipt, non-empty report hash/attestation, and binding to that receipt's `txHash` | `settlement success + delivery unknown`, `false completion attempt` |
| Safe recovery after uncertain outcomes | `TIMEOUT` keeps `SETTLEMENT_PENDING` with `uncertain=true`; `RECONCILE` resolves to one outcome; ABSENT permits a fresh settlement; machine is reconstructible from the store | `crash between RESERVED and SETTLED` |
| Consistent evidence after retries/crashes | append-only hash chain + idempotency dedupe + `verifyRecoveryEvidence` (also detects tampering) | all scenarios; dedicated tamper test |

## 7. Tamarin-compatible textual property list — **UNVERIFIED**

> The following is a specification sketch only. It has **not** been compiled or
> proved. There is no `recovery-model.spthy` and no proof artifact. Do not cite
> it as a formal verification result. A future model would need to define the
> fact symbols (`Authorized`, `Reserved`, `SettlementPending`, `Confirmed`,
 `Completed`, `Disputed`, `CompensationPending`, `Compensated`, `Event`) and the
> rules that emit them; the lemmas below state what such a model should show.

```
/* CFRSC — textual lemma list. UNVERIFIED: not compiled, not proved. */
builtins: hashing

/* P-CFRSC-1: at-most-once financial settlement per transaction. */
lemma cfrsc_at_most_once_settlement:
  all-traces
  "All tx h #i #j.
     Confirmed(tx, h) @ #i & Confirmed(tx, h) @ #j ==> #i = #j"

/* P-CFRSC-2: at most one distinct receipt hash can ever be confirmed. */
lemma cfrsc_single_receipt:
  all-traces
  "All tx h1 h2 #i #j.
     Confirmed(tx, h1) @ #i & Confirmed(tx, h2) @ #j ==> h1 = h2"

/* P-CFRSC-3: at-most-once service execution where the execution id is bound. */
lemma cfrsc_at_most_once_execution:
  all-traces
  "All tx e #i #j.
     Fulfilled(tx, e) @ #i & Fulfilled(tx, e) @ #j ==> #i = #j"

/* P-CFRSC-4: no premature refund — a refund implies a prior dispute of a
   confirmed settlement. */
lemma cfrsc_no_premature_refund:
  all-traces
  "All tx r #ref.
     Refunded(tx, r) @ #ref
     ==> (Ex h #d #s #c. Confirmed(tx, h) @ #s & Disputed(tx) @ #d
          & CompensationPending(tx) @ #c & #s < #d & #d < #c & #c < #ref)"

/* P-CFRSC-5: no false completion — completion implies a bound report and a
   prior confirmed settlement. */
lemma cfrsc_no_false_completion:
  all-traces
  "All tx rep #done.
     Completed(tx, rep) @ #done
     ==> (Ex h #s #f. Confirmed(tx, h) @ #s & Fulfilled(tx, f) @ #f
          & BoundReport(rep, h) @ #done & #s < #f & #f < #done)"

/* P-CFRSC-6: safe recovery after an uncertain outcome — a timeout does not
   burn the authorization; a later confirmation with the same nonce is
   reachable (mirrors P7 of clb-aligned.spthy). */
lemma cfrsc_recovery_after_timeout:
  exists-trace
  "Ex tx h n #t #s. TimedOut(tx, n) @ #t & Confirmed(tx, h) @ #s & #t < #s"

/* P-CFRSC-7: consistent evidence after a retry — one idempotency key yields
   at most one accepted effect. */
lemma cfrsc_idempotent_effect:
  all-traces
  "All tx k #i #j.
     Effect(tx, k) @ #i & Effect(tx, k) @ #j ==> #i = #j"
```

## 8. Enforced vs only specified

| Layer | Status |
|---|---|
| Code (`recovery.ts`) + Bun tests + fault-injection JSON/MD | **Enforced and executed** |
| Tamarin lemmas in §7 | **Specified only — UNVERIFIED** (no model, no proof run) |
| Delivery-signature authenticity | Delegated to `delivery-core`; not re-verified here |
| Multi-replica atomicity | Specified by the `writeAtomic` contract; only the single-process store was executed |

## 9. Residual limits

1. **Timers are external.** `TIMEOUT` is an explicit command; the machine has no
   clock and will not auto-resolve a stuck `SETTLEMENT_PENDING`.
2. **Binding, not authenticity.** `COMPLETE` checks that the report names the
   recorded `txHash` and carries a non-empty attestation. Verifying the merchant
   signature itself remains `delivery-core`'s job (`verifyDeliveryBinding`).
3. **Store trust.** Guards assume `RecoveryStore.writeAtomic` is genuinely
   atomic. The in-memory store is correct for one process only.
4. **Reorg availability.** After a confirmed receipt, a conflicting hash is
   rejected as stale; the machine will not replace the receipt. Recovery from a
   real chain reorg needs an external workflow (dispute → compensation).
5. **Dispute before reconciliation.** `DISPUTE` from `SETTLEMENT_PENDING` is
   refused by design: reconcile first, then dispute a known settlement.
6. **No symbolic proof.** §7 is text only; §6 is the evidential basis.

## 10. File map

```
packages/service-kit/src/recovery.ts            state machine, store interface, evidence audit
packages/service-kit/src/index.ts               exports ONLY (export * from "./recovery")
packages/service-kit/test/recovery.test.ts      9 fault-injection/property tests
experiments/novelty/cfrsc/fault-injection-results.json   executed scenario results
experiments/novelty/cfrsc/fault-injection-results.md     human-readable summary
review-revision/novelty/cfrsc/state-machine-spec.md      this document
review-revision/novelty/cfrsc/fault-injection.md         method and reproduction
review-revision/novelty/cfrsc/paste-ready-text.md        manuscript-ready wording
```
