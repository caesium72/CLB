import { describe, expect, it } from "bun:test";
import { buildValidBundle, TEST_KEYS } from "@clb-acel/attack-core";
import { signDeliveryBinding } from "@clb-acel/delivery-core";
import { verifyTrace } from "../src";

describe("R14b_DELIVERY_BOUND_TO_SETTLEMENT", () => {
  it("passes for a delivery bound to this settlement", async () => {
    const bundle = await buildValidBundle();
    const { result } = await verifyTrace(bundle);
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
    const { result } = await verifyTrace(tampered);
    expect(result.failedRules).toContain("R14b_DELIVERY_BOUND_TO_SETTLEMENT");
  });
});
