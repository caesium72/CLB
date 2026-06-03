import { canonicalJson } from "@clb-acel/evidence-core";
import type {
  CLBCommitmentInput,
  IdentityRef,
  Mandate,
  PredicateDescriptor,
  SettlementDescriptorExact,
  SettlementParams,
  SpendingPredicate,
} from "@clb-acel/schemas";
import {
  type Address,
  type Hex,
  type TypedDataDomain,
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  toBytes,
  verifyTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * EIP-712 type definitions for the Cross-Layer Binding commitment.
 *
 * The commitment binds the three protocol layers by their digests so the same
 * structure is signable off-chain (viem) and recomputable on-chain (Solidity)
 * without embedding variable-length protocol payloads in the typed data.
 */
export const CLB_TYPED_DATA_TYPES = {
  IdentityRef: [
    { name: "chainId", type: "uint256" },
    { name: "registryAddr", type: "address" },
    { name: "agentId", type: "string" },
  ],
  CLBCommitment: [
    { name: "identityRef", type: "IdentityRef" },
    { name: "mandateDigest", type: "bytes32" },
    { name: "settlementDigest", type: "bytes32" },
  ],
} as const;

export const CLB_PRIMARY_TYPE = "CLBCommitment" as const;

/** keccak256 over the canonical JSON encoding of any value. */
export function keccakCanonical(value: unknown): Hex {
  return keccak256(toBytes(canonicalJson(value)));
}

/**
 * Mandate digest = AP2 authorization content hash, reused (not replaced) by CLB.
 * Excludes the signature and the derived `clbCommitment` so the digest is stable
 * across the sign/verify round trip.
 */
export function computeMandateDigest(mandate: Mandate): Hex {
  const { signature: _signature, clbCommitment: _clbCommitment, ...authorization } = mandate;
  void _signature;
  void _clbCommitment;
  return keccakCanonical(authorization);
}

/** Digest of the full settlement descriptor (exact or predicate). */
export function computeSettlementDigest(
  descriptor: SettlementDescriptorExact | PredicateDescriptor,
): Hex {
  return keccakCanonical(descriptor);
}

function toTypedDataDomain(domain: CLBCommitmentInput["domain"]): TypedDataDomain {
  return {
    name: domain.name,
    version: domain.version,
    chainId: domain.chainId,
    ...(domain.verifyingContract
      ? { verifyingContract: domain.verifyingContract as Address }
      : {}),
  };
}

/** Build the EIP-712 typed-data payload for a commitment input. */
export function buildClbTypedData(input: CLBCommitmentInput) {
  return {
    domain: toTypedDataDomain(input.domain),
    types: CLB_TYPED_DATA_TYPES,
    primaryType: CLB_PRIMARY_TYPE,
    message: {
      identityRef: {
        chainId: BigInt(input.identityRef.chainId),
        registryAddr: input.identityRef.registryAddr as Address,
        agentId: input.identityRef.agentId,
      },
      mandateDigest: input.mandateDigest as Hex,
      settlementDigest: computeSettlementDigest(input.settlementDescriptor),
    },
  } as const;
}

/** C = keccak256(EIP712(identityRef, mandateDigest, settlementDescriptor)). */
export function computeCommitment(input: CLBCommitmentInput): Hex {
  return hashTypedData(buildClbTypedData(input));
}

/** Payment nonce derivation: nonce = H(C). */
export function deriveNonce(commitment: Hex): Hex {
  return keccak256(commitment);
}

/** Sign the commitment as EIP-712 typed data with a raw private key. */
export async function signCommitment(
  privateKey: Hex,
  input: CLBCommitmentInput,
): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData(buildClbTypedData(input));
}

/** Recover the signer address from a commitment signature. */
export async function recoverCommitmentSigner(
  input: CLBCommitmentInput,
  signature: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({ ...buildClbTypedData(input), signature });
}

