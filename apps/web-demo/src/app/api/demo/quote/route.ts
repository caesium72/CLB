import { NextResponse } from "next/server";
import { quote, resolveIntent } from "@/server/clb/orchestrator";
import { readJson } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  const mode = body.mode === "b" ? "b" : "a";
  try {
    const intent = await resolveIntent(body);
    const result = await quote(intent, mode);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Quote failed" },
      { status: 502 },
    );
  }
}
