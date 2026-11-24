import { describe, expect, test } from "bun:test";
import type { SettlementDescriptorExact } from "@clb-acel/schemas";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildPaymentAuthorization,
  ChainMismatchError,
  createLocalFacilitator,
  NonceAlreadyConsumedError,
  signPaymentPayload,
  type FacilitatorChain,
} from "../src/index";

const payerKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const payerAddress = privateKeyToAccount(payerKey).address;
const nonce = `0x${"c".repeat(64)}` as const;

const descriptor: SettlementDescriptorExact = {
  chainId: 84532,
  network: "base-sepolia",
  asset: "USDC",
  payTo: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  value: "2.00",
  validBefore: "2026-05-30T06:00:00.000Z",
  x402Scheme: "exact",
};

/** The chain the authorization is signed for. */
const chainA: FacilitatorChain = { chainId: 84532, network: "base-sepolia" };
/** A different chain with a completely separate nonce store. */
const chainB: FacilitatorChain = { chainId: 8453, network: "base" };

function signedPayload() {
  return signPaymentPayload(
    payerKey,
    buildPaymentAuthorization({ from: payerAddress, descriptor, nonce }),
  );
}

describe("cross-chain / cross-facilitator replay", () => {
  test("POSITIVE: a valid payload settles on the matching-chain facilitator", async () => {
    const facilitator = createLocalFacilitator(undefined, chainA);
    const receipt = await facilitator.settle(await signedPayload());

    expect(receipt.settled).toBe(true);
    expect(receipt.chainId).toBe(chainA.chainId);
    expect(receipt.network).toBe(chainA.network);
    expect(receipt.nonce).toBe(nonce);
    expect(facilitator.isConsumed(nonce)).toBe(true);
  });

  test("EXPLOIT -> REJECTED: identical signed bytes cannot settle on a second chain", async () => {
    const payload = await signedPayload();

    const chainAFacilitator = createLocalFacilitator(undefined, chainA);
    const first = await chainAFacilitator.settle(payload);
    expect(first.settled).toBe(true);

    // Fresh store modelling another chain. The EIP-712 signature is still valid
    // here (the payload was not altered); only chain binding can stop replay.
    const chainBFacilitator = createLocalFacilitator(undefined, chainB);

    let caught: unknown;
    try {
      await chainBFacilitator.settle(payload);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ChainMismatchError);
    expect(caught).toMatchObject({ name: "ChainMismatchError" });
    expect(caught).toMatchObject({
      expectedChainId: chainB.chainId,
      actualChainId: chainA.chainId,
    });
    // Rejection happens before reservation: chain B's store stays clean.
    expect(chainBFacilitator.isConsumed(nonce)).toBe(false);
    expect(chainBFacilitator.getSettlement(nonce)).toBeNull();
  });

  test("replay on the same facilitator is still rejected (single-use preserved)", async () => {
    const facilitator = createLocalFacilitator(undefined, chainA);
    const payload = await signedPayload();

    expect((await facilitator.settle(payload)).settled).toBe(true);
    await expect(facilitator.settle(payload)).rejects.toBeInstanceOf(NonceAlreadyConsumedError);
  });

  test("same chainId with a different network label is also rejected", async () => {
    const facilitator = createLocalFacilitator(undefined, {
      chainId: chainA.chainId,
      network: "base",
    });
    await expect(facilitator.settle(await signedPayload())).rejects.toBeInstanceOf(
      ChainMismatchError,
    );
  });
});
