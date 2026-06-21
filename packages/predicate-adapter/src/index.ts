import {
  computeModeBSettlementCommitment,
  deriveSettlementNonce,
  evaluatePredicate,
  type ModeBSettlementInput,
  type PredicateEvalResult,
} from "@clb-acel/clb-core";
import type { SettlementParams, SpendingPredicate } from "@clb-acel/schemas";
import type { Hex } from "viem";

/**
 * Demo substitute for an ERC-7710 smart-account caveat enforcer. The adapter
 * evaluates a human-signed spending predicate against the concrete settlement
 * the agent chose, recomputes the settlement-time commitment C', and asserts
 * `nonce == H(C')` before settlement is allowed to proceed.
 *
 * This is intentionally NOT a production delegation implementation — see the
 * package README and DECISIONS.md (ERC-7710 not stable enough for v1). The
 * interface is deliberately small so a real caveat enforcer can replace it.
 */

export type GuardSettlementInput = {
  predicate: SpendingPredicate;
  params: SettlementParams;
  /** Inputs needed to recompute C' = keccak256(EIP712(...)). */
  commitment: ModeBSettlementInput;
  /** When set, the guard rejects settlement unless the payload nonce equals H(C'). */
  expectedNonce?: Hex;
  now?: Date;
  /** Actual task hash of the settlement (e.g. report.inputDataHash). */
  observedTaskHash?: Hex;
};

export type GuardResult = {
  allowed: boolean;
  evaluation: PredicateEvalResult;
  /** Recomputed C'. */
  commitment: Hex;
  /** nonce = H(C'). */
  nonce: Hex;
  /** Which layer authorized: off-chain predicate eval, or an on-chain guard call. */
  enforcedBy: "in-memory" | "contract";
};

export class PredicateViolationError extends Error {
  constructor(public readonly evaluation: PredicateEvalResult) {
    super(`Predicate violated: ${evaluation.violations.join(", ") || "unknown"}`);
    this.name = "PredicateViolationError";
  }
}

export class SettlementNonceMismatchError extends Error {
  constructor(
    public readonly expected: Hex,
    public readonly actual: Hex,
  ) {
    super(`Settlement nonce ${actual} != H(C') ${expected}`);
    this.name = "SettlementNonceMismatchError";
  }
}

/**
 * A typed revert from the on-chain `PredicatePaymentGuard.validateAndConsume`.
 * The viem writer maps a contract revert to this so callers can read the
 * Solidity error name (`PayeeNotAllowed`, `AmountExceedsMax`, …) without
 * depending on viem's error shapes.
 */
export class PredicateOnChainRevertError extends Error {
  constructor(public readonly errorName: string) {
    super(`On-chain predicate revert: ${errorName}`);
    this.name = "PredicateOnChainRevertError";
  }
}

export interface PredicateGuardAdapter {
  readonly kind: "in-memory" | "contract";
  evaluateOffChain(
    predicate: SpendingPredicate,
    params: SettlementParams,
    now?: Date,
    observedTaskHash?: Hex,
  ): PredicateEvalResult;
  /** Throws PredicateViolationError / SettlementNonceMismatchError on violation. */
  assertSettlementAllowed(input: GuardSettlementInput): Promise<GuardResult>;
}

function recompute(input: GuardSettlementInput): { commitment: Hex; nonce: Hex } {
  const commitment = computeModeBSettlementCommitment(input.commitment);
  return { commitment, nonce: deriveSettlementNonce(commitment) };
}

function assertCommon(input: GuardSettlementInput): {
  evaluation: PredicateEvalResult;
  commitment: Hex;
  nonce: Hex;
} {
  const evaluation = evaluatePredicate(
    input.predicate,
    input.params,
    input.now,
    input.observedTaskHash,
  );
  const { commitment, nonce } = recompute(input);
  if (input.expectedNonce !== undefined && input.expectedNonce !== nonce) {
    throw new SettlementNonceMismatchError(nonce, input.expectedNonce);
  }
  if (!evaluation.ok) {
    throw new PredicateViolationError(evaluation);
  }
  return { evaluation, commitment, nonce };
}

/**
 * Default guard for CI and the in-process orchestrator. Calls
 * `evaluatePredicate` from clb-core — no chain required.
 */
export class InMemoryPredicateGuard implements PredicateGuardAdapter {
  readonly kind = "in-memory" as const;

  evaluateOffChain(
    predicate: SpendingPredicate,
    params: SettlementParams,
    now?: Date,
    observedTaskHash?: Hex,
  ): PredicateEvalResult {
    return evaluatePredicate(predicate, params, now, observedTaskHash);
  }

  async assertSettlementAllowed(input: GuardSettlementInput): Promise<GuardResult> {
    const { evaluation, commitment, nonce } = assertCommon(input);
    return { allowed: true, evaluation, commitment, nonce, enforcedBy: "in-memory" };
  }
}

