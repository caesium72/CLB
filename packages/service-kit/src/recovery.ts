import { createHash } from "node:crypto";

/**
 * CFRSC — Cross-Layer Failure Recovery and Settlement Consistency.
 *
 * A pure, durable state machine for the part of an x402/AP2 exchange where the
 * two layers disagree: settlement may have landed while delivery is unknown,
 * a retry may follow a timeout, or a process may crash between `RESERVED` and
 * `SETTLED`. The machine gives every transaction one idempotency key and makes
 * each state change explicit, guarded, and evidenced.
 *
 * Design constraints (deliberate, see review-revision/novelty/cfrsc/):
 *   - No I/O of its own. All persistence goes through `RecoveryStore`; a real
 *     SQL/KV backend only has to implement `writeAtomic` (conditional update on
 *     `version`) to be crash- and replica-safe. `createInMemoryRecoveryStore`
 *     is the test/demo implementation.
 *   - No cryptography beyond SHA-256 digests for the evidence hash chain. The
 *     merchant-signature check that binds a report to a settlement lives in
 *     `@clb-acel/delivery-core`; this machine verifies *binding consistency*
 *     (delivery.txHash === recorded receipt.txHash), not signature authenticity.
 *   - Evidence is append-only and hash-chained. A replayed command reuses the
 *     original evidence hash instead of appending a second effect, so a retry
 *     or a crash/reload cannot produce two settlements, two executions, or a
 *     duplicated audit trail.
 */

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** The eight specified CFRSC states plus `COMPENSATED`, the terminal state of
 * a completed compensation (a refund must have a distinct terminal outcome). */
export const RECOVERY_STATES = [
  "AUTHORIZED",
  "RESERVED",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "FULFILLMENT_PENDING",
  "COMPLETED",
  "DISPUTED",
  "COMPENSATION_PENDING",
  "COMPENSATED",
] as const;

export type RecoveryState = (typeof RECOVERY_STATES)[number];

export const REJECTION_REASONS = {
  INVALID_TRANSITION: "INVALID_TRANSITION",
  NO_PREMATURE_REFUND: "NO_PREMATURE_REFUND",
  NO_FALSE_COMPLETION: "NO_FALSE_COMPLETION",
  STALE_SETTLEMENT_EVIDENCE: "STALE_SETTLEMENT_EVIDENCE",
  MISSING_SETTLEMENT_EVIDENCE: "MISSING_SETTLEMENT_EVIDENCE",
  AT_MOST_ONCE_SETTLEMENT: "AT_MOST_ONCE_SETTLEMENT",
  AT_MOST_ONCE_EXECUTION: "AT_MOST_ONCE_EXECUTION",
  UNCERTAIN_SETTLEMENT: "UNCERTAIN_SETTLEMENT",
} as const;

export type RejectionReason = (typeof REJECTION_REASONS)[keyof typeof REJECTION_REASONS];

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** A delivered artifact is admissible for COMPLETE only if it is bound to the
 * settlement that actually paid for it. `attestation` is the carrier for the
 * delivery-core signature; this machine only checks it is present. */
export type DeliveryEvidence = {
  reportHash: string;
  settlementTxHash: string;
  attestation: string;
  executionId?: string;
};

export type RecoveryCommand =
  | { type: "AUTHORIZE"; idempotencyKey: string; orderRef: string; at?: string }
  | { type: "RESERVE"; idempotencyKey: string; reservationId: string; at?: string }
  | { type: "SUBMIT_SETTLEMENT"; idempotencyKey: string; settlementId: string; at?: string }
  | { type: "TIMEOUT"; idempotencyKey: string; at?: string }
  | { type: "RECONCILE"; idempotencyKey: string; outcome: "SETTLED" | "ABSENT"; txHash?: string; at?: string }
  | { type: "CONFIRM_SETTLEMENT"; idempotencyKey: string; txHash: string; at?: string }
  | { type: "START_FULFILLMENT"; idempotencyKey: string; executionId: string; at?: string }
  | { type: "COMPLETE"; idempotencyKey: string; delivery: DeliveryEvidence; at?: string }
  | { type: "DISPUTE"; idempotencyKey: string; reason: string; at?: string }
  | { type: "START_COMPENSATION"; idempotencyKey: string; reason: string; at?: string }
  | { type: "REFUND"; idempotencyKey: string; refundId: string; at?: string };

