import type {
  CLBCommitmentInput,
  EvidenceEvent,
  Mandate,
  SettlementDescriptorExact,
  TokenRiskReport,
  VerificationCertificate,
  VerificationResult,
} from "@clb-acel/schemas";
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
  report: TokenRiskReport;
  /**
   * Concrete settlement params the agent committed to at settlement time.
   * Required when `mode === MODE_B_PREDICATE` — R17 evaluates the predicate
   * against these and C' is bound to them.
   */
  concreteSettlement?: SettlementDescriptorExact;
  /** Settlement-time commitment C' bound in Mode B (nonce = H(C')). */
  modeBCommitment?: Hex;
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
};
