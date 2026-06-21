/**
 * Live on-chain Mode B prevention demo (Phase 7A, on Base Sepolia).
 *
 * The deployed `PredicatePaymentGuard` enforces the human's spending predicate
 * BEFORE any transfer: a predicate-violating delegated settlement reverts on-chain.
 * To demonstrate "the transaction actually rejected" with a BaseScan-viewable hash,
 * we FORCE-BROADCAST `validateAndConsume` (manual gas, no simulate gate) so it is
 * mined-and-reverted — a real failed tx, not a caught simulation.
 *
 * The on-chain attack matches the SELECTED predicate scenario: payee / amount /
 * asset / expiry each revert with their own Solidity error; the happy path is
 * allowed (a successful, non-reverting tx). The guard checks in this order:
 * commitment recompute -> nonce -> payee -> asset -> chain -> amount -> expiry,
 * so each scenario isolates one error.
 *
 * Constants/config here are shared with `scripts/deploy-predicate-guard-sepolia.ts`
 * (the registered predicate config must match what we settle against) — keep in sync.
 */
import {
  computeModeBSettlementCommitment,
  deriveSettlementNonce,
  settlementParamsFromExact,
} from "@clb-acel/clb-core";
import type { ModeBSettlementInput } from "@clb-acel/clb-core";
import { PREDICATE_GUARD_ABI, extractRevertName } from "@clb-acel/predicate-adapter";
import type { SettlementDescriptorExact } from "@clb-acel/schemas";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

export const GUARD_CHAIN_ID = 84532;
/** Canonical ERC-8004 identity registry (Base Sepolia). */
export const GUARD_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
/** Payer (shopping) agent id bound into C'. */
export const GUARD_AGENT_ID = "6823";
/** The human-approved merchant payee (grammar agent wallet). */
export const GUARD_MERCHANT = "0x54Db78Db972b6e153d918e49758CB0D0265b5e4E" as Address;
/** An address the human never approved. */
const ATTACKER = "0x000000000000000000000000000000000000dEaD" as Address;
/** Registered spending cap: 5 USDC (6 decimals). */
export const GUARD_MAX_VALUE_ATOMIC = 5_000_000n;
/** Live predicate (never expires) — used for payee/amount/asset/happy scenarios. */
export const GUARD_PREDICATE_ID = "demo-modeb-guard";
/** Already-expired predicate — used only for the expiry scenario. */
export const GUARD_EXPIRED_PREDICATE_ID = "demo-modeb-expired";
const UINT64_MAX = 18446744073709551615n;
const PAST_DEADLINE = 1735689600n; // 2025-01-01 — already in the past
export const GUARD_MANDATE_DIGEST = `0x${"11".repeat(32)}` as Hex;
export const GUARD_DOMAIN = { name: "CLB-ACEL", version: "0.1", chainId: GUARD_CHAIN_ID } as const;

/** The predicate configs registered on-chain (shared with the deploy script). */
export function demoPredicateConfigs() {
  const base = {
    allowedPayees: [GUARD_MERCHANT],
    allowedAssetHashes: [keccak256(toBytes("USDC"))],
    allowedChainIds: [BigInt(GUARD_CHAIN_ID)],
    maxValueAtomic: GUARD_MAX_VALUE_ATOMIC,
    registered: true,
  } as const;
  return [
    { predicateId: GUARD_PREDICATE_ID, config: { ...base, validUntil: UINT64_MAX } },
    { predicateId: GUARD_EXPIRED_PREDICATE_ID, config: { ...base, validUntil: PAST_DEADLINE } },
  ] as const;
}

export type PredicateAttackId =
  | "PREDICATE_HAPPY_PATH"
  | "PREDICATE_PAYEE_VIOLATION"
  | "PREDICATE_AMOUNT_VIOLATION"
  | "PREDICATE_ASSET_VIOLATION"
  | "PREDICATE_EXPIRED";

type ScenarioPlan = {
  predicateId: string;
  value: string;
  payTo: Address;
  asset: string;
  expectReverted: boolean;
  expectedReason: string;
  detail: string;
};

function scenarioPlan(attackId: PredicateAttackId): ScenarioPlan {
  switch (attackId) {
    case "PREDICATE_PAYEE_VIOLATION":
      return {
        predicateId: GUARD_PREDICATE_ID,
        value: "2.00",
        payTo: ATTACKER,
        asset: "USDC",
        expectReverted: true,
        expectedReason: "PayeeNotAllowed",
        detail: "Pays a merchant you never approved.",
      };
    case "PREDICATE_AMOUNT_VIOLATION":
      return {
        predicateId: GUARD_PREDICATE_ID,
        value: "9.00",
        payTo: GUARD_MERCHANT,
        asset: "USDC",
        expectReverted: true,
        expectedReason: "AmountExceedsMax",
        detail: "9.00 USDC exceeds the 5.00 USDC signed cap.",
      };
    case "PREDICATE_ASSET_VIOLATION":
      return {
        predicateId: GUARD_PREDICATE_ID,
        value: "2.00",
        payTo: GUARD_MERCHANT,
        asset: "WETH",
        expectReverted: true,
        expectedReason: "AssetNotAllowed",
        detail: "Pays in WETH, not the allowed USDC.",
      };
    case "PREDICATE_EXPIRED":
      return {
        predicateId: GUARD_EXPIRED_PREDICATE_ID,
        value: "2.00",
        payTo: GUARD_MERCHANT,
        asset: "USDC",
        expectReverted: true,
        expectedReason: "PredicateExpired",
        detail: "Settles after your authorization deadline.",
      };
    default: // PREDICATE_HAPPY_PATH
      return {
        predicateId: GUARD_PREDICATE_ID,
        value: "2.00",
        payTo: GUARD_MERCHANT,
        asset: "USDC",
        expectReverted: false,
        expectedReason: "",
        detail: "Within every rule — the guard allows it and consumes the nonce.",
      };
  }
}

