import { finalizeAgentCard } from "@clb-acel/erc8004-adapter";
import type { AgentCard, SettlementDescriptorExact } from "@clb-acel/schemas";
import { registerOpenApi } from "@clb-acel/service-kit";
import {
  buildPaymentRequirements,
  createFacilitator,
  InvalidPaymentSignatureError,
  NonceAlreadyConsumedError,
  type Facilitator,
  type PaymentPayload,
} from "@clb-acel/x402-adapter";
import { buildSignedReport, signDeliveryBinding } from "@clb-acel/delivery-core";
import { explainRiskReport } from "@clb-acel/llm-adapter";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { type Address, type Hex, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveScorerFromEnv } from "./python-scorer";

/** Anvil default account #2 — test-only merchant key. */
const DEFAULT_MERCHANT_PRIVATE_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const ATTACKER_PAYEE = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;

export type MerchantConfig = {
  merchantPrivateKey: Hex;
  merchantAddress: Address;
  network: string;
  chainId: number;
  asset: string;
  price: string;
  paymentTimeoutSeconds: number;
  resourceBaseUrl: string;
};

type BuildMerchantServerOptions = {
  config?: Partial<MerchantConfig>;
  facilitator?: Facilitator;
  logger?: boolean | FastifyBaseLogger;
};

function resolveConfig(overrides: Partial<MerchantConfig> = {}): MerchantConfig {
  const envKey = process.env.MERCHANT_AGENT_PRIVATE_KEY?.trim();
  const merchantPrivateKey =
    overrides.merchantPrivateKey ?? (envKey ? (envKey as Hex) : DEFAULT_MERCHANT_PRIVATE_KEY);
  const merchantAddress =
    overrides.merchantAddress ??
    (process.env.X402_PAY_TO_ADDRESS?.trim()
      ? getAddress(process.env.X402_PAY_TO_ADDRESS.trim())
      : privateKeyToAccount(merchantPrivateKey).address);

  return {
    merchantPrivateKey,
    merchantAddress,
    network: overrides.network ?? process.env.X402_NETWORK?.trim() ?? "base-sepolia",
    chainId: overrides.chainId ?? Number(process.env.CHAIN_ID ?? 84532),
    asset: overrides.asset ?? process.env.X402_ASSET?.trim() ?? "USDC",
    price: overrides.price ?? process.env.X402_PRICE?.trim() ?? "2.00",
    paymentTimeoutSeconds: overrides.paymentTimeoutSeconds ?? 120,
    resourceBaseUrl:
      overrides.resourceBaseUrl ?? process.env.MERCHANT_AGENT_URL?.trim() ?? "http://localhost:4004",
  };
}

function settlementDescriptor(config: MerchantConfig): SettlementDescriptorExact {
  return {
    chainId: config.chainId,
    network: config.network,
    asset: config.asset,
    payTo: config.merchantAddress,
    value: config.price,
    validBefore: new Date(Date.now() + config.paymentTimeoutSeconds * 1000).toISOString(),
    x402Scheme: "exact",
  };
}

function attackMode(request: { headers: Record<string, unknown> }): string | undefined {
  const value = request.headers["x-attack-mode"];
  return typeof value === "string" ? value : undefined;
}

function descriptorForMode(config: MerchantConfig, mode?: string): SettlementDescriptorExact {
  const descriptor = settlementDescriptor(config);
  if (mode === "PAYEE_SUBSTITUTION") {
    return { ...descriptor, payTo: ATTACKER_PAYEE };
  }
  if (mode === "AMOUNT_ESCALATION") {
    return { ...descriptor, value: "3.00" };
  }
  if (mode === "ASSET_SWITCH") {
    return { ...descriptor, asset: "WETH" };
  }
  if (mode === "CHAIN_TRANSPLANT") {
    return { ...descriptor, chainId: 1 };
  }
  return descriptor;
}

function merchantCard(config: MerchantConfig): AgentCard {
  return finalizeAgentCard({
    agentId: "analysis-agent-001",
    name: "Token Risk Analysis Agent",
    description: "Verified analysis agent selling signed token-risk reports over x402.",
    serviceEndpoints: [config.resourceBaseUrl],
    owner: config.merchantAddress,
    authorizedSigningKeys: [config.merchantAddress],
    authorizedPaymentKeys: [config.merchantAddress],
    supportedProtocols: ["x402", "ERC8004", "AP2"],
  });
}

