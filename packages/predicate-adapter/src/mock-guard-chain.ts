import { computeModeBSettlementCommitment, deriveNonce } from "@clb-acel/clb-core";
import type { SpendingPredicate } from "@clb-acel/schemas";
import { keccak256, parseUnits, stringToHex, type Address, type Hex } from "viem";
import {
  PredicateOnChainRevertError,
  type ContractGuardReader,
  type ContractGuardWriter,
} from "./index";

/**
 * OFFLINE FALLBACK ONLY. Models `PredicatePaymentGuard.validateAndConsume`
 * (check order, custom-error names, one-shot nonce) for tests and for the case
 * where no local EVM can be started. NOT a chain, NOT on-chain evidence.
 */

/** Deliberately all-zero: never present this as a real transaction hash. */
export const MOCK_TX_HASH = `0x${"00".repeat(32)}` as Hex;

export type MockPredicateConfig = {
  allowedPayees: Address[];
  allowedAssetHashes: Hex[];
  allowedChainIds: bigint[];
  maxValueAtomic: bigint;
  validUntil: bigint;
  /** Required by the Solidity PredicateConfig tuple even though the mock ignores it. */
  registered: true;
};

/** Demo predicates use 6-decimal atomic units (USDC/EURC), as `settlementParamsFromExact` does. */
export function mockConfigFromPredicate(predicate: SpendingPredicate): MockPredicateConfig {
  return {
    allowedPayees: predicate.allowedPayees as Address[],
    allowedAssetHashes: predicate.allowedAssets.map((asset) => keccak256(stringToHex(asset))),
    allowedChainIds: predicate.allowedChainIds.map((id) => BigInt(id)),
    maxValueAtomic: parseUnits(predicate.maxValue, 6),
    validUntil: BigInt(Math.floor(Date.parse(predicate.validUntil) / 1000)),
    registered: true,
  };
}

export class MockGuardChain {
  private readonly predicates = new Map<string, MockPredicateConfig>();
  private readonly used = new Set<string>();
  private readonly nowSec: bigint;

  constructor(options: { nowSec?: bigint } = {}) {
    this.nowSec = options.nowSec ?? BigInt(Math.floor(Date.now() / 1000));
  }

  register(predicateId: string, config: MockPredicateConfig): void {
    const key = keccak256(stringToHex(predicateId));
    if (this.predicates.has(key)) throw new PredicateOnChainRevertError("PredicateAlreadyRegistered");
    this.predicates.set(key, config);
  }

  readonly writer: ContractGuardWriter = async ({ commitment, cPrime, nonce }) => {
    const config = this.predicates.get(keccak256(stringToHex(commitment.predicateId)));
    if (!config) throw new PredicateOnChainRevertError("PredicateNotRegistered");

    if (computeModeBSettlementCommitment(commitment) !== cPrime) {
      throw new PredicateOnChainRevertError("CommitmentMismatch");
    }
    if (deriveNonce(cPrime) !== nonce) throw new PredicateOnChainRevertError("NonceMismatch");
    if (this.used.has(nonce.toLowerCase())) {
      throw new PredicateOnChainRevertError("NonceAlreadyConsumed");
    }

    const p = commitment.settlementParams;
    const key = nonce.toLowerCase();
    if (!config.allowedPayees.some((allowed) => allowed.toLowerCase() === p.payTo.toLowerCase())) {
      throw new PredicateOnChainRevertError("PayeeNotAllowed");
    }
    if (!config.allowedAssetHashes.includes(keccak256(stringToHex(p.asset)))) {
      throw new PredicateOnChainRevertError("AssetNotAllowed");
    }
    if (!config.allowedChainIds.includes(BigInt(p.chainId))) {
      throw new PredicateOnChainRevertError("ChainNotAllowed");
    }
    if (BigInt(p.valueAtomic) > config.maxValueAtomic) {
      throw new PredicateOnChainRevertError("AmountExceedsMax");
    }
    if (this.nowSec > config.validUntil) {
      throw new PredicateOnChainRevertError("PredicateExpired");
    }

    this.used.add(key);
    return { txHash: MOCK_TX_HASH };
  };

  readonly reader: ContractGuardReader = async ({ nonce }) => ({
    consumed: this.used.has(nonce.toLowerCase()),
  });
}