// ---------------------------------------------------------------------------
// Durable record + evidence
// ---------------------------------------------------------------------------

export type SettlementOutcome = "PENDING" | "CONFIRMED" | "ABSENT";

export type SettlementRecord = {
  settlementId: string;
  submittedAt: string;
  outcome: SettlementOutcome;
  receipt?: { txHash: string; confirmedAt: string };
};

export type RecoveryEvidenceKind = "TRANSITION" | "TIMEOUT" | "RECONCILE" | "REJECTION";

export type RecoveryEvidence = {
  sequence: number;
  kind: RecoveryEvidenceKind;
  commandType: RecoveryCommand["type"];
  idempotencyKey: string;
  from: RecoveryState | null;
  to: RecoveryState;
  at: string;
  accepted: boolean;
  reason?: string;
  detail: Record<string, unknown>;
  previousHash: string;
  hash: string;
};

export type CommandResult = {
  hash: string;
  state: RecoveryState;
  accepted: boolean;
  reason?: string;
};

export type RecoveryRecord = {
  txId: string;
  /** Optimistic-concurrency version; incremented on every persisted transition. */
  version: number;
  state: RecoveryState;
  order: { orderRef: string; authorizedAt: string };
  reservation?: { reservationId: string; reservedAt: string };
  settlement?: SettlementRecord;
  fulfillment?: { executionId: string; startedAt: string };
  completion?: {
    reportHash: string;
    settlementTxHash: string;
    attestation: string;
    completedAt: string;
  };
  dispute?: { reason: string; at: string };
  compensation?: {
    reason: string;
    requestedAt: string;
    refundId?: string;
    refundedAt?: string;
  };
  /** True after a TIMEOUT: the settlement outcome is explicitly unknown. */
  uncertain: boolean;
  evidence: RecoveryEvidence[];
  /** idempotencyKey -> the one effect that key produced (accepted or rejected). */
  commandResults: Record<string, CommandResult>;
};

export type DispatchOutcome = "APPLIED" | "REPLAYED" | "REJECTED";

export type TransitionResult = {
  outcome: DispatchOutcome;
  state: RecoveryState;
  evidence: RecoveryEvidence;
  /** Full post-command record; a fresh read from the store after any crash. */
  record: RecoveryRecord;
  reason?: string;
};

// ---------------------------------------------------------------------------
// Evidence hashing / verification (self-contained; no new dependency)
// ---------------------------------------------------------------------------

const GENESIS_HASH = "0".repeat(64);

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    out[key] = canonicalize(source[key]);
  }
  return out;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function computeEvidenceHash(entry: Omit<RecoveryEvidence, "hash">): string {
  return createHash("sha256").update(stableStringify(entry)).digest("hex");
}

function cloneRecord(record: RecoveryRecord): RecoveryRecord {
  return JSON.parse(JSON.stringify(record)) as RecoveryRecord;
}

type EvidenceInput = Omit<RecoveryEvidence, "hash" | "sequence" | "previousHash">;

function appendEvidence(
  record: RecoveryRecord,
  input: EvidenceInput,
): { evidence: RecoveryEvidence; evidenceLog: RecoveryEvidence[] } {
  const previous = record.evidence[record.evidence.length - 1] ?? null;
  const base = {
    ...input,
    sequence: record.evidence.length + 1,
    previousHash: previous?.hash ?? GENESIS_HASH,
  };
  const evidence: RecoveryEvidence = { ...base, hash: computeEvidenceHash(base) };
  return { evidence, evidenceLog: [...record.evidence, evidence] };
}

