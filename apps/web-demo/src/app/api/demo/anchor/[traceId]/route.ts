import { NextResponse } from "next/server";
import { anchorStored } from "@/server/clb/anchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Anchor the trace Merkle root on-chain via AgenticAuditAnchor (in-process). */
export async function POST(_request: Request, context: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await context.params;
  try {
    const result = await anchorStored(traceId);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Anchor failed" },
      { status: 502 },
    );
  }
}
