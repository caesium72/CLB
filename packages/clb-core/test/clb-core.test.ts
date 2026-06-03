import { describe, expect, test } from "bun:test";
import type { CLBCommitmentInput, Mandate, SettlementDescriptorExact } from "@clb-acel/schemas";
import { privateKeyToAccount } from "viem/accounts";
import {
  computeCommitment,
  computeMandateDigest,
  computeSettlementDigest,
  deriveCommitment,
  deriveNonce,
  recoverCommitmentSigner,
  signCommitment,
  verifyCommitmentSignature,
} from "../src/index";

const registryAddr = "0x0000000000000000000000000000000000000001" as const;
const payTo = "0x00000000000000000000000000000000000000a1" as const;
// Anvil default account #0 private key (test only, never funded on mainnet).
const userPrivateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const settlement: SettlementDescriptorExact = {
  chainId: 84532,
  network: "base-sepolia",
  asset: "USDC",
  payTo,
  value: "2.00",
  validBefore: "2026-05-30T06:00:00.000Z",
  x402Scheme: "exact",
};

const mandate: Mandate = {
  mandateId: "mandate-1",
  type: "CART",
  humanPrincipal: "user:0xabc",
  authorizedAgent: { chainId: 84532, registryAddr, agentId: "analysis-agent-001" },
  constraints: {
    maxAmount: "2.00",
    allowedAssets: ["USDC"],
    allowedPayees: [payTo],
    validUntil: "2026-05-30T06:00:00.000Z",
  },
  signature: `0x${"1".repeat(130)}`,
};

function input(overrides: Partial<CLBCommitmentInput> = {}): CLBCommitmentInput {
  return {
    identityRef: { chainId: 84532, registryAddr, agentId: "analysis-agent-001" },
    mandateDigest: computeMandateDigest(mandate),
    settlementDescriptor: settlement,
    domain: { name: "CLB-ACEL", version: "0.1", chainId: 84532 },
    ...overrides,
  };
}

describe("computeMandateDigest", () => {
  test("is stable regardless of signature or derived clbCommitment", () => {
    const base = computeMandateDigest(mandate);
    const withCommitment = computeMandateDigest({
      ...mandate,
      signature: `0x${"2".repeat(130)}`,
      clbCommitment: `0x${"d".repeat(64)}`,
    });

    expect(base).toBe(withCommitment);
    expect(base).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("computeSettlementDigest", () => {
  test("is insensitive to key ordering", () => {
    const reordered = {
      x402Scheme: "exact",
      value: "2.00",
      validBefore: "2026-05-30T06:00:00.000Z",
      payTo,
      asset: "USDC",
      network: "base-sepolia",
      chainId: 84532,
    } as SettlementDescriptorExact;

    expect(computeSettlementDigest(settlement)).toBe(computeSettlementDigest(reordered));
  });
});

describe("computeCommitment", () => {
  test("is deterministic for identical input", () => {
    expect(computeCommitment(input())).toBe(computeCommitment(input()));
    expect(computeCommitment(input())).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("changes when the settlement payee changes (P4 non-transferability)", () => {
    const other = computeCommitment(
      input({ settlementDescriptor: { ...settlement, payTo: "0x00000000000000000000000000000000000000b2" } }),
    );

    expect(other).not.toBe(computeCommitment(input()));
  });

  test("changes when the domain chainId changes (cross-chain transplant resistance)", () => {
    const transplanted = computeCommitment(input({ domain: { name: "CLB-ACEL", version: "0.1", chainId: 1 } }));

    expect(transplanted).not.toBe(computeCommitment(input()));
  });

  test("changes when the identity agentId changes (identity substitution)", () => {
    const swapped = computeCommitment(
      input({ identityRef: { chainId: 84532, registryAddr, agentId: "evil-agent-999" } }),
    );

    expect(swapped).not.toBe(computeCommitment(input()));
  });
});

describe("deriveNonce", () => {
  test("nonce = H(C) is deterministic and distinct from C", () => {
    const commitment = computeCommitment(input());
    const nonce = deriveNonce(commitment);

    expect(nonce).toBe(deriveNonce(commitment));
    expect(nonce).not.toBe(commitment);
    expect(nonce).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("deriveCommitment bundles commitment, nonce, and settlement digest", () => {
    const bundle = deriveCommitment(input());

    expect(bundle.commitment).toBe(computeCommitment(input()));
    expect(bundle.nonce).toBe(deriveNonce(bundle.commitment));
    expect(bundle.settlementDigest).toBe(computeSettlementDigest(settlement));
  });
});

describe("commitment signatures", () => {
  test("round-trips through sign, recover, and verify", async () => {
    const signature = await signCommitment(userPrivateKey, input());
    const expected = privateKeyToAccount(userPrivateKey).address;

    expect(await recoverCommitmentSigner(input(), signature)).toBe(expected);
    expect(await verifyCommitmentSignature(input(), signature, expected)).toBe(true);
  });

  test("rejects a signature when the committed settlement is tampered", async () => {
    const signature = await signCommitment(userPrivateKey, input());
    const expected = privateKeyToAccount(userPrivateKey).address;
    const tampered = input({ settlementDescriptor: { ...settlement, value: "3.00" } });

    expect(await verifyCommitmentSignature(tampered, signature, expected)).toBe(false);
  });
});
