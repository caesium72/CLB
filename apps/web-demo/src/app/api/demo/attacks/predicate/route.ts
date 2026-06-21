import { NextResponse } from "next/server";
import { listPredicateAttacks } from "@/server/clb/attacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Predicate-attack (Mode B / P5) catalogue, computed in-process from attack-core. */
export async function GET() {
  return NextResponse.json({ attacks: listPredicateAttacks() });
}
