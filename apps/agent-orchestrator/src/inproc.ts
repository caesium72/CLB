/**
 * In-process orchestration entrypoints for serverless / Next.js route handlers.
 *
 * Unlike `./http-flow`, nothing here calls another service over HTTP — every step
 * reads the ERC-8004 registry and computes quotes/predicates directly through the
 * adapter packages. This is what makes the demo deployable as a single Vercel app
 * (no 6 Fastify processes at runtime). The Fastify `./server` path is retained for
 * local dev, CI, and the e2e scripts.
 *
 * Phase 1 swaps the seeded registry for the canonical ERC-8004 reader; Phase 2
 * replaces the deterministic selection here with LLM-driven selection.
 */
import { computeCommitment, computeMandateDigest } from "@clb-acel/clb-core";
import type { MandateAuthorization } from "@clb-acel/ap2-adapter";
import {
  createInMemoryErc8004Registry,
  identityRefFor,
  type AgentRecord,
  type Erc8004Registry,
} from "@clb-acel/erc8004-adapter";
import {
  DEFAULT_GRAMMAR_AGENT_ID,
  DEFAULT_SHOPPING_AGENT_ID,
  DEFAULT_WEATHER_AGENT_ID,
  defaultAgents,
} from "@clb-acel/identity-service/seed";
import { selectAgentForTask } from "@clb-acel/llm-adapter";
import type {
  Mandate,
  PredicateDescriptor,
  SettlementDescriptorExact,
  SpendingPredicate,
} from "@clb-acel/schemas";
import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveConfig, resolvePredicateValidUntil, type Intent, type OrchestratorConfig } from "./flow";
import type {
  CartQuoteResult,
  DelegationQuoteResult,
  DiscoveryCandidate,
  DiscoveryResult,
  PreparedDelegated,
  PreparedHumanPresent,
  QuoteResult,
} from "./http-flow";

export { createIntent, runHumanPresent, runDelegated } from "./flow";
export type {
  Intent,
  TraceResult,
  ModeBTraceResult,
  OrchestratorConfig,
} from "./flow";
export type { DiscoveryResult, QuoteResult } from "./http-flow";
export type { VerifyTraceOutput } from "@clb-acel/verifier-core";
export { assessFeedback } from "./feedback";
export type { FeedbackAssessment, FeedbackFactor } from "./feedback";

/** Build a fresh in-memory ERC-8004 registry seeded with the demo agents. */
export async function seededRegistry(): Promise<Erc8004Registry> {
  const registry = createInMemoryErc8004Registry();
  for (const agent of defaultAgents()) {
    await registry.register(agent);
  }
  return registry;
}

function merchantAddressOf(agent: AgentRecord, config: OrchestratorConfig): Address {
  return (agent.card.authorizedPaymentKeys[0] ??
    privateKeyToAccount(config.merchantPrivateKey).address) as Address;
}

/** Capability routing + merchant delivery live in ./merchant (single source). */
export {
  agentAddress,
  deliverServiceReport,
  merchantIdForKind,
  serviceKindForIntent,
  servicePaymentFraming,
  weatherForecast,
  type ServiceKind,
} from "./merchant";
import { merchantIdForKind, serviceKindForIntent } from "./merchant";

/**
 * Discover merchant agents for an intent, fully in-process. The shopping agent's
 * LLM DECIDES which of the two real canonical agents (grammar 6827, weather 6823)
 * fits the task within the user's constraints, or reports that none do. The
 * decision is recorded as evidence but never trusted by the verifier.
 */
