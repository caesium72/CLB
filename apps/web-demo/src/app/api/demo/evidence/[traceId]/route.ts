import { buildEvidenceGraph, buildMerkleRoot, linkEvidenceEvents } from "@clb-acel/evidence-core";
import { EvidenceEventSchema } from "@clb-acel/schemas";
import { NextResponse } from "next/server";
import { serviceUrls } from "../../_lib";

export async function GET(_request: Request, context: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await context.params;
  try {
    const trace = await fetch(`${serviceUrls.evidence}/traces/${encodeURIComponent(traceId)}`, {
      cache: "no-store",
    }).then((r) => r.json());

    const events = EvidenceEventSchema.array().parse(trace.events);
    const linked = linkEvidenceEvents(events);
    const graph = buildEvidenceGraph(linked);
    const merkleRoot = buildMerkleRoot(trace.eventHashes ?? []);

    return NextResponse.json({ ...trace, graph, merkleRoot });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Evidence service request failed" },
      { status: 502 },
    );
  }
}
