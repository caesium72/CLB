import { NextResponse } from "next/server";
import { runPredicateAttack, type PredicateAttackIdParam } from "@/server/clb/attacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Run one predicate (Mode B / P5) attack in-process against attack-core. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const result = await runPredicateAttack(id as PredicateAttackIdParam);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Attack run failed" },
      { status: 400 },
    );
  }
}
