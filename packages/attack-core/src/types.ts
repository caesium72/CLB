import type { AttackId, AttackResultCode, BaselineId } from "@clb-acel/schemas";
import type { RuleId, TraceBundle, VerifyTraceOutput } from "@clb-acel/verifier-core";

export type { AttackId, AttackResultCode, BaselineId };

/** The seven outcome categories required by the R3-C5 baseline-fairness review. */
export const OUTCOME_CATEGORIES = [
  "PREVENTED",
  "DETECTED",
  "EXPLOITED",
  "PARTIALLY_MITIGATED",
  "NOT_APPLICABLE",
  "ERROR",
  "SKIPPED",
] as const;

export type OutcomeCategory = (typeof OUTCOME_CATEGORIES)[number];

/** Categories the two booleans cannot express; a marker always wins over them. */
export type OutcomeMarker = Extract<
  OutcomeCategory,
  "PARTIALLY_MITIGATED" | "NOT_APPLICABLE" | "ERROR" | "SKIPPED"
>;

export type BaselineOutcome = {
  detected: boolean;
  prevented: boolean;
  note: string;
  failedRules?: RuleId[];
  /** Seven-category taxonomy; derived by deriveOutcome(), never hand-guessed. */
  outcome?: OutcomeCategory;
  /** Explicit marker for terminal/non-boolean outcomes (ERROR, SKIPPED, ...). */
  marker?: OutcomeMarker;
};

export function isOutcomeCategory(value: unknown): value is OutcomeCategory {
  return typeof value === "string" && (OUTCOME_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Single source of truth for boolean (+ optional marker) → taxonomy.
 * A marker wins so an ERROR/SKIPPED run can never look successful; an explicit
 * outcome is validated; PREVENTED requires prevented:true, so DETECTED is never
 * reported as PREVENTED.
 */
export function deriveOutcome(cell: {
  detected: boolean;
  prevented: boolean;
  outcome?: OutcomeCategory;
  marker?: OutcomeMarker;
}): OutcomeCategory {
  if (cell.marker !== undefined) {
    if (!isOutcomeCategory(cell.marker)) {
      throw new Error(`Unknown outcome marker: ${String(cell.marker)}`);
    }
    return cell.marker as OutcomeMarker;
  }
  if (cell.outcome !== undefined) {
    if (!isOutcomeCategory(cell.outcome)) {
      throw new Error(`Unknown outcome category: ${String(cell.outcome)}`);
    }
    if (cell.outcome === "PREVENTED" && cell.prevented !== true) {
      throw new Error("PREVENTED requires prevented:true; DETECTED must not be reported as PREVENTED");
    }
    return cell.outcome;
  }
  if (cell.prevented) return "PREVENTED";
  if (cell.detected) return "DETECTED";
  return "EXPLOITED";
}

export type AuditCheckResult = {
  ok: boolean;
  detail?: string;
};

export type AttackMutation = {
  path: string;
  before: string;
  after: string;
  impact: string;
};

export type AttackTraceSummary = {
  settlement: {
    payTo: string;
    value: string;
    asset: string;
    chainId: number;
    nonce: string;
  };
  mandate: {
    maxAmount?: string;
    allowedAssets?: string[];
    allowedPayees?: string[];
    taskHash?: string;
  };
  payerAgent: {
    authorizedPaymentKeys: string[];
  };
  report: {
    inputDataHash: string;
    reportHash: string;
  };
  evidence: {
    eventCount: number;
    objectTypes: string[];
    feedbackEventIds: string[];
    selectedPayee?: string;
  };
  nonceReplayAttempt: boolean;
};

export type AttackAnatomy = {
  summary: string;
  steps: string[];
  mutations: AttackMutation[];
  evidenceFocus: string[];
  detectedBy: string[];
  honestTrace: AttackTraceSummary;
  attackedTrace: AttackTraceSummary;
};

export type AttackScenario = {
  seed: number;
  token: string;
  baseAmount: string;
  attackAmount: string;
  allowedAsset: string;
  attackAsset: string;
  attackerPayee: string;
  taskHash: string;
  reportInputDataHash: string;
};

export type AttackAnatomyTemplate =
  | Omit<AttackAnatomy, "honestTrace" | "attackedTrace">
  | ((scenario: AttackScenario) => Omit<AttackAnatomy, "honestTrace" | "attackedTrace">);

export type AttackFixture = {
  id: AttackId;
  description: string;
  expectedResultCode: AttackResultCode;
  expectedFailedRules: RuleId[];
  mutate: (bundle: TraceBundle, scenario: AttackScenario) => TraceBundle | Promise<TraceBundle>;
  auditCheck?: (bundle: TraceBundle) => AuditCheckResult;
  anatomy: AttackAnatomyTemplate;
  baselineOutcomes: Record<BaselineId, BaselineOutcome>;
};

export type AttackRunResult = {
  attackId: AttackId;
  traceId: string;
  verification: VerifyTraceOutput;
  expectedResultCode: AttackResultCode;
  expectedFailedRules: RuleId[];
  auditCheck?: AuditCheckResult;
  scenario: AttackScenario;
  anatomy: AttackAnatomy;
  baselineComparison: Record<BaselineId, BaselineOutcome>;
  matched: boolean;
  preventionLayer: "x402" | "verifier" | "audit" | "none";
  metrics: {
    verifyLatencyMs: number;
    settlementLatencyMs?: number;
    eventCount: number;
    storageBytesEstimate: number;
  };
};

export type BaselineMatrix = Record<AttackId, Record<BaselineId, BaselineOutcome>>;

/**
 * Visitor-facing summary of one delegated (Mode B) settlement: what the human
 * signed (the predicate) versus the concrete params the agent settled, plus
 * the C' commitment, nonce, and whether the predicate guard would allow it.
 */
export type PredicateTraceSummary = {
  mandateType: "INTENT";
  predicate: {
    allowedPayees: string[];
    maxValue: string;
    allowedAssets: string[];
    validUntil: string;
    allowedChainIds: number[];
  };
  concreteSettlement: {
    payTo: string;
    value: string;
    asset: string;
    chainId: number;
    validBefore: string;
  };
  settledAt: string;
  commitmentCprime: string;
  nonce: string;
  guardWouldAllow: boolean;
};

/** Mode B counterpart of {@link AttackAnatomy}; contrasts authorized vs violated. */
export type PredicateAttackAnatomy = {
  summary: string;
  steps: string[];
  mutations: AttackMutation[];
  evidenceFocus: string[];
  detectedBy: string[];
  authorizedTrace: PredicateTraceSummary;
  violatedTrace: PredicateTraceSummary;
};
