import { describe, expect, test } from "bun:test";
import type { SettlementDescriptorExact, TokenRiskReport } from "@clb-acel/schemas";
import {
  buildPaymentAuthorization,
  signPaymentPayload,
  type PaymentRequirementsResponse,
} from "@clb-acel/x402-adapter";
import { privateKeyToAccount } from "viem/accounts";
import { buildMerchantServer } from "../src/server";
import { verifyReportSignature } from "../src/report";

const merchantKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const merchantAddress = privateKeyToAccount(merchantKey).address;
const payerKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const payerAddress = privateKeyToAccount(payerKey).address;
const nonce = `0x${"a".repeat(64)}` as const;

async function server() {
  return buildMerchantServer({
    logger: false,
    config: { merchantPrivateKey: merchantKey, merchantAddress, network: "base-sepolia", chainId: 84532 },
  });
}

describe("merchant-agent-api", () => {
  test("returns 402 with payment requirements before payment", async () => {
    const app = await server();
    const response = await app.inject({ method: "GET", url: "/risk-report?token=XYZ" });

    expect(response.statusCode).toBe(402);
    expect(response.json<PaymentRequirementsResponse>().accepts[0]?.maxAmountRequired).toBe("2.00");

    await app.close();
  });

  test("delivers a signed report after settlement", async () => {
    const app = await server();

    const requirements = await app.inject({ method: "GET", url: "/x402/payment-requirements?token=XYZ" });
    const descriptor = requirements.json<{ settlementDescriptor: SettlementDescriptorExact }>()
      .settlementDescriptor;

    const auth = buildPaymentAuthorization({ from: payerAddress, descriptor, nonce });
    const payload = await signPaymentPayload(payerKey, auth);

    const settle = await app.inject({ method: "POST", url: "/x402/settle", payload });
    expect(settle.statusCode).toBe(201);

    const delivery = await app.inject({ method: "GET", url: `/risk-report?token=XYZ&nonce=${nonce}` });
    expect(delivery.statusCode).toBe(200);

    const report = delivery.json<{ report: TokenRiskReport }>().report;
    expect(report.token).toBe("XYZ");
    expect(report.reportHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await verifyReportSignature(report, merchantAddress)).toBe(true);

    await app.close();
  });

  test("scoring is deterministic for the same token", async () => {
    const app = await server();
    const descriptor = (
      await app.inject({ method: "GET", url: "/x402/payment-requirements?token=ABC" })
    ).json<{ settlementDescriptor: SettlementDescriptorExact }>().settlementDescriptor;

    const nonceA = `0x${"b".repeat(64)}` as const;
    const nonceB = `0x${"c".repeat(64)}` as const;
    for (const n of [nonceA, nonceB]) {
      const auth = buildPaymentAuthorization({ from: payerAddress, descriptor, nonce: n });
      await app.inject({ method: "POST", url: "/x402/settle", payload: await signPaymentPayload(payerKey, auth) });
    }

    const first = (await app.inject({ method: "GET", url: `/risk-report?token=ABC&nonce=${nonceA}` })).json<{
      report: TokenRiskReport;
    }>().report;
    const second = (await app.inject({ method: "GET", url: `/risk-report?token=ABC&nonce=${nonceB}` })).json<{
      report: TokenRiskReport;
    }>().report;

    expect(first.riskScore).toBe(second.riskScore);
    expect(first.signals).toEqual(second.signals);

    await app.close();
  });
});
