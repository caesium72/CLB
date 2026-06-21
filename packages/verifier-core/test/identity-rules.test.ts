import { describe, expect, it } from "bun:test";
import { buildValidBundle } from "@clb-acel/attack-core";
import { verifyTrace } from "../src";

describe("R3/R4 identity rules", () => {
  it("R4 fails when settled payer key not in live card.authorizedPaymentKeys", async () => {
    const bundle = await buildValidBundle();
    const tampered = {
      ...bundle,
      payerAgent: {
        ...bundle.payerAgent,
        authorizedPaymentKeys: ["0x0000000000000000000000000000000000000001"],
      },
    };
    const { result } = await verifyTrace(tampered);
    expect(result.failedRules).toContain("R4_AGENT_PAYMENT_KEY_AUTHORIZED");
  });

  it("R3 passes when payer identity resolves consistently", async () => {
    const bundle = await buildValidBundle();
    const { result } = await verifyTrace(bundle);
    expect(result.failedRules).not.toContain("R3_AGENT_IDENTITY_RESOLVES");
  });
});
