# CFRSC architecture (implementation-aligned)

Describes what is implemented in `packages/service-kit/src/recovery.ts`, exported by
`packages/service-kit/src/index.ts`, and exercised by
`packages/service-kit/test/recovery.test.ts`. Architecture note only: not a manuscript
edit, not a citation source.

## 1. What this novelty does

CFRSC (Cross-Layer Failure Recovery and Settlement Consistency) is a pure, durable
state machine for where x402/AP2 layers disagree: settlement may land while delivery
is unknown, a retry may follow a timeout, or a process may crash between RESERVED and
SETTLED. It makes uncertainty explicit and every move a guarded, evidenced transition.
Its **9-state lifecycle** (8 specified states plus `COMPENSATED`, a distinct terminal
state for a completed refund):

- AUTHORIZED: order exists, no funds reserved
- RESERVED: funds/capacity reserved, no settlement submitted
- SETTLEMENT_PENDING: settlement submitted; outcome may be unknown
- SETTLED: exactly one receipt (txHash) recorded, no delivery yet
- FULFILLMENT_PENDING: one service execution started
- COMPLETED: a report bound to the recorded receipt accepted
- DISPUTED: a settled transaction contested
- COMPENSATION_PENDING: refund authorized by a dispute
- COMPENSATED: terminal, refund executed exactly once

