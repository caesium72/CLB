import { describe, expect, test } from "bun:test";
import { issueMandate } from "@clb-acel/ap2-adapter";
import { computeCommitment, computeMandateDigest, deriveNonce } from "@clb-acel/clb-core";
import { signDeliveryBinding, signReport } from "@clb-acel/delivery-core";
import { buildMerkleRoot, hashEvidenceEvent, linkEvidenceEvents } from "@clb-acel/evidence-core";
import type { EvidenceEvent, SettlementDescriptorExact } from "@clb-acel/schemas";
import {
  buildPaymentAuthorization,
  createLocalFacilitator,
  signPaymentPayload,
} from "@clb-acel/x402-adapter";
import type { TraceBundle } from "@clb-acel/verifier-core";
import { privateKeyToAccount } from "viem/accounts";
import { buildVerifierServer } from "../src/server";

const userKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const shopperKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const merchantKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const shopperAddress = privateKeyToAccount(shopperKey).address;
const merchantAddress = privateKeyToAccount(merchantKey).address;
const registryAddr = "0x0000000000000000000000000000000000008004" as const;
const domain = { name: "CLB-ACEL", version: "0.1", chainId: 84532 } as const;
const payerIdentity = { chainId: 84532, registryAddr, agentId: "shopping-agent-001" };

async function validBundle(traceId: string): Promise<TraceBundle> {
  const settlementDescriptor: SettlementDescriptorExact = {
    chainId: 84532,
    network: "base-sepolia",
    asset: "USDC",
    payTo: merchantAddress,
    value: "2.00",
    validBefore: "2026-12-30T06:00:00.000Z",
    x402Scheme: "exact",
  };
  const constraints = {
    maxAmount: "2.00",
    allowedAssets: ["USDC"],
    allowedPayees: [merchantAddress],
    validUntil: "2026-12-30T06:00:00.000Z",
  };
  const clb = { identityRef: payerIdentity, settlementDescriptor, domain };
  const mandate = await issueMandate(userKey, {
    type: "CART",
    authorizedAgent: payerIdentity,
    constraints,
    clb,
  });
  const nonce = deriveNonce(
    computeCommitment({
      identityRef: payerIdentity,
      mandateDigest: computeMandateDigest(mandate),
      settlementDescriptor,
      domain,
    }),
  );
  const paymentPayload = await signPaymentPayload(
    shopperKey,
    buildPaymentAuthorization({ from: shopperAddress, descriptor: settlementDescriptor, nonce }),
  );
  const settlement = await createLocalFacilitator().settle(paymentPayload);
  const signedReport = await signReport(merchantKey, {
    token: "XYZ",
    chain: "base-sepolia",
    riskScore: 0.42,
    signals: {
      liquidityRisk: 0.4,
      holderConcentrationRisk: 0.5,
      contractRisk: 0.3,
      marketVolatilityRisk: 0.45,
    },
    modelVersion: "heuristic-v1",
    inputDataHash: `0x${"a".repeat(64)}`,
    generatedAt: new Date(Date.parse(settlement.settledAt) + 1000).toISOString(),
  });
  // R14b binds delivery to this settlement; the report must carry a deliveryBinding signature.
  const deliveryBinding = await signDeliveryBinding({
    settlementTxHash: settlement.txHash,
    reportHash: signedReport.reportHash,
    merchantKey,
  });
  const report = { ...signedReport, deliveryBinding };
  const events: EvidenceEvent[] = linkEvidenceEvents(
    ["USER_INTENT", "CHAIN_SETTLEMENT", "DELIVERY_PROOF"].map((objectType, index) => ({
      traceId,
      eventId: `evt-${index + 1}`,
      protocol: "USER",
      objectType,
      actor: "orchestrator",
      timestamp: new Date(Date.parse(settlement.settledAt) - (3 - index) * 1000).toISOString(),
      objectHash: `0x${index.toString(16).padStart(64, "0")}`,
      publicFields: {},
      signature: `0x${"1".repeat(130)}`,
    })),
  );
  const eventHashes = events.map(hashEvidenceEvent);
  return {
    traceId,
    mode: "MODE_A_EXACT",
    events,
    eventHashes,
    merkleRoot: buildMerkleRoot(eventHashes),
    payerAgent: {
      agentId: "shopping-agent-001",
      registryAddr,
      chainId: 84532,
      status: "ACTIVE",
      authorizedPaymentKeys: [shopperAddress],
      authorizedSigningKeys: [shopperAddress],
    },
    merchantAgent: {
      agentId: "analysis-agent-001",
      registryAddr,
      chainId: 84532,
      status: "ACTIVE",
      authorizedPaymentKeys: [merchantAddress],
      authorizedSigningKeys: [merchantAddress],
    },
    mandate,
    clb,
    paymentPayload,
    settlement,
    report,
  };
}

describe("verifier-service", () => {
  test("verifies a trace and serves result + certificate", async () => {
    const app = await buildVerifierServer({ logger: false });
    const bundle = await validBundle("trace-svc-1");

    const verify = await app.inject({ method: "POST", url: "/verify/trace-svc-1", payload: bundle });
    expect(verify.statusCode).toBe(200);
    expect(verify.json<{ result: { status: string } }>().result.status).toBe("PASS");

    const result = await app.inject({ method: "GET", url: "/verify/trace-svc-1/result" });
    expect(result.json<{ result: { status: string } }>().result.status).toBe("PASS");

    const certificate = await app.inject({ method: "GET", url: "/verify/trace-svc-1/certificate" });
    expect(certificate.json<{ certificateHash: string }>().certificateHash).toMatch(/^0x[0-9a-f]{64}$/);

    await app.close();
  });

  test("returns 404 before a trace is verified", async () => {
    const app = await buildVerifierServer({ logger: false });
    const result = await app.inject({ method: "GET", url: "/verify/unknown/result" });
    expect(result.statusCode).toBe(404);
    await app.close();
  });
});
