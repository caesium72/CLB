import { NextResponse } from "next/server";
import { discover, resolveIntent } from "@/server/clb/orchestrator";
import { readJson } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  try {
    const intent = await resolveIntent(body);
    const result = await discover(intent);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Discovery failed" },
      { status: 502 },
    );
  }
}
