import { NextResponse } from "next/server";
import { resolveIntent, run } from "@/server/clb/orchestrator";
import { readJson } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Live on-chain settlement + delivery can take several seconds on Base Sepolia.
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = await readJson(request);
  const mode = body.mode === "b" ? "b" : "a";
  try {
    const intent = await resolveIntent(body);
    const trace = await run(intent, mode);
    return NextResponse.json(trace, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Run failed" },
      { status: 502 },
    );
  }
}
