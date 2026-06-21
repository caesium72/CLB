import { NextResponse } from "next/server";
import { listAttacks } from "@/server/clb/attacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Binding-attack (Mode A) catalogue, computed in-process from attack-core fixtures. */
export async function GET() {
  return NextResponse.json({ attacks: listAttacks() });
}
