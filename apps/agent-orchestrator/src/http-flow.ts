import {
  computeCommitment,
  computeMandateDigest,
  computeModeBSettlementCommitment,
  deriveNonce,
  deriveSettlementNonce,
  keccakCanonical,
  settlementParamsFromExact,
} from "@clb-acel/clb-core";
import { buildEvidenceGraph, buildMerkleRoot, hashEvidenceEvent, linkEvidenceEvents } from "@clb-acel/evidence-core";
import { identityRefFor, type AgentRecord } from "@clb-acel/erc8004-adapter";
import { DEFAULT_ANALYSIS_AGENT_ID, DEFAULT_DECOY_AGENT_ID, DEFAULT_SHOPPING_AGENT_ID } from "@clb-acel/identity-service/seed";
import { createPredicateGuard, type GuardResult } from "@clb-acel/predicate-adapter";
import type {
  EvidenceEvent,
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
  signPaymentPayload,
  type PaymentPayload,
  type PaymentRequirementsResponse,
  type SettlementReceipt,
} from "@clb-acel/x402-adapter";
import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createIntent,
  resolveConfig,
  type Intent,
  type ModeBTraceResult,
  type OrchestratorConfig,
  type TraceResult,
} from "./flow";
import type { MandateAuthorization } from "@clb-acel/ap2-adapter";

export type ServiceUrls = {
  evidence: string;
  identity: string;
  mandate: string;
  merchant: string;
  verifier: string;
};

export function resolveServiceUrls(overrides: Partial<ServiceUrls> = {}): ServiceUrls {
  return {
    evidence: overrides.evidence ?? process.env.EVIDENCE_SERVICE_URL?.trim() ?? "http://localhost:4001",
    identity: overrides.identity ?? process.env.IDENTITY_SERVICE_URL?.trim() ?? "http://localhost:4002",
    mandate: overrides.mandate ?? process.env.MANDATE_SERVICE_URL?.trim() ?? "http://localhost:4003",
    merchant: overrides.merchant ?? process.env.MERCHANT_AGENT_URL?.trim() ?? "http://localhost:4004",
    verifier: overrides.verifier ?? process.env.VERIFIER_SERVICE_URL?.trim() ?? "http://localhost:4005",
  };
}

export type PreparedHumanPresent = {
  mode: "a";
  payerAgent: AgentRecord;
  merchantAgent: AgentRecord;
  settlementDescriptor: SettlementDescriptorExact;
  clbDomain: { name: "CLB-ACEL"; version: "0.1"; chainId: number };
  clb: Omit<import("@clb-acel/schemas").CLBCommitmentInput, "mandateDigest">;
  mandateDraft: MandateAuthorization;
  expectedCommitment: Hex;
};

