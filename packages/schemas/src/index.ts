import { z } from "zod";

export const HexStringSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/, "Expected hex string prefixed with 0x");

export type HexString = z.infer<typeof HexStringSchema>;

export const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Expected 20-byte Ethereum address");

export type Address = z.infer<typeof AddressSchema>;

export const IdentityRefSchema = z.object({
  chainId: z.number().int().positive(),
  registryAddr: AddressSchema,
  agentId: z.string().min(1),
});

export type IdentityRef = z.infer<typeof IdentityRefSchema>;

export const SupportedProtocolSchema = z.enum(["AP2", "ACP", "x402", "ERC8004"]);

export const AgentCardSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  serviceEndpoints: z.array(z.string().url()),
  owner: AddressSchema,
  authorizedSigningKeys: z.array(AddressSchema),
  authorizedPaymentKeys: z.array(AddressSchema),
  supportedProtocols: z.array(SupportedProtocolSchema),
  metadataHash: HexStringSchema,
});

export type AgentCard = z.infer<typeof AgentCardSchema>;

export const MandateTypeSchema = z.enum(["INTENT", "CART", "PAYMENT"]);

/** Stable link from an INTENT mandate to the predicate that authorizes it (Mode B). */
export const PredicateRefSchema = z.object({
  predicateId: z.string().min(1),
});

export type PredicateRef = z.infer<typeof PredicateRefSchema>;

export const MandateConstraintsSchema = z.object({
  maxAmount: z.string().optional(),
  allowedAssets: z.array(z.string()).optional(),
  allowedPayees: z.array(AddressSchema).optional(),
  validUntil: z.string().datetime().optional(),
  taskHash: HexStringSchema.optional(),
  checkoutHash: HexStringSchema.optional(),
  /**
   * Delegated (Mode B) link to the spending predicate the human signed. The
   * constraint fields above still mirror the predicate for AP2 compatibility;
   * `predicateRef` pins the canonical predicate id used to recompute C'.
   */
  predicateRef: PredicateRefSchema.optional(),
});

export type MandateConstraints = z.infer<typeof MandateConstraintsSchema>;

export const MandateSchema = z.object({
  mandateId: z.string().min(1),
  type: MandateTypeSchema,
  humanPrincipal: z.string().min(1),
  authorizedAgent: IdentityRefSchema,
  constraints: MandateConstraintsSchema,
  clbCommitment: HexStringSchema.optional(),
  parentMandateHash: HexStringSchema.optional(),
  signature: HexStringSchema,
});

export type Mandate = z.infer<typeof MandateSchema>;

export const SettlementDescriptorExactSchema = z.object({
  chainId: z.number().int().positive(),
  network: z.string().min(1),
  asset: z.string().min(1),
  payTo: AddressSchema,
  value: z.string().min(1),
  validBefore: z.string().datetime(),
  x402Scheme: z.literal("exact"),
});

export type SettlementDescriptorExact = z.infer<typeof SettlementDescriptorExactSchema>;

export const SpendingPredicateSchema = z.object({
  allowedAssets: z.array(z.string()),
  allowedPayees: z.array(AddressSchema),
  maxValue: z.string(),
  validUntil: z.string().datetime(),
  allowedChainIds: z.array(z.number().int().positive()),
  allowedAgentIds: z.array(z.string()),
  taskHash: HexStringSchema.optional(),
});

export type SpendingPredicate = z.infer<typeof SpendingPredicateSchema>;

export const PredicateDescriptorSchema = z.object({
  predicateId: z.string().min(1),
  predicate: SpendingPredicateSchema,
  x402Scheme: z.literal("predicate"),
});

export type PredicateDescriptor = z.infer<typeof PredicateDescriptorSchema>;

/**
 * Concrete settlement slice the agent commits to at settlement time in the
 * delegated (Mode B) flow. The verifier evaluates the spending predicate
 * against these fields (R17) and C' binds their digest.
 */
export const SettlementParamsSchema = z.object({
  chainId: z.number().int().positive(),
  network: z.string().min(1),
  asset: z.string().min(1),
  payTo: AddressSchema,
  value: z.string().min(1),
  /**
   * Integer base-units of `value` (e.g. 6-decimal USDC: "2.00" -> "2000000"),
   * as a decimal string. Bound into the C' settlement digest so the committed
   * amount and the on-chain `validateAndConsume` comparison are the same quantity.
   */
  valueAtomic: z.string().regex(/^\d+$/, "valueAtomic must be integer base-units"),
  validBefore: z.string().datetime(),
  payerAgentId: z.string().min(1),
});

