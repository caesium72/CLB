import { type Hex, encodeAbiParameters, keccak256 } from "viem";

/**
 * RCLB — Revocation-Aware Temporal Cross-Layer Binding.
 *
 * A normal CLB commitment C (or C') is a cryptographic binding over the
 * authorization content. It says nothing about whether the identity key or the
 * mandate that produced it is still CURRENT when settlement executes. An
 * attacker who keeps a signed message can therefore replay it after revocation
 * and every layer-local check still passes.
 *
 * This module adds a second, short-lived binding around C:
 *
 *   C_t = keccak256(abi.encode(bytes32 C, uint256 E_I, uint256 E_M,
 *                              uint64 T_expiry, bytes32 N))
 *
 * EXACT CONSTRUCTION (shared with `RevocationAwareGuard.sol`):
 *   1. `C`      = 32-byte base commitment from clb-core (`computeCommitment` for
 *                 Mode A, `computeModeBSettlementCommitment` for Mode B).
 *   2. `E_I`    = current identity-authorization epoch at signing time.
 *   3. `E_M`    = current mandate-revocation epoch at signing time.
 *   4. `T_expiry` = Unix seconds, INCLUSIVE upper bound on settlement time.
 *   5. `N`      = 32-byte application nonce, distinct from the payment nonce
 *                 `H(C_t)`; it is the single-use token checked at execution.
 *   The five fields are `abi.encode`d (static, padded, big-endian) and hashed
 *   with keccak256 — the same digest style used by `computePredicateDigest`.
 *   No EIP-712 domain is folded into C_t itself; the base C/C' already carries
 *   the CLB EIP-712 domain, so re-binding it would double-count the domain.
 *
 * Payment nonce derivation remains `nonce = keccak256(commitment)`, now applied
 * to C_t rather than C, so x402 replay semantics are unchanged.
 */

/** Monotonic authority epoch counter. 0 is a valid initial epoch. */
export type Epoch = bigint;

/** Human-readable schema string, exposed for cross-language parity tests. */
export const REVOCATION_AWARE_COMMITMENT_SCHEMA =
  "RevocationAwareCommitment(bytes32 baseCommitment,uint256 identityEpoch,uint256 mandateEpoch,uint64 expiry,bytes32 nonce)";

export type RevocationAwareCommitmentFields = {
  /** C or C' produced by the existing clb-core commitment functions. */
  baseCommitment: Hex;
  /** E_I: identity-authorization epoch bound into C_t. */
  identityEpoch: Epoch;
  /** E_M: mandate-revocation epoch bound into C_t. */
  mandateEpoch: Epoch;
  /** T_expiry: inclusive Unix-seconds expiry of the revocation-aware binding. */
  expiry: bigint;
  /** N: 32-byte single-use application nonce (not the payment nonce). */
  nonce: Hex;
};

function isBytes32(value: Hex): boolean {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/** C_t = keccak256(abi.encode(C, E_I, E_M, T_expiry, N)). */
export function computeRevocationAwareCommitment(fields: RevocationAwareCommitmentFields): Hex {
  if (!isBytes32(fields.baseCommitment) || !isBytes32(fields.nonce)) {
    throw new Error("RCLB commitment inputs must be 32-byte hex values");
  }
  if (fields.expiry < 0n || fields.identityEpoch < 0n || fields.mandateEpoch < 0n) {
    throw new Error("RCLB epochs and expiry must be non-negative");
  }
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint64" },
        { type: "bytes32" },
      ],
      [
        fields.baseCommitment,
        fields.identityEpoch,
        fields.mandateEpoch,
        fields.expiry,
        fields.nonce,
      ],
    ),
  );
}

/** Payment nonce for C_t: nonce = keccak256(C_t), same rule as H(C). */
export function deriveRevocationAwareNonce(commitment: Hex): Hex {
  return keccak256(commitment);
}

/** Canonical (case-insensitive) key for a nonce in a consumed set. */
export function revocationNonceKey(nonce: Hex): string {
  return nonce.toLowerCase();
}

export type RevocationViolationCode =
  | "REVOCATION_STATE_UNAVAILABLE"
  | "IDENTITY_EPOCH_STALE"
  | "MANDATE_EPOCH_STALE"
  | "COMMITMENT_EXPIRED"
  | "NONCE_ALREADY_CONSUMED"
  | "COMMITMENT_MISMATCH"
  | "MALFORMED_COMMITMENT_INPUT";

export type RevocationAcceptanceInput = {
  fields: RevocationAwareCommitmentFields;
  /** The C_t carried by the settlement message. */
  commitment: Hex;
  /**
   * CURRENT authority state, read from the trusted registry AT EXECUTION TIME.
   * `undefined`/`null` means the read failed: the guard fails closed.
   */
  currentIdentityEpoch: Epoch | undefined | null;
  currentMandateEpoch: Epoch | undefined | null;
  /** Settlement time in Unix seconds (injected for determinism). */
  now: bigint;
  /** Application nonces already consumed (lower-cased keys recommended). */
  consumedNonces?: ReadonlySet<string>;
};

export type RevocationAcceptanceResult = {
  ok: boolean;
  violations: RevocationViolationCode[];
  detail: string;
};

function result(
  violations: RevocationViolationCode[],
): RevocationAcceptanceResult {
  return {
    ok: violations.length === 0,
    violations,
    detail: violations.length === 0 ? "RCLB acceptance OK" : violations.join(", "),
  };
}

/**
 * Deterministic settlement-time acceptance check. No wall clock, no I/O: the
 * caller supplies a trusted CURRENT epoch snapshot and the settlement time.
 *
 * ACCEPT iff E_I == current E_I && E_M == current E_M && t <= T_expiry &&
 * N not consumed && recomputed C_t == presented C_t. Missing authority state
 * is a hard failure, never an implicit "current".
 */
export function checkRevocationAwareAcceptance(
  input: RevocationAcceptanceInput,
): RevocationAcceptanceResult {
  const { fields } = input;
  if (
    !isBytes32(fields.baseCommitment) ||
    !isBytes32(fields.nonce) ||
    !isBytes32(input.commitment) ||
    fields.identityEpoch < 0n ||
    fields.mandateEpoch < 0n ||
    fields.expiry < 0n ||
    input.now < 0n
  ) {
    return result(["MALFORMED_COMMITMENT_INPUT"]);
  }

  const violations: RevocationViolationCode[] = [];

  if (input.currentIdentityEpoch == null || input.currentMandateEpoch == null) {
    violations.push("REVOCATION_STATE_UNAVAILABLE");
  } else {
    if (fields.identityEpoch !== input.currentIdentityEpoch) {
      violations.push("IDENTITY_EPOCH_STALE");
    }
    if (fields.mandateEpoch !== input.currentMandateEpoch) {
      violations.push("MANDATE_EPOCH_STALE");
    }
  }

  if (input.now > fields.expiry) {
    violations.push("COMMITMENT_EXPIRED");
  }

  const recomputed = computeRevocationAwareCommitment(fields);
  if (recomputed.toLowerCase() !== input.commitment.toLowerCase()) {
    violations.push("COMMITMENT_MISMATCH");
  }

  if (input.consumedNonces?.has(revocationNonceKey(fields.nonce)) === true) {
    violations.push("NONCE_ALREADY_CONSUMED");
  }

  return result(violations);
}

/** Functional nonce consumption — callers replace their consumed set with the result. */
export function consumeRevocationNonce(
  consumedNonces: ReadonlySet<string>,
  nonce: Hex,
): Set<string> {
  const next = new Set(consumedNonces);
  next.add(revocationNonceKey(nonce));
  return next;
}