export type PreparedDelegated = {
  mode: "b";
  payerAgent: AgentRecord;
  merchantAgent: AgentRecord;
  predicateDescriptor: PredicateDescriptor;
  mandateDraft: MandateAuthorization;
  mandateDigest: Hex;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}: ${body}`);
  }
  return (await response.json()) as T;
}

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

async function fetchDefaultAgents(urls: ServiceUrls) {
  const payerAgent = await fetchJson<AgentRecord>(
    `${urls.identity}/agents/${DEFAULT_SHOPPING_AGENT_ID}`,
    { headers: { Accept: "application/json" } },
  );
  const merchantAgent = await fetchJson<AgentRecord>(
    `${urls.identity}/agents/${DEFAULT_ANALYSIS_AGENT_ID}`,
    { headers: { Accept: "application/json" } },
  );
  return { payerAgent, merchantAgent };
}

async function fetchAgent(urls: ServiceUrls, agentId: string): Promise<AgentRecord | null> {
  try {
    return await fetchJson<AgentRecord>(`${urls.identity}/agents/${agentId}`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    return null;
  }
}

export type AgentActivityEvent = {
  id: string;
  label: string;
  detail?: string;
  delayMs: number;
  tone?: "info" | "success" | "reject";
};

export type DiscoveryCandidate = {
  agentId: string;
  card: AgentRecord["card"];
  selected: boolean;
  rejectedReason?: string;
};

export type DiscoveryResult = {
  payerAgent: AgentRecord;
  selectedMerchant: AgentRecord;
  selectedMerchantId: string;
  candidates: DiscoveryCandidate[];
  activity: AgentActivityEvent[];
  rationale: string;
};

export type CartQuoteResult = {
  kind: "cart";
  product: string;
  merchantName: string;
  merchantAgentId: string;
  price: string;
  asset: string;
  payee: string;
  network: string;
  settlementDescriptor: SettlementDescriptorExact;
};

export type DelegationQuoteResult = {
  kind: "delegation";
  product: string;
  merchantName: string;
  merchantAgentId: string;
  maxValue: string;
  asset: string;
  allowedPayees: string[];
  validUntil: string;
  note: string;
  predicateDescriptor: PredicateDescriptor;
};

export type QuoteResult = CartQuoteResult | DelegationQuoteResult;

function merchantSupportsX402(agent: AgentRecord): boolean {
  return agent.card.supportedProtocols?.includes("x402") ?? false;
}

/**
 * Deterministic agent discovery narrative for Phase 5b demo UX.
 * Always selects the verified analysis merchant; decoy lacks x402.
 */
export async function discoverAgentsForIntent(
  intent: Intent,
  options: { urls?: Partial<ServiceUrls> } = {},
): Promise<DiscoveryResult> {
  const urls = resolveServiceUrls(options.urls);
  const { payerAgent, merchantAgent } = await fetchDefaultAgents(urls);
  const decoyAgent = await fetchAgent(urls, DEFAULT_DECOY_AGENT_ID);

  const activity: AgentActivityEvent[] = [
    {
      id: "search",
      label: "Searching ERC-8004 identity registry…",
      detail: `Task: ${intent.task}`,
      delayMs: 0,
      tone: "info",
    },
    {
      id: "compare",
      label: "Comparing merchant agents for x402 support…",
      delayMs: 800,
      tone: "info",
    },
  ];

  const candidates: DiscoveryCandidate[] = [];

  if (decoyAgent) {
    const rejected = !merchantSupportsX402(decoyAgent);
    candidates.push({
      agentId: decoyAgent.agentId,
      card: decoyAgent.card,
      selected: false,
      rejectedReason: rejected ? "Missing verified x402 settlement support" : undefined,
    });
    if (rejected) {
      activity.push({
        id: "reject-decoy",
        label: `Skipped ${decoyAgent.card.name}`,
        detail: "Missing verified x402 settlement support",
        delayMs: 1400,
        tone: "reject",
      });
    }
  }

  candidates.push({
    agentId: merchantAgent.agentId,
    card: merchantAgent.card,
    selected: true,
  });

  activity.push({
    id: "select",
    label: `Selected ${merchantAgent.card.name}`,
    detail: "Verified token-risk reports over x402",
    delayMs: 2200,
    tone: "success",
  });

  return {
    payerAgent,
    selectedMerchant: merchantAgent,
    selectedMerchantId: merchantAgent.agentId,
    candidates,
    activity,
    rationale: `${merchantAgent.card.name} supports x402 and matches the token-risk report use case for ${intent.token}.`,
  };
}

export async function quoteForIntent(
  intent: Intent,
  mode: "a" | "b",
  options: { urls?: Partial<ServiceUrls>; config?: Partial<OrchestratorConfig> } = {},
): Promise<QuoteResult> {
  const urls = resolveServiceUrls(options.urls);
  const { merchantAgent } = await fetchDefaultAgents(urls);
  const product = `Token-risk report for ${intent.token}`;

  if (mode === "b") {
    const prepared = await prepareDelegatedOverHttp(intent, { urls, config: options.config });
    const predicate = prepared.predicateDescriptor.predicate;
    return {
      kind: "delegation",
      product,
      merchantName: merchantAgent.card.name,
      merchantAgentId: merchantAgent.agentId,
      maxValue: predicate.maxValue,
      asset: predicate.allowedAssets[0] ?? intent.asset,
      allowedPayees: predicate.allowedPayees,
      validUntil: predicate.validUntil,
      note: "The agent will choose the exact amount within these limits when it pays.",
      predicateDescriptor: prepared.predicateDescriptor,
    };
  }

  const prepared = await prepareHumanPresentOverHttp(intent, { urls, config: options.config });
  const settlementDescriptor = prepared.settlementDescriptor;
  const payee = settlementDescriptor.payTo;

  return {
    kind: "cart",
    product,
    merchantName: merchantAgent.card.name,
    merchantAgentId: merchantAgent.agentId,
    price: settlementDescriptor.value,
    asset: settlementDescriptor.asset,
    payee,
    network: settlementDescriptor.network,
    settlementDescriptor,
  };
}

function domainFor(config: OrchestratorConfig) {
  return { name: "CLB-ACEL", version: "0.1", chainId: config.chainId } as const;
}

export async function prepareHumanPresentOverHttp(
  intent: Intent,
  input: {
    humanPrincipal?: Address;
    urls?: Partial<ServiceUrls>;
    config?: Partial<OrchestratorConfig>;
    nowMs?: number;
  } = {},
): Promise<PreparedHumanPresent> {
  const config = resolveConfig({ ...(input.config ?? {}), ...(input.nowMs ? { nowMs: input.nowMs } : {}) });
  const urls = resolveServiceUrls(input.urls);
  const baseTime = config.nowMs ?? Date.now();
  const { payerAgent, merchantAgent } = await fetchDefaultAgents(urls);
  const merchantAddress = (merchantAgent.card.authorizedPaymentKeys[0] ??
    privateKeyToAccount(config.merchantPrivateKey).address) as Address;
  const requirementsResponse = await fetchJson<{
    accepts: ReturnType<typeof buildPaymentRequirements>["accepts"];
    settlementDescriptor: SettlementDescriptorExact;
  }>(`${urls.merchant}/x402/payment-requirements?token=${encodeURIComponent(intent.token)}`);
  const settlementDescriptor = {
    ...requirementsResponse.settlementDescriptor,
    asset: intent.asset,
    value: intent.budget,
    payTo: merchantAddress,
    validBefore: new Date(baseTime + config.paymentTimeoutSeconds * 1000).toISOString(),
  };
  const identityRef = identityRefFor(payerAgent);
  const clb = {
    identityRef,
    settlementDescriptor,
    domain: domainFor(config),
  };
  const mandateDraft: MandateAuthorization = {
    mandateId: `mandate-cart-${intent.intentId}`,
    type: "CART",
    humanPrincipal: input.humanPrincipal ?? privateKeyToAccount(config.userPrivateKey).address,
    authorizedAgent: identityRef,
    constraints: {
      maxAmount: intent.budget,
      allowedAssets: [intent.asset],
      allowedPayees: [merchantAddress],
      validUntil: settlementDescriptor.validBefore,
    },
  };
  const expectedCommitment = computeCommitment({
    ...clb,
    mandateDigest: computeMandateDigest(mandateDraft as Mandate),
  });

  return {
    mode: "a",
    payerAgent,
    merchantAgent,
    settlementDescriptor,
    clbDomain: clb.domain,
    clb,
    mandateDraft,
    expectedCommitment,
  };
}

export async function prepareDelegatedOverHttp(
  intent: Intent,
  input: {
    humanPrincipal?: Address;
    urls?: Partial<ServiceUrls>;
    config?: Partial<OrchestratorConfig>;
    nowMs?: number;
  } = {},
): Promise<PreparedDelegated> {
  const config = resolveConfig({ ...(input.config ?? {}), ...(input.nowMs ? { nowMs: input.nowMs } : {}) });
  const urls = resolveServiceUrls(input.urls);
  const baseTime = config.nowMs ?? Date.now();
  const { payerAgent, merchantAgent } = await fetchDefaultAgents(urls);
  const merchantAddress = (merchantAgent.card.authorizedPaymentKeys[0] ??
    privateKeyToAccount(config.merchantPrivateKey).address) as Address;
  const identityRef = identityRefFor(payerAgent);
  const predicate: SpendingPredicate = {
    allowedAssets: [intent.asset],
    allowedPayees: [merchantAddress],
    maxValue: intent.budget,
    validUntil: new Date(baseTime + 24 * 60 * 60 * 1000).toISOString(),
    allowedChainIds: [config.chainId],
    allowedAgentIds: [payerAgent.agentId],
  };
  const predicateDescriptor: PredicateDescriptor = {
    predicateId: `predicate-${intent.intentId}`,
    predicate,
    x402Scheme: "predicate",
  };
  const mandateDraft: MandateAuthorization = {
    mandateId: `mandate-intent-${intent.intentId}`,
    type: "INTENT",
    humanPrincipal: input.humanPrincipal ?? privateKeyToAccount(config.userPrivateKey).address,
    authorizedAgent: identityRef,
    constraints: {
      maxAmount: predicate.maxValue,
      allowedAssets: predicate.allowedAssets,
      allowedPayees: predicate.allowedPayees,
      validUntil: predicate.validUntil,
      predicateRef: { predicateId: predicateDescriptor.predicateId },
    },
  };

  return {
    mode: "b",
    payerAgent,
    merchantAgent,
    predicateDescriptor,
    mandateDraft,
    mandateDigest: computeMandateDigest(mandateDraft as Mandate),
  };
}

/**
 * Execute Mode A by calling live HTTP services instead of in-process adapters.
 * Evidence events are persisted through evidence-service; verification uses verifier-service.
 */
export async function runHumanPresentOverHttp(
  intent: Intent,
  options: {
    urls?: Partial<ServiceUrls>;
    config?: Partial<OrchestratorConfig>;
    fetchImpl?: typeof fetch;
    mandateId?: string;
  } = {},
): Promise<TraceResult & { transport: "http" }> {
  const config = resolveConfig(options.config ?? {});
  const urls = resolveServiceUrls(options.urls);
  const fetchImpl = options.fetchImpl ?? fetch;
  const traceId = `trace-${intent.intentId}`;
  const baseTime = config.nowMs ?? Date.now();

  const { payerAgent, merchantAgent } = await fetchDefaultAgents(urls);

  const shopperAddress = privateKeyToAccount(config.shopperPrivateKey).address;
  const merchantAddress = (merchantAgent.card.authorizedPaymentKeys[0] ??
    privateKeyToAccount(config.merchantPrivateKey).address) as Address;

  const requirementsResponse = await fetchJson<{
    accepts: ReturnType<typeof buildPaymentRequirements>["accepts"];
    settlementDescriptor: SettlementDescriptorExact;
  }>(`${urls.merchant}/x402/payment-requirements?token=${encodeURIComponent(intent.token)}`);

  const fetchedMandate = options.mandateId
    ? await fetchJson<Mandate>(`${urls.mandate}/mandates/${encodeURIComponent(options.mandateId)}`)
    : null;

  const settlementDescriptor: SettlementDescriptorExact = {
    ...requirementsResponse.settlementDescriptor,
    asset: fetchedMandate?.constraints.allowedAssets?.[0] ?? intent.asset,
    value: fetchedMandate?.constraints.maxAmount ?? intent.budget,
    payTo: (fetchedMandate?.constraints.allowedPayees?.[0] ?? merchantAddress) as Address,
    validBefore:
      fetchedMandate?.constraints.validUntil ??
      new Date(baseTime + config.paymentTimeoutSeconds * 1000).toISOString(),
  };

  const paymentRequirements = buildPaymentRequirements({
    descriptor: settlementDescriptor,
    resource: `${urls.merchant}/risk-report?token=${intent.token}`,
    description: `Token-risk report for ${intent.token}`,
  });

  const identityRef = identityRefFor(payerAgent);
  const clb = {
    identityRef,
    settlementDescriptor,
    domain: { name: "CLB-ACEL", version: "0.1", chainId: config.chainId } as const,
  };

  const mandate =
    fetchedMandate ??
    (await fetchJson<Mandate>(`${urls.mandate}/mandates/cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authorizedAgent: identityRef,
        constraints: {
          maxAmount: intent.budget,
          allowedAssets: [intent.asset],
          allowedPayees: [merchantAddress],
          validUntil: settlementDescriptor.validBefore,
        },
        settlementDescriptor,
        domain: clb.domain,
      }),
    }));

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

  const settledReceipt = await fetchJson<SettlementReceipt>(`${urls.merchant}/x402/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(paymentPayload),
  });
  const usePinnedClock = config.nowMs !== undefined;
  const settlement = usePinnedClock
    ? { ...settledReceipt, settledAt: new Date(baseTime + 5000).toISOString() }
    : settledReceipt;

  const delivery = usePinnedClock
    ? await fetchJson<{ report: TokenRiskReport; settlementTxHash: Hex }>(`${urls.merchant}/risk-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: intent.token,
          nonce,
          generatedAt: new Date(baseTime + 6000).toISOString(),
        }),
      })
    : await fetchJson<{ report: TokenRiskReport; settlementTxHash: Hex }>(
        `${urls.merchant}/risk-report?token=${encodeURIComponent(intent.token)}&nonce=${nonce}`,
      );
  const report = delivery.report;

  const events = linkEvidenceEvents([
    evidenceEvent(traceId, 1, "USER", "USER_INTENT", "user:browser-wallet", intent, baseTime),
    evidenceEvent(traceId, 2, "ERC8004", "ERC8004_AGENT_IDENTITY", "identity-service", payerAgent.card, baseTime),
    evidenceEvent(traceId, 3, "AP2", "AP2_CART_MANDATE", "mandate-service", mandate, baseTime),
    evidenceEvent(traceId, 4, "X402", "X402_PAYMENT_REQUIREMENT", "merchant-agent", paymentRequirements, baseTime),
    evidenceEvent(traceId, 5, "X402", "X402_PAYMENT_PAYLOAD", "shopping-agent", paymentPayload, baseTime),
    evidenceEvent(traceId, 6, "CHAIN", "CHAIN_SETTLEMENT", "facilitator", settlement, baseTime),
    evidenceEvent(traceId, 7, "DELIVERY", "DELIVERY_PROOF", "merchant-agent", report, baseTime),
  ]);

  for (const event of events) {
    await fetchJson(`${urls.evidence}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  }

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

  const verificationResponse = await fetchJson<VerifyTraceOutput>(`${urls.verifier}/verify/${traceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });

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
    verification: {
      ...verification,
      certificate: verificationResponse.certificate ?? verification.certificate,
      result: verificationResponse.result ?? verification.result,
      outcomes: verificationResponse.outcomes ?? verification.outcomes,
    },
    transport: "http",
  };
}

