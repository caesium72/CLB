import { issueMandate } from "@clb-acel/ap2-adapter";
import {
  computeCommitment,
  computeMandateDigest,
  computeModeBSettlementCommitment,
  deriveNonce,
  deriveSettlementNonce,
  keccakCanonical,
  settlementParamsFromExact,
} from "@clb-acel/clb-core";
import { createPredicateGuard, type GuardResult } from "@clb-acel/predicate-adapter";
import { buildSignedReport } from "@clb-acel/delivery-core";
import {
  createInMemoryErc8004Registry,
  identityRefFor,
  type AgentRecord,
  type Erc8004Registry,
} from "@clb-acel/erc8004-adapter";
import { buildEvidenceGraph, buildMerkleRoot, hashEvidenceEvent, linkEvidenceEvents } from "@clb-acel/evidence-core";
import { defaultAgents, DEFAULT_ANALYSIS_AGENT_ID, DEFAULT_SHOPPING_AGENT_ID } from "@clb-acel/identity-service/seed";
import type {
  EvidenceEvent,
  EvidenceGraph,
  Mandate,
  PredicateDescriptor,
  SettlementDescriptorExact,
  SpendingPredicate,
  TokenRiskReport,
} from "@clb-acel/schemas";
import { verifyTrace, type TraceBundle, type VerifierAgentView, type VerifyTraceOutput } from "@clb-acel/verifier-core";
import {
  buildPaymentAuthorization,
  buildPaymentRequirements,
  buildPredicatePaymentRequirements,
  createFacilitator,
  createLocalFacilitator,
  settlePredicate,
  signPaymentPayload,
  type PaymentPayload,
  type PaymentRequirementsResponse,
  type SettlementReceipt,
} from "@clb-acel/x402-adapter";
import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ANVIL = {
  user: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  shopper: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  merchant: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
} as const;

function envKey(name: string, fallback: string): Hex {
  const value = process.env[name]?.trim();
  return (value ? value : fallback) as Hex;
}

export type OrchestratorConfig = {
  userPrivateKey: Hex;
  shopperPrivateKey: Hex;
  merchantPrivateKey: Hex;
  chainId: number;
  network: string;
  asset: string;
  price: string;
  paymentTimeoutSeconds: number;
  /** Fixed base time (ms) for deterministic, reproducible traces. */
  nowMs?: number;
};

export function resolveConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    userPrivateKey: overrides.userPrivateKey ?? envKey("USER_TEST_PRIVATE_KEY", ANVIL.user),
    shopperPrivateKey: overrides.shopperPrivateKey ?? envKey("SHOPPING_AGENT_PRIVATE_KEY", ANVIL.shopper),
    merchantPrivateKey: overrides.merchantPrivateKey ?? envKey("MERCHANT_AGENT_PRIVATE_KEY", ANVIL.merchant),
    chainId: overrides.chainId ?? Number(process.env.CHAIN_ID ?? 84532),
    network: overrides.network ?? process.env.X402_NETWORK?.trim() ?? "base-sepolia",
    asset: overrides.asset ?? process.env.X402_ASSET?.trim() ?? "USDC",
    price: overrides.price ?? process.env.X402_PRICE?.trim() ?? "2.00",
    paymentTimeoutSeconds: overrides.paymentTimeoutSeconds ?? 600,
    ...(overrides.nowMs !== undefined ? { nowMs: overrides.nowMs } : {}),
  };
}

export type Intent = {
  intentId: string;
  task: string;
  token: string;
  budget: string;
  asset: string;
  network: string;
  createdAt: string;
};

export function createIntent(input: {
  task?: string;
  token: string;
  budget?: string;
  asset?: string;
  network?: string;
  intentId?: string;
}): Intent {
  const config = resolveConfig();
  return {
    intentId: input.intentId ?? `intent-${crypto.randomUUID()}`,
    task: input.task ?? `Buy a token-risk report for token ${input.token}`,
    token: input.token,
    budget: input.budget ?? config.price,
    asset: input.asset ?? config.asset,
    network: input.network ?? config.network,
    createdAt: new Date().toISOString(),
  };
}

export type TraceResult = {
  traceId: string;
  intent: Intent;
  payerAgent: AgentRecord;
  merchantAgent: AgentRecord;
  mandate: Mandate;
  clbCommitment: Hex;
  nonce: Hex;
  settlementDescriptor: SettlementDescriptorExact;
  paymentRequirements: ReturnType<typeof buildPaymentRequirements>;
  paymentPayload: PaymentPayload;
  settlement: SettlementReceipt;
  report: TokenRiskReport;
  events: EvidenceEvent[];
  eventHashes: Hex[];
  merkleRoot: Hex;
  graph: EvidenceGraph;
  verification: VerifyTraceOutput;
};

