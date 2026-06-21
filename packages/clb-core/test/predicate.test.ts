import { describe, expect, test } from "bun:test";
import type { IdentityRef, SettlementParams, SpendingPredicate } from "@clb-acel/schemas";
import { keccak256 } from "viem";
import {
  buildModeBSettlementCommitment,
  computeModeBSettlementCommitment,
  computeSettlementParamsDigest,
  deriveSettlementNonce,
  evaluatePredicate,
  settlementParamsFromExact,
  type ModeBSettlementInput,
} from "../src/index";

const merchant = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const attacker = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

const predicate: SpendingPredicate = {
  allowedAssets: ["USDC", "EURC"],
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
  valueAtomic: "2000000",
  validBefore: "2026-12-30T06:00:00.000Z",
  payerAgentId: "shopping-agent-001",
};

const now = new Date("2026-05-30T05:00:00.000Z");

describe("evaluatePredicate", () => {
  test("passes when concrete params satisfy every constraint", () => {
    const result = evaluatePredicate(predicate, params, now);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test("accepts a checksum-variant payee address", () => {
    const result = evaluatePredicate(predicate, { ...params, payTo: merchant.toLowerCase() }, now);
    expect(result.ok).toBe(true);
  });

  test("flags an asset outside allowedAssets", () => {
    const result = evaluatePredicate(predicate, { ...params, asset: "WETH" }, now);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("ASSET_NOT_ALLOWED");
  });

  test("flags a payee outside allowedPayees", () => {
    const result = evaluatePredicate(predicate, { ...params, payTo: attacker }, now);
    expect(result.violations).toContain("PAYEE_NOT_ALLOWED");
  });

  test("flags a value over maxValue", () => {
    const result = evaluatePredicate(predicate, { ...params, value: "9.99" }, now);
    expect(result.violations).toContain("AMOUNT_EXCEEDS_MAX");
  });

  test("flags settlement after validUntil", () => {
    const result = evaluatePredicate(predicate, params, new Date("2027-01-01T00:00:00.000Z"));
    expect(result.violations).toContain("PREDICATE_EXPIRED");
  });

  test("flags a chain outside allowedChainIds", () => {
    const result = evaluatePredicate(predicate, { ...params, chainId: 1 }, now);
    expect(result.violations).toContain("CHAIN_NOT_ALLOWED");
  });

  test("flags an agent outside allowedAgentIds", () => {
    const result = evaluatePredicate(predicate, { ...params, payerAgentId: "rogue-agent" }, now);
    expect(result.violations).toContain("AGENT_NOT_ALLOWED");
  });

  test("checks taskHash only when the predicate pins one", () => {
    const taskHash = `0x${"a".repeat(64)}` as const;
    const pinned: SpendingPredicate = { ...predicate, taskHash };
    expect(evaluatePredicate(pinned, params, now, taskHash).ok).toBe(true);
    expect(evaluatePredicate(pinned, params, now, `0x${"b".repeat(64)}`).violations).toContain(
      "TASK_HASH_MISMATCH",
    );
    // No predicate.taskHash -> task hash is not enforced.
    expect(evaluatePredicate(predicate, params, now, `0x${"b".repeat(64)}`).ok).toBe(true);
  });
});

describe("Mode B settlement commitment C'", () => {
  const identityRef: IdentityRef = {
    chainId: 84532,
    registryAddr: "0x0000000000000000000000000000000000008004",
    agentId: "shopping-agent-001",
  };
  const input: ModeBSettlementInput = {
    identityRef,
    mandateDigest: `0x${"c".repeat(64)}`,
    predicateId: "predicate-001",
    settlementParams: params,
    domain: { name: "CLB-ACEL", version: "0.1", chainId: 84532 },
  };

  test("is deterministic across recomputation", () => {
    expect(computeModeBSettlementCommitment(input)).toBe(computeModeBSettlementCommitment(input));
  });

  test("nonce = H(C')", () => {
    const commitment = computeModeBSettlementCommitment(input);
    expect(deriveSettlementNonce(commitment)).toBe(keccak256(commitment));
  });

  test("changes when any bound field changes", () => {
    const base = computeModeBSettlementCommitment(input);
    expect(computeModeBSettlementCommitment({ ...input, predicateId: "predicate-002" })).not.toBe(base);
    expect(
      computeModeBSettlementCommitment({
        ...input,
        settlementParams: { ...params, value: "2.01" },
      }),
    ).not.toBe(base);
    expect(
      computeModeBSettlementCommitment({ ...input, mandateDigest: `0x${"d".repeat(64)}` }),
    ).not.toBe(base);
  });

  test("typed-data payload uses the CLBSettlementCommitment primary type", () => {
    const typed = buildModeBSettlementCommitment(input);
    expect(typed.primaryType).toBe("CLBSettlementCommitment");
    expect(typed.message.settlementParamsDigest).toBe(computeSettlementParamsDigest(params));
  });

  test("settlementParamsFromExact lifts an exact descriptor", () => {
    const lifted = settlementParamsFromExact(
      {
        chainId: 84532,
        network: "base-sepolia",
        asset: "USDC",
        payTo: merchant,
        value: "2.00",
        validBefore: "2026-12-30T06:00:00.000Z",
        x402Scheme: "exact",
      },
      "shopping-agent-001",
    );
    expect(lifted).toEqual(params);
  });
});
