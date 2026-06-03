import { describe, expect, test } from "bun:test";
import type { TokenRiskReport } from "@clb-acel/schemas";
import { explainRiskReport } from "../src/index";

const sampleReport: TokenRiskReport = {
  token: "XYZ",
  chain: "base-sepolia",
  riskScore: 0.42,
  signals: {
    liquidityRisk: 0.3,
    holderConcentrationRisk: 0.5,
    contractRisk: 0.6,
    marketVolatilityRisk: 0.4,
    socialNarrativeRisk: 0.2,
  },
  modelVersion: "heuristic-v1",
  inputDataHash: `0x${"a".repeat(64)}`,
  reportHash: `0x${"b".repeat(64)}`,
  merchantAgentSignature: `0x${"1".repeat(130)}`,
  generatedAt: "2026-05-30T00:00:00.000Z",
};

describe("llm-adapter", () => {
  test("returns a deterministic heuristic explanation without API keys", async () => {
    const first = await explainRiskReport({ report: sampleReport, provider: "heuristic" });
    const second = await explainRiskReport({ report: sampleReport, provider: "heuristic" });

    expect(first.provider).toBe("heuristic");
    expect(first.explanation).toContain("XYZ");
    expect(first.explanation).toBe(second.explanation);
  });
});
