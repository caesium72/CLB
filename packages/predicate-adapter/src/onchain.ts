import type { Hex } from "viem";
import { BaseError, ContractFunctionRevertedError, encodeAbiParameters, keccak256 } from "viem";
import {
  PredicateOnChainRevertError,
  type ContractGuardReader,
  type ContractGuardWriter,
} from "./index";

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
      { name: "extraFieldsDigest", type: "bytes32" },
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
    name: "validateAndConsumeBound",
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
      { name: "extraFieldsDigest", type: "bytes32" },
      { name: "agentIdHashes", type: "bytes32[]" },
      { name: "taskHash", type: "bytes32" },
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
    name: "registerPredicateBound",
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
      { name: "principal", type: "address" },
      { name: "mandateDigest", type: "bytes32" },
      { name: "taskHash", type: "bytes32" },
      { name: "extraFieldsDigest", type: "bytes32" },
      { name: "signature", type: "bytes" },
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
    type: "function",
    name: "bindingDigest",
    stateMutability: "view",
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
      { name: "principal", type: "address" },
      { name: "mandateDigest", type: "bytes32" },
      { name: "taskHash", type: "bytes32" },
      { name: "extraFieldsDigest", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
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
  { type: "error", name: "InvalidBindingSignature", inputs: [] },
  { type: "error", name: "PredicateNotBound", inputs: [{ name: "predicateIdHash", type: "bytes32" }] },
  {
    type: "error",
    name: "UnauthorizedRegistrant",
    inputs: [
      { name: "caller", type: "address" },
      { name: "principal", type: "address" },
    ],
  },
  {
    type: "error",
    name: "PrincipalMismatch",
    inputs: [
      { name: "caller", type: "address" },
      { name: "principal", type: "address" },
    ],
  },
  {
    type: "error",
    name: "MandateDigestMismatch",
    inputs: [
      { name: "expected", type: "bytes32" },
      { name: "provided", type: "bytes32" },
    ],
  },
  {
    type: "error",
    name: "TaskHashMismatch",
    inputs: [
      { name: "expected", type: "bytes32" },
      { name: "provided", type: "bytes32" },
    ],
  },
  {
    type: "error",
    name: "ExtrasDigestMismatch",
    inputs: [
      { name: "expected", type: "bytes32" },
      { name: "provided", type: "bytes32" },
    ],
  },
  {
    type: "error",
    name: "ChainIdMismatch",
    inputs: [
      { name: "identityChainId", type: "uint256" },
      { name: "settlementChainId", type: "uint256" },
      { name: "domainChainId", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "AmountMismatch",
    inputs: [
      { name: "value", type: "string" },
      { name: "providedAtomic", type: "uint256" },
      { name: "expectedAtomic", type: "uint256" },
    ],
  },
  { type: "error", name: "InvalidDecimalValue", inputs: [{ name: "value", type: "string" }] },
  {
    type: "function",
    name: "isBound",
    stateMutability: "view",
    inputs: [{ name: "predicateId", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "consumed",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
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

/** PredicateConfig tuple shared by `registerPredicate` / `registerPredicateBound`. */
export type GuardPredicateConfig = {
  allowedPayees: readonly Hex[];
  allowedAssetHashes: readonly Hex[];
  allowedChainIds: readonly bigint[];
  maxValueAtomic: bigint;
  validUntil: bigint;
  registered: boolean;
};

/**
 * Register a predicate through the enforced human-bound path. The guard requires
 * `msg.sender == principal` and an EIP-191 signature by `principal` over
 * `bindingDigest(...)`; a config registered through the legacy `registerPredicate`
 * can never be settled (`validateAndConsume` reverts `PredicateNotBound`).
 *
 * `extraFieldsDigest` must be the digest the settlement path passes (for
 * `ContractPredicateGuard.settleOnChain` that is `computePredicateExtrasDigest`),
 * and `mandateDigest` the one bound into C'.
 */
export async function registerPredicateBound(
  clients: GuardViemClients,
  input: {
    address: Hex;
    predicateId: string;
    config: GuardPredicateConfig;
    principal: Hex;
    mandateDigest: Hex;
    taskHash: Hex;
    extraFieldsDigest: Hex;
  },
): Promise<Hex> {
  const { address, predicateId, config, principal, mandateDigest, taskHash, extraFieldsDigest } =
    input;
  const digest = (await clients.publicClient.readContract({
    address,
    abi: PREDICATE_GUARD_ABI,
    functionName: "bindingDigest",
    args: [predicateId, config, principal, mandateDigest, taskHash, extraFieldsDigest],
  })) as Hex;
  // `bindingDigest` already contains the EIP-191 prefix, so sign the digest itself
  // (`sign({ hash })`); `signMessage({ raw })` would prefix it a second time.
  const signature: Hex = await clients.account.sign({ hash: digest });
  const txHash: Hex = await clients.walletClient.writeContract({
    address,
    abi: PREDICATE_GUARD_ABI,
    functionName: "registerPredicateBound",
    args: [predicateId, config, principal, mandateDigest, taskHash, extraFieldsDigest, signature],
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`registerPredicateBound reverted for "${predicateId}" (tx ${txHash})`);
  }
  return txHash;
}

/**
 * Build a {@link ContractGuardWriter} that broadcasts `validateAndConsume`
 * through viem. On a predicate revert it throws
 * {@link PredicateOnChainRevertError} carrying the Solidity error name; other
 * failures propagate untouched.
 */
export function makeViemGuardWriter(clients: GuardViemClients): ContractGuardWriter {
  return async ({ address, commitment, extraFieldsDigest, cPrime, nonce, binding }) => {
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
    try {
      const request = binding
        ? (
            await clients.publicClient.simulateContract({
              address,
              abi: PREDICATE_GUARD_ABI,
              functionName: "validateAndConsumeBound",
              args: [
                id,
                commitment.mandateDigest,
                commitment.predicateId,
                keccak256(
                  encodeAbiParameters(
                    [{ type: "bytes32[]" }, { type: "bytes32" }],
                    [binding.agentIdHashes, binding.taskHash],
                  ),
                ),
                binding.agentIdHashes,
                binding.taskHash,
                settleParams,
                cPrime,
                nonce,
              ],
              account: clients.account,
            })
          ).request
        : (
            await clients.publicClient.simulateContract({
              address,
              abi: PREDICATE_GUARD_ABI,
              functionName: "validateAndConsume",
              args: [id, commitment.mandateDigest, commitment.predicateId, extraFieldsDigest, settleParams, cPrime, nonce],
              account: clients.account,
            })
          ).request;
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

/**
 * Build a {@link ContractGuardReader} that reads the guard's `consumed` mapping.
 * Used by the e2e harness to prove that a reverted settlement changed no state.
 */
export function makeViemGuardReader(clients: { publicClient: any }): ContractGuardReader {
  return async ({ address, nonce }) => {
    const consumed = await clients.publicClient.readContract({
      address,
      abi: PREDICATE_GUARD_ABI,
      functionName: "consumed",
      args: [nonce],
    });
    return { consumed: Boolean(consumed) };
  };
}
