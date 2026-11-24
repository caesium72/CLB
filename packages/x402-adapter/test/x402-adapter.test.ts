import { describe, expect, test } from "bun:test";
import type { SettlementDescriptorExact } from "@clb-acel/schemas";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildPaymentAuthorization,
  buildPaymentRequirements,
  createLocalFacilitator,
  NonceAlreadyConsumedError,
  recoverPaymentSigner,
  runConcurrencyTrials,
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
    const requirements = buildPaymentRequirements({
      descriptor,
      resource: "/risk-report?token=XYZ",
    });
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

  test("atomically reserves a nonce under concurrent settlement attempts", async () => {
    const facilitator = createLocalFacilitator();
    const auth = buildPaymentAuthorization({ from: payerAddress, descriptor, nonce });
    const payload = await signPaymentPayload(payerKey, auth);

    const results = await Promise.allSettled(
      Array.from({ length: 24 }, () => facilitator.settle(payload)),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(23);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(NonceAlreadyConsumedError);
    }
    expect(facilitator.isConsumed(nonce)).toBe(true);
    expect(facilitator.getSettlement(nonce)).not.toBeNull();
  });

  test("allows concurrent independent transactions with distinct nonces", async () => {
    const facilitator = createLocalFacilitator();
    const payloads = await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const uniqueNonce = `0x${(index + 1).toString(16).padStart(64, "0")}` as const;
        const auth = buildPaymentAuthorization({
          from: payerAddress,
          descriptor,
          nonce: uniqueNonce,
        });
        return signPaymentPayload(payerKey, auth);
      }),
    );

    const receipts = await Promise.all(payloads.map((payload) => facilitator.settle(payload)));
    expect(receipts).toHaveLength(12);
    expect(new Set(receipts.map((receipt) => receipt.nonce)).size).toBe(12);
    expect(receipts.every((receipt) => receipt.settled)).toBe(true);
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

describe("concurrency harness", () => {
  test("holds the one-settlement-per-nonce invariant across burst levels", async () => {
    const run = await runConcurrencyTrials({ levels: [4, 8], trialsPerLevel: 5 });

    expect(run.summary.anomalyCount).toBe(0);
    expect(run.summary.totalOtherErrors).toBe(0);
    for (const result of run.results.filter((row) => row.mode === "same-nonce")) {
      expect(result.settled, `same-nonce level ${result.level}`).toBe(1);
      expect(result.rejected).toBe(result.attempted - 1);
    }
    for (const result of run.results.filter((row) => row.mode === "distinct-nonce")) {
      expect(result.settled, `distinct-nonce level ${result.level}`).toBe(result.level);
    }
  });
});