function agentView(record: AgentRecord): VerifierAgentView {
  return {
    agentId: record.agentId,
    registryAddr: record.registryAddr as Address,
    chainId: record.chainId,
    status: record.status,
    authorizedPaymentKeys: record.card.authorizedPaymentKeys as Address[],
    authorizedSigningKeys: record.card.authorizedSigningKeys as Address[],
  };
}

async function seededRegistry(): Promise<Erc8004Registry> {
  const registry = createInMemoryErc8004Registry();
  for (const agent of defaultAgents()) {
    await registry.register(agent);
  }
  return registry;
}

function evidenceEvent(
  traceId: string,
  index: number,
  protocol: EvidenceEvent["protocol"],
  objectType: string,
  actor: string,
  object: unknown,
  baseTime: number,
): EvidenceEvent {
  return {
    traceId,
    eventId: `evt-${index}-${objectType.toLowerCase()}`,
    protocol,
    objectType,
    actor,
    timestamp: new Date(baseTime + index * 1000).toISOString(),
    objectHash: keccakCanonical(object),
    publicFields: { objectType },
    signature: `0x${"1".repeat(130)}`,
  };
}

/**
 * Execute the full human-present (Mode A) flow in-process:
 * identity -> mandate -> CLB commitment -> x402 402 -> settle -> delivery ->
 * evidence graph -> deterministic verification.
 */
export async function runHumanPresent(
  intent: Intent,
  configOverrides: Partial<OrchestratorConfig> = {},
): Promise<TraceResult> {
  const config = resolveConfig(configOverrides);
  const traceId = `trace-${intent.intentId}`;
  const baseTime = config.nowMs ?? Date.now();

  const registry = await seededRegistry();
  const payerAgent = await registry.getAgent(DEFAULT_SHOPPING_AGENT_ID);
  const merchantAgent = await registry.getAgent(DEFAULT_ANALYSIS_AGENT_ID);
  if (!payerAgent || !merchantAgent) {
    throw new Error("Default agents are not registered");
  }

  const shopperAddress = privateKeyToAccount(config.shopperPrivateKey).address;
  const merchantAddress = (merchantAgent.card.authorizedPaymentKeys[0] ??
    privateKeyToAccount(config.merchantPrivateKey).address) as Address;

  const settlementDescriptor: SettlementDescriptorExact = {
    chainId: config.chainId,
    network: intent.network,
    asset: config.asset,
    payTo: merchantAddress,
    value: config.price,
    validBefore: new Date(baseTime + config.paymentTimeoutSeconds * 1000).toISOString(),
    x402Scheme: "exact",
  };

  const paymentRequirements = buildPaymentRequirements({
    descriptor: settlementDescriptor,
    resource: `${merchantAgent.card.serviceEndpoints[0]}/risk-report?token=${intent.token}`,
    description: `Token-risk report for ${intent.token}`,
  });

  const identityRef = identityRefFor(payerAgent);
  const clb = {
    identityRef,
    settlementDescriptor,
    domain: { name: "CLB-ACEL", version: "0.1", chainId: config.chainId } as const,
  };
  const constraints = {
    maxAmount: intent.budget,
    allowedAssets: [intent.asset],
    allowedPayees: [merchantAddress],
    validUntil: settlementDescriptor.validBefore,
  };

  const mandate = await issueMandate(config.userPrivateKey, {
    type: "CART",
    authorizedAgent: identityRef,
    constraints,
    clb,
  });

  const commitment = computeCommitment({
    identityRef,
    mandateDigest: computeMandateDigest(mandate),
    settlementDescriptor,
    domain: clb.domain,
  });
  const nonce = deriveNonce(commitment);

  const paymentPayload = await signPaymentPayload(
    config.shopperPrivateKey,
    buildPaymentAuthorization({ from: shopperAddress, descriptor: settlementDescriptor, nonce }),
  );

  const facilitator = createFacilitator();
  const settledReceipt = await facilitator.settle(paymentPayload);
  // Deterministic settlement/delivery ordering (R14) anchored to baseTime.
  const settlement = { ...settledReceipt, settledAt: new Date(baseTime + 5000).toISOString() };

  const report = await buildSignedReport(config.merchantPrivateKey, {
    token: intent.token,
    chain: intent.network,
    generatedAt: new Date(baseTime + 6000).toISOString(),
  });

  const events = linkEvidenceEvents([
    evidenceEvent(traceId, 1, "USER", "USER_INTENT", "user:browser-wallet", intent, baseTime),
    evidenceEvent(traceId, 2, "ERC8004", "ERC8004_AGENT_IDENTITY", "identity-service", payerAgent.card, baseTime),
    evidenceEvent(traceId, 3, "AP2", "AP2_CART_MANDATE", "mandate-service", mandate, baseTime),
    evidenceEvent(traceId, 4, "X402", "X402_PAYMENT_REQUIREMENT", "merchant-agent", paymentRequirements, baseTime),
    evidenceEvent(traceId, 5, "X402", "X402_PAYMENT_PAYLOAD", "shopping-agent", paymentPayload, baseTime),
    evidenceEvent(traceId, 6, "CHAIN", "CHAIN_SETTLEMENT", "facilitator", settlement, baseTime),
    evidenceEvent(traceId, 7, "DELIVERY", "DELIVERY_PROOF", "merchant-agent", report, baseTime),
  ]);
  const eventHashes = events.map(hashEvidenceEvent);
  const merkleRoot = buildMerkleRoot(eventHashes);

  const bundle: TraceBundle = {
    traceId,
    mode: "MODE_A_EXACT",
    events,
    eventHashes,
    merkleRoot,
    payerAgent: agentView(payerAgent),
    merchantAgent: agentView(merchantAgent),
    mandate,
    clb,
    paymentPayload,
    settlement,
    report,
  };

  const verification = await verifyTrace(bundle);

  return {
    traceId,
    intent,
    payerAgent,
    merchantAgent,
    mandate,
    clbCommitment: commitment,
    nonce,
    settlementDescriptor,
    paymentRequirements,
    paymentPayload,
    settlement,
    report,
    events,
    eventHashes,
    merkleRoot,
    graph: buildEvidenceGraph(events),
    verification,
  };
}

