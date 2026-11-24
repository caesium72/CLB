import { describe, expect, it } from "bun:test";
import { buildValidBundle, TEST_KEYS } from "@clb-acel/attack-core";
import { signDeliveryBinding } from "@clb-acel/delivery-core";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTrace } from "../src";

const HUMAN = privateKeyToAccount(TEST_KEYS.userKey).address;

describe("R14b_DELIVERY_BOUND_TO_SETTLEMENT", () => {
  it("passes for a delivery bound to this settlement", async () => {
    const bundle = await buildValidBundle();
    const { result } = await verifyTrace(bundle, { expectedHumanPrincipal: HUMAN });
    expect(result.failedRules).not.toContain("R14b_DELIVERY_BOUND_TO_SETTLEMENT");
  });

  it("fails when delivery binds a different settlement", async () => {
    const bundle = await buildValidBundle();
    const wrongBinding = await signDeliveryBinding({
      settlementTxHash: "0xdeadbeef",
      reportHash: bundle.report.reportHash,
      merchantKey: TEST_KEYS.merchantKey,
    });
    const tampered = {
      ...bundle,
      report: { ...bundle.report, deliveryBinding: wrongBinding },
    };
    const { result } = await verifyTrace(tampered, { expectedHumanPrincipal: HUMAN });
    expect(result.failedRules).toContain("R14b_DELIVERY_BOUND_TO_SETTLEMENT");
  });
});