/** Verify a commitment signature against an expected signer address. */
export async function verifyCommitmentSignature(
  input: CLBCommitmentInput,
  signature: Hex,
  expectedSigner: Address,
): Promise<boolean> {
  return verifyTypedData({
    ...buildClbTypedData(input),
    address: expectedSigner,
    signature,
  });
}

export type ComputedCommitment = {
  commitment: Hex;
  nonce: Hex;
  settlementDigest: Hex;
};

/** Convenience: compute the commitment, derived nonce, and settlement digest together. */
export function deriveCommitment(input: CLBCommitmentInput): ComputedCommitment {
  const commitment = computeCommitment(input);
  return {
    commitment,
    nonce: deriveNonce(commitment),
    settlementDigest: computeSettlementDigest(input.settlementDescriptor),
  };
}

// ---------------------------------------------------------------------------
// Mode B (delegated / predicate) settlement-time commitment C'
// ---------------------------------------------------------------------------

/**
 * EIP-712 type for the settlement-time commitment C'. Unlike Mode A's C (which
 * binds an exact descriptor at authorization time), C' is bound when the agent
 * picks concrete settlement params within the human-signed predicate:
 *
 *   C' = keccak256(EIP712(identityRef, mandateDigest, predicateId, settlementParamsDigest))
 *   nonce = H(C')
 *
 * The fixed-size leaves keep off-chain (viem) and on-chain
 * (`PredicatePaymentGuard.sol`) encodings identical. Solidity parity:
 *   IDENTITY_REF_TYPEHASH = keccak256("IdentityRef(uint256 chainId,address registryAddr,string agentId)")
 *   SETTLEMENT_TYPEHASH   = keccak256(
 *     "CLBSettlementCommitment(IdentityRef identityRef,bytes32 mandateDigest,string predicateId,bytes32 settlementParamsDigest)IdentityRef(uint256 chainId,address registryAddr,string agentId)")
 */
export const CLB_SETTLEMENT_TYPED_DATA_TYPES = {
  IdentityRef: [
    { name: "chainId", type: "uint256" },
    { name: "registryAddr", type: "address" },
    { name: "agentId", type: "string" },
  ],
  CLBSettlementCommitment: [
    { name: "identityRef", type: "IdentityRef" },
    { name: "mandateDigest", type: "bytes32" },
    { name: "predicateId", type: "string" },
    { name: "settlementParamsDigest", type: "bytes32" },
  ],
} as const;

export const CLB_SETTLEMENT_PRIMARY_TYPE = "CLBSettlementCommitment" as const;

/**
 * ABI-encoded digest of the concrete settlement params. Mirrors
 * `keccak256(abi.encode(chainId, network, asset, payTo, value, validBefore, payerAgentId))`
 * in Solidity, giving byte-exact parity with the on-chain guard.
 */
export function computeSettlementParamsDigest(params: SettlementParams): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "string" },
        { type: "string" },
        { type: "address" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
      ],
      [
        BigInt(params.chainId),
        params.network,
        params.asset,
        getAddress(params.payTo),
        params.value,
        params.validBefore,
        params.payerAgentId,
      ],
    ),
  );
}

export type ModeBSettlementInput = {
  identityRef: IdentityRef;
  mandateDigest: Hex;
  predicateId: string;
  settlementParams: SettlementParams;
  domain: CLBCommitmentInput["domain"];
};

/** Build the EIP-712 typed-data payload for C' (settlement-time commitment). */
export function buildModeBSettlementCommitment(input: ModeBSettlementInput) {
  return {
    domain: toTypedDataDomain(input.domain),
    types: CLB_SETTLEMENT_TYPED_DATA_TYPES,
    primaryType: CLB_SETTLEMENT_PRIMARY_TYPE,
    message: {
      identityRef: {
        chainId: BigInt(input.identityRef.chainId),
        registryAddr: input.identityRef.registryAddr as Address,
        agentId: input.identityRef.agentId,
      },
      mandateDigest: input.mandateDigest,
      predicateId: input.predicateId,
      settlementParamsDigest: computeSettlementParamsDigest(input.settlementParams),
    },
  } as const;
}

