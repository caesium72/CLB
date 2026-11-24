import { describe, expect, it } from "bun:test";
import type { SettlementParams, SpendingPredicate } from "@clb-acel/schemas";
import { keccak256, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildModeBSettlementCommitment,
  computeModeBSettlementCommitment,
  computePredicateDigest,
  computePredicateExtrasDigest,
  deriveSettlementNonce,
  type ModeBSettlementInput,
} from "../src/index";

// Same ID in every case: the attack is predicate substitution UNDER an existing ID.
const PREDICATE_ID = "predicate-001";
const MERCHANT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ATTACKER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const SIGNER_KEY = `0x${"11".repeat(32)}` as const;
const ACCOUNT = privateKeyToAccount(SIGNER_KEY);
const SIGNER = ACCOUNT.address;

const humanPredicate: SpendingPredicate = {
  allowedAssets: ["USDC"],
  allowedPayees: [MERCHANT],
  maxValue: "5.00",
  validUntil: "2026-12-30T06:00:00.000Z",
  allowedChainIds: [84532],
  allowedAgentIds: ["shopping-agent-001"],
};

const params: SettlementParams = {
  chainId: 84532,
  network: "base-sepolia",
  asset: "USDC",
  payTo: MERCHANT,
  value: "2.00",
  valueAtomic: "2000000",
  validBefore: "2026-12-30T06:00:00.000Z",
  payerAgentId: "shopping-agent-001",
};

function inputFor(predicate: SpendingPredicate, settlementParams = params): ModeBSettlementInput {
  return {
    identityRef: {
      chainId: 84532,
      registryAddr: "0x0000000000000000000000000000000000008004",
      agentId: "shopping-agent-001",
    },
    mandateDigest: `0x${"c".repeat(64)}`,
    predicateId: PREDICATE_ID,
    predicate,
    settlementParams,
    domain: { name: "CLB-ACEL", version: "0.1", chainId: 84532 },
  };
}

const signedTypedData = buildModeBSettlementCommitment(inputFor(humanPredicate));
const humanSignature = await ACCOUNT.signTypedData(signedTypedData);

/** One mutation per predicate field, all keeping the SAME predicateId. */
const substitutions: Array<[string, SpendingPredicate]> = [
  ["allowedPayees", { ...humanPredicate, allowedPayees: [ATTACKER] }],
  ["allowedAssets", { ...humanPredicate, allowedAssets: ["USDC", "EURC"] }],
  ["maxValue", { ...humanPredicate, maxValue: "10.00" }],
  ["validUntil", { ...humanPredicate, validUntil: "2027-12-30T06:00:00.000Z" }],
  ["allowedChainIds", { ...humanPredicate, allowedChainIds: [84532, 1] }],
  ["allowedAgentIds", { ...humanPredicate, allowedAgentIds: ["other-agent"] }],
  ["taskHash", { ...humanPredicate, taskHash: `0x${"ab".repeat(32)}` }],
];

describe("predicate content binding in C'", () => {
  it("binds the full predicate digest (positive case)", () => {
    const input = inputFor(humanPredicate);
    const cPrime = computeModeBSettlementCommitment(input);
    expect(buildModeBSettlementCommitment(input).message.predicateDigest).toBe(
      computePredicateDigest(humanPredicate),
    );
    // extras (agent IDs + task hash) are folded into the same digest
    expect(computePredicateExtrasDigest(humanPredicate)).not.toBe(`0x${"00".repeat(32)}`);
    expect(deriveSettlementNonce(cPrime)).toBe(keccak256(cPrime));
  });

  it("accepts the human's own signature", async () => {
    await expect(
      verifyTypedData({ ...signedTypedData, address: SIGNER, signature: humanSignature }),
    ).resolves.toBe(true);
  });

  for (const [field, substituted] of substitutions) {
    it(`rejects substitution of ${field} under the same predicateId`, async () => {
      const substitutedDigest = computePredicateDigest(substituted);
      expect(substitutedDigest).not.toBe(computePredicateDigest(humanPredicate));

      const substitutedInput = inputFor(substituted);
      expect(substitutedInput.predicateId).toBe(PREDICATE_ID);
      const substitutedTypedData = buildModeBSettlementCommitment(substitutedInput);
      const substitutedCommitment = computeModeBSettlementCommitment(substitutedInput);
      expect(substitutedCommitment).not.toBe(computeModeBSettlementCommitment(inputFor(humanPredicate)));

      // Guard-side effect: the human signature was made over the ORIGINAL C',
      // so it no longer verifies against the substituted predicate's typed data.
      await expect(
        verifyTypedData({ ...substitutedTypedData, address: SIGNER, signature: humanSignature }),
      ).resolves.toBe(false);
    });
  }

  it("rejects the 9.99 settlement under a permissive predicate with the human's ID", async () => {
    const permissive: SpendingPredicate = { ...humanPredicate, maxValue: "10.00" };
    const nine99: SettlementParams = { ...params, value: "9.99", valueAtomic: "9990000" };

    const humanCPrime = computeModeBSettlementCommitment(inputFor(humanPredicate, nine99));
    // This is what the on-chain guard recomputes from the REGISTERED config:
    const guardCPrime = computeModeBSettlementCommitment(inputFor(permissive, nine99));
    expect(guardCPrime).not.toBe(humanCPrime);

    // The human never signed the permissive predicate's C' -> rejection.
    await expect(
      verifyTypedData({
        ...buildModeBSettlementCommitment(inputFor(permissive, nine99)),
        address: SIGNER,
        signature: humanSignature,
      }),
    ).resolves.toBe(false);
  });
});
