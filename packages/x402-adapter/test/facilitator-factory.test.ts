import { describe, expect, test } from "bun:test";
import type { SettlementDescriptorExact } from "@clb-acel/schemas";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildPaymentAuthorization,
  createHttpFacilitator,
  signPaymentPayload,
} from "../src/index";

const payerKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const payerAddress = privateKeyToAccount(payerKey).address;
const nonce = `0x${"e".repeat(64)}` as const;

const descriptor: SettlementDescriptorExact = {
  chainId: 84532,
  network: "base-sepolia",
  asset: "USDC",
  payTo: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  value: "2.00",
  validBefore: "2026-05-30T06:00:00.000Z",
  x402Scheme: "exact",
};

describe("createHttpFacilitator", () => {
  test("posts payloads to the remote facilitator", async () => {
    const calls: string[] = [];
    const facilitator = createHttpFacilitator({
      baseUrl: "http://facilitator.test",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response(
          JSON.stringify({
            settled: true,
            txHash: `0x${"d".repeat(64)}`,
            payer: payerAddress,
            payTo: descriptor.payTo,
            value: "2.00",
            asset: "USDC",
            network: "base-sepolia",
            chainId: 84532,
            nonce,
            settledAt: "2026-05-30T00:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    const auth = buildPaymentAuthorization({ from: payerAddress, descriptor, nonce });
    const payload = await signPaymentPayload(payerKey, auth);
    const receipt = await facilitator.settle(payload);

    expect(calls).toEqual(["http://facilitator.test/settle"]);
    expect(receipt.txHash).toBe(`0x${"d".repeat(64)}`);
    expect(facilitator.isConsumed(nonce)).toBe(true);
  });
});
