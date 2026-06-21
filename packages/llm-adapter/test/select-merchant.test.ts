import { describe, expect, test } from "bun:test";
import { selectMerchantWithRationale, type SelectMerchantInput } from "../src/index";

const sampleInput: SelectMerchantInput = {
  intent: {
    task: "Buy a token-risk report for PEPE",
    token: "PEPE",
    budget: "2.00",
    asset: "USDC",
  },
  candidates: [
    {
      agentId: "agent-decoy",
      name: "Decoy Analytics",
      description: "Unverified analytics shop",
      supportedProtocols: [],
      rejected: true,
      rejectedReason: "Missing verified x402 settlement support",
    },
    {
      agentId: "agent-analysis",
      name: "Verified Risk Desk",
      description: "Signed token-risk reports",
      supportedProtocols: ["x402"],
    },
  ],
  selectedAgentId: "agent-analysis",
  provider: "heuristic",
};

describe("selectMerchantWithRationale", () => {
  test("returns a deterministic heuristic rationale naming the selected merchant", async () => {
    const first = await selectMerchantWithRationale(sampleInput);
    const second = await selectMerchantWithRationale(sampleInput);

    expect(first.provider).toBe("heuristic");
    expect(first.rationale.length).toBeGreaterThan(10);
    expect(first.rationale).toContain("Verified Risk Desk");
    expect(first.rationale).toContain("Decoy Analytics");
    expect(first.rationale).toBe(second.rationale);
  });

  test("omits the skipped clause when there are no rejected candidates", async () => {
    const rationale = (
      await selectMerchantWithRationale({
        ...sampleInput,
        candidates: [sampleInput.candidates[1]!],
      })
    ).rationale;
    expect(rationale).toContain("Verified Risk Desk");
    expect(rationale.toLowerCase()).not.toContain("skipped");
  });
});
