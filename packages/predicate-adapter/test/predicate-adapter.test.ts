import { describe, expect, test } from "bun:test";
import {
  computeModeBSettlementCommitment,
  deriveSettlementNonce,
  type ModeBSettlementInput,
} from "@clb-acel/clb-core";
import type { SettlementParams, SpendingPredicate } from "@clb-acel/schemas";
import {
  ContractPredicateGuard,
  InMemoryPredicateGuard,
  PredicateViolationError,
  SettlementNonceMismatchError,
  createPredicateGuard,
} from "../src/index";

const merchant = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const attacker = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

const predicate: SpendingPredicate = {
  allowedAssets: ["USDC"],
  allowedPayees: [merchant],
  maxValue: "5.00",
  validUntil: "2026-12-30T06:00:00.000Z",
  allowedChainIds: [84532],
  allowedAgentIds: ["shopping-agent-001"],
};

const params: SettlementParams = {
  chainId: 84532,
  network: "base-sepolia",
  asset: "USDC",
  payTo: merchant,
  value: "2.00",
  validBefore: "2026-12-30T06:00:00.000Z",
  payerAgentId: "shopping-agent-001",
};

const commitmentInput: ModeBSettlementInput = {
  identityRef: {
    chainId: 84532,
    registryAddr: "0x0000000000000000000000000000000000008004",
    agentId: "shopping-agent-001",
  },
  mandateDigest: `0x${"c".repeat(64)}`,
  predicateId: "predicate-001",
  settlementParams: params,
  domain: { name: "CLB-ACEL", version: "0.1", chainId: 84532 },
};

const now = new Date("2026-05-30T05:00:00.000Z");
const expectedNonce = deriveSettlementNonce(computeModeBSettlementCommitment(commitmentInput));

describe("InMemoryPredicateGuard", () => {
  const guard = new InMemoryPredicateGuard();

  test("allows a settlement that satisfies the predicate and nonce", async () => {
    const result = await guard.assertSettlementAllowed({
      predicate,
      params,
      commitment: commitmentInput,
      expectedNonce,
      now,
    });
    expect(result.allowed).toBe(true);
    expect(result.enforcedBy).toBe("in-memory");
    expect(result.nonce).toBe(expectedNonce);
  });

  test("throws PredicateViolationError on a payee violation", async () => {
    await expect(
      guard.assertSettlementAllowed({
        predicate,
        params: { ...params, payTo: attacker },
        commitment: { ...commitmentInput, settlementParams: { ...params, payTo: attacker } },
        now,
      }),
    ).rejects.toBeInstanceOf(PredicateViolationError);
  });

  test("throws SettlementNonceMismatchError on a bad nonce", async () => {
    await expect(
      guard.assertSettlementAllowed({
        predicate,
        params,
        commitment: commitmentInput,
        expectedNonce: `0x${"0".repeat(64)}`,
        now,
      }),
    ).rejects.toBeInstanceOf(SettlementNonceMismatchError);
  });

  test("evaluateOffChain reports violations without throwing", () => {
    const evaluation = guard.evaluateOffChain(predicate, { ...params, value: "99.00" }, now);
    expect(evaluation.ok).toBe(false);
    expect(evaluation.violations).toContain("AMOUNT_EXCEEDS_MAX");
  });
});

describe("ContractPredicateGuard", () => {
  test("rejects when the on-chain reader reports the nonce consumed", async () => {
    const guard = new ContractPredicateGuard({
      address: merchant,
      reader: async () => ({ consumed: true }),
    });
    await expect(
      guard.assertSettlementAllowed({ predicate, params, commitment: commitmentInput, now }),
    ).rejects.toBeInstanceOf(SettlementNonceMismatchError);
  });

  test("allows when the reader reports the nonce fresh", async () => {
    const guard = new ContractPredicateGuard({
      address: merchant,
      reader: async () => ({ consumed: false }),
    });
    const result = await guard.assertSettlementAllowed({
      predicate,
      params,
      commitment: commitmentInput,
      now,
    });
    expect(result.enforcedBy).toBe("contract");
  });
});

describe("createPredicateGuard", () => {
  test("defaults to the in-memory guard with no address", () => {
    expect(createPredicateGuard().kind).toBe("in-memory");
  });

  test("uses the contract guard when an address is provided", () => {
    expect(createPredicateGuard({ address: merchant }).kind).toBe("contract");
  });
});
