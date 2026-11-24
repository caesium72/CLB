# Paste-ready text — Novelty 4 (CFRSC)

> Insert only citations that have been retrieved and verified in the reference
> library. No citation keys are supplied here. File paths refer to artifacts in
> this repository and are not external references.

## Paragraph 1 — motivation

Existing x402/AP2 pipelines treat settlement and delivery as a single linear
flow. In practice the two layers can finish out of order, or one can finish while
the other is unobservable: a client that times out after submitting a payment
cannot distinguish "not yet settled" from "settled but the response was lost",
and a naive retry can settle twice. We address this gap with **Cross-Layer
Failure Recovery and Settlement Consistency (CFRSC)**, a durable transaction
state machine that makes partial execution, timeouts, retries, and uncertain
delivery explicit states rather than implicit error paths.

## Paragraph 2 — mechanism

CFRSC models the lifecycle
`AUTHORIZED → RESERVED → SETTLEMENT_PENDING → SETTLED → FULFILLMENT_PENDING → COMPLETED`,
with `DISPUTED` and `COMPENSATION_PENDING` branches ending in `COMPENSATED`.
Each command carries an idempotency key and is either *applied*, *replayed*, or
*rejected*. Replays return the original evidence hash and write nothing, so a
duplicate retry after a timeout cannot create a second settlement or a second
service execution. Rejections are recorded as evidence but leave the business
state unchanged. The machine records exactly one settlement receipt; conflicting
hashes presented after a confirmation (as a chain reorg would produce) are
rejected as stale. Completion is accepted only when a report is bound to the
recorded receipt's transaction hash and carries a non-empty attestation, and a
refund is legal only after a confirmed settlement has been disputed and
compensation explicitly requested — never while the outcome is uncertain. All
persistence goes through a narrow store interface whose single write operation
is a compare-and-set on a version counter, so a process crash is recovered by
reconstructing the machine over the same durable state.

## Paragraph 3 — evidence

Every transition appends an append-only, hash-chained evidence record. A
verifier can recompute the chain and check that no idempotency key produced two
accepted effects; our fault-injection results show this audit detects hash
breaks, chain breaks, and duplicate effects. The design keeps the evidence
consistent across retries and crashes without trusting the client's clock:
timeouts and reconciliations are explicit commands.

## Paragraph 4 — evaluation and scope

Six fault-injection scenarios — duplicate retry after timeout, crash between
reservation and settlement, settlement success with unknown delivery, premature
refund, false completion, and reorg-style stale settlement evidence — were
executed against the implementation, and the associated assertions pass. The
properties enforced in code are at-most-once financial settlement, at-most-once
service execution where an execution identifier is available, no premature
refund, no false completion, safe recovery after uncertain outcomes, and
consistent evidence after retries and crashes. We deliberately do **not** claim
a symbolic proof for this component: a Tamarin-style lemma list is provided as
an unverified specification, and the existing aligned CLB model covers failed
settlement recovery at the authorization layer only. Enforcement assumes the
storage layer's compare-and-set is genuinely atomic and delegates delivery
signature verification to the delivery-core component.

## Suggested figure caption

> Figure: CFRSC transaction states and guarded transitions. Solid arrows are
> applied transitions; `TIMEOUT` is a self-loop that records uncertainty;
> `RECONCILE(ABSENT)` returns to `RESERVED` without a receipt. Every edge is an
> evidenced state change, and duplicate commands replay the original edge.

## Suggested table caption

> Table: Fault-injection scenarios, injected fault, final state, and the
> CFRSC property each scenario asserts (all six scenarios pass).