/**
 * Audit an evidence log for integrity and duplicate effects. A crash/reload or
 * a retry that produced a second settlement/execution will fail this check.
 */
export function verifyRecoveryEvidence(record: RecoveryRecord): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  let previousHash = GENESIS_HASH;
  record.evidence.forEach((entry, index) => {
    const { hash: _hash, ...base } = entry;
    void _hash;
    if (computeEvidenceHash(base) !== entry.hash) reasons.push(`HASH_MISMATCH:${index}`);
    if (entry.previousHash !== previousHash) reasons.push(`CHAIN_BREAK:${index}`);
    if (entry.sequence !== index + 1) reasons.push(`SEQUENCE:${index}`);
    previousHash = entry.hash;
  });

  const effects = new Set<string>();
  for (const entry of record.evidence) {
    if (!entry.accepted) continue;
    const key = `${entry.commandType}:${entry.idempotencyKey}`;
    if (effects.has(key)) reasons.push(`DUPLICATE_EFFECT:${key}`);
    effects.add(key);
  }

  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Storage interface (a real DB implements writeAtomic via conditional update)
// ---------------------------------------------------------------------------

/**
 * `writeAtomic` MUST be a compare-and-set: write only when the stored record's
 * version equals `expectedVersion`. Two concurrent callers may never both win.
 * A single-process store can rely on the event loop; a multi-replica store needs
 * a real atomic primitive (unique index, `UPDATE ... WHERE version = ?`, tx).
 */
export interface RecoveryStore {
  read(txId: string): Promise<RecoveryRecord | null>;
  writeAtomic(record: RecoveryRecord, expectedVersion: number): Promise<boolean>;
}