/** C' = keccak256(EIP712(identityRef, mandateDigest, predicateId, settlementParamsDigest)). */
export function computeModeBSettlementCommitment(input: ModeBSettlementInput): Hex {
  return hashTypedData(buildModeBSettlementCommitment(input));
}

/** Settlement nonce derivation: nonce = H(C'). Alias of {@link deriveNonce}. */
export function deriveSettlementNonce(commitment: Hex): Hex {
  return deriveNonce(commitment);
}

/** Lift an exact settlement descriptor into the concrete params R17 evaluates. */
export function settlementParamsFromExact(
  descriptor: SettlementDescriptorExact,
  payerAgentId: string,
): SettlementParams {
  return {
    chainId: descriptor.chainId,
    network: descriptor.network,
    asset: descriptor.asset,
    payTo: descriptor.payTo,
    value: descriptor.value,
    validBefore: descriptor.validBefore,
    payerAgentId,
  };
}

export type PredicateViolationCode =
  | "ASSET_NOT_ALLOWED"
  | "PAYEE_NOT_ALLOWED"
  | "AMOUNT_EXCEEDS_MAX"
  | "PREDICATE_EXPIRED"
  | "CHAIN_NOT_ALLOWED"
  | "AGENT_NOT_ALLOWED"
  | "TASK_HASH_MISMATCH";

export type PredicateEvalResult = {
  ok: boolean;
  violations: PredicateViolationCode[];
  details: string[];
};

function sameAddr(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

/**
 * Evaluate a human-signed spending predicate against the concrete settlement
 * params the agent chose (CONTEXT §7 / §13.3). Pure and deterministic; shared
 * by the in-process guard, the x402 predicate settle path, and verifier R17.
 *
 * @param observedTaskHash actual task hash of the settlement (e.g.
 *   `report.inputDataHash`); only compared when the predicate pins a `taskHash`.
 */
export function evaluatePredicate(
  predicate: SpendingPredicate,
  params: SettlementParams,
  now: Date = new Date(),
  observedTaskHash?: Hex,
): PredicateEvalResult {
  const violations: PredicateViolationCode[] = [];
  const details: string[] = [];

  if (!predicate.allowedAssets.includes(params.asset)) {
    violations.push("ASSET_NOT_ALLOWED");
    details.push(`Asset ${params.asset} not in allowedAssets [${predicate.allowedAssets.join(", ")}]`);
  }

  if (!predicate.allowedPayees.some((payee) => sameAddr(payee, params.payTo))) {
    violations.push("PAYEE_NOT_ALLOWED");
    details.push(`Payee ${params.payTo} not in allowedPayees`);
  }

  const value = Number(params.value);
  const max = Number(predicate.maxValue);
  if (!Number.isFinite(value) || !Number.isFinite(max) || value > max) {
    violations.push("AMOUNT_EXCEEDS_MAX");
    details.push(`Value ${params.value} exceeds maxValue ${predicate.maxValue}`);
  }

  const validUntil = Date.parse(predicate.validUntil);
  if (Number.isNaN(validUntil) || now.getTime() > validUntil) {
    violations.push("PREDICATE_EXPIRED");
    details.push(`Settlement time ${now.toISOString()} is after validUntil ${predicate.validUntil}`);
  }

  if (!predicate.allowedChainIds.includes(params.chainId)) {
    violations.push("CHAIN_NOT_ALLOWED");
    details.push(`Chain ${params.chainId} not in allowedChainIds [${predicate.allowedChainIds.join(", ")}]`);
  }

  if (!predicate.allowedAgentIds.includes(params.payerAgentId)) {
    violations.push("AGENT_NOT_ALLOWED");
    details.push(`Agent ${params.payerAgentId} not in allowedAgentIds`);
  }

  if (predicate.taskHash !== undefined && observedTaskHash !== predicate.taskHash) {
    violations.push("TASK_HASH_MISMATCH");
    details.push(`Observed task hash ${observedTaskHash ?? "<none>"} != predicate taskHash`);
  }

  return { ok: violations.length === 0, violations, details };
}
