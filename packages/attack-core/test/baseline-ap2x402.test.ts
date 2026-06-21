import { describe, expect, it } from "bun:test";
import { bAp2X402 } from "../src/baselines/ap2-x402";
import { buildValidBundle, descriptor, payerAgent, merchantAddress } from "../src/index";
import { verifyTrace } from "@clb-acel/verifier-core";

describe("bAp2X402", () => {
  it("catches AMOUNT_ESCALATION (settlement value exceeds mandate maxAmount)", async () => {
    // default mandate maxAmount is "2.00"; settle 9.99
    const overBudget = await buildValidBundle({ settlementDescriptor: descriptor({ value: "9.99" }) });
    expect((await bAp2X402(overBudget)).accepted).toBe(false);
  });

  it("misses AGENT_IDENTITY_SWAP (no identity layer) but CLB-ACEL catches it (R4)", async () => {
    const base = await buildValidBundle();
    const swapped = { ...base, payerAgent: { ...payerAgent, authorizedPaymentKeys: [merchantAddress] } };
    expect((await bAp2X402(swapped)).accepted).toBe(true);            // no identity view -> missed
    expect((await verifyTrace(swapped)).result.status).toBe("FAIL");  // CLB catches it (R4)
  });

  it("accepts a fully valid bundle", async () => {
    expect((await bAp2X402(await buildValidBundle())).accepted).toBe(true);
  });
});
