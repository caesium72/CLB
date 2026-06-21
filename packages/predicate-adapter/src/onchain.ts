import type { Hex } from "viem";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { PredicateOnChainRevertError, type ContractGuardWriter } from "./index";

/**
 * Minimal ABI for `PredicatePaymentGuard` — only the members the off-chain
 * writer / e2e need: `validateAndConsume`, `registerPredicate`, `isRegistered`,
 * plus the typed errors so viem can decode a revert back to its Solidity name.
 * Kept hand-written (not imported from `contracts/out`) so the package has no
 * build-time dependency on a Foundry artifact.
 */
export const PREDICATE_GUARD_ABI = [
  {
    type: "function",
    name: "validateAndConsume",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "id",
        type: "tuple",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "registryAddr", type: "address" },
          { name: "agentId", type: "string" },
        ],
      },
      { name: "mandateDigest", type: "bytes32" },
      { name: "predicateId", type: "string" },
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "network", type: "string" },
          { name: "asset", type: "string" },
          { name: "payTo", type: "address" },
          { name: "value", type: "string" },
          { name: "valueAtomic", type: "uint256" },
          { name: "validBefore", type: "string" },
          { name: "payerAgentId", type: "string" },
        ],
      },
      { name: "commitment", type: "bytes32" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "registerPredicate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "predicateId", type: "string" },
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "allowedPayees", type: "address[]" },
          { name: "allowedAssetHashes", type: "bytes32[]" },
          { name: "allowedChainIds", type: "uint256[]" },
          { name: "maxValueAtomic", type: "uint256" },
          { name: "validUntil", type: "uint64" },
          { name: "registered", type: "bool" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isRegistered",
    stateMutability: "view",
    inputs: [{ name: "predicateId", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "error",
    name: "PredicateNotRegistered",
    inputs: [{ name: "predicateIdHash", type: "bytes32" }],
  },
  { type: "error", name: "NonceAlreadyConsumed", inputs: [{ name: "nonce", type: "bytes32" }] },
  {
    type: "error",
    name: "CommitmentMismatch",
    inputs: [
      { name: "expected", type: "bytes32" },
      { name: "provided", type: "bytes32" },
    ],
  },
  {
    type: "error",
    name: "NonceMismatch",
    inputs: [
      { name: "expected", type: "bytes32" },
      { name: "provided", type: "bytes32" },
    ],
  },
  { type: "error", name: "PayeeNotAllowed", inputs: [{ name: "payTo", type: "address" }] },
  { type: "error", name: "AssetNotAllowed", inputs: [{ name: "asset", type: "string" }] },
  { type: "error", name: "ChainNotAllowed", inputs: [{ name: "chainId", type: "uint256" }] },
  {
    type: "error",
    name: "AmountExceedsMax",
    inputs: [
      { name: "valueAtomic", type: "uint256" },
      { name: "maxValueAtomic", type: "uint256" },
    ],
  },
  { type: "error", name: "PredicateExpired", inputs: [{ name: "validUntil", type: "uint64" }] },
] as const;

/** Extract the Solidity custom-error name from a viem contract revert, if any. */
export function extractRevertName(error: unknown): string | undefined {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.reason ?? undefined;
    }
  }
  return undefined;
}

/** A minimal viem client surface the writer needs (public + wallet). */
export type GuardViemClients = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  walletClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  account: any;
};

/**
 * Build a {@link ContractGuardWriter} that broadcasts
 * `validateAndConsume` through viem. On a predicate revert it throws
 * {@link PredicateOnChainRevertError} carrying the Solidity error name; other
 * failures propagate untouched.
 */
export function makeViemGuardWriter(clients: GuardViemClients): ContractGuardWriter {
  return async ({ address, commitment, cPrime, nonce }) => {
    const id = {
      chainId: BigInt(commitment.identityRef.chainId),
      registryAddr: commitment.identityRef.registryAddr as Hex,
      agentId: commitment.identityRef.agentId,
    };
    const p = commitment.settlementParams;
    const settleParams = {
      chainId: BigInt(p.chainId),
      network: p.network,
      asset: p.asset,
      payTo: p.payTo as Hex,
      value: p.value,
      valueAtomic: BigInt(p.valueAtomic),
      validBefore: p.validBefore,
      payerAgentId: p.payerAgentId,
    };
    const args = [
      id,
      commitment.mandateDigest,
      commitment.predicateId,
      settleParams,
      cPrime,
      nonce,
    ] as const;
    try {
      const { request } = await clients.publicClient.simulateContract({
        address,
        abi: PREDICATE_GUARD_ABI,
        functionName: "validateAndConsume",
        args,
        account: clients.account,
      });
      const txHash: Hex = await clients.walletClient.writeContract(request);
      await clients.publicClient.waitForTransactionReceipt({ hash: txHash });
      return { txHash };
    } catch (error) {
      const name = extractRevertName(error);
      if (name) throw new PredicateOnChainRevertError(name);
      throw error;
    }
  };
}
