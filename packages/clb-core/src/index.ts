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
  parseUnits,
  recoverTypedDataAddress,
  toBytes,
  verifyTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Confidential commit-and-prove (Phase 7F). The curve library is isolated in
// `./confidential`; consumers reach it through this package re-export.
export * from "./confidential";
// RCLB: revocation-aware temporal binding (additive; existing exports unchanged).
export * from "./epochs";

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
    ...(domain.verifyingContract ? { verifyingContract: domain.verifyingContract as Address } : {}),
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
export async function signCommitment(privateKey: Hex, input: CLBCommitmentInput): Promise<Hex> {
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
 *   C' = keccak256(EIP712(identityRef, mandateDigest, predicateId,
 *                          predicateDigest, settlementParamsDigest))
 *   nonce = H(C')
 *
 * `predicateDigest` binds the FULL predicate content, so a permissive predicate
 * registered under a human-signed `predicateId` cannot pass the human's signature.
 * The fixed-size leaves keep off-chain (viem) and on-chain
 * (`PredicatePaymentGuard.sol`) encodings identical. Solidity parity:
 *   IDENTITY_REF_TYPEHASH = keccak256("IdentityRef(uint256 chainId,address registryAddr,string agentId)")
 *   SETTLEMENT_TYPEHASH   = keccak256(
 *     "CLBSettlementCommitment(IdentityRef identityRef,bytes32 mandateDigest,string predicateId,bytes32 predicateDigest,bytes32 settlementParamsDigest)IdentityRef(uint256 chainId,address registryAddr,string agentId)")
 *
 * NOTE: adding `predicateDigest` changes SETTLEMENT_TYPEHASH and therefore every C'.
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
    { name: "predicateDigest", type: "bytes32" },
    { name: "settlementParamsDigest", type: "bytes32" },
  ],
} as const;

const ZERO_BYTES32: Hex = `0x${"00".repeat(32)}`;

/**
 * Digest of the predicate fields the Solidity guard does not store in
 * `PredicateConfig` (agent IDs and optional task hash). Bound into C' so that
 * substituting those fields under the same predicate ID also breaks the human
 * signature. Parity: `keccak256(abi.encode(bytes32[] agentIdHashes, bytes32 taskHash))`.
 */
export function computePredicateExtrasDigest(predicate: SpendingPredicate): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32[]" }, { type: "bytes32" }],
      [
        predicate.allowedAgentIds.map((agentId) => keccak256(toBytes(agentId))),
        (predicate.taskHash ?? ZERO_BYTES32) as Hex,
      ],
    ),
  );
}

/**
 * Layer-1 digest of `PredicateConfig`, byte-identical to Solidity
 * `PredicatePaymentGuard.predicateDigest`. `maxValue` is converted with 6
 * decimals (USDC base units); `validUntil` is truncated to Unix seconds.
 */
export function computePredicateConfigDigest(predicate: SpendingPredicate): Hex {
  // shortcut: maxValue is 6-decimal USDC base-units, matching the guard's maxValueAtomic; upgrade when multi-decimal assets are registered.
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address[]" },
        { type: "bytes32[]" },
        { type: "uint256[]" },
        { type: "uint256" },
        { type: "uint64" },
      ],
      [
        predicate.allowedPayees.map(getAddress),
        predicate.allowedAssets.map((asset) => keccak256(toBytes(asset))),
        predicate.allowedChainIds.map(BigInt),
        parseUnits(predicate.maxValue, 6),
        BigInt(Math.trunc(Date.parse(predicate.validUntil) / 1000)),
      ],
    ),
  );
}

/**
 * Canonical digest of the FULL spending predicate, byte-identical to the
 * Solidity `predicateDigestWithExtras(PredicateConfig, extraFieldsDigest)`.
 * Layer 1 = config digest; layer 2 folds in agent IDs / task hash.
 */
export function computePredicateDigest(predicate: SpendingPredicate): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [computePredicateConfigDigest(predicate), computePredicateExtrasDigest(predicate)],
    ),
  );
}

/** Typehash of the DEMO human registration signature payload (Solidity parity). */
export const PREDICATE_GUARD_BINDING_TYPEHASH = keccak256(
  toBytes(
    "PredicateGuardBinding(string predicateId,bytes32 configDigest,address principal,bytes32 mandateDigest,bytes32 taskHash,bytes32 extraFieldsDigest,uint256 chainId)",
  ),
);

/**
 * EIP-191 digest a human signs to bind a predicate registration to a principal,
 * mandate digest and task hash. Byte-identical to Solidity `bindingDigest`.
 * The extras digest defaults to clb-core's agent-IDs + taskHash encoding.
 */
