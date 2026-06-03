import { describe, expect, test } from "bun:test";
import type { CLBCommitmentInput, IdentityRef, SettlementDescriptorExact } from "@clb-acel/schemas";
import { privateKeyToAccount } from "viem/accounts";
import { issueMandate, verifyMandate } from "../src/index";

const userPrivateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const userAddress = privateKeyToAccount(userPrivateKey).address;
const registryAddr = "0x0000000000000000000000000000000000008004" as const;
const payTo = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;

const authorizedAgent: IdentityRef = {
  chainId: 84532,
  registryAddr,
  agentId: "analysis-agent-001",
};

const settlementDescriptor: SettlementDescriptorExact = {
  chainId: 84532,
  network: "base-sepolia",
  asset: "USDC",
  payTo,
  value: "2.00",
  validBefore: "2026-05-30T06:00:00.000Z",
  x402Scheme: "exact",
};

const clb: Omit<CLBCommitmentInput, "mandateDigest"> = {
  identityRef: authorizedAgent,
  settlementDescriptor,
  domain: { name: "CLB-ACEL", version: "0.1", chainId: 84532 },
};

const constraints = {
  maxAmount: "2.00",
  allowedAssets: ["USDC"],
  allowedPayees: [payTo],
  validUntil: "2026-05-30T06:00:00.000Z",
};

describe("CART/PAYMENT mandate", () => {
  test("binds to C and verifies under the human signer", async () => {
    const mandate = await issueMandate(userPrivateKey, {
      type: "CART",
      authorizedAgent,
      constraints,
      clb,
    });

    expect(mandate.humanPrincipal).toBe(userAddress);
    expect(mandate.clbCommitment).toMatch(/^0x[0-9a-f]{64}$/);

    const result = await verifyMandate(mandate, { clb });
    expect(result.valid).toBe(true);
    expect(result.clbCommitment).toBe(mandate.clbCommitment!);
  });

  test("fails verification when settlement value is tampered", async () => {
    const mandate = await issueMandate(userPrivateKey, {
      type: "PAYMENT",
      authorizedAgent,
      constraints,
      clb,
    });

    const tampered = {
      ...clb,
      settlementDescriptor: { ...settlementDescriptor, value: "3.00" },
    };
    const result = await verifyMandate(mandate, { clb: tampered });

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("CLB_COMMITMENT_MISMATCH");
  });

  test("fails when CLB context is not provided", async () => {
    const mandate = await issueMandate(userPrivateKey, {
      type: "CART",
      authorizedAgent,
      constraints,
      clb,
    });

    const result = await verifyMandate(mandate);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("CLB_INPUT_REQUIRED");
  });
});

describe("INTENT mandate", () => {
  test("signs over the authorization digest and verifies", async () => {
    const mandate = await issueMandate(userPrivateKey, {
      type: "INTENT",
      authorizedAgent,
      constraints,
    });

    expect(mandate.clbCommitment).toBeUndefined();
    const result = await verifyMandate(mandate);
    expect(result.valid).toBe(true);
  });

  test("rejects a forged signer", async () => {
    const mandate = await issueMandate(userPrivateKey, {
      type: "INTENT",
      authorizedAgent,
      constraints,
    });

    const result = await verifyMandate(mandate, {
      expectedSigner: "0x0000000000000000000000000000000000000009",
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("MANDATE_SIGNATURE_INVALID");
  });
});
