import { describe, expect, it } from "bun:test";
import {
  computeModeBSettlementCommitment,
  deriveSettlementNonce,
  type ModeBSettlementInput,
} from "@clb-acel/clb-core";
import type { SettlementParams, SpendingPredicate } from "@clb-acel/schemas";
import {
  ContractPredicateGuard,
  PredicateOnChainRevertError,
  type ContractGuardWriter,
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
  valueAtomic: "2000000",
  validBefore: "2026-12-30T06:00:00.000Z",
  payerAgentId: "shopping-agent-001",
};

function inputFor(p: SettlementParams) {
  const commitment: ModeBSettlementInput = {
    identityRef: {
      chainId: 84532,
      registryAddr: "0x0000000000000000000000000000000000008004",
      agentId: "shopping-agent-001",
    },
    mandateDigest: `0x${"c".repeat(64)}`,
    predicateId: "predicate-001",
    settlementParams: p,
    domain: { name: "CLB-ACEL", version: "0.1", chainId: 84532 },
  };
  return { predicate, params: p, commitment };
}

const happy = inputFor(params);
const badPayee = inputFor({ ...params, payTo: attacker });

describe("ContractPredicateGuard.settleOnChain", () => {
  it("surfaces an on-chain payee revert (not just an off-chain throw)", async () => {
    const writer: ContractGuardWriter = async () => {
      throw new PredicateOnChainRevertError("PayeeNotAllowed");
    };
    const guard = new ContractPredicateGuard({ address: merchant, writer });
    const res = await guard.settleOnChain(badPayee);
    expect(res.reverted).toBe(true);
    expect(res.reason).toBe("PayeeNotAllowed");
    // commitment + nonce are still computed for the artifact
    const expectedNonce = deriveSettlementNonce(
      computeModeBSettlementCommitment(badPayee.commitment),
    );
    expect(res.nonce).toBe(expectedNonce);
  });

  it("returns the tx hash on the happy path", async () => {
    const writer: ContractGuardWriter = async () => ({ txHash: `0x${"ab".repeat(32)}` });
    const guard = new ContractPredicateGuard({ address: merchant, writer });
    const res = await guard.settleOnChain(happy);
    expect(res.reverted).toBe(false);
    expect(res.txHash).toBe(`0x${"ab".repeat(32)}`);
  });

  it("rethrows non-revert errors (real failures are not swallowed)", async () => {
    const writer: ContractGuardWriter = async () => {
      throw new Error("connection refused");
    };
    const guard = new ContractPredicateGuard({ address: merchant, writer });
    await expect(guard.settleOnChain(happy)).rejects.toThrow("connection refused");
  });

  it("throws when no writer is configured", async () => {
    const guard = new ContractPredicateGuard({ address: merchant });
    await expect(guard.settleOnChain(happy)).rejects.toThrow(/writer/i);
  });
});
