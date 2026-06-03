import { describe, expect, test } from "bun:test";
import { scoreToken, buildSignedReport } from "../src/index";

describe("delivery-core", () => {
  test("scoreToken is deterministic", () => {
    const first = scoreToken({ token: "XYZ", chain: "base-sepolia" });
    const second = scoreToken({ token: "XYZ", chain: "base-sepolia" });
    expect(first).toEqual(second);
  });

  test("buildSignedReport accepts an injected scorer", async () => {
    const report = await buildSignedReport(
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
      { token: "ABC", chain: "base-sepolia", generatedAt: "2026-05-30T00:00:00.000Z" },
      {
        scorer: () => ({
          riskScore: 0.123,
          inputDataHash: `0x${"a".repeat(64)}`,
          signals: {
            liquidityRisk: 0.1,
            holderConcentrationRisk: 0.2,
            contractRisk: 0.3,
            marketVolatilityRisk: 0.4,
            socialNarrativeRisk: 0.5,
          },
        }),
        modelVersion: "custom-scorer",
      },
    );

    expect(report.riskScore).toBe(0.123);
    expect(report.modelVersion).toBe("custom-scorer");
  });
});
