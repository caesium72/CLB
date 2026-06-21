import { NextResponse } from "next/server";
import { ensureMonorepoEnv } from "@/server/clb/env";
import { runLiveOnChainRejection, type PredicateAttackId } from "@/server/clb/predicate-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

ensureMonorepoEnv();

const VALID: PredicateAttackId[] = [
  "PREDICATE_HAPPY_PATH",
  "PREDICATE_PAYEE_VIOLATION",
  "PREDICATE_AMOUNT_VIOLATION",
  "PREDICATE_ASSET_VIOLATION",
  "PREDICATE_EXPIRED",
];

/**
 * Demonstrate REAL on-chain Mode B prevention for the SELECTED scenario:
 * force-broadcast the settlement through the deployed PredicatePaymentGuard so a
 * violation is mined-and-reverted on Base Sepolia (its own Solidity error), or the
 * happy path is allowed — returning the tx hash for BaseScan.
 */
export async function POST(request: Request) {
  let attackId: PredicateAttackId = "PREDICATE_AMOUNT_VIOLATION";
  try {
    const body = (await request.json()) as { attackId?: string };
    if (body.attackId && VALID.includes(body.attackId as PredicateAttackId)) {
      attackId = body.attackId as PredicateAttackId;
    }
  } catch {
    // default scenario
  }
  const result = await runLiveOnChainRejection(attackId);
  return NextResponse.json(result);
}
