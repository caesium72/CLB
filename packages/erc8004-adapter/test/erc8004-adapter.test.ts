import { describe, expect, test } from "bun:test";
import type { AgentCard } from "@clb-acel/schemas";
import { getAddress } from "viem";
import {
  computeMetadataHash,
  createInMemoryErc8004Registry,
  finalizeAgentCard,
  identityRefFor,
  isPaymentKeyAuthorized,
  MetadataHashMismatchError,
} from "../src/index";

const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const paymentKey = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const newPaymentKey = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const registryAddr = "0x0000000000000000000000000000000000000abc" as const;

function cardInput(): Omit<AgentCard, "metadataHash"> {
  return {
    agentId: "analysis-agent-001",
    name: "Token Risk Analysis Agent",
    description: "Sells signed token-risk reports.",
    serviceEndpoints: ["http://localhost:4004"],
    owner,
    authorizedSigningKeys: [owner],
    authorizedPaymentKeys: [paymentKey],
    supportedProtocols: ["x402", "ERC8004"],
  };
}

describe("agent card integrity", () => {
  test("finalizeAgentCard produces a verifiable metadataHash", () => {
    const card = finalizeAgentCard(cardInput());
    expect(card.metadataHash).toBe(computeMetadataHash(card));
  });
});

describe("in-memory registry", () => {
  test("registers and resolves an agent", async () => {
    const registry = createInMemoryErc8004Registry();
    const card = finalizeAgentCard(cardInput());

    const record = await registry.register({ card, registryAddr, chainId: 84532 });
    const resolved = await registry.getAgent("analysis-agent-001");

    expect(resolved?.agentId).toBe("analysis-agent-001");
    expect(identityRefFor(record)).toEqual({
      chainId: 84532,
      registryAddr: getAddress(registryAddr),
      agentId: "analysis-agent-001",
    });
    expect(isPaymentKeyAuthorized(record, paymentKey)).toBe(true);
  });

  test("rejects a card whose metadataHash does not match", async () => {
    const registry = createInMemoryErc8004Registry();
    const card = { ...finalizeAgentCard(cardInput()), metadataHash: `0x${"0".repeat(64)}` } as AgentCard;

    await expect(registry.register({ card, registryAddr, chainId: 84532 })).rejects.toBeInstanceOf(
      MetadataHashMismatchError,
    );
  });

  test("authorizes a new payment key and keeps the metadataHash consistent", async () => {
    const registry = createInMemoryErc8004Registry();
    const card = finalizeAgentCard(cardInput());
    await registry.register({ card, registryAddr, chainId: 84532 });

    const updated = await registry.authorizePaymentKey("analysis-agent-001", newPaymentKey);

    expect(isPaymentKeyAuthorized(updated, newPaymentKey)).toBe(true);
    expect(updated.card.metadataHash).toBe(computeMetadataHash(updated.card));
  });
});
