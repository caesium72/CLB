import { issueMandate } from "@clb-acel/ap2-adapter";
import { computeCommitment, computeMandateDigest, deriveNonce } from "@clb-acel/clb-core";
import { signDeliveryBinding, signReport } from "@clb-acel/delivery-core";
import { buildMerkleRoot, hashEvidenceEvent, linkEvidenceEvents } from "@clb-acel/evidence-core";
import type {
  DeliveryReport,
  EvidenceEvent,
  IdentityRef,
  MandateConstraints,
  SettlementDescriptorExact,
  TokenRiskReport,
} from "@clb-acel/schemas";
import {
  NonceAlreadyConsumedError,
  buildPaymentAuthorization,
  createLocalFacilitator,
  signPaymentPayload,
} from "@clb-acel/x402-adapter";
import type { TraceBundle, VerifierAgentView } from "@clb-acel/verifier-core";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recomputeEvidenceIntegrity } from "./trace-utils";

export const TEST_KEYS = {
  userKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
  shopperKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex,
  merchantKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex,
};

export const shopperAddress = privateKeyToAccount(TEST_KEYS.shopperKey).address;
export const merchantAddress = privateKeyToAccount(TEST_KEYS.merchantKey).address;
export const attackerAddress = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
export const registryAddr = "0x0000000000000000000000000000000000008004" as Address;
export const domain = { name: "CLB-ACEL", version: "0.1", chainId: 84532 } as const;
export const payerIdentity: IdentityRef = {
  chainId: 84532,
  registryAddr,
  agentId: "shopping-agent-001",
};

const sig = `0x${"1".repeat(130)}` as Hex;

export const payerAgent: VerifierAgentView = {
  agentId: "shopping-agent-001",
  registryAddr,
  chainId: 84532,
  status: "ACTIVE",
  authorizedPaymentKeys: [shopperAddress],
  authorizedSigningKeys: [shopperAddress],
};

export const merchantAgent: VerifierAgentView = {
  agentId: "analysis-agent-001",
  registryAddr,
  chainId: 84532,
  status: "ACTIVE",
  authorizedPaymentKeys: [merchantAddress],
  authorizedSigningKeys: [merchantAddress],
};

export function descriptor(
  overrides: Partial<SettlementDescriptorExact> = {},
): SettlementDescriptorExact {
  return {
    chainId: 84532,
    network: "base-sepolia",
    asset: "USDC",
    payTo: merchantAddress,
    value: "2.00",
    validBefore: "2026-12-30T06:00:00.000Z",
    x402Scheme: "exact",
    ...overrides,
  };
}

export function constraints(overrides: Partial<MandateConstraints> = {}): MandateConstraints {
  return {
    maxAmount: "2.00",
    allowedAssets: ["USDC"],
    allowedPayees: [merchantAddress],
    validUntil: "2026-12-30T06:00:00.000Z",
    ...overrides,
  };
}

export function evidenceEvents(traceId: string, settledAt: string): EvidenceEvent[] {
  const types: Array<[EvidenceEvent["protocol"], string]> = [
    ["USER", "USER_INTENT"],
    ["ERC8004", "ERC8004_AGENT_IDENTITY"],
    ["AP2", "AP2_CART_MANDATE"],
    ["X402", "X402_PAYMENT_REQUIREMENT"],
    ["X402", "X402_PAYMENT_PAYLOAD"],
    ["CHAIN", "CHAIN_SETTLEMENT"],
    ["DELIVERY", "DELIVERY_PROOF"],
  ];

  return linkEvidenceEvents(
    types.map(([protocol, objectType], index) => ({
      traceId,
      eventId: `evt-${index + 1}`,
      protocol,
      objectType,
      actor: "orchestrator",
      timestamp: new Date(Date.parse(settledAt) - (types.length - index) * 1000).toISOString(),
      objectHash: `0x${index.toString(16).padStart(64, "0")}`,
      publicFields: { objectType },
      signature: sig,
    })),
  );
}