/**
 * On-chain `PredicatePaymentGuard` reader. The off-chain `evaluatePredicate`
 * stays authoritative for the result (so the demo works without a deployed
 * guard); when a `reader` is supplied it additionally cross-checks the
 * contract's view that the C' nonce has not already been consumed.
 */
export type ContractGuardReader = (input: {
  address: Hex;
  commitment: Hex;
  nonce: Hex;
}) => Promise<{ consumed: boolean }>;

/**
 * Broadcasts `PredicatePaymentGuard.validateAndConsume(...)` on-chain. Resolves
 * with the settlement tx hash on success; on a predicate violation it MUST throw
 * a {@link PredicateOnChainRevertError} (the viem factory maps the typed revert).
 * Any other thrown error is treated as an infrastructure failure and propagated.
 */
export type ContractGuardWriter = (input: {
  address: Hex;
  /** Inputs to recompute C' on-chain: identityRef, mandateDigest, predicateId, settlementParams. */
  commitment: ModeBSettlementInput;
  /** Off-chain recomputed C' and nonce = H(C'), passed to validateAndConsume. */
  cPrime: Hex;
  nonce: Hex;
}) => Promise<{ txHash: Hex }>;

export type ContractPredicateGuardOptions = {
  address: Hex;
  reader?: ContractGuardReader;
  writer?: ContractGuardWriter;
};

/**
 * Result of an on-chain settlement attempt. `reverted: true` means the contract
 * enforced the predicate and reverted *before any transfer* — Mode B prevented
 * in-protocol rather than merely flagged by the off-chain R17 audit.
 */
export type OnChainSettlementResult = {
  commitment: Hex;
  nonce: Hex;
  reverted: boolean;
  /** Solidity error name when reverted (e.g. "AmountExceedsMax"). */
  reason?: string;
  /** Settlement tx hash when it succeeded. */
  txHash?: Hex;
};

export class ContractPredicateGuard implements PredicateGuardAdapter {
  readonly kind = "contract" as const;
  readonly address: Hex;
  private readonly reader?: ContractGuardReader;
  private readonly writer?: ContractGuardWriter;

  constructor(options: ContractPredicateGuardOptions) {
    this.address = options.address;
    this.reader = options.reader;
    this.writer = options.writer;
  }

  evaluateOffChain(
    predicate: SpendingPredicate,
    params: SettlementParams,
    now?: Date,
    observedTaskHash?: Hex,
  ): PredicateEvalResult {
    return evaluatePredicate(predicate, params, now, observedTaskHash);
  }

  async assertSettlementAllowed(input: GuardSettlementInput): Promise<GuardResult> {
    const { evaluation, commitment, nonce } = assertCommon(input);
    if (this.reader) {
      const { consumed } = await this.reader({ address: this.address, commitment, nonce });
      if (consumed) {
        throw new SettlementNonceMismatchError(nonce, nonce);
      }
    }
    return { allowed: true, evaluation, commitment, nonce, enforcedBy: "contract" };
  }

  /**
   * Settle *through the contract* — the on-chain guard is the enforcer. Unlike
   * {@link assertSettlementAllowed} (which is off-chain-authoritative and throws
   * before any chain interaction), this always broadcasts `validateAndConsume`
   * so a predicate-violating Mode B settlement produces a REAL on-chain revert.
   * A typed revert is captured as `{ reverted: true, reason }`; the happy path
   * returns `{ reverted: false, txHash }`. Non-revert errors propagate.
   */
  async settleOnChain(input: GuardSettlementInput): Promise<OnChainSettlementResult> {
    if (!this.writer) {
      throw new Error("ContractPredicateGuard.settleOnChain requires a writer");
    }
    const { commitment, nonce } = recompute(input);
    try {
      const { txHash } = await this.writer({
        address: this.address,
        commitment: input.commitment,
        cPrime: commitment,
        nonce,
      });
      return { commitment, nonce, reverted: false, txHash };
    } catch (error) {
      if (error instanceof PredicateOnChainRevertError) {
        return { commitment, nonce, reverted: true, reason: error.errorName };
      }
      throw error;
    }
  }
}

/**
 * Resolve the active guard from configuration. Uses the on-chain guard when
 * `PREDICATE_GUARD_ADDRESS` is set, otherwise the in-memory guard.
 */
export function createPredicateGuard(
  options: { address?: Hex; reader?: ContractGuardReader; writer?: ContractGuardWriter } = {},
): PredicateGuardAdapter {
  const address = options.address ?? (process.env.PREDICATE_GUARD_ADDRESS?.trim() as Hex | undefined);
  if (address && /^0x[0-9a-fA-F]{40}$/u.test(address)) {
    return new ContractPredicateGuard({
      address,
      ...(options.reader ? { reader: options.reader } : {}),
      ...(options.writer ? { writer: options.writer } : {}),
    });
  }
  return new InMemoryPredicateGuard();
}

export {
  PREDICATE_GUARD_ABI,
  extractRevertName,
  makeViemGuardWriter,
  type GuardViemClients,
} from "./onchain";
