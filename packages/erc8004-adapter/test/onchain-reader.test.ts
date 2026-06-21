import { describe, expect, it } from "bun:test";
import { createIdentityRegistry } from "../src";

describe("createIdentityRegistry", () => {
  it("factory falls back to mock without RPC config", () => {
    const reg = createIdentityRegistry({});
    expect(reg.kind).toBe("mock");
  });

  it("real reader resolves a live agent card (Base Sepolia)", async () => {
    if (!process.env.RPC_URL_BASE_SEPOLIA || !process.env.ERC8004_REGISTRY_ADDRESS) {
      return;
    }
    const reg = createIdentityRegistry({
      rpcUrl: process.env.RPC_URL_BASE_SEPOLIA,
      registryAddr: process.env.ERC8004_REGISTRY_ADDRESS as `0x${string}`,
      chainId: 84532,
    });
    expect(reg.kind).toBe("onchain");
    const agentId = process.env.TEST_AGENT_ID ?? "shopping-agent-001";
    const card = await reg.getCard(agentId);
    expect(card.authorizedPaymentKeys.length).toBeGreaterThan(0);
    expect(card.agentId).toBeTruthy();
  });
});
