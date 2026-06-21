import { NextResponse } from "next/server";
import { prepare, resolveIntent } from "@/server/clb/orchestrator";
import { readJson } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  const mode = body.mode === "b" ? "b" : "a";
  const humanPrincipal =
    typeof body.humanPrincipal === "string" && body.humanPrincipal.startsWith("0x")
      ? body.humanPrincipal
      : undefined;
  try {
    const intent = await resolveIntent(body);
    const prepared = await prepare(intent, mode, humanPrincipal);
    return NextResponse.json({ intent, ...prepared });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Prepare failed" },
      { status: 502 },
    );
  }
}
