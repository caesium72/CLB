import { NextResponse } from "next/server";
import { probe402 } from "@/server/clb/orchestrator";
import { jsonError } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? undefined;
  const intentId = url.searchParams.get("intentId") ?? undefined;
  if (!token && !intentId) return jsonError("token or intentId query parameter is required");
  try {
    const result = await probe402({ token, intentId });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Probe failed" },
      { status: 502 },
    );
  }
}
