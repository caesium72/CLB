import { NextResponse } from "next/server";
import { commitConfidential, verifyConfidential } from "@clb-acel/clb-core";
import { readJson } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Human USDC string -> 6-decimal atomic units (e.g. "2.5" -> 2_500_000n). */
function toAtomic(human: string): bigint {
  const [whole = "0", frac = ""] = String(human).trim().split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole || "0") * 1_000_000n + BigInt(fracPadded || "0");
}

/**
 * Confidential commit-and-prove: publish only a Pedersen commitment + a range
 * proof that value <= maxValue, and a hiding digest of the payee. The verifier
 * checks value <= budget WITHOUT learning the amount or payee.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  try {
    const amount = typeof body.amount === "string" ? body.amount : "2.00";
    const maxValue = typeof body.maxValue === "string" ? body.maxValue : "5.00";
    const payee =
      typeof body.payee === "string" && body.payee.trim()
        ? body.payee.trim()
        : "0x54Db78Db972b6e153d918e49758CB0D0265b5e4E";

    const valueAtomic = toAtomic(amount);
    const maxValueAtomic = toAtomic(maxValue);

    const commitment = commitConfidential({ valueAtomic, maxValueAtomic, payTo: payee });
    const valid = verifyConfidential(commitment.onchain.commitment, commitment.onchain.rangeProof, {
      maxValueAtomic,
    });

    return NextResponse.json({
      valid,
      amount,
      maxValue,
      payee,
      onchain: {
        commitment: commitment.onchain.commitment,
        payeeCommitment: commitment.onchain.payeeCommitment,
        rangeProofBits: commitment.onchain.rangeProof.bitLength,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Confidential proof failed" },
      { status: 400 },
    );
  }
}
