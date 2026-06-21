import { NextResponse } from "next/server";
import { ATTACK_SEED, runAttack, type AttackIdParam } from "@/server/clb/attacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Run one binding attack in-process against attack-core (fixed seed → reproducible). */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const result = await runAttack(id as AttackIdParam, { nowMs: ATTACK_SEED });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Attack run failed" },
      { status: 400 },
    );
  }
}