export type SettlementParams = z.infer<typeof SettlementParamsSchema>;

export const CLBDomainSchema = z.object({
  name: z.literal("CLB-ACEL"),
  version: z.literal("0.1"),
  chainId: z.number().int().positive(),
  verifyingContract: AddressSchema.optional(),
});

export const CLBCommitmentInputSchema = z.object({
  identityRef: IdentityRefSchema,
  mandateDigest: HexStringSchema,
  settlementDescriptor: z.union([SettlementDescriptorExactSchema, PredicateDescriptorSchema]),
  domain: CLBDomainSchema,
});

export type CLBCommitmentInput = z.infer<typeof CLBCommitmentInputSchema>;

export const EvidenceProtocolSchema = z.enum([
  "USER",
  "ERC8004",
  "AP2",
  "ACP",
  "X402",
  "CHAIN",
  "DELIVERY",
  "VERIFIER",
  "ATTACK",
]);

export const EvidenceEventSchema = z.object({
  traceId: z.string().min(1),
  eventId: z.string().min(1),
  protocol: EvidenceProtocolSchema,
  objectType: z.string().min(1),
  actor: z.string().min(1),
  timestamp: z.string().datetime(),
  objectHash: HexStringSchema,
  previousEventHash: HexStringSchema.optional(),
  publicFields: z.record(z.unknown()),
  privateRef: z.string().optional(),
  signature: HexStringSchema,
});

export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;

export const EvidenceNodeSchema = z.enum([
  "USER_INTENT",
  "ERC8004_AGENT_IDENTITY",
  "AP2_INTENT_MANDATE",
  "AP2_CART_MANDATE",
  "AP2_PAYMENT_MANDATE",
  "ACP_CHECKOUT_OR_TASK",
  "X402_PAYMENT_REQUIREMENT",
  "X402_PAYMENT_PAYLOAD",
  "CHAIN_SETTLEMENT",
  "DELIVERY_PROOF",
  "VERIFICATION_CERTIFICATE",
  "ERC8004_FEEDBACK",
  "DECISION_CONTEXT",
]);

export type EvidenceNode = z.infer<typeof EvidenceNodeSchema>;

export const EvidenceEdgeSchema = z.enum([
  "AUTHORIZES",
  "BINDS_TO",
  "PAYS_FOR",
  "SETTLES",
  "DELIVERS",
  "VALIDATES",
  "RATES",
  "CONSIDERED",
  "SELECTED",
]);

export type EvidenceEdge = z.infer<typeof EvidenceEdgeSchema>;

export const VerificationModeSchema = z.enum(["MODE_A_EXACT", "MODE_B_PREDICATE"]);

export const VerificationStatusSchema = z.enum(["PASS", "FAIL", "WARNING"]);

