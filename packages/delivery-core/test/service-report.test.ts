import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildSignedServiceReport,
  signDeliveryBinding,
  verifyDeliveryBinding,
  verifyServiceReportSignature,
} from "../src";

const MERCHANT_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;

describe("service report (generic delivery artifact)", () => {
  it("builds a signed report that verifies against the merchant key", async () => {
    const merchant = privateKeyToAccount(MERCHANT_KEY).address;
    const report = await buildSignedServiceReport(MERCHANT_KEY, {
      service: "grammar",
      task: "Proofread paragraph",
      input: { text: "i has two dogs" },
      result: { correctedText: "I have two dogs.", issues: [] },
      modelVersion: "grammar-v1",
      generatedAt: "2026-06-06T00:00:00.000Z",
    });
    expect(report.reportHash).toMatch(/^0x[0-9a-f]+$/);
    expect(report.inputDataHash).toMatch(/^0x[0-9a-f]+$/);
    expect(await verifyServiceReportSignature(report, merchant)).toBe(true);
  });

  it("rejects a tampered report result", async () => {
    const merchant = privateKeyToAccount(MERCHANT_KEY).address;
    const report = await buildSignedServiceReport(MERCHANT_KEY, {
      service: "weather",
      task: "Forecast for London",
      input: { city: "London" },
      result: { summary: "Sunny" },
      modelVersion: "weather-v1",
      generatedAt: "2026-06-06T00:00:00.000Z",
    });
    const tampered = { ...report, result: { summary: "Rainy" } };
    expect(await verifyServiceReportSignature(tampered, merchant)).toBe(false);
  });

  it("delivery binding round-trips for a service report", async () => {
    const merchant = privateKeyToAccount(MERCHANT_KEY).address;
    const report = await buildSignedServiceReport(MERCHANT_KEY, {
      service: "grammar",
      task: "Proofread",
      input: { text: "hello" },
      result: { correctedText: "Hello." },
      modelVersion: "grammar-v1",
      generatedAt: "2026-06-06T00:00:00.000Z",
    });
    const signature = await signDeliveryBinding({
      settlementTxHash: "0xabc",
      reportHash: report.reportHash,
      merchantKey: MERCHANT_KEY,
    });
    expect(
      await verifyDeliveryBinding({
        settlementTxHash: "0xabc",
        reportHash: report.reportHash,
        signature,
        merchant,
      }),
    ).toBe(true);
  });

  it("is reproducible for identical inputs", async () => {
    const a = await buildSignedServiceReport(MERCHANT_KEY, {
      service: "grammar",
      task: "Proofread",
      input: { text: "same" },
      result: { correctedText: "Same." },
      modelVersion: "grammar-v1",
      generatedAt: "2026-06-06T00:00:00.000Z",
    });
    const b = await buildSignedServiceReport(MERCHANT_KEY, {
      service: "grammar",
      task: "Proofread",
      input: { text: "same" },
      result: { correctedText: "Same." },
      modelVersion: "grammar-v1",
      generatedAt: "2026-06-06T00:00:00.000Z",
    });
    expect(a.reportHash).toBe(b.reportHash);
  });
});
