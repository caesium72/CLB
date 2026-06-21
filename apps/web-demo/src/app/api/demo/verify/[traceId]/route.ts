import { NextResponse } from "next/server";
import { verification } from "@/server/clb/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await context.params;
  const v = await verification(traceId);
  if (!v) {
    return NextResponse.json({ error: "Verification not found" }, { status: 404 });
  }
  // Preserve the previous `/verify/:id/certificate` contract consumed by the UI.
  return NextResponse.json(v.certificate);
}
