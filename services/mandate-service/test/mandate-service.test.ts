import { describe, expect, test } from "bun:test";
import type { Mandate } from "@clb-acel/schemas";
import { buildMandateServer } from "../src/server";

const registryAddr = "0x0000000000000000000000000000000000008004";
const payTo = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const authorizedAgent = { chainId: 84532, registryAddr, agentId: "analysis-agent-001" };
const settlementDescriptor = {
  chainId: 84532,
  network: "base-sepolia",
  asset: "USDC",
  payTo,
  value: "2.00",
  validBefore: "2026-05-30T06:00:00.000Z",
  x402Scheme: "exact",
};
const constraints = {
  maxAmount: "2.00",
  allowedAssets: ["USDC"],
  allowedPayees: [payTo],
  validUntil: "2026-05-30T06:00:00.000Z",
};
const domain = { name: "CLB-ACEL", version: "0.1", chainId: 84532 };

async function server() {
  return buildMandateServer({ logger: false });
}

describe("mandate-service", () => {
  test("issues a CART mandate bound to C and verifies it", async () => {
    const app = await server();

    const issued = await app.inject({
      method: "POST",
      url: "/mandates/cart",
      payload: { authorizedAgent, constraints, settlementDescriptor, domain },
    });
    expect(issued.statusCode).toBe(201);
    const mandate = issued.json<Mandate>();
    expect(mandate.clbCommitment).toMatch(/^0x[0-9a-f]{64}$/);

    const verify = await app.inject({
      method: "POST",
      url: "/mandates/verify",
      payload: { mandate, clb: { identityRef: authorizedAgent, settlementDescriptor, domain } },
    });
    expect(verify.json<{ valid: boolean }>().valid).toBe(true);

    await app.close();
  });

  test("detects an amount-substitution attempt during verification", async () => {
    const app = await server();
    const issued = await app.inject({
      method: "POST",
      url: "/mandates/payment",
      payload: { authorizedAgent, constraints, settlementDescriptor, domain },
    });
    const mandate = issued.json<Mandate>();

    const verify = await app.inject({
      method: "POST",
      url: "/mandates/verify",
      payload: {
        mandate,
        clb: {
          identityRef: authorizedAgent,
          settlementDescriptor: { ...settlementDescriptor, value: "9.00" },
          domain,
        },
      },
    });

    expect(verify.json<{ valid: boolean; reasons: string[] }>().valid).toBe(false);
    expect(verify.json<{ reasons: string[] }>().reasons).toContain("CLB_COMMITMENT_MISMATCH");

    await app.close();
  });

  test("stores mandates retrievable by id", async () => {
    const app = await server();
    const issued = await app.inject({
      method: "POST",
      url: "/mandates/intent",
      payload: { authorizedAgent, constraints },
    });
    const mandate = issued.json<Mandate>();

    const fetched = await app.inject({ method: "GET", url: `/mandates/${mandate.mandateId}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<Mandate>().mandateId).toBe(mandate.mandateId);

    await app.close();
  });
});