export function computePredicateGuardBindingDigest(input: {
  predicateId: string;
  predicate: SpendingPredicate;
  principal: Address;
  mandateDigest: Hex;
  taskHash?: Hex;
  extraFieldsDigest?: Hex;
  chainId: number;
}): Hex {
  const extras =
    input.extraFieldsDigest ??
    (input.taskHash !== undefined
      ? keccak256(
          encodeAbiParameters(
            [{ type: "bytes32[]" }, { type: "bytes32" }],
            [
              input.predicate.allowedAgentIds.map((agentId) => keccak256(toBytes(agentId))),
              input.taskHash,
            ],
          ),
        )
      : computePredicateExtrasDigest(input.predicate));
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" }, // typehash
        { type: "bytes32" }, // keccak256(bytes(predicateId))
        { type: "bytes32" }, // config digest
        { type: "address" }, // principal
        { type: "bytes32" }, // mandateDigest
        { type: "bytes32" }, // taskHash
        { type: "bytes32" }, // extraFieldsDigest
        { type: "uint256" }, // domain chainId
      ],
      [
        PREDICATE_GUARD_BINDING_TYPEHASH,
        keccak256(toBytes(input.predicateId)),
        computePredicateConfigDigest(input.predicate),
        input.principal,
        input.mandateDigest,
        input.taskHash ?? ZERO_BYTES32,
        extras,
        BigInt(input.chainId),
      ],
    ),
  );
  // EIP-191 prefix bytes + structHash, concatenated as raw bytes (viem's
  // `concat` re-encodes hex strings as text, so build the hex payload directly).
  return keccak256(
    `0x19457468657265756d205369676e6564204d6573736167653a0a3332${structHash.slice(2)}` as Hex,
  );
}

export const CLB_SETTLEMENT_PRIMARY_TYPE = "CLBSettlementCommitment" as const;

/**
 * ABI-encoded digest of the concrete settlement params. Mirrors
 * `keccak256(abi.encode(chainId, network, asset, payTo, value, valueAtomic, validBefore, payerAgentId))`
 * in Solidity, giving byte-exact parity with the on-chain guard.
 *
 * `valueAtomic` (uint256 base-units) is bound here so the on-chain
 * `PredicatePaymentGuard` compares the SAME quantity it commits to — the
 * human-readable `value` decimal string stays for display/off-chain parity.
 */
export function computeSettlementParamsDigest(params: SettlementParams): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" }, // chainId
        { type: "string" }, // network
        { type: "string" }, // asset
        { type: "address" }, // payTo
        { type: "string" }, // value (decimal display)
        { type: "uint256" }, // valueAtomic (enforced quantity)
        { type: "string" }, // validBefore
        { type: "string" }, // payerAgentId
      ],
      [
        BigInt(params.chainId),
        params.network,
        params.asset,
        getAddress(params.payTo),
        params.value,
        BigInt(params.valueAtomic),
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
  /** The human-signed predicate content bound into C'. Required for the binding. */
  predicate?: SpendingPredicate;
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
      predicateDigest: input.predicate ? computePredicateDigest(input.predicate) : ZERO_BYTES32,
      settlementParamsDigest: computeSettlementParamsDigest(input.settlementParams),
    },
  } as const;
}

/**
 * C' = keccak256(EIP712(identityRef, mandateDigest, predicateId,
 *                       predicateDigest, settlementParamsDigest)).
 */
export function computeModeBSettlementCommitment(input: ModeBSettlementInput): Hex {
  return hashTypedData(buildModeBSettlementCommitment(input));
}

/** Settlement nonce derivation: nonce = H(C'). Alias of {@link deriveNonce}. */
export function deriveSettlementNonce(commitment: Hex): Hex {
  return deriveNonce(commitment);
}

/**
 * Lift an exact settlement descriptor into the concrete params R17 evaluates.
 * `valueAtomic` is derived deterministically from the decimal `value` via
 * `parseUnits(value, decimals)` (default 6 — USDC/EURC base units) so payer and
 * verifier commit to the same integer quantity.
 */
export function settlementParamsFromExact(
  descriptor: SettlementDescriptorExact,
  payerAgentId: string,
  decimals = 6,
): SettlementParams {
  return {
    chainId: descriptor.chainId,
    network: descriptor.network,
    asset: descriptor.asset,
    payTo: descriptor.payTo,
    value: descriptor.value,
    valueAtomic: parseUnits(descriptor.value, decimals).toString(),
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
    details.push(
      `Asset ${params.asset} not in allowedAssets [${predicate.allowedAssets.join(", ")}]`,
    );
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
    details.push(
      `Settlement time ${now.toISOString()} is after validUntil ${predicate.validUntil}`,
    );
  }

  if (!predicate.allowedChainIds.includes(params.chainId)) {
    violations.push("CHAIN_NOT_ALLOWED");
    details.push(
      `Chain ${params.chainId} not in allowedChainIds [${predicate.allowedChainIds.join(", ")}]`,
    );
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
