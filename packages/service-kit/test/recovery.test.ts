import { describe, expect, test } from "bun:test";
import {
  REJECTION_REASONS,
  createInMemoryRecoveryStore,
  createRecoveryMachine,
  verifyRecoveryEvidence,
  type DeliveryEvidence,
  type RecoveryMachine,
  type RecoveryStore,
} from "../src/recovery";

/** Fixed timestamps keep every evidence hash deterministic across a "replay". */
const at = (second: number): string => `2026-05-30T05:00:${String(second).padStart(2, "0")}.000Z`;

function delivery(txHash: string, reportHash = "0xreport-a", attestation = "sig:merchant"): DeliveryEvidence {
  return { reportHash, settlementTxHash: txHash, attestation };
}

async function toSettlementPending(store: RecoveryStore, txId = "tx-1", settlementId = "set-1") {
  const machine = createRecoveryMachine(store, txId);
  await machine.dispatch({ type: "AUTHORIZE", idempotencyKey: "auth-1", orderRef: "order-1", at: at(0) });
  await machine.dispatch({ type: "RESERVE", idempotencyKey: "res-1", reservationId: "res-1", at: at(1) });
  const submit = await machine.dispatch({
    type: "SUBMIT_SETTLEMENT",
    idempotencyKey: settlementId,
    settlementId,
    at: at(2),
  });
  return { machine, submit };
}

async function toSettled(store: RecoveryStore, txId = "tx-1", txHash = "0xaaa") {
  const { machine } = await toSettlementPending(store, txId);
  const confirm = await machine.dispatch({
    type: "CONFIRM_SETTLEMENT",
    idempotencyKey: "conf-1",
    txHash,
    at: at(3),
  });
  return { machine, confirm };
}