/**
 * Execute Mode B by calling live HTTP services. The predicate mandate may be
 * pre-registered from a browser wallet; otherwise the mandate service issues a
 * deterministic INTENT mandate with its configured test key.
 */
export async function runDelegatedOverHttp(
  intent: Intent,
  options: {
    urls?: Partial<ServiceUrls>;
    config?: Partial<OrchestratorConfig>;
    mandateId?: string;
  } = {},
): Promise<ModeBTraceResult & { transport: "http" }> {
  const config = resolveConfig(options.config ?? {});
  const urls = resolveServiceUrls(options.urls);
  const traceId = `trace-delegated-${intent.intentId}`;
  const baseTime = config.nowMs ?? Date.now();
  const { payerAgent, merchantAgent } = await fetchDefaultAgents(urls);
  const shopperAddress = privateKeyToAccount(config.shopperPrivateKey).address;
  const merchantAddress = (merchantAgent.card.authorizedPaymentKeys[0] ??
    privateKeyToAccount(config.merchantPrivateKey).address) as Address;
  const identityRef = identityRefFor(payerAgent);
  const domain = domainFor(config);

  const prepared = await prepareDelegatedOverHttp(intent, {
    urls,
    config,
    humanPrincipal: privateKeyToAccount(config.userPrivateKey).address,
  });
  const predicateDescriptor = prepared.predicateDescriptor;
  const predicate = predicateDescriptor.predicate;
  const mandate =
    options.mandateId !== undefined
      ? await fetchJson<Mandate>(`${urls.mandate}/mandates/${encodeURIComponent(options.mandateId)}`)
      : await fetchJson<Mandate>(`${urls.mandate}/mandates/intent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mandateId: prepared.mandateDraft.mandateId,
            authorizedAgent: identityRef,
            constraints: {},
            humanPrincipal: prepared.mandateDraft.humanPrincipal,
            predicate: predicateDescriptor,
          }),
        });

  const validBefore = new Date(baseTime + config.paymentTimeoutSeconds * 1000).toISOString();
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
  const modeBInput = {
    identityRef,
    mandateDigest: computeMandateDigest(mandate),
    predicateId: predicateDescriptor.predicateId,
    settlementParams,
    domain,
  };
  const modeBCommitment = computeModeBSettlementCommitment(modeBInput);
  const nonce = deriveSettlementNonce(modeBCommitment);

  const paymentRequirements: PaymentRequirementsResponse = buildPredicatePaymentRequirements({
    predicate,
    predicateId: predicateDescriptor.predicateId,
    resource: `${urls.merchant}/risk-report?token=${intent.token}`,
    concreteSettlement,
    description: `Token-risk report for ${intent.token} (predicate-authorized)`,
  });
  const paymentPayload = await signPaymentPayload(
    config.shopperPrivateKey,
    buildPaymentAuthorization({ from: shopperAddress, descriptor: concreteSettlement, nonce }),
    "predicate",
  );

  const guard = createPredicateGuard();
  const guardResult: GuardResult = await guard.assertSettlementAllowed({
    predicate,
    params: settlementParams,
    commitment: modeBInput,
    expectedNonce: nonce,
    now: new Date(baseTime),
  });

  const settledReceipt = await fetchJson<SettlementReceipt>(`${urls.merchant}/x402/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(paymentPayload),
  });
  const usePinnedClock = config.nowMs !== undefined;
  const settlement = usePinnedClock
    ? { ...settledReceipt, settledAt: new Date(baseTime + 5000).toISOString() }
    : settledReceipt;

  const delivery = usePinnedClock
    ? await fetchJson<{ report: TokenRiskReport; settlementTxHash: Hex }>(`${urls.merchant}/risk-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: intent.token,
          nonce,
          generatedAt: new Date(baseTime + 6000).toISOString(),
        }),
      })
    : await fetchJson<{ report: TokenRiskReport; settlementTxHash: Hex }>(
        `${urls.merchant}/risk-report?token=${encodeURIComponent(intent.token)}&nonce=${nonce}`,
      );
  const report = delivery.report;

  const events = linkEvidenceEvents([
    evidenceEvent(traceId, 1, "USER", "USER_INTENT", "user:browser-wallet", intent, baseTime),
    evidenceEvent(traceId, 2, "ERC8004", "ERC8004_AGENT_IDENTITY", "identity-service", payerAgent.card, baseTime),
    evidenceEvent(traceId, 3, "AP2", "AP2_INTENT_MANDATE", "mandate-service", { mandate, predicate: predicateDescriptor }, baseTime),
    evidenceEvent(traceId, 4, "X402", "X402_PAYMENT_REQUIREMENT", "merchant-agent", paymentRequirements, baseTime),
    evidenceEvent(traceId, 5, "X402", "X402_PAYMENT_PAYLOAD", "shopping-agent", paymentPayload, baseTime),
    evidenceEvent(traceId, 6, "CHAIN", "CHAIN_SETTLEMENT", "facilitator", settlement, baseTime),
    evidenceEvent(traceId, 7, "DELIVERY", "DELIVERY_PROOF", "merchant-agent", report, baseTime),
  ]);

  for (const event of events) {
    await fetchJson(`${urls.evidence}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  }

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

  const verificationResponse = await fetchJson<VerifyTraceOutput>(`${urls.verifier}/verify/${traceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
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
    verification: {
      ...verification,
      certificate: verificationResponse.certificate ?? verification.certificate,
      result: verificationResponse.result ?? verification.result,
      outcomes: verificationResponse.outcomes ?? verification.outcomes,
    },
    transport: "http",
  };
}

export { createIntent };
