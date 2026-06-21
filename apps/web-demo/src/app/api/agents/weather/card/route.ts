import { NextResponse } from "next/server";
import { requestBaseUrl, weatherCard } from "@/server/clb/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  return NextResponse.json(weatherCard(requestBaseUrl(request)), {
    headers: { "cache-control": "public, max-age=60" },
  });
}
