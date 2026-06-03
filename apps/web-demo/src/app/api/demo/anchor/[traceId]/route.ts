import { NextResponse } from "next/server";
import { proxyJson, serviceUrls } from "../../_lib";

/** Anchor on-chain via evidence-service (Anvil RPC stays on Lightsail). */
export async function POST(_request: Request, context: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await context.params;

  const merkleResponse = await fetch(
    `${serviceUrls.evidence}/traces/${encodeURIComponent(traceId)}/merkle`,
    { method: "POST", cache: "no-store" },
  );
  if (!merkleResponse.ok) {
    return NextResponse.json({ error: "Trace evidence is not available yet" }, { status: 404 });
  }

  return proxyJson(`${serviceUrls.evidence}/traces/${encodeURIComponent(traceId)}/anchor`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
