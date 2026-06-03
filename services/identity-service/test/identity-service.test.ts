import { describe, expect, test } from "bun:test";
import { finalizeAgentCard } from "@clb-acel/erc8004-adapter";
import type { AgentCard } from "@clb-acel/schemas";
import { buildIdentityServer, createInMemoryErc8004Registry } from "../src/server";

const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const newPaymentKey = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const registryAddr = "0x0000000000000000000000000000000000008004";

function card(): AgentCard {
  return finalizeAgentCard({
    agentId: "analysis-agent-test",
    name: "Test Analysis Agent",
    description: "Test agent.",
    serviceEndpoints: ["http://localhost:4004"],
    owner: owner as `0x${string}`,
    authorizedSigningKeys: [owner as `0x${string}`],
    authorizedPaymentKeys: [owner as `0x${string}`],
    supportedProtocols: ["x402", "ERC8004"],
  });
}

async function server() {
  return buildIdentityServer({
    registry: createInMemoryErc8004Registry(),
    logger: false,
    seed: false,
  });
}

describe("identity-service", () => {
  test("registers an agent and resolves its card", async () => {
    const app = await server();

    const registered = await app.inject({
      method: "POST",
      url: "/agents/register",
      payload: { card: card(), registryAddr, chainId: 84532 },
    });
    const resolved = await app.inject({ method: "GET", url: "/agents/analysis-agent-test/card" });

    expect(registered.statusCode).toBe(201);
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json<AgentCard>().agentId).toBe("analysis-agent-test");

    await app.close();
  });

  test("authorizes an additional payment key", async () => {
    const app = await server();
    await app.inject({
      method: "POST",
      url: "/agents/register",
      payload: { card: card(), registryAddr, chainId: 84532 },
    });

    const updated = await app.inject({
      method: "POST",
      url: "/agents/analysis-agent-test/authorize-payment-key",
      payload: { key: newPaymentKey },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json<AgentCard>().card.authorizedPaymentKeys).toContain(newPaymentKey);

    await app.close();
  });

  test("rejects a card with a tampered metadataHash", async () => {
    const app = await server();
    const tampered = { ...card(), metadataHash: `0x${"0".repeat(64)}` };

    const response = await app.inject({
      method: "POST",
      url: "/agents/register",
      payload: { card: tampered, registryAddr, chainId: 84532 },
    });

    expect(response.statusCode).toBe(422);

    await app.close();
  });

  test("returns 404 for unknown agents", async () => {
    const app = await server();
    const response = await app.inject({ method: "GET", url: "/agents/missing" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  test("seeds a default agent and hosts its well-known card", async () => {
    const app = await buildIdentityServer({
      registry: createInMemoryErc8004Registry(),
      logger: false,
      seed: true,
    });

    const wellKnown = await app.inject({ method: "GET", url: "/.well-known/agent-card.json" });

    expect(wellKnown.statusCode).toBe(200);
    expect(wellKnown.json<AgentCard>().agentId).toBe("analysis-agent-001");

    await app.close();
  });
});