export type ModeBTraceResult = {
  traceId: string;
  mode: "MODE_B_PREDICATE";
  intent: Intent;
  payerAgent: AgentRecord;
  merchantAgent: AgentRecord;
  /** INTENT mandate (personal-message signed, no auth-time commitment). */
  mandate: Mandate;
  /** Human-signed spending predicate π. */
  predicateDescriptor: PredicateDescriptor;
  /** Concrete settlement params the agent chose within π. */
  concreteSettlement: SettlementDescriptorExact;
  /** Settlement-time commitment C'. */
  modeBCommitment: Hex;
  /** nonce = H(C'). */
  nonce: Hex;
  paymentRequirements: PaymentRequirementsResponse;
  paymentPayload: PaymentPayload;
  settlement: SettlementReceipt;
  guardResult: GuardResult;
  report: TokenRiskReport;
  events: EvidenceEvent[];
  eventHashes: Hex[];
  merkleRoot: Hex;
  graph: EvidenceGraph;
  verification: VerifyTraceOutput;
};

/**
 * Execute the delegated (Mode B) flow in-process: identity -> INTENT mandate
 * over a spending predicate -> agent picks concrete settlement within π ->
 * C' commitment + guard enforcement -> settle -> delivery -> evidence graph ->
 * deterministic verification (R17). The human signs π once; the exact
 * `(asset, payTo, value)` are chosen later by the agent and bound via C'.
 */
