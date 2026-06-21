import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type ValidationInput = {
  traceId: Hex | string;
  certificateHash: Hex | string;
  result: boolean;
  merkleRoot: Hex | string;
  settlementTxHash: Hex | string;
  responseURI?: string; // evidence/certificate read-back URL (canonical responseURI)
  agentId?: string; // canonical uint256 subject agentId (required for canonical mode)
};
export type ValidationRecord = {
  certificateHash: string;
  result: boolean;
  merkleRoot: string;
  settlementTxHash: string;
  timestamp: number;
};
export type ValidationRegistry = {
  kind: "mock" | "onchain" | "canonical";
  record(input: ValidationInput): Promise<{ txHash?: string }>;
  get(traceId: string): Promise<ValidationRecord | null>;
};

export type ValidationEnv = {
  mode?: "mock" | "onchain" | "canonical";
  rpcUrl?: string;
  chainId?: number;
  validatorAddr?: Address; // our CrossLayerBindingValidator (onchain mode)
  validationRegistryAddr?: Address; // canonical ERC-8004 Validation Registry (canonical mode)
  deployerKey?: Hex;
  // O1: flip to true ONLY after a canonical Validation Registry is confirmed on the target chain.
  canonicalValidationConfirmed?: boolean;
};

// Tag carried into the canonical registry — this IS the new validator-type name.
export const CLB_VALIDATOR_TAG = "CrossLayerBindingValidator";

export function createValidationRegistry(env: ValidationEnv = {}): ValidationRegistry {
  const mode = env.mode ?? (env.validatorAddr && env.rpcUrl ? "onchain" : "mock");

  if (mode === "canonical") {
    // O1 gate — do not write to a registry we have not confirmed exists on this chain.
    // As of 2026-06-05 the canonical ERC-8004 Validation Registry is NOT deployed on Base Sepolia
    // (authoritative erc-8004-contracts deployments list only Identity + Reputation). The writer
    // below is fully wired against the confirmed ABI; flipping the gate is the only change needed.
    if (!env.canonicalValidationConfirmed) {
      throw new Error(
        "canonical validation mode is gated off (open item O1: canonical Validation Registry not confirmed on Base Sepolia). " +
          "Resolve O1 and set canonicalValidationConfirmed=true to enable.",
      );
    }
    return createCanonicalValidationRegistry(env);
  }
  if (mode === "onchain") return createOnchainValidationRegistry(env);
  return createMockValidationRegistry();
}

function createMockValidationRegistry(): ValidationRegistry {
  const store = new Map<string, ValidationRecord>();
  return {
    kind: "mock",
    async record(input) {
      store.set(String(input.traceId), {
        certificateHash: String(input.certificateHash),
        result: input.result,
        merkleRoot: String(input.merkleRoot),
        settlementTxHash: String(input.settlementTxHash),
        timestamp: Date.now(),
      });
      return {};
    },
    async get(traceId) {
      return store.get(traceId) ?? null;
    },
  };
}