export async function discoverInProcess(
  intent: Intent,
  options: { registry?: Erc8004Registry; allowedAgentIds?: string[] } = {},
): Promise<DiscoveryResult> {
  const registry = options.registry ?? (await seededRegistry());
  const payerAgent = await registry.getAgent(DEFAULT_SHOPPING_AGENT_ID);
  const grammarAgent = await registry.getAgent(DEFAULT_GRAMMAR_AGENT_ID);
  const weatherAgent = await registry.getAgent(DEFAULT_WEATHER_AGENT_ID);
  if (!payerAgent || !grammarAgent || !weatherAgent) {
    throw new Error("Merchant agents are not registered");
  }
  const merchants = [grammarAgent, weatherAgent];

  const activity: DiscoveryResult["activity"] = [
    {
      id: "search",
      label: "Searching ERC-8004 identity registry…",
      detail: `Task: ${intent.task}`,
      delayMs: 0,
      tone: "info",
    },
    {
      id: "compare",
      label: `Comparing ${merchants.length} agents against your task and constraints…`,
      delayMs: 800,
      tone: "info",
    },
  ];

  const allowedAgentIds = options.allowedAgentIds ?? intent.allowedAgentIds;
  const selection = await selectAgentForTask({
    intent: {
      task: intent.task,
      asset: intent.asset,
      maxPrice: intent.budget,
      network: intent.network,
      ...(allowedAgentIds && allowedAgentIds.length ? { allowedAgentIds } : {}),
    },
    candidates: merchants.map((m) => ({
      agentId: m.agentId,
      name: m.card.name,
      description: m.card.description ?? "",
      supportedProtocols: m.card.supportedProtocols ?? [],
    })),
  });

  const verdictById = new Map(selection.perAgent.map((v) => [v.agentId, v]));
  const selectable = selection.selectedAgentId !== null;
  const selectedMerchant =
    merchants.find((m) => m.agentId === selection.selectedAgentId) ?? merchants[0]!;

  const candidates: DiscoveryCandidate[] = merchants.map((m) => {
    const selected = selectable && m.agentId === selectedMerchant.agentId;
    const verdict = verdictById.get(m.agentId);
    return {
      agentId: m.agentId,
      card: m.card,
      selected,
      rejectedReason: selected ? undefined : (verdict?.reason ?? "Not selected for this task"),
    };
  });

  for (const m of merchants) {
    const verdict = verdictById.get(m.agentId);
    if (verdict && !verdict.eligible) {
      activity.push({
        id: `reject-${m.agentId}`,
        label: `Skipped ${m.card.name}`,
        detail: verdict.reason,
        delayMs: 1400,
        tone: "reject",
      });
    }
  }
  activity.push(
    selectable
      ? {
          id: "select",
          label: `Selected ${selectedMerchant.card.name}`,
          detail: selectedMerchant.card.description ?? "",
          delayMs: 2200,
          tone: "success",
        }
      : {
          id: "none",
          label: "No eligible agent for your constraints",
          detail: selection.reasoning,
          delayMs: 2200,
          tone: "reject",
        },
  );

  return {
    payerAgent,
    selectedMerchant,
    selectedMerchantId: selectedMerchant.agentId,
    candidates,
    activity,
    rationale: selection.reasoning,
    llmProvider: selection.provider,
    selectable,
    perAgent: selection.perAgent,
  };
}

/** Cart (Mode A) or delegation (Mode B) quote, computed in-process. */
export async function quoteInProcess(
  intent: Intent,
  mode: "a" | "b",
  options: { registry?: Erc8004Registry; config?: Partial<OrchestratorConfig> } = {},
): Promise<QuoteResult> {
  const config = resolveConfig(options.config ?? {});
  const registry = options.registry ?? (await seededRegistry());
  const merchantAgent = await registry.getAgent(merchantIdForKind(serviceKindForIntent({ task: intent.task, token: intent.token })));
  const payerAgent = await registry.getAgent(DEFAULT_SHOPPING_AGENT_ID);
  if (!merchantAgent || !payerAgent) {
    throw new Error("Merchant agents are not registered");
  }
  const merchantAddress = merchantAddressOf(merchantAgent, config);
  const product = intent.task;
  const baseTime = config.nowMs ?? Date.now();

  if (mode === "b") {
    const predicate: SpendingPredicate = {
      allowedAssets: [intent.asset],
      allowedPayees: [merchantAddress],
      maxValue: intent.budget,
      validUntil: resolvePredicateValidUntil(intent, baseTime),
      allowedChainIds: [config.chainId],
      allowedAgentIds: [payerAgent.agentId],
    };
    const predicateDescriptor: PredicateDescriptor = {
      predicateId: `predicate-${intent.intentId}`,
      predicate,
      x402Scheme: "predicate",
    };
    const delegation: DelegationQuoteResult = {
      kind: "delegation",
      product,
      merchantName: merchantAgent.card.name,
      merchantAgentId: merchantAgent.agentId,
      maxValue: predicate.maxValue,
      asset: predicate.allowedAssets[0] ?? intent.asset,
      allowedPayees: predicate.allowedPayees,
      validUntil: predicate.validUntil,
      note: "The agent will choose the exact amount within these limits when it pays.",
      predicateDescriptor,
    };
    return delegation;
  }

  const settlementDescriptor: SettlementDescriptorExact = {
    chainId: config.chainId,
    network: intent.network,
    asset: intent.asset,
    payTo: merchantAddress,
    // Exact amount the merchant charges and settles on-chain = config.price (X402_PRICE).
    // The human's budget is the spending cap, surfaced separately as `maxAmount` below.
    value: config.price,
    validBefore: new Date(baseTime + config.paymentTimeoutSeconds * 1000).toISOString(),
    x402Scheme: "exact",
  };
  const cart: CartQuoteResult = {
    kind: "cart",
    product,
    merchantName: merchantAgent.card.name,
    merchantAgentId: merchantAgent.agentId,
    price: settlementDescriptor.value,
    maxAmount: intent.budget,
    asset: settlementDescriptor.asset,
    payee: settlementDescriptor.payTo,
    network: settlementDescriptor.network,
    settlementDescriptor,
  };
  return cart;
}

