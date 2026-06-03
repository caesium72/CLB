import { describe, expect, test } from "bun:test";
import type { SettlementDescriptorExact } from "@clb-acel/schemas";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildPaymentAuthorization,
  buildPaymentRequirements,
  createLocalFacilitator,
  NonceAlreadyConsumedError,
  recoverPaymentSigner,
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

describe("payment requirements", () => {
  test("derive a 402 body from a settlement descriptor", () => {
    const requirements = buildPaymentRequirements({ descriptor, resource: "/risk-report?token=XYZ" });
    const [accept] = requirements.accepts;

    expect(accept?.scheme).toBe("exact");
    expect(accept?.maxAmountRequired).toBe("2.00");
    expect(accept?.payTo).toBe(descriptor.payTo);
  });
});

describe("payment authorization", () => {
  test("signs and recovers the payer", async () => {
    const auth = buildPaymentAuthorization({ from: payerAddress, descriptor, nonce });
    const payload = await signPaymentPayload(payerKey, auth);

    expect(payload.authorization.nonce).toBe(nonce);
    expect(await recoverPaymentSigner(payload)).toBe(payerAddress);
  });
});

describe("local facilitator", () => {
  test("settles once and rejects nonce reuse (P3 freshness)", async () => {
    const facilitator = createLocalFacilitator();
    const auth = buildPaymentAuthorization({ from: payerAddress, descriptor, nonce });
    const payload = await signPaymentPayload(payerKey, auth);

    const receipt = await facilitator.settle(payload);
    expect(receipt.settled).toBe(true);
    expect(receipt.payer).toBe(payerAddress);
    expect(facilitator.isConsumed(nonce)).toBe(true);

    await expect(facilitator.settle(payload)).rejects.toBeInstanceOf(NonceAlreadyConsumedError);
  });

  test("rejects a tampered authorization", async () => {
    const facilitator = createLocalFacilitator();
    const auth = buildPaymentAuthorization({ from: payerAddress, descriptor, nonce });
    const payload = await signPaymentPayload(payerKey, auth);
    const tampered = {
      ...payload,
      authorization: { ...payload.authorization, value: "9.99" },
    };

    expect(await facilitator.verify(tampered)).toBe(false);
  });
});
