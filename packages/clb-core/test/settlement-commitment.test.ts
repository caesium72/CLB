import { describe, expect, it } from "bun:test";
import type { SettlementParams } from "@clb-acel/schemas";
import { computeSettlementParamsDigest } from "../src/index";

// Canonical vector — must stay byte-identical to the Solidity GOLDEN_* constants
// in contracts/test/PredicatePaymentGuard.t.sol (TS<->Solidity parity anchor).
const base: SettlementParams = {
  chainId: 84532,
  network: "base-sepolia",
  asset: "USDC",
  payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  value: "2.00",
  valueAtomic: "2000000", // 2 USDC, 6 decimals — NOW part of the digest (uint256)
  validBefore: "2026-12-30T06:00:00.000Z",
  payerAgentId: "shopping-agent-001",
};

describe("computeSettlementParamsDigest valueAtomic binding", () => {
  it("digest depends on valueAtomic (not just the decimal string)", () => {
    const d1 = computeSettlementParamsDigest(base);
    const d2 = computeSettlementParamsDigest({ ...base, valueAtomic: "3000000" });
    expect(d1).not.toEqual(d2);
  });

  it("digest is stable for a frozen vector (TS<->Solidity parity anchor)", () => {
    expect(computeSettlementParamsDigest(base)).toBe(
      "0x31c3a08746fb658e8a0b0e70c47cd5cca15a72c6ec13868552188ab7b64474c8",
    );
  });
});
