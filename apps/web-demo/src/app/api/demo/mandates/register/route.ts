import { NextResponse } from "next/server";
import { registerMandate } from "@/server/clb/orchestrator";
import { readJson } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  try {
    const result = registerMandate(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mandate registration failed" },
      { status: 502 },
    );
  }
}
