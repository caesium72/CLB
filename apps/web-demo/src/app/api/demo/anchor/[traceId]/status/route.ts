import { proxyJson, serviceUrls } from "../../../_lib";

/** Read anchor status via evidence-service (uses Lightsail Anvil RPC). */
export async function GET(_request: Request, context: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await context.params;
  return proxyJson(`${serviceUrls.evidence}/traces/${encodeURIComponent(traceId)}/anchor/status`);
}
