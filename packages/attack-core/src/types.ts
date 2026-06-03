import type { AttackId, AttackResultCode, BaselineId } from "@clb-acel/schemas";
import type { RuleId, TraceBundle, VerifyTraceOutput } from "@clb-acel/verifier-core";

export type { AttackId, AttackResultCode, BaselineId };

export type BaselineOutcome = {
  detected: boolean;
  prevented: boolean;
  note: string;
  failedRules?: RuleId[];
};

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