describe("CFRSC — Cross-Layer Failure Recovery and Settlement Consistency", () => {
  test("happy path records explicit evidence for every transition", async () => {
    const store = createInMemoryRecoveryStore();
    const { machine } = await toSettled(store);
    await machine.dispatch({ type: "START_FULFILLMENT", idempotencyKey: "exec-1", executionId: "exec-1", at: at(4) });
    const completed = await machine.dispatch({
      type: "COMPLETE",
      idempotencyKey: "done-1",
      delivery: delivery("0xaaa"),
      at: at(5),
    });

    expect(completed.state).toBe("COMPLETED");
    expect(completed.record.evidence.filter((e) => e.accepted).map((e) => e.to)).toEqual([
      "AUTHORIZED",
      "RESERVED",
      "SETTLEMENT_PENDING",
      "SETTLED",
      "FULFILLMENT_PENDING",
      "COMPLETED",
    ]);
    expect(completed.record.settlement?.receipt?.txHash).toBe("0xaaa");
    expect(verifyRecoveryEvidence(completed.record)).toEqual({ ok: true, reasons: [] });
  });

  test("fault: duplicate retry after TIMEOUT replays, never re-settles", async () => {
    const store = createInMemoryRecoveryStore();
    const { machine, submit } = await toSettlementPending(store);
    const timeout = await machine.dispatch({ type: "TIMEOUT", idempotencyKey: "timeout-1", at: at(3) });
    expect(timeout.state).toBe("SETTLEMENT_PENDING");
    expect(timeout.record.uncertain).toBe(true);
    expect(timeout.record.settlement?.receipt).toBeUndefined();

    // Same idempotency key + same settlementId: a retry must have no second effect.
    const retry = await machine.dispatch({
      type: "SUBMIT_SETTLEMENT",
      idempotencyKey: "set-1",
      settlementId: "set-1",
      at: at(4),
    });
    expect(retry.outcome).toBe("REPLAYED");
    expect(retry.evidence.hash).toBe(submit.evidence.hash);
    expect(retry.record.uncertain).toBe(true);

    // Reconciliation resolves the uncertainty into exactly one settlement.
    const reconciled = await machine.dispatch({
      type: "RECONCILE",
      idempotencyKey: "recon-1",
      outcome: "SETTLED",
      txHash: "0xaaa",
      at: at(5),
    });
    expect(reconciled.state).toBe("SETTLED");
    expect(reconciled.record.uncertain).toBe(false);

    const confirmRetries = reconciled.record.evidence.filter(
      (e) => e.accepted && (e.commandType === "CONFIRM_SETTLEMENT" || e.commandType === "RECONCILE") && e.detail.txHash === "0xaaa",
    );
    expect(confirmRetries).toHaveLength(1);
    expect(verifyRecoveryEvidence(reconciled.record)).toEqual({ ok: true, reasons: [] });
  });

  test("fault: crash between RESERVED and SETTLED recovers from durable store", async () => {
    const store = createInMemoryRecoveryStore();
    const { machine } = await toSettlementPending(store);

    // Simulate a process crash: drop the machine, reopen the same txId/store.
    const recovered = createRecoveryMachine(store, "tx-1");
    const snapshot = await recovered.snapshot();
    expect(snapshot?.state).toBe("SETTLEMENT_PENDING");
    expect(snapshot?.settlement?.outcome).toBe("PENDING");
    expect(snapshot?.settlement?.receipt).toBeUndefined();

    const confirmed = await recovered.dispatch({
      type: "RECONCILE",
      idempotencyKey: "recon-1",
      outcome: "SETTLED",
      txHash: "0xaaa",
      at: at(5),
    });
    expect(confirmed.state).toBe("SETTLED");
    expect(confirmed.record.evidence.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(verifyRecoveryEvidence(confirmed.record)).toEqual({ ok: true, reasons: [] });
  });

  test("fault: settlement success + delivery unknown blocks false completion", async () => {
    const store = createInMemoryRecoveryStore();
    const { machine } = await toSettled(store);
    expect((await machine.snapshot())?.uncertain).toBe(false); // delivery, not settlement, is unknown

    // Completion before fulfillment is a false completion.
    const early = await machine.dispatch({ type: "COMPLETE", idempotencyKey: "done-early", delivery: delivery("0xaaa"), at: at(4) });
    expect(early.outcome).toBe("REJECTED");
    expect(early.reason).toBe(REJECTION_REASONS.NO_FALSE_COMPLETION);
    expect(early.state).toBe("SETTLED");

    await machine.dispatch({ type: "START_FULFILLMENT", idempotencyKey: "exec-1", executionId: "exec-1", at: at(5) });

    // A report bound to a different settlement cannot complete this one.
    const wrongBinding = await machine.dispatch({ type: "COMPLETE", idempotencyKey: "done-wrong", delivery: delivery("0xevil"), at: at(6) });
    expect(wrongBinding.reason).toBe(REJECTION_REASONS.NO_FALSE_COMPLETION);

    // Nor can a report with no attestation.
    const noAttestation = await machine.dispatch({
      type: "COMPLETE",
      idempotencyKey: "done-empty",
      delivery: delivery("0xaaa", "0xreport-a", ""),
      at: at(7),
    });
    expect(noAttestation.reason).toBe(REJECTION_REASONS.NO_FALSE_COMPLETION);

    const completed = await machine.dispatch({ type: "COMPLETE", idempotencyKey: "done-ok", delivery: delivery("0xaaa"), at: at(8) });
    expect(completed.state).toBe("COMPLETED");
    expect(verifyRecoveryEvidence(completed.record)).toEqual({ ok: true, reasons: [] });
  });

  test("property: at-most-once service execution where enforceable", async () => {
    const store = createInMemoryRecoveryStore();
    const { machine } = await toSettled(store);
    const first = await machine.dispatch({ type: "START_FULFILLMENT", idempotencyKey: "exec-1", executionId: "exec-1", at: at(4) });
    expect(first.state).toBe("FULFILLMENT_PENDING");

    const second = await machine.dispatch({ type: "START_FULFILLMENT", idempotencyKey: "exec-2", executionId: "exec-2", at: at(5) });
    expect(second.outcome).toBe("REJECTED");
    expect(second.reason).toBe(REJECTION_REASONS.AT_MOST_ONCE_EXECUTION);

    // Retry with the original key replays the one effect.
    const replay = await machine.dispatch({ type: "START_FULFILLMENT", idempotencyKey: "exec-1", executionId: "exec-1", at: at(6) });
    expect(replay.outcome).toBe("REPLAYED");
    expect(replay.record.fulfillment?.executionId).toBe("exec-1");
  });

  test("fault: premature refund attempt is rejected in every unsafe state", async () => {
    const store = createInMemoryRecoveryStore();
    const { machine } = await toSettlementPending(store);
    await machine.dispatch({ type: "TIMEOUT", idempotencyKey: "timeout-1", at: at(3) });

    // Uncertain settlement: a refund could double-pay if the settlement lands.
    const duringUncertainty = await machine.dispatch({ type: "REFUND", idempotencyKey: "refund-early-1", refundId: "refund-1", at: at(4) });
    expect(duringUncertainty.outcome).toBe("REJECTED");
    expect(duringUncertainty.reason).toBe(REJECTION_REASONS.NO_PREMATURE_REFUND);
    expect(duringUncertainty.state).toBe("SETTLEMENT_PENDING");

    // No settlement at all: still not a refundable state.
    const reservedStore = createInMemoryRecoveryStore();
    const reservedMachine = createRecoveryMachine(reservedStore, "tx-reserved");
    await reservedMachine.dispatch({ type: "AUTHORIZE", idempotencyKey: "auth-r", orderRef: "order-r", at: at(0) });
    await reservedMachine.dispatch({ type: "RESERVE", idempotencyKey: "res-r", reservationId: "res-r", at: at(1) });
    const atReserved = await reservedMachine.dispatch({ type: "REFUND", idempotencyKey: "refund-r", refundId: "refund-r", at: at(2) });
    expect(atReserved.reason).toBe(REJECTION_REASONS.NO_PREMATURE_REFUND);

    // Settled but not disputed: compensation is still premature.
    const settledStore = createInMemoryRecoveryStore();
    const { machine: settledMachine } = await toSettled(settledStore, "tx-settled");
    const earlyCompensation = await settledMachine.dispatch({ type: "START_COMPENSATION", idempotencyKey: "comp-early", reason: "changed mind", at: at(4) });
    expect(earlyCompensation.reason).toBe(REJECTION_REASONS.NO_PREMATURE_REFUND);
    expect(earlyCompensation.state).toBe("SETTLED");

    // The only safe refund path: SETTLED -> DISPUTED -> COMPENSATION_PENDING -> COMPENSATED.
    await settledMachine.dispatch({ type: "DISPUTE", idempotencyKey: "dispute-1", reason: "not delivered", at: at(5) });
    const compensation = await settledMachine.dispatch({ type: "START_COMPENSATION", idempotencyKey: "comp-1", reason: "not delivered", at: at(6) });
    expect(compensation.state).toBe("COMPENSATION_PENDING");
    const refund = await settledMachine.dispatch({ type: "REFUND", idempotencyKey: "refund-1", refundId: "refund-1", at: at(7) });
    expect(refund.state).toBe("COMPENSATED");
    expect(refund.record.compensation?.refundId).toBe("refund-1");

    const secondRefund = await settledMachine.dispatch({ type: "REFUND", idempotencyKey: "refund-2", refundId: "refund-2", at: at(8) });
    expect(secondRefund.outcome).toBe("REJECTED");
    expect(secondRefund.reason).toBe(REJECTION_REASONS.NO_PREMATURE_REFUND);
    expect(verifyRecoveryEvidence(refund.record)).toEqual({ ok: true, reasons: [] });
  });

  test("fault: reorg-style stale settlement evidence never overwrites a receipt", async () => {
    const store = createInMemoryRecoveryStore();
    const { machine } = await toSettled(store, "tx-1", "0xaaa");

    const stale = await machine.dispatch({ type: "CONFIRM_SETTLEMENT", idempotencyKey: "conf-stale", txHash: "0xbbb", at: at(4) });
    expect(stale.outcome).toBe("REJECTED");
    expect(stale.reason).toBe(REJECTION_REASONS.STALE_SETTLEMENT_EVIDENCE);
    expect(stale.record.settlement?.receipt?.txHash).toBe("0xaaa");

    // The canonical receipt still replays cleanly.
    const replay = await machine.dispatch({ type: "CONFIRM_SETTLEMENT", idempotencyKey: "conf-replay", txHash: "0xaaa", at: at(5) });
    expect(replay.outcome).toBe("REPLAYED");
    expect(verifyRecoveryEvidence(replay.record)).toEqual({ ok: true, reasons: [] });
  });

  test("fault: confirmed ABSENT settlement permits one fresh settlement, never two", async () => {
    const store = createInMemoryRecoveryStore();
    const { machine } = await toSettlementPending(store);
    await machine.dispatch({ type: "TIMEOUT", idempotencyKey: "timeout-1", at: at(3) });
    const absent = await machine.dispatch({ type: "RECONCILE", idempotencyKey: "recon-absent", outcome: "ABSENT", at: at(4) });
    expect(absent.state).toBe("RESERVED");
    expect(absent.record.settlement?.outcome).toBe("ABSENT");
    expect(absent.record.settlement?.receipt).toBeUndefined();

    await machine.dispatch({ type: "SUBMIT_SETTLEMENT", idempotencyKey: "set-2", settlementId: "set-2", at: at(5) });
    const confirmed = await machine.dispatch({ type: "CONFIRM_SETTLEMENT", idempotencyKey: "conf-2", txHash: "0xccc", at: at(6) });
    expect(confirmed.state).toBe("SETTLED");
    expect(confirmed.record.settlement?.receipt?.txHash).toBe("0xccc");

    const acceptedReceipts = confirmed.record.evidence.filter(
      (e) => e.accepted && e.detail.txHash === "0xccc" && (e.commandType === "CONFIRM_SETTLEMENT" || e.commandType === "RECONCILE"),
    );
    expect(acceptedReceipts).toHaveLength(1);
    expect(verifyRecoveryEvidence(confirmed.record)).toEqual({ ok: true, reasons: [] });
  });

  test("evidence audit detects tampering (hash break, chain break, duplicate effect)", async () => {
    const store = createInMemoryRecoveryStore();
    const { machine } = await toSettled(store);
    const record = await machine.snapshot();
    expect(record).not.toBeNull();
    expect(verifyRecoveryEvidence(record!).ok).toBe(true);

    const flipped = structuredClone(record!);
    (flipped.evidence[1] as { hash: string }).hash = "0".repeat(64);
    expect(verifyRecoveryEvidence(flipped).reasons.some((r) => r.startsWith("HASH_MISMATCH"))).toBe(true);

    const brokenChain = structuredClone(record!);
    (brokenChain.evidence[2] as { previousHash: string }).previousHash = "0".repeat(64);
    expect(verifyRecoveryEvidence(brokenChain).reasons.some((r) => r.startsWith("CHAIN_BREAK"))).toBe(true);

    const duplicated = structuredClone(record!);
    duplicated.evidence.push({ ...structuredClone(duplicated.evidence[0]!), sequence: duplicated.evidence.length + 1 });
    expect(verifyRecoveryEvidence(duplicated).reasons.some((r) => r.startsWith("DUPLICATE_EFFECT"))).toBe(true);
  });
});