Enforced properties (exercised in code, section 7): at-most-once financial settlement
(one receipt, never overwritten); at-most-once service execution where an executionId
exists; no premature refund (only after DISPUTED on a confirmed settlement); no false
completion (report must bind to the receipt's txHash plus attestation); safe recovery
after uncertain outcomes (TIMEOUT + RECONCILE, reconstructible); consistent evidence
after retries/crashes (append-only SHA-256 hash chain).

Key semantic point: **a valid payment does not imply service completion.** SETTLED
records money moved; COMPLETED additionally requires a fulfillment that started, a
report whose `settlementTxHash` equals the receipt `txHash`, a non-empty `reportHash`
and `attestation`, and a matching optional `executionId`. `COMPLETE` from SETTLED
(no fulfillment) is rejected `NO_FALSE_COMPLETION`.

## 2. Where it fits

```
 AP2 / CLB ----------> +--------------------+ <---------- x402 / facilitator
 (authorization)       |       CFRSC        |            (payment)
 delivery-core ------> |  RecoveryMachine   | <--------- evidence / verifier
 (delivery + guard)    +---------+----------+            verifyRecoveryEvidence
                                 |
                                 v
                      durability / recovery layer (this component)
```
CFRSC sits **between** authorization, payment, delivery, and the verifier as a
durability/recovery layer. It consumes receipts and delivery artifacts as command
payloads and decides only whether they may change state. It does **not** replace the
guard: signature authenticity stays in `delivery-core` (`verifyDeliveryBinding`),
authorization stays in AP2/CLB. CFRSC checks *binding consistency*
(`delivery.settlementTxHash === receipt.txHash`), not signature authenticity.

## 3. Architecture diagram

Input -> Processing -> Output:
```
 INPUT (commands)          PROCESSING (RecoveryMachine)         OUTPUT
 =================         ============================         ======
 AUTHORIZE        ----+
 RESERVE          ----+
 SUBMIT_SETTLEMENT----+ +--------------------------------+ +---------------------+
 TIMEOUT          ----+>| computeNext(current, command)  | | TransitionResult    |
 RECONCILE        ----+>| 1. idempotency (commandResults)| | {outcome, state,    |
 CONFIRM_SETTLEMENT--+>| 2. state guard                 | |  evidence, record,  |
 START_FULFILLMENT--+>| 3. accept()/reject()            | |  reason?}           |
 COMPLETE         ----+>| 4. appendEvidence (SHA-256)    | +---------------------+
 DISPUTE          ----+>+---------------+----------------+          |
 START_COMPENSATION--+                  |                           v
 REFUND           ----+                 v                +---------------------+
                       +--------------------------------+ | hash-chained        |
                       | RecoveryStore (CAS on version) | | evidence log        |
                       | read(txId) / writeAtomic(rec,v)| | (append-only)       |
                       +--------------------------------+ +---------------------+
```

State machine (all 9 states; `v` = applied transition):
```
                        AUTHORIZED
                            | RESERVE
                            v
                        RESERVED <-------------------------------+
                            | SUBMIT_SETTLEMENT                   | RECONCILE(ABSENT)
                            v                                     | (no receipt;
                   +-------------------+                           |  new id allowed)
                   | SETTLEMENT_PENDING| -- TIMEOUT --> (self, uncertain=true)
                   +----+----+----+----+
                        |    |    |
                        |    |    +-- CONFIRM_SETTLEMENT(txHash) -----+
                        |    +------- RECONCILE(SETTLED, txHash) -----+
                        |                                             |
                        +-------------------------------------------+
                                           |
                                           v
                                       SETTLED ----- DISPUTE ------+
                                           |                      |
                     START_FULFILLMENT     |                      |
                     (one executionId)     v                      |
                               FULFILLMENT_PENDING -- DISPUTE ----+
                                           |
                      COMPLETE(bound report) |  (reportHash+attestation,
                                           |   settlementTxHash == receipt.txHash)
                                           v
                                      COMPLETED -- DISPUTE ------+
                                                              |
                                                              v
                                                          DISPUTED
                                                              | START_COMPENSATION
                                                              | (confirmed receipt)
                                                              v
                                                   COMPENSATION_PENDING
                                                              | REFUND (once)
                                                              v
                                                         COMPENSATED (terminal)
```
Unsafe commands are not silently dropped: they are recorded as `REJECTION` evidence
(`accepted=false`) with a reason code; state is unchanged. A replay returns the
original evidence hash and writes nothing.

## 4. Execution flow

Internals of `RecoveryMachine.dispatch(command)` (same for every command):
`store.read(txId)` -> `computeNext()` -> if `commandResults[key]` hash matches,
`REPLAYED` (no write); else guard -> `accept()`/`reject()` -> `appendEvidence()`
(SHA-256 chain) -> `store.writeAtomic(next, current.version)` (CAS loop, max 8
attempts) -> `TransitionResult {outcome, state, evidence, record, reason?}`.

Happy path (exact methods/commands; fixed timestamps in tests):
```
 1. store = createInMemoryRecoveryStore()
 2. machine = createRecoveryMachine(store, "tx-1")
 3. dispatch AUTHORIZE          key "auth-1"  orderRef "order-1"    -> AUTHORIZED
 4. dispatch RESERVE            key "res-1"   reservationId "res-1" -> RESERVED
 5. dispatch SUBMIT_SETTLEMENT  key "set-1"   settlementId "set-1"  -> SETTLEMENT_PENDING
 6. dispatch CONFIRM_SETTLEMENT key "conf-1"  txHash "0xaaa"        -> SETTLED
 7. dispatch START_FULFILLMENT  key "exec-1"  executionId "exec-1"  -> FULFILLMENT_PENDING
 8. dispatch COMPLETE           key "done-1"  delivery("0xaaa")     -> COMPLETED
 9. snapshot() -> verifyRecoveryEvidence(record) => {ok:true, reasons:[]}
```
Timeout -> reconcile path:
```
 1-3. same through SUBMIT_SETTLEMENT -> SETTLEMENT_PENDING
 4. TIMEOUT            key "timeout-1"    -> SETTLEMENT_PENDING, uncertain=true, no receipt
 5. SUBMIT_SETTLEMENT  key "set-1" (dup)  -> REPLAYED, original hash, no second effect
 6a. RECONCILE outcome SETTLED, txHash "0xaaa" -> SETTLED, uncertain=false
 6b. OR RECONCILE outcome ABSENT -> RESERVED; then SUBMIT_SETTLEMENT "set-2"
       -> SETTLEMENT_PENDING; then CONFIRM_SETTLEMENT "conf-2" txHash "0xccc" -> SETTLED
 7. snapshot() -> verifyRecoveryEvidence(record) => {ok:true, reasons:[]}
```
Crash recovery: drop the machine, create a new one with same store and txId, call
`snapshot()` (fresh durable read), then continue with RECONCILE. Evidence sequence
continues intact (e.g. 1->4).

## 5. Data flow: one idempotency key

```
 command {type:"SUBMIT_SETTLEMENT", idempotencyKey:"set-1", settlementId:"set-1", at}
   |
   v
 computeNext: prior = current.commandResults["set-1"]     <-- key lookup
   |
   +-- first time (prior absent): guard passes
   |     accept(): version+1, state=SETTLEMENT_PENDING
   |     appendEvidence(): hash = SHA256(canonicalJson(entry without hash))
   |                       previousHash = last entry hash (genesis = 64 zeros)
   |     commandResults["set-1"] = {hash, state, accepted:true}
   |     store.writeAtomic(next, current.version) -> CAS persists
   |
   +-- replay (same key): prior present -> findEffect(hash === prior.hash)
         -> REPLAYED, no writeAtomic, record identical, no second effect
   |
   v
 verifyRecoveryEvidence: no two accepted effects share commandType:idempotencyKey
```
The key travels command -> `commandResults` map -> evidence `idempotencyKey` field
-> hash-chain entry -> replay suppression. A duplicate after TIMEOUT reuses the
original hash; a second accepted effect would trigger `DUPLICATE_EFFECT`.

## 6. Integration points and boundaries

- **No clock.** `TIMEOUT`/`RECONCILE` are explicit commands; timestamps come from the
  caller (`at`). Nothing is inferred from wall-clock expiry.
- **Single-process store.** `createInMemoryRecoveryStore` relies on the JS event loop.
  Guards assume `writeAtomic` is a genuine compare-and-set; multi-replica deployments
  need a real atomic primitive (`UPDATE ... WHERE version=?`, tx, or unique index).
  Only the single-process store was executed.
- **No signature authenticity.** `COMPLETE` checks binding and presence only;
  merchant-signature verification is delegated to `delivery-core`.
- **No Tamarin proof (UNVERIFIED).** Lemmas in `state-machine-spec.md` section 7 are
  textual spec only: no `.spthy` model, no proof run. Do not cite as formal verification.
  Section 1 properties are the evidential basis.
- **Reorg treated as stale.** `CONFIRM_SETTLEMENT` with a different txHash after a
  receipt exists is rejected `STALE_SETTLEMENT_EVIDENCE`; receipt never overwritten,
  canonical replay identical. Real reorg recovery needs an external dispute ->
  compensation workflow.
- **No network I/O.** Receipts and delivery artifacts arrive as command payloads.

## 7. Verification pointers

```bash
cd "E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2"
bun test packages/service-kit/test/recovery.test.ts   # 9 unit tests
bun run typecheck                                     # tsc --build, exit 0
bun test                                              # full suite, 0 fail
```
The 9 tests in `packages/service-kit/test/recovery.test.ts`:
1. happy path records explicit evidence for every transition
2. fault: duplicate retry after TIMEOUT replays, never re-settles
3. fault: crash between RESERVED and SETTLED recovers from durable store
4. fault: settlement success + delivery unknown blocks false completion
5. property: at-most-once service execution where enforceable
6. fault: premature refund attempt is rejected in every unsafe state
7. fault: reorg-style stale settlement evidence never overwrites a receipt
8. fault: confirmed ABSENT settlement permits one fresh settlement, never two
9. evidence audit detects tampering (hash break, chain break, duplicate effect)

Fault injection: `experiments/novelty/cfrsc/fault-injection-results.md` reports
**6 / 6 scenarios passed**, evidence-chain integrity OK for all 6; machine-readable
companion `fault-injection-results.json` (same directory). Method/reproduction:
`review-revision/novelty/cfrsc/fault-injection.md`. Spec and unverified lemmas:
`review-revision/novelty/cfrsc/state-machine-spec.md`.
