import { describe, expect, it } from "bun:test";
import { selectAgentForTask } from "../src";

const CANDIDATES = [
  {
    agentId: "6827",
    name: "Grammar Checker Agent",
    description:
      "Proofreads and corrects English text — fixes grammar, spelling, and punctuation.",
    supportedProtocols: ["x402"],
  },
  {
    agentId: "6823",
    name: "Weather Agent",
    description: "Returns a weather forecast (conditions and temperature) for a given city.",
    supportedProtocols: ["x402"],
  },
];

const base = { asset: "USDC", maxPrice: "2.00", network: "base-sepolia" };

describe("selectAgentForTask (heuristic, deterministic)", () => {
  it("selects the grammar agent for a proofreading task", async () => {
    const r = await selectAgentForTask({
      intent: { task: "Proofread this paragraph for me", ...base },
      candidates: CANDIDATES,
      provider: "heuristic",
    });
    expect(r.selectedAgentId).toBe("6827");
  });

  it("selects the weather agent for a forecast task", async () => {
    const r = await selectAgentForTask({
      intent: { task: "What is the weather forecast in Dhaka?", ...base },
      candidates: CANDIDATES,
      provider: "heuristic",
    });
    expect(r.selectedAgentId).toBe("6823");
  });

  it("returns null when no agent capability matches the task", async () => {
    const r = await selectAgentForTask({
      intent: { task: "Book a flight to Paris", ...base },
      candidates: CANDIDATES,
      provider: "heuristic",
    });
    expect(r.selectedAgentId).toBeNull();
    expect(r.reasoning).toContain("No available agent");
  });

  it("rejects a capable agent that is not in the allow-list", async () => {
    const r = await selectAgentForTask({
      intent: { task: "Proofread this", ...base, allowedAgentIds: ["6823"] },
      candidates: CANDIDATES,
      provider: "heuristic",
    });
    expect(r.selectedAgentId).toBeNull();
    const grammar = r.perAgent.find((v) => v.agentId === "6827");
    expect(grammar?.eligible).toBe(false);
  });
});