export const VerificationResultSchema = z.object({
  traceId: z.string().min(1),
  status: VerificationStatusSchema,
  failedRules: z.array(z.string()),
  warnings: z.array(z.string()),
  certificateHash: HexStringSchema,
  checkedAt: z.string().datetime(),
  mode: VerificationModeSchema,
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const VerificationCertificateSchema = z.object({
  traceId: z.string().min(1),
  mode: VerificationModeSchema,
  status: z.enum(["PASS", "FAIL"]),
  rulesChecked: z.array(z.string()),
  failedRules: z.array(z.string()),
  clbCommitment: HexStringSchema,
  settlementTxHash: HexStringSchema.optional(),
  traceMerkleRoot: HexStringSchema,
  certificateHash: HexStringSchema,
  verifierVersion: z.string().min(1),
  createdAt: z.string().datetime(),
});

export type VerificationCertificate = z.infer<typeof VerificationCertificateSchema>;

export const AttackIdSchema = z.enum([
  "PAYEE_SUBSTITUTION",
  "AMOUNT_ESCALATION",
  "ASSET_SWITCH",
  "CHAIN_TRANSPLANT",
  "AGENT_IDENTITY_SWAP",
  "MANDATE_REPLAY",
  "CART_OR_TASK_SWITCH",
  "PAYMENT_WITHOUT_DELIVERY",
  "FAKE_FEEDBACK",
  "PROMPT_INJECTION_SELECTION",
]);

export type AttackId = z.infer<typeof AttackIdSchema>;

export const BaselineIdSchema = z.enum(["B0", "B1", "B2", "B3"]);

export type BaselineId = z.infer<typeof BaselineIdSchema>;

export const AttackResultCodeSchema = z.enum([
  "PAYEE_MISMATCH",
  "AMOUNT_EXCEEDS_MANDATE",
  "ASSET_NOT_ALLOWED",
  "CHAIN_DOMAIN_MISMATCH",
  "UNAUTHORIZED_PAYMENT_KEY",
  "NONCE_REPLAY",
  "TASK_HASH_MISMATCH",
  "DELIVERY_MISSING_OR_INVALID",
  "FAKE_FEEDBACK_WITHOUT_VERIFICATION",
  "PROMPT_INJECTION_SELECTED_UNAUTHORIZED_MERCHANT",
]);

export type AttackResultCode = z.infer<typeof AttackResultCodeSchema>;

export const TokenRiskSignalsSchema = z.object({
  liquidityRisk: z.number().min(0).max(1),
  holderConcentrationRisk: z.number().min(0).max(1),
  contractRisk: z.number().min(0).max(1),
  marketVolatilityRisk: z.number().min(0).max(1),
  socialNarrativeRisk: z.number().min(0).max(1).optional(),
});

export const TokenRiskReportSchema = z.object({
  token: z.string().min(1),
  chain: z.string().min(1),
  riskScore: z.number().min(0).max(1),
  signals: TokenRiskSignalsSchema,
  modelVersion: z.string().min(1),
  inputDataHash: HexStringSchema,
  reportHash: HexStringSchema,
  merchantAgentSignature: HexStringSchema,
  /** Merchant signature over keccak256(settlementTxHash, reportHash) — R14b evidence. */
  deliveryBinding: HexStringSchema.optional(),
  generatedAt: z.string().datetime(),
});

export type TokenRiskReport = z.infer<typeof TokenRiskReportSchema>;

/**
 * Generic signed delivery artifact produced by any merchant agent (grammar,
 * weather, …). Structurally compatible with the verifier's report checks
 * (`reportHash`, `merchantAgentSignature`, `inputDataHash`, `generatedAt`,
 * `deliveryBinding`) so it can flow through the same binding rules as the
 * legacy token-risk report.
 */
export const ServiceKindSchema = z.enum(["grammar", "weather"]);
export type ServiceKind = z.infer<typeof ServiceKindSchema>;

export const ServiceReportSchema = z.object({
  /** Which agent capability produced this artifact. */
  service: ServiceKindSchema,
  /** Human-readable task this artifact fulfils (e.g. "Proofread paragraph"). */
  task: z.string().min(1),
  /** Structured service result (corrected text + issues, forecast, …). */
  result: z.record(z.unknown()),
  modelVersion: z.string().min(1),
  /** keccak over the canonical service input (the text / the city). */
  inputDataHash: HexStringSchema,
  /** keccak over the unsigned report content — binds delivery to the paid task. */
  reportHash: HexStringSchema,
  merchantAgentSignature: HexStringSchema,
  /** Merchant signature over keccak256(settlementTxHash, reportHash) — R14b evidence. */
  deliveryBinding: HexStringSchema.optional(),
  generatedAt: z.string().datetime(),
});

export type ServiceReport = z.infer<typeof ServiceReportSchema>;

/**
 * Any signed delivery artifact the verifier can bind to a settlement. Both the
 * legacy token-risk report and the generic service report satisfy the verifier's
 * structural checks (reportHash / merchantAgentSignature / inputDataHash /
 * generatedAt / deliveryBinding).
 */
export type DeliveryReport = TokenRiskReport | ServiceReport;

export const EvidenceGraphNodeSchema = z.object({
  id: z.string().min(1),
  nodeType: EvidenceNodeSchema,
  label: z.string(),
  protocol: EvidenceProtocolSchema,
  objectHash: HexStringSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type EvidenceGraphNode = z.infer<typeof EvidenceGraphNodeSchema>;

export const EvidenceGraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  edgeType: EvidenceEdgeSchema,
  label: z.string().optional(),
});

export type EvidenceGraphEdge = z.infer<typeof EvidenceGraphEdgeSchema>;

export const EvidenceGraphSchema = z.object({
  traceId: z.string().min(1),
  nodes: z.array(EvidenceGraphNodeSchema),
  edges: z.array(EvidenceGraphEdgeSchema),
});

export type EvidenceGraph = z.infer<typeof EvidenceGraphSchema>;
