import { proxyJson, serviceUrls } from "../../_lib";

export async function GET(_request: Request, context: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await context.params;
  return proxyJson(`${serviceUrls.orchestrator}/trace/${encodeURIComponent(traceId)}`);
}
