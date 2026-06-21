import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { signDeliveryBinding, verifyDeliveryBinding } from "../src";

const merchantKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

describe("delivery binding", () => {
  it("binding verifies for the matching settlement", async () => {
    const sig = await signDeliveryBinding({
      settlementTxHash: "0xtx",
      reportHash: "0xrep",
      merchantKey,
    });
    expect(
      await verifyDeliveryBinding({
        settlementTxHash: "0xtx",
        reportHash: "0xrep",
        signature: sig,
        merchant: privateKeyToAccount(merchantKey).address,
      }),
    ).toBe(true);
  });

  it("binding fails for a different settlement", async () => {
    const sig = await signDeliveryBinding({
      settlementTxHash: "0xtx",
      reportHash: "0xrep",
      merchantKey,
    });
    expect(
      await verifyDeliveryBinding({
        settlementTxHash: "0xOTHER",
        reportHash: "0xrep",
        signature: sig,
        merchant: privateKeyToAccount(merchantKey).address,
      }),
    ).toBe(false);
  });
});