/**
 * Compute the wallet-signing payload (mandate draft + descriptor/predicate +
 * expected commitment) in-process, for the authorize step and the formula view.
 */
export async function prepareInProcess(
  intent: Intent,
  mode: "a" | "b",
  options: {
    registry?: Erc8004Registry;
    config?: Partial<OrchestratorConfig>;
    humanPrincipal?: Address;
  } = {},
): Promise<PreparedHumanPresent | PreparedDelegated> {
  const config = resolveConfig(options.config ?? {});
  const registry = options.registry ?? (await seededRegistry());
  const payerAgent = await registry.getAgent(DEFAULT_SHOPPING_AGENT_ID);
  const merchantAgent = await registry.getAgent(merchantIdForKind(serviceKindForIntent({ task: intent.task, token: intent.token })));
  if (!payerAgent || !merchantAgent) {
    throw new Error("Merchant agents are not registered");
  }
  const merchantAddress = merchantAddressOf(merchantAgent, config);
  const identityRef = identityRefFor(payerAgent);
  const domain = { name: "CLB-ACEL", version: "0.1", chainId: config.chainId } as const;
  const humanPrincipal =
    options.humanPrincipal ?? privateKeyToAccount(config.userPrivateKey).address;
  const baseTime = config.nowMs ?? Date.now();

  if (mode === "b") {
    const predicate: SpendingPredicate = {
      allowedAssets: [intent.asset],
      allowedPayees: [merchantAddress],
      maxValue: intent.budget,
      validUntil: resolvePredicateValidUntil(intent, baseTime),
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
      humanPrincipal,
      authorizedAgent: identityRef,
      constraints: {
        maxAmount: predicate.maxValue,
        allowedAssets: predicate.allowedAssets,
        allowedPayees: predicate.allowedPayees,
        validUntil: predicate.validUntil,
        predicateRef: { predicateId: predicateDescriptor.predicateId },
      },
    };
    const prepared: PreparedDelegated = {
      mode: "b",
      payerAgent,
      merchantAgent,
      predicateDescriptor,
      mandateDraft,
      mandateDigest: computeMandateDigest(mandateDraft as Mandate),
    };
    return prepared;
  }

  const settlementDescriptor: SettlementDescriptorExact = {
    chainId: config.chainId,
    network: intent.network,
    asset: intent.asset,
    payTo: merchantAddress,
    // Exact charge = config.price (X402_PRICE), matching the live run (runHumanPresent) so the
    // previewed commitment binds the same value that settles. Budget remains the mandate cap.
    value: config.price,
    validBefore: new Date(baseTime + config.paymentTimeoutSeconds * 1000).toISOString(),
    x402Scheme: "exact",
  };
  const clb = { identityRef, settlementDescriptor, domain };
  const mandateDraft: MandateAuthorization = {
    mandateId: `mandate-cart-${intent.intentId}`,
    type: "CART",
    humanPrincipal,
    authorizedAgent: identityRef,
    constraints: {
      maxAmount: intent.budget,
      allowedAssets: [intent.asset],
      allowedPayees: [merchantAddress],
      validUntil: settlementDescriptor.validBefore,
    },
  };
  const expectedCommitment: Hex = computeCommitment({
    ...clb,
    mandateDigest: computeMandateDigest(mandateDraft as Mandate),
  });
  const prepared: PreparedHumanPresent = {
    mode: "a",
    payerAgent,
    merchantAgent,
    settlementDescriptor,
    clbDomain: clb.domain,
    clb,
    mandateDraft,
    expectedCommitment,
  };
  return prepared;
}

export { identityRefFor };
export type { AgentRecord, Erc8004Registry, PreparedHumanPresent, PreparedDelegated };
