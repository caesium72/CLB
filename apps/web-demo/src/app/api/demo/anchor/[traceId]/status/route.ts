import { NextResponse } from "next/server";
import { anchorStatus } from "@/server/clb/anchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await context.params;
  const result = await anchorStatus(traceId);
  if ("error" in result && "status" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json(result);
}