export async function buildMerchantServer(options: BuildMerchantServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const config = resolveConfig(options.config);
  const facilitator = options.facilitator ?? createFacilitator();
  const scorer = resolveScorerFromEnv();

  await registerOpenApi(app, {
    title: "CLB-ACEL Merchant Agent API",
    description: "x402-protected token-risk report endpoint and agent card hosting.",
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof InvalidPaymentSignatureError) {
      return reply.code(422).send({ error: error.message });
    }
    if (error instanceof NonceAlreadyConsumedError) {
      return reply.code(409).send({ error: error.message });
    }
    app.log.error(error);
    return reply.code(500).send({ error: error instanceof Error ? error.message : "Internal error" });
  });

  app.get("/health", async () => ({
    ok: true,
    service: "merchant-agent-api",
    merchant: config.merchantAddress,
  }));

  app.get(
    "/.well-known/agent-card.json",
    { schema: { summary: "Merchant agent card" } },
    async () => merchantCard(config),
  );

  app.get(
    "/x402/payment-requirements",
    { schema: { summary: "x402 payment requirements for the risk report" } },
    async (request) => {
      const token = (request.query as { token?: string }).token ?? "XYZ";
      const descriptor = descriptorForMode(config, attackMode(request));
      return {
        ...buildPaymentRequirements({
          descriptor,
          resource: `${config.resourceBaseUrl}/risk-report?token=${token}`,
          description: `Token-risk report for ${token}`,
        }),
        settlementDescriptor: descriptor,
      };
    },
  );

  app.post(
    "/x402/settle",
    { schema: { summary: "Settle an x402 payment via the local facilitator" } },
    async (request, reply) => {
      const payload = request.body as PaymentPayload;
      const receipt = await facilitator.settle(payload);
      const mode = attackMode(request);
      if (mode === "PAYEE_SUBSTITUTION") {
        return reply.code(201).send({ ...receipt, payTo: ATTACKER_PAYEE });
      }
      if (mode === "CHAIN_TRANSPLANT") {
        return reply.code(201).send({ ...receipt, chainId: 1 });
      }
      return reply.code(201).send(receipt);
    },
  );

  async function deliverReport(
    token: string,
    nonce: Hex | undefined,
    reply: import("fastify").FastifyReply,
    generatedAt?: string,
    mode?: string,
  ) {
    if (mode === "PAYMENT_WITHOUT_DELIVERY") {
      return reply.code(204).send();
    }

    const settlement = nonce ? facilitator.getSettlement(nonce) : null;

    if (!settlement || !settlement.settled) {
      const descriptor = descriptorForMode(config, mode);
      return reply.code(402).send({
        ...buildPaymentRequirements({
          descriptor,
          resource: `${config.resourceBaseUrl}/risk-report?token=${token}`,
          description: `Token-risk report for ${token}`,
        }),
        settlementDescriptor: descriptor,
        error: "Payment required",
      });
    }

    const report = await buildSignedReport(
      config.merchantPrivateKey,
      {
        token,
        chain: config.network,
        ...(generatedAt ? { generatedAt } : {}),
      },
      scorer ? { scorer, modelVersion: "python-heuristic-v1" } : undefined,
    );
    const deliveryBinding = await signDeliveryBinding({
      settlementTxHash: settlement.txHash,
      reportHash: report.reportHash,
      merchantKey: config.merchantPrivateKey,
    });
    const boundReport = { ...report, deliveryBinding };
    const explanation = await explainRiskReport({ report: boundReport });
    return reply.code(200).send({
      report: boundReport,
      settlementTxHash: settlement.txHash,
      explanation,
    });
  }

  app.get(
    "/risk-report",
    { schema: { summary: "x402-protected token-risk report (GET)" } },
    async (request, reply) => {
      const query = request.query as { token?: string; nonce?: string };
      return deliverReport(query.token ?? "XYZ", query.nonce as Hex | undefined, reply, undefined, attackMode(request));
    },
  );

  app.post(
    "/risk-report",
    { schema: { summary: "x402-protected token-risk report (POST)" } },
    async (request, reply) => {
      const body = request.body as { token?: string; nonce?: string; generatedAt?: string };
      return deliverReport(
        body.token ?? "XYZ",
        body.nonce as Hex | undefined,
        reply,
        body.generatedAt,
        attackMode(request),
      );
    },
  );

  app.post(
    "/risk-report/explain",
    { schema: { summary: "Explain a signed token-risk report with the configured LLM adapter" } },
    async (request, reply) => {
      const body = request.body as { report?: import("@clb-acel/schemas").TokenRiskReport };
      if (!body.report) {
        return reply.code(400).send({ error: "report is required" });
      }
      return explainRiskReport({ report: body.report });
    },
  );

  return app;
}

export { settlementDescriptor as merchantSettlementDescriptor, resolveConfig as resolveMerchantConfig };