export function createInMemoryRecoveryStore(): RecoveryStore {
  const rows = new Map<string, RecoveryRecord>();
  return {
    async read(txId) {
      const row = rows.get(txId);
      return row ? cloneRecord(row) : null;
    },
    async writeAtomic(record, expectedVersion) {
      const current = rows.get(record.txId);
      if ((current?.version ?? 0) !== expectedVersion) return false;
      rows.set(record.txId, cloneRecord(record));
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Transition computation (pure given `current` + `command`)
// ---------------------------------------------------------------------------

type TransitionComputation = {
  next: RecoveryRecord;
  outcome: DispatchOutcome;
  evidence: RecoveryEvidence;
  reason?: string;
};

function emptyRecord(txId: string): RecoveryRecord {
  return {
    txId,
    version: 0,
    state: "AUTHORIZED",
    order: { orderRef: "", authorizedAt: "" },
    uncertain: false,
    evidence: [],
    commandResults: {},
  };
}

function findEffect(
  record: RecoveryRecord,
  predicate: (entry: RecoveryEvidence) => boolean,
): RecoveryEvidence | undefined {
  return record.evidence.find((entry) => entry.accepted && predicate(entry));
}

function computeNext(
  txId: string,
  current: RecoveryRecord | null,
  command: RecoveryCommand,
): TransitionComputation {
  const base = current ?? emptyRecord(txId);
  const from = current?.state ?? null;
  const at = command.at ?? new Date().toISOString();
  const key = command.idempotencyKey;

  // 1. Idempotency: a key produces exactly one effect. A retry replays the
  //    original evidence hash instead of writing a second effect.
  const prior = current?.commandResults?.[key];
  if (prior) {
    const evidence =
      findEffect(base, (entry) => entry.hash === prior.hash) ??
      base.evidence.find((entry) => entry.hash === prior.hash);
    if (evidence) return { next: base, outcome: "REPLAYED", evidence, reason: prior.reason };
  }

  const accept = (
    patch: Partial<RecoveryRecord>,
    to: RecoveryState,
    detail: Record<string, unknown>,
    kind: RecoveryEvidenceKind = "TRANSITION",
  ): TransitionComputation => {
    const staged: RecoveryRecord = { ...base, ...patch, version: base.version + 1, state: to };
    const { evidence, evidenceLog } = appendEvidence(staged, {
      kind,
      commandType: command.type,
      idempotencyKey: key,
      from,
      to,
      at,
      accepted: true,
      detail,
    });
    const next: RecoveryRecord = {
      ...staged,
      evidence: evidenceLog,
      commandResults: {
        ...staged.commandResults,
        [key]: { hash: evidence.hash, state: to, accepted: true },
      },
    };
    return { next, outcome: "APPLIED", evidence };
  };

  const reject = (reason: RejectionReason, detail: Record<string, unknown> = {}): TransitionComputation => {
    const to = base.state;
    const { evidence, evidenceLog } = appendEvidence(base, {
      kind: "REJECTION",
      commandType: command.type,
      idempotencyKey: key,
      from,
      to,
      at,
      accepted: false,
      reason,
      detail,
    });
    const next: RecoveryRecord = {
      ...base,
      version: base.version + 1,
      evidence: evidenceLog,
      commandResults: {
        ...base.commandResults,
        [key]: { hash: evidence.hash, state: to, accepted: false, reason },
      },
    };
    return { next, outcome: "REJECTED", evidence, reason };
  };

  const replayEffect = (evidence: RecoveryEvidence | undefined): TransitionComputation | null =>
    evidence ? { next: base, outcome: "REPLAYED", evidence } : null;

  switch (command.type) {
    case "AUTHORIZE": {
      if (current) return reject(REJECTION_REASONS.INVALID_TRANSITION);
      return accept(
        { order: { orderRef: command.orderRef, authorizedAt: at } },
        "AUTHORIZED",
        { orderRef: command.orderRef },
      );
    }

    case "RESERVE": {
      if (!current || base.state !== "AUTHORIZED" || base.reservation) {
        return reject(REJECTION_REASONS.INVALID_TRANSITION);
      }
      return accept(
        { reservation: { reservationId: command.reservationId, reservedAt: at } },
        "RESERVED",
        { reservationId: command.reservationId },
      );
    }

    case "SUBMIT_SETTLEMENT": {
      // Second submit of the same settlementId replays the original effect.
      const duplicate = replayEffect(
        findEffect(
          base,
          (entry) =>
            entry.commandType === "SUBMIT_SETTLEMENT" &&
            entry.detail.settlementId === command.settlementId,
        ),
      );
      if (duplicate) return duplicate;

      if (base.settlement?.outcome === "CONFIRMED") {
        return reject(REJECTION_REASONS.AT_MOST_ONCE_SETTLEMENT);
      }
      const retryable = base.state === "SETTLEMENT_PENDING" && base.settlement?.outcome === "ABSENT";
      if (base.state !== "RESERVED" && !retryable) {
        // While PENDING (uncertain) a fresh submit could double-spend.
        return reject(
          base.state === "SETTLEMENT_PENDING"
            ? REJECTION_REASONS.UNCERTAIN_SETTLEMENT
            : REJECTION_REASONS.INVALID_TRANSITION,
        );
      }
      return accept(
        {
          settlement: {
            settlementId: command.settlementId,
            submittedAt: at,
            outcome: "PENDING",
          },
          uncertain: false,
        },
        "SETTLEMENT_PENDING",
        { settlementId: command.settlementId },
      );
    }

    case "TIMEOUT": {
      if (base.state !== "SETTLEMENT_PENDING" || base.settlement?.outcome !== "PENDING") {
        return reject(REJECTION_REASONS.INVALID_TRANSITION);
      }
      return accept({ uncertain: true }, "SETTLEMENT_PENDING", {
        settlementId: base.settlement.settlementId,
        uncertain: true,
      }, "TIMEOUT");
    }

    case "RECONCILE": {
      if (base.state !== "SETTLEMENT_PENDING" || base.settlement?.outcome !== "PENDING") {
        return reject(REJECTION_REASONS.INVALID_TRANSITION);
      }
      const settlementId = base.settlement.settlementId;
      if (command.outcome === "SETTLED") {
        if (!command.txHash) return reject(REJECTION_REASONS.MISSING_SETTLEMENT_EVIDENCE);
        return accept(
          {
            settlement: {
              ...base.settlement,
              outcome: "CONFIRMED",
              receipt: { txHash: command.txHash, confirmedAt: at },
            },
            uncertain: false,
          },
          "SETTLED",
          { settlementId, txHash: command.txHash, reconcile: "SETTLED" },
          "RECONCILE",
        );
      }
      // Definitive absence: keep the reservation, clear the settlement so a
      // fresh settlementId may be submitted; no money moved yet.
      return accept(
        {
          settlement: { ...base.settlement, outcome: "ABSENT" },
          uncertain: false,
        },
        "RESERVED",
        { settlementId, reconcile: "ABSENT" },
        "RECONCILE",
      );
    }

    case "CONFIRM_SETTLEMENT": {
      if (base.settlement?.outcome === "CONFIRMED") {
        if (base.settlement.receipt?.txHash === command.txHash) {
          const replay = replayEffect(
            findEffect(
              base,
              (entry) =>
                (entry.commandType === "CONFIRM_SETTLEMENT" || entry.commandType === "RECONCILE") &&
                entry.detail.txHash === command.txHash,
            ),
          );
          if (replay) return replay;
        }
        // A different txHash is stale/reorged evidence: never overwrite a receipt.
        return reject(REJECTION_REASONS.STALE_SETTLEMENT_EVIDENCE, {
          recordedTxHash: base.settlement.receipt?.txHash,
          presentedTxHash: command.txHash,
        });
      }
      if (base.state !== "SETTLEMENT_PENDING" || base.settlement?.outcome !== "PENDING") {
        return reject(REJECTION_REASONS.INVALID_TRANSITION);
      }
      if (!command.txHash) return reject(REJECTION_REASONS.MISSING_SETTLEMENT_EVIDENCE);
      return accept(
        {
          settlement: {
            ...base.settlement,
            outcome: "CONFIRMED",
            receipt: { txHash: command.txHash, confirmedAt: at },
          },
          uncertain: false,
        },
        "SETTLED",
        { settlementId: base.settlement.settlementId, txHash: command.txHash },
      );
    }

    case "START_FULFILLMENT": {
      const duplicate = replayEffect(
        findEffect(
          base,
          (entry) =>
            entry.commandType === "START_FULFILLMENT" &&
            entry.detail.executionId === command.executionId,
        ),
      );
      if (duplicate) return duplicate;
      if (base.fulfillment) return reject(REJECTION_REASONS.AT_MOST_ONCE_EXECUTION);
      if (base.state !== "SETTLED" || base.settlement?.outcome !== "CONFIRMED") {
        return reject(REJECTION_REASONS.INVALID_TRANSITION);
      }
      return accept(
        { fulfillment: { executionId: command.executionId, startedAt: at } },
        "FULFILLMENT_PENDING",
        { executionId: command.executionId },
      );
    }

    case "COMPLETE": {
      if (base.completion) {
        if (base.completion.reportHash === command.delivery.reportHash) {
          const replay = replayEffect(
            findEffect(
              base,
              (entry) =>
                entry.commandType === "COMPLETE" && entry.detail.reportHash === command.delivery.reportHash,
            ),
          );
          if (replay) return replay;
        }
        return reject(REJECTION_REASONS.NO_FALSE_COMPLETION);
      }
      const receipt = base.settlement?.receipt;
      const bindingOk =
        base.state === "FULFILLMENT_PENDING" &&
        base.settlement?.outcome === "CONFIRMED" &&
        receipt !== undefined &&
        command.delivery.settlementTxHash === receipt.txHash &&
        command.delivery.reportHash.length > 0 &&
        command.delivery.attestation.length > 0 &&
        (command.delivery.executionId === undefined ||
          command.delivery.executionId === base.fulfillment?.executionId);
      if (!bindingOk) return reject(REJECTION_REASONS.NO_FALSE_COMPLETION);
      return accept(
        {
          completion: {
            reportHash: command.delivery.reportHash,
            settlementTxHash: command.delivery.settlementTxHash,
            attestation: command.delivery.attestation,
            completedAt: at,
          },
        },
        "COMPLETED",
        {
          reportHash: command.delivery.reportHash,
          settlementTxHash: command.delivery.settlementTxHash,
          executionId: base.fulfillment?.executionId,
        },
      );
    }

    case "DISPUTE": {
      if (
        base.state !== "SETTLED" &&
        base.state !== "FULFILLMENT_PENDING" &&
        base.state !== "COMPLETED"
      ) {
        return reject(REJECTION_REASONS.INVALID_TRANSITION);
      }
      return accept({ dispute: { reason: command.reason, at } }, "DISPUTED", {
        reason: command.reason,
      });
    }

    case "START_COMPENSATION": {
      if (base.compensation) {
        const replay = replayEffect(
          findEffect(
            base,
            (entry) => entry.commandType === "START_COMPENSATION" && entry.detail.reason === command.reason,
          ),
        );
        if (replay) return replay;
      }
      // Compensation is a refund of money that actually moved. Without a
      // confirmed receipt this would be a premature refund.
      if (base.state !== "DISPUTED" || base.settlement?.outcome !== "CONFIRMED") {
        return reject(REJECTION_REASONS.NO_PREMATURE_REFUND);
      }
      return accept(
        { compensation: { reason: command.reason, requestedAt: at } },
        "COMPENSATION_PENDING",
        { reason: command.reason },
      );
    }

    case "REFUND": {
      if (base.state === "COMPENSATION_PENDING" && base.compensation?.refundId) {
        const replay = replayEffect(
          findEffect(
            base,
            (entry) => entry.commandType === "REFUND" && entry.detail.refundId === command.refundId,
          ),
        );
        if (replay) return replay;
      }
      // Only an explicit, post-dispute compensation may authorize a refund.
      if (base.state !== "COMPENSATION_PENDING" || !base.compensation) {
        return reject(REJECTION_REASONS.NO_PREMATURE_REFUND);
      }
      return accept(
        {
          compensation: {
            ...base.compensation,
            refundId: command.refundId,
            refundedAt: at,
          },
        },
        "COMPENSATED",
        { refundId: command.refundId },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public machine
// ---------------------------------------------------------------------------

export class RecoveryMachine {
  constructor(
    readonly store: RecoveryStore,
    readonly txId: string,
  ) {}

  /** Apply one guarded command. Replays and rejections are returned, not thrown. */
  async dispatch(command: RecoveryCommand): Promise<TransitionResult> {
    // Optimistic-concurrency loop: a real multi-replica store may reject our
    // write; re-read and recompute from the winner's version before retrying.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.store.read(this.txId);
      const computed = computeNext(this.txId, current, command);
      if (computed.outcome !== "REPLAYED") {
        const written = await this.store.writeAtomic(computed.next, current?.version ?? 0);
        if (!written) continue;
      }
      return {
        outcome: computed.outcome,
        state: computed.next.state,
        evidence: computed.evidence,
        record: computed.next,
        ...(computed.reason ? { reason: computed.reason } : {}),
      };
    }
    throw new Error("CFRSC: optimistic-concurrency retry budget exhausted");
  }

  /** Fresh, durable view of the transaction. Safe to call after any crash. */
  async snapshot(): Promise<RecoveryRecord | null> {
    return this.store.read(this.txId);
  }
}

export function createRecoveryMachine(store: RecoveryStore, txId: string): RecoveryMachine {
  return new RecoveryMachine(store, txId);
}