function buildModeBInput(plan: ScenarioPlan): ModeBSettlementInput {
  const descriptor: SettlementDescriptorExact = {
    chainId: GUARD_CHAIN_ID,
    network: "base-sepolia",
    asset: plan.asset,
    payTo: plan.payTo,
    value: plan.value,
    // Unique each call -> fresh C'/nonce, so the happy path never hits NonceAlreadyConsumed.
    validBefore: new Date(Date.now() + 3_600_000).toISOString(),
    x402Scheme: "exact",
  };
  return {
    identityRef: { chainId: GUARD_CHAIN_ID, registryAddr: GUARD_REGISTRY, agentId: GUARD_AGENT_ID },
    mandateDigest: GUARD_MANDATE_DIGEST,
    predicateId: plan.predicateId,
    settlementParams: settlementParamsFromExact(descriptor, GUARD_AGENT_ID),
    domain: GUARD_DOMAIN,
  };
}

export type LiveRejectionResult = {
  available: boolean;
  attackId?: PredicateAttackId;
  reverted?: boolean;
  /** True when the scenario behaved as designed (violation reverted / happy allowed). */
  asExpected?: boolean;
  txHash?: string;
  reason?: string;
  url?: string;
  detail?: string;
  note?: string;
  error?: string;
};

/**
 * Run the SELECTED predicate scenario through the deployed guard on Base Sepolia,
 * force-broadcasting so a violation is mined-and-reverted (real failed tx) and the
 * happy path is a real successful tx. Returns `{ available: false }` when the guard
 * env is not configured (graceful fallback).
 */
export async function runLiveOnChainRejection(
  attackId: PredicateAttackId = "PREDICATE_AMOUNT_VIOLATION",
): Promise<LiveRejectionResult> {
  const rpc = process.env.RPC_URL_BASE_SEPOLIA?.trim() || process.env.RPC_URL?.trim();
  const guard = process.env.PREDICATE_GUARD_ADDRESS?.trim() as Address | undefined;
  const signerKey = (process.env.DEPLOYER_PRIVATE_KEY?.trim() ||
    process.env.SHOPPING_AGENT_PRIVATE_KEY?.trim()) as Hex | undefined;
  if (!rpc || !guard || !signerKey) {
    return { available: false, note: "On-chain guard not configured (PREDICATE_GUARD_ADDRESS)." };
  }

  const plan = scenarioPlan(attackId);
  try {
    const account = privateKeyToAccount(signerKey);
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
    const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });

    const input = buildModeBInput(plan);
    const commitment = computeModeBSettlementCommitment(input);
    const nonce = deriveSettlementNonce(commitment);
    const p = input.settlementParams;
    const args = [
      {
        chainId: BigInt(input.identityRef.chainId),
        registryAddr: input.identityRef.registryAddr as Hex,
        agentId: input.identityRef.agentId,
      },
      input.mandateDigest,
      input.predicateId,
      {
        chainId: BigInt(p.chainId),
        network: p.network,
        asset: p.asset,
        payTo: p.payTo as Hex,
        value: p.value,
        valueAtomic: BigInt(p.valueAtomic),
        validBefore: p.validBefore,
        payerAgentId: p.payerAgentId,
      },
      commitment,
      nonce,
    ] as const;

    // Decode the revert reason via simulation (it throws for violations); then
    // force-broadcast with a manual gas limit so the tx is actually mined.
    let reason: string | undefined;
    try {
      await publicClient.simulateContract({
        address: guard,
        abi: PREDICATE_GUARD_ABI,
        functionName: "validateAndConsume",
        args,
        account,
      });
    } catch (error) {
      reason = extractRevertName(error);
    }

    const txHash = await walletClient.writeContract({
      address: guard,
      abi: PREDICATE_GUARD_ABI,
      functionName: "validateAndConsume",
      args,
      gas: 400_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const reverted = receipt.status === "reverted";

    return {
      available: true,
      attackId,
      reverted,
      asExpected: reverted === plan.expectReverted,
      txHash,
      reason: reverted ? (reason ?? plan.expectedReason) : undefined,
      url: `https://sepolia.basescan.org/tx/${txHash}`,
      detail: plan.detail,
      note: reverted
        ? "Reverted on-chain before any transfer."
        : "Allowed on-chain — within the signed rules; nonce consumed once.",
    };
  } catch (error) {
    return {
      available: true,
      attackId,
      error: error instanceof Error ? error.message.split("\n")[0] : "live rejection failed",
    };
  }
}
