import { describe, expect, it } from "bun:test";
import { bVanillaX402 } from "../src/baselines/vanilla-x402";
import { TEST_KEYS, buildValidBundle, descriptor, attackerAddress } from "../src/index";
import { verifyTrace } from "@clb-acel/verifier-core";
import { privateKeyToAccount } from "viem/accounts";

const HUMAN = privateKeyToAccount(TEST_KEYS.userKey).address;

describe("bVanillaX402", () => {
  it("accepts a payee-substitution settlement that CLB-ACEL rejects", async () => {
    const attacked = await buildValidBundle({ settlementDescriptor: descriptor({ payTo: attackerAddress }) });
    expect((await bVanillaX402(attacked)).accepted).toBe(true); // baseline misses it
    expect((await verifyTrace(attacked, { expectedHumanPrincipal: HUMAN })).result.status).toBe("FAIL"); // full stack catches it (R12)
  });

  it("accepts a fully valid bundle", async () => {
    const valid = await buildValidBundle();
    expect((await bVanillaX402(valid)).accepted).toBe(true);
  });
});
