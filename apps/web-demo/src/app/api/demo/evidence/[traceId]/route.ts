import { NextResponse } from "next/server";
import { evidenceView } from "@/server/clb/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await context.params;
  const view = await evidenceView(traceId);
  if (!view) {
    return NextResponse.json({ error: "Trace not found" }, { status: 404 });
  }
  return NextResponse.json(view);
}