export async function runDelegated(
  intent: Intent,
  configOverrides: Partial<OrchestratorConfig> = {},
): Promise<ModeBTraceResult> {
  const config = resolveConfig(configOverrides);
  const traceId = `trace-delegated-${intent.intentId}`;
  const baseTime = config.nowMs ?? Date.now();

  const registry = await seededRegistry();
  const payerAgent = await registry.getAgent(DEFAULT_SHOPPING_AGENT_ID);
  const merchantAgent = await registry.getAgent(DEFAULT_ANALYSIS_AGENT_ID);
  if (!payerAgent || !merchantAgent) {
    throw new Error("Default agents are not registered");
  }

  const shopperAddress = privateKeyToAccount(config.shopperPrivateKey).address;
  const merchantAddress = (merchantAgent.card.authorizedPaymentKeys[0] ??
    privateKeyToAccount(config.merchantPrivateKey).address) as Address;

  const identityRef = identityRefFor(payerAgent);
  const domain = { name: "CLB-ACEL", version: "0.1", chainId: config.chainId } as const;
  // Payment authorization expiry (short) vs predicate authorization window (longer).
  const validBefore = new Date(baseTime + config.paymentTimeoutSeconds * 1000).toISOString();
  const predicateValidUntil = new Date(baseTime + 24 * 60 * 60 * 1000).toISOString();

  // 1. Human authorizes a spending predicate (not an exact descriptor).
  const predicate: SpendingPredicate = {
    allowedAssets: [intent.asset],
    allowedPayees: [merchantAddress],
    maxValue: intent.budget,
    validUntil: predicateValidUntil,
    allowedChainIds: [config.chainId],
    allowedAgentIds: [payerAgent.agentId],
  };
  const predicateDescriptor: PredicateDescriptor = {
    predicateId: `predicate-${intent.intentId}`,
    predicate,
    x402Scheme: "predicate",
  };

  // 2. INTENT mandate over the predicate (personal-message signature).
  // Pin the mandateId so the mandate digest (and therefore C') is deterministic.
  const mandate = await issueMandate(config.userPrivateKey, {
    type: "INTENT",
    mandateId: `mandate-intent-${intent.intentId}`,
    authorizedAgent: identityRef,
    constraints: {},
    predicate: predicateDescriptor,
  });

  // 3. Agent autonomously picks concrete settlement params within π.
  const concreteSettlement: SettlementDescriptorExact = {
    chainId: config.chainId,
    network: intent.network,
    asset: intent.asset,
    payTo: merchantAddress,
    value: config.price,
    validBefore,
    x402Scheme: "exact",
  };
  const settlementParams = settlementParamsFromExact(concreteSettlement, payerAgent.agentId);

  // 4. Bind C' at settlement time and derive the nonce.
  const modeBInput = {
    identityRef,
    mandateDigest: computeMandateDigest(mandate),
    predicateId: predicateDescriptor.predicateId,
    settlementParams,
    domain,
  };
  const modeBCommitment = computeModeBSettlementCommitment(modeBInput);
  const nonce = deriveSettlementNonce(modeBCommitment);

  const paymentRequirements = buildPredicatePaymentRequirements({
    predicate,
    predicateId: predicateDescriptor.predicateId,
    resource: `${merchantAgent.card.serviceEndpoints[0]}/risk-report?token=${intent.token}`,
    concreteSettlement,
    description: `Token-risk report for ${intent.token} (predicate-authorized)`,
  });

  const paymentPayload = await signPaymentPayload(
    config.shopperPrivateKey,
    buildPaymentAuthorization({ from: shopperAddress, descriptor: concreteSettlement, nonce }),
    "predicate",
  );

  // 5. Guard enforces π + C'/nonce binding before the local facilitator settles.
  const guard = createPredicateGuard();
  const { receipt, guardResult } = await settlePredicate({
    payload: paymentPayload,
    guard,
    guardInput: {
      predicate,
      params: settlementParams,
      commitment: modeBInput,
      expectedNonce: nonce,
      now: new Date(baseTime),
    },
    facilitator: createLocalFacilitator(),
  });
  const settlement = { ...receipt, settledAt: new Date(baseTime + 5000).toISOString() };

  const report = await buildSignedReport(config.merchantPrivateKey, {
    token: intent.token,
    chain: intent.network,
    generatedAt: new Date(baseTime + 6000).toISOString(),
  });

  // 6. Evidence graph uses AP2_INTENT_MANDATE (no CART / PAYMENT mandates).
  const events = linkEvidenceEvents([
    evidenceEvent(traceId, 1, "USER", "USER_INTENT", "user:browser-wallet", intent, baseTime),
    evidenceEvent(traceId, 2, "ERC8004", "ERC8004_AGENT_IDENTITY", "identity-service", payerAgent.card, baseTime),
    evidenceEvent(traceId, 3, "AP2", "AP2_INTENT_MANDATE", "mandate-service", { mandate, predicate: predicateDescriptor }, baseTime),
    evidenceEvent(traceId, 4, "X402", "X402_PAYMENT_REQUIREMENT", "merchant-agent", paymentRequirements, baseTime),
    evidenceEvent(traceId, 5, "X402", "X402_PAYMENT_PAYLOAD", "shopping-agent", paymentPayload, baseTime),
    evidenceEvent(traceId, 6, "CHAIN", "CHAIN_SETTLEMENT", "facilitator", settlement, baseTime),
    evidenceEvent(traceId, 7, "DELIVERY", "DELIVERY_PROOF", "merchant-agent", report, baseTime),
  ]);
  const eventHashes = events.map(hashEvidenceEvent);
  const merkleRoot = buildMerkleRoot(eventHashes);

  const bundle: TraceBundle = {
    traceId,
    mode: "MODE_B_PREDICATE",
    events,
    eventHashes,
    merkleRoot,
    payerAgent: agentView(payerAgent),
    merchantAgent: agentView(merchantAgent),
    mandate,
    clb: { identityRef, settlementDescriptor: predicateDescriptor, domain },
    paymentPayload,
    settlement,
    report,
    concreteSettlement,
    modeBCommitment,
  };

  const verification = await verifyTrace(bundle);

  return {
    traceId,
    mode: "MODE_B_PREDICATE",
    intent,
    payerAgent,
    merchantAgent,
    mandate,
    predicateDescriptor,
    concreteSettlement,
    modeBCommitment,
    nonce,
    paymentRequirements,
    paymentPayload,
    settlement,
    guardResult,
    report,
    events,
    eventHashes,
    merkleRoot,
    graph: buildEvidenceGraph(events),
    verification,
  };
}