function chainFor(rpcUrl: string, chainId: number) {
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

// onchain: write/read our CrossLayerBindingValidator (ABI fully known from contracts/Task 1).
const CLB_VALIDATOR_ABI = [
  {
    type: "function",
    name: "recordValidation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "traceId", type: "bytes32" },
      { name: "certificateHash", type: "bytes32" },
      { name: "result", type: "bool" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "settlementTxHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getValidation",
    stateMutability: "view",
    inputs: [{ name: "traceId", type: "bytes32" }],
    outputs: [
      { name: "certificateHash", type: "bytes32" },
      { name: "result", type: "bool" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "settlementTxHash", type: "bytes32" },
      { name: "timestamp", type: "uint256" },
    ],
  },
] as const;

function createOnchainValidationRegistry(env: ValidationEnv): ValidationRegistry {
  if (!env.rpcUrl || !env.validatorAddr) {
    throw new Error("onchain validation requires rpcUrl + validatorAddr");
  }
  const chainId = env.chainId ?? 84532;
  const chain = chainFor(env.rpcUrl, chainId);
  const publicClient = createPublicClient({ chain, transport: http(env.rpcUrl) });
  const address = env.validatorAddr;
  return {
    kind: "onchain",
    async record(input) {
      if (!env.deployerKey) throw new Error("onchain validation write requires deployerKey");
      const wallet = createWalletClient({
        chain,
        transport: http(env.rpcUrl),
        account: privateKeyToAccount(env.deployerKey),
      });
      const txHash = await wallet.writeContract({
        address,
        abi: CLB_VALIDATOR_ABI,
        functionName: "recordValidation",
        args: [
          input.traceId as Hex,
          input.certificateHash as Hex,
          input.result,
          input.merkleRoot as Hex,
          input.settlementTxHash as Hex,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return { txHash };
    },
    async get(traceId) {
      const [certificateHash, result, merkleRoot, settlementTxHash, timestamp] =
        await publicClient.readContract({
          address,
          abi: CLB_VALIDATOR_ABI,
          functionName: "getValidation",
          args: [traceId as Hex],
        });
      if (Number(timestamp) === 0) return null;
      return {
        certificateHash,
        result,
        merkleRoot,
        settlementTxHash,
        timestamp: Number(timestamp),
      };
    },
  };
}

// canonical: the real ERC-8004 Validation Registry ABI (confirmed against the authoritative
// erc-8004-contracts abis/ValidationRegistry.json + ValidationRegistryUpgradeable.sol). All
// canonical-registry ABI specifics live HERE (one-file blast radius). The writer is fully wired
// but UNREACHABLE by default — createValidationRegistry throws above unless O1 is explicitly
// confirmed, because no canonical Validation Registry is deployed on Base Sepolia yet.
const CANONICAL_VALIDATION_ABI = [
  {
    type: "function",
    name: "validationRequest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "validatorAddress", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "requestURI", type: "string" },
      { name: "requestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "validationResponse",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestHash", type: "bytes32" },
      { name: "response", type: "uint8" },
      { name: "responseURI", type: "string" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getValidationStatus",
    stateMutability: "view",
    inputs: [{ name: "requestHash", type: "bytes32" }],
    outputs: [
      { name: "validatorAddress", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "response", type: "uint8" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "string" },
      { name: "lastUpdate", type: "uint256" },
    ],
  },
] as const;

/**
 * Canonical ERC-8004 Validation Registry writer (GATED — see createValidationRegistry).
 *
 * Certificate → canonical mapping (feasibility doc §3.2):
 *   validationRequest(validator, agentId, requestURI, requestHash=certificateHash)  — by owner/operator
 *   validationResponse(requestHash, response=result?100:0, responseURI, responseHash=merkleRoot,
 *                      tag=CLB_VALIDATOR_TAG)                                        — by the named validator
 * Read-back keys on requestHash (== certificateHash) via getValidationStatus.
 */
function createCanonicalValidationRegistry(env: ValidationEnv): ValidationRegistry {
  if (!env.rpcUrl || !env.validationRegistryAddr) {
    throw new Error("canonical validation requires rpcUrl + validationRegistryAddr");
  }
  const chainId = env.chainId ?? 84532;
  const chain = chainFor(env.rpcUrl, chainId);
  const publicClient = createPublicClient({ chain, transport: http(env.rpcUrl) });
  const address = env.validationRegistryAddr;
  return {
    kind: "canonical",
    async record(input) {
      if (!env.deployerKey) throw new Error("canonical validation write requires deployerKey");
      if (!input.agentId) throw new Error("canonical validation requires the subject agentId");
      const account = privateKeyToAccount(env.deployerKey);
      const wallet = createWalletClient({ chain, transport: http(env.rpcUrl), account });
      const agentId = BigInt(input.agentId);
      const requestHash = input.certificateHash as Hex;
      const responseURI = input.responseURI ?? "";
      // 1. owner/operator opens the request, naming our validator (the deployer EOA here).
      const reqTx = await wallet.writeContract({
        address,
        abi: CANONICAL_VALIDATION_ABI,
        functionName: "validationRequest",
        args: [account.address, agentId, responseURI, requestHash],
      });
      await publicClient.waitForTransactionReceipt({ hash: reqTx });
      // 2. the named validator submits the response (response ∈ 0..100; 100 = PASS).
      const respTx = await wallet.writeContract({
        address,
        abi: CANONICAL_VALIDATION_ABI,
        functionName: "validationResponse",
        args: [requestHash, input.result ? 100 : 0, responseURI, input.merkleRoot as Hex, CLB_VALIDATOR_TAG],
      });
      await publicClient.waitForTransactionReceipt({ hash: respTx });
      return { txHash: respTx };
    },
    async get(traceId) {
      // Canonical is keyed by requestHash (== certificateHash). Callers that index by traceId must
      // pass the certificateHash here; the verifier-service stores that linkage alongside the trace.
      const [, , response, responseHash, , lastUpdate] = await publicClient.readContract({
        address,
        abi: CANONICAL_VALIDATION_ABI,
        functionName: "getValidationStatus",
        args: [traceId as Hex],
      });
      if (Number(lastUpdate) === 0) return null;
      return {
        certificateHash: traceId,
        result: Number(response) >= 100,
        merkleRoot: responseHash,
        settlementTxHash: "",
        timestamp: Number(lastUpdate),
      };
    },
  };
}