export type BuildValidBundleOptions = {
  traceId?: string;
  settlementDescriptor?: SettlementDescriptorExact;
  mandateConstraints?: MandateConstraints;
  reportInputDataHash?: Hex;
  token?: string;
  reportGeneratedAt?: (settledAt: string) => string;
};

export async function buildValidBundle(options: BuildValidBundleOptions = {}): Promise<TraceBundle> {
  const traceId = options.traceId ?? "trace-attack-001";
  const settlementDescriptor = options.settlementDescriptor ?? descriptor();
  const mandateConstraints = options.mandateConstraints ?? constraints();
  const clb = { identityRef: payerIdentity, settlementDescriptor, domain };

  const mandate = await issueMandate(TEST_KEYS.userKey, {
    type: "CART",
    authorizedAgent: payerIdentity,
    constraints: mandateConstraints,
    clb,
  });

  const commitment = computeCommitment({
    identityRef: payerIdentity,
    mandateDigest: computeMandateDigest(mandate),
    settlementDescriptor,
    domain,
  });
  const nonce = deriveNonce(commitment);

  const auth = buildPaymentAuthorization({ from: shopperAddress, descriptor: settlementDescriptor, nonce });
  const paymentPayload = await signPaymentPayload(TEST_KEYS.shopperKey, auth);

  const facilitator = createLocalFacilitator();
  const settlement = await facilitator.settle(paymentPayload);

  const signedReport = await signReport(TEST_KEYS.merchantKey, {
    token: options.token ?? "XYZ",
    chain: settlementDescriptor.network,
    riskScore: 0.42,
    signals: {
      liquidityRisk: 0.4,
      holderConcentrationRisk: 0.5,
      contractRisk: 0.3,
      marketVolatilityRisk: 0.45,
    },
    modelVersion: "heuristic-v1",
    inputDataHash: options.reportInputDataHash ?? `0x${"a".repeat(64)}`,
    generatedAt:
      options.reportGeneratedAt?.(settlement.settledAt) ??
      new Date(Date.parse(settlement.settledAt) + 1000).toISOString(),
  });
  const deliveryBinding = await signDeliveryBinding({
    settlementTxHash: settlement.txHash,
    reportHash: signedReport.reportHash,
    merchantKey: TEST_KEYS.merchantKey,
  });
  const report: TokenRiskReport = { ...signedReport, deliveryBinding };

  const events = evidenceEvents(traceId, settlement.settledAt);
  const eventHashes = events.map(hashEvidenceEvent);

  return {
    traceId,
    mode: "MODE_A_EXACT",
    events,
    eventHashes,
    merkleRoot: buildMerkleRoot(eventHashes),
    payerAgent,
    merchantAgent,
    mandate,
    clb,
    paymentPayload,
    settlement,
    report,
  };
}

export function appendEvidenceEvent(bundle: TraceBundle, event: Omit<EvidenceEvent, "previousEventHash">): TraceBundle {
  return recomputeEvidenceIntegrity({ ...bundle, events: [...bundle.events, event] });
}

export function breakReportHash(bundle: TraceBundle): TraceBundle {
  const report: DeliveryReport = { ...bundle.report, reportHash: `0x${"f".repeat(64)}` };
  return { ...bundle, report };
}

export async function markReplayAttempt(bundle: TraceBundle): Promise<{
  bundle: TraceBundle;
  prevented: boolean;
  errorName?: string;
  settlementLatencyMs: number;
}> {
  const facilitator = createLocalFacilitator();
  const firstStart = performance.now();
  await facilitator.settle(bundle.paymentPayload);
  try {
    await facilitator.settle(bundle.paymentPayload);
    return { bundle: { ...bundle, nonceReplayAttempt: true }, prevented: false, settlementLatencyMs: performance.now() - firstStart };
  } catch (error) {
    return {
      bundle: { ...bundle, nonceReplayAttempt: true },
      prevented: error instanceof NonceAlreadyConsumedError,
      errorName: error instanceof Error ? error.name : "UnknownError",
      settlementLatencyMs: performance.now() - firstStart,
    };
  }
}
