import { NextResponse } from "next/server";
import { grammarCard, requestBaseUrl } from "@/server/clb/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  return NextResponse.json(grammarCard(requestBaseUrl(request)), {
    headers: { "cache-control": "public, max-age=60" },
  });
}
