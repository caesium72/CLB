import { describe, expect, test } from "bun:test";
import {
  MandateConstraintsSchema,
  PredicateDescriptorSchema,
  SettlementParamsSchema,
  SpendingPredicateSchema,
} from "../src/index";

const merchant = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const attacker = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

const predicate = {
  allowedAssets: ["USDC", "EURC"],
  allowedPayees: [merchant],
  maxValue: "5.00",
  validUntil: "2026-12-30T06:00:00.000Z",
  allowedChainIds: [84532, 8453],
  allowedAgentIds: ["shopping-agent-001"],
  taskHash: `0x${"a".repeat(64)}`,
};

const settlementParams = {
  chainId: 84532,
  network: "base-sepolia",
  asset: "USDC",
  payTo: merchant,
  value: "2.00",
  validBefore: "2026-12-30T06:00:00.000Z",
  payerAgentId: "shopping-agent-001",
};

describe("SpendingPredicateSchema", () => {
  test("round-trips a valid predicate", () => {
    const parsed = SpendingPredicateSchema.parse(predicate);
    expect(parsed).toEqual(predicate);
  });

  test("allows omitting the optional taskHash", () => {
    const { taskHash: _taskHash, ...rest } = predicate;
    void _taskHash;
    expect(() => SpendingPredicateSchema.parse(rest)).not.toThrow();
  });

  test("rejects a non-address payee", () => {
    expect(() =>
      SpendingPredicateSchema.parse({ ...predicate, allowedPayees: ["not-an-address"] }),
    ).toThrow();
  });

  test("rejects a non-positive chain id", () => {
    expect(() =>
      SpendingPredicateSchema.parse({ ...predicate, allowedChainIds: [0] }),
    ).toThrow();
  });
});

describe("PredicateDescriptorSchema", () => {
  test("round-trips a valid descriptor", () => {
    const descriptor = { predicateId: "predicate-001", predicate, x402Scheme: "predicate" as const };
    expect(PredicateDescriptorSchema.parse(descriptor)).toEqual(descriptor);
  });

  test("rejects the exact scheme literal", () => {
    expect(() =>
      PredicateDescriptorSchema.parse({ predicateId: "p", predicate, x402Scheme: "exact" }),
    ).toThrow();
  });
});

describe("SettlementParamsSchema", () => {
  test("round-trips concrete settlement params", () => {
    expect(SettlementParamsSchema.parse(settlementParams)).toEqual(settlementParams);
  });

  test("rejects a non-address payTo", () => {
    expect(() =>
      SettlementParamsSchema.parse({ ...settlementParams, payTo: attacker.slice(0, 10) }),
    ).toThrow();
  });

  test("requires a payerAgentId", () => {
    const { payerAgentId: _payerAgentId, ...rest } = settlementParams;
    void _payerAgentId;
    expect(() => SettlementParamsSchema.parse(rest)).toThrow();
  });
});

describe("MandateConstraintsSchema predicateRef", () => {
  test("accepts an INTENT mandate predicate link", () => {
    const constraints = {
      maxAmount: "5.00",
      allowedAssets: ["USDC"],
      allowedPayees: [merchant],
      validUntil: "2026-12-30T06:00:00.000Z",
      predicateRef: { predicateId: "predicate-001" },
    };
    expect(MandateConstraintsSchema.parse(constraints)).toEqual(constraints);
  });

  test("remains valid without a predicateRef (Mode A)", () => {
    const constraints = { maxAmount: "2.00", allowedAssets: ["USDC"], allowedPayees: [merchant] };
    expect(() => MandateConstraintsSchema.parse(constraints)).not.toThrow();
  });

  test("rejects an empty predicateId", () => {
    expect(() =>
      MandateConstraintsSchema.parse({ predicateRef: { predicateId: "" } }),
    ).toThrow();
  });
});
