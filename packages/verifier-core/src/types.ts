import type {
  CLBCommitmentInput,
  DeliveryReport,
  EvidenceEvent,
  Mandate,
  SettlementDescriptorExact,
  VerificationCertificate,
  VerificationResult,
} from "@clb-acel/schemas";
import type { RangeProof } from "@clb-acel/clb-core";
import type { PaymentPayload, SettlementReceipt } from "@clb-acel/x402-adapter";
import type { Address, Hex } from "viem";

/** Minimal agent view the verifier needs (subset of an AgentRecord). */
export type VerifierAgentView = {
  agentId: string;
  registryAddr: Address;
  chainId: number;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  authorizedPaymentKeys: Address[];
  authorizedSigningKeys: Address[];
};

/**
 * Structured trace bundle the verifier evaluates. The orchestrator assembles it
 * from live protocol objects; the verifier never trusts an LLM and only runs
 * deterministic checks over this data plus the evidence events.
 */
export type TraceBundle = {
  traceId: string;
  mode: VerificationResult["mode"];
  events: EvidenceEvent[];
  eventHashes?: string[];
  merkleRoot: Hex;
  /** Payer agent whose identity is bound in C (the agent that was authorized). */
  payerAgent: VerifierAgentView;
  /** Analysis/merchant agent that receives payment and signs the report. */
  merchantAgent: VerifierAgentView;
  mandate: Mandate;
  /**
   * CLB binding context. In Mode A `clb.settlementDescriptor` is an exact
   * descriptor; in Mode B it is a `PredicateDescriptor` (the human-signed π).
   */
  clb: Omit<CLBCommitmentInput, "mandateDigest">;
  paymentPayload: PaymentPayload;
  settlement: SettlementReceipt;
  /** True when a second settlement with the same nonce was attempted. */
  nonceReplayAttempt?: boolean;
  /** Signed delivery artifact (token-risk report or any generic ServiceReport). */
  report: DeliveryReport;
  /**
   * Concrete settlement params the agent committed to at settlement time.
   * Required when `mode === MODE_B_PREDICATE` — R17 evaluates the predicate
   * against these and C' is bound to them.
   */
  concreteSettlement?: SettlementDescriptorExact;
  /** Settlement-time commitment C' bound in Mode B (nonce = H(C')). */
  modeBCommitment?: Hex;
  /**
   * Confidential commit-and-prove inputs (Phase 7F). When present and the
   * verifier runs in confidential mode, R11 is discharged by checking the range
   * proof against the (public) maxValue instead of reading a plaintext amount.
   */
  confidential?: {
    /** Pedersen commitment to the settlement value. */
    valueCommitment: Hex;
    rangeProof: RangeProof;
    /** Public, human-signed spending cap the proof attests `value <= maxValue`. */
    maxValueAtomic: string | bigint;
  };
};

export type RuleId =
  | "R1_HASH_CHAIN_INTACT"
  | "R2_SIGNATURES_VALID"
  | "R3_AGENT_IDENTITY_RESOLVES"
  | "R4_AGENT_PAYMENT_KEY_AUTHORIZED"
  | "R5_MANDATE_SIGNATURE_VALID"
  | "R6_CLB_COMMITMENT_RECOMPUTES"
  | "R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR"
  | "R8_PAYMENT_NONCE_EQUALS_HASH_C"
  | "R9_NONCE_CONSUMED_EXACTLY_ONCE"
  | "R10_CHAIN_DOMAIN_MATCHES"
  | "R11_AMOUNT_WITHIN_MANDATE"
  | "R12_PAYEE_MATCHES_CHECKOUT_OR_TASK"
  | "R13_ASSET_ALLOWED"
  | "R14_DELIVERY_AFTER_SETTLEMENT"
  | "R14b_DELIVERY_BOUND_TO_SETTLEMENT"
  | "R15_TASK_HASH_MATCHES"
  | "R17_PREDICATE_TRUE_FOR_MODE_B";

export type RuleOutcome = {
  ok: boolean;
  detail?: string;
};

export type VerifyTraceOutput = {
  result: VerificationResult;
  certificate: VerificationCertificate;
  outcomes: Record<RuleId, RuleOutcome>;
  /**
   * `true` when R11 read a plaintext amount (standard path); `undefined` when the
   * confidential range-proof path discharged R11 without ever seeing the value.
   */
  readPlaintextAmount?: boolean;
};

/** Options controlling how a trace is verified. */
export type VerifyTraceOptions = {
  /** Discharge R11 via the confidential range proof in `bundle.confidential`. */
  confidential?: boolean;
};
