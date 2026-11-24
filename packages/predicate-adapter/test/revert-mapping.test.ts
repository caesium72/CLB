import { describe, expect, it } from "bun:test";
import {
  computeModeBSettlementCommitment,
  deriveSettlementNonce,
  type ModeBSettlementInput,
} from "@clb-acel/clb-core";
import type { SettlementParams, SpendingPredicate } from "@clb-acel/schemas";
import type { Hex } from "viem";
import {
  ContractPredicateGuard,
  MockGuardChain,
  MOCK_TX_HASH,
  mockConfigFromPredicate,
} from "../src/index";

const merchant = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const attacker = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const address = merchant as Hex;
const nowSec = BigInt(Math.floor(Date.parse("2026-05-30T05:00:05.000Z") / 1000));

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

function inputFor(p: SettlementParams, predicateId = "predicate-001") {
  const commitment: ModeBSettlementInput = {
    identityRef: {
      chainId: 84532,
      registryAddr: "0x0000000000000000000000000000000000008004",
      agentId: "shopping-agent-001",
    },
    mandateDigest: `0x${"c".repeat(64)}`,
    predicateId,
    settlementParams: p,
    domain: { name: "CLB-ACEL", version: "0.1", chainId: 84532 },
  };
  return { predicate, params: p, commitment };
}

function chainWith(configPredicate = predicate) {
  const chain = new MockGuardChain({ nowSec });
  chain.register("predicate-001", mockConfigFromPredicate(configPredicate));
  const guard = new ContractPredicateGuard({
    address,
    writer: chain.writer,
    reader: chain.reader,
  });
  return { chain, guard };
}

describe("Solidity revert-name mapping via contract-faithful mock", () => {
  it("maps a payee violation to reverted:true / PayeeNotAllowed with no state change", async () => {
    const { chain, guard } = chainWith();
    const input = inputFor({ ...params, payTo: attacker });
    const result = await guard.settleOnChain(input);

    expect(result.reverted).toBe(true);
    expect(result.reason).toBe("PayeeNotAllowed");
    expect(result.txHash).toBeUndefined();
    const nonce = deriveSettlementNonce(computeModeBSettlementCommitment(input.commitment));
    expect(result.nonce).toBe(nonce);
    expect((await chain.reader({ address, commitment: result.commitment, nonce })).consumed).toBe(false);
  });

  it("maps an over-limit settlement to AmountExceedsMax", async () => {
    const { guard } = chainWith();
    const result = await guard.settleOnChain(
      inputFor({ ...params, value: "9.99", valueAtomic: "9990000" }),
    );
    expect(result.reverted).toBe(true);
    expect(result.reason).toBe("AmountExceedsMax");
  });

  it("maps a tampered commitment to CommitmentMismatch at the writer boundary", async () => {
    const { chain } = chainWith();
    const input = inputFor(params);
    const correct = computeModeBSettlementCommitment(input.commitment);
    const tampered = `0x${"d".repeat(64)}` as Hex;
    expect(tampered).not.toBe(correct);
    await expect(
      chain.writer({
        address,
        commitment: input.commitment,
        cPrime: tampered,
        nonce: deriveSettlementNonce(correct),
      }),
    ).rejects.toMatchObject({ errorName: "CommitmentMismatch" });
  });

  it("consumes the nonce once on the happy path and rejects the replay", async () => {
    const { chain, guard } = chainWith();
    const input = inputFor(params);
    const first = await guard.settleOnChain(input);
    expect(first.reverted).toBe(false);
    expect(first.txHash).toBe(MOCK_TX_HASH);

    const replay = await guard.settleOnChain(input);
    expect(replay.reverted).toBe(true);
    expect(replay.reason).toBe("NonceAlreadyConsumed");
    expect(replay.nonce).toBe(first.nonce);
  });

  it("maps an expired predicate to PredicateExpired", async () => {
    const { guard } = chainWith({
      ...predicate,
      validUntil: "2026-05-30T04:00:00.000Z",
    });
    const result = await guard.settleOnChain(inputFor(params));
    expect(result).toMatchObject({ reverted: true, reason: "PredicateExpired" });
  });
});
