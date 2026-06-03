import { jsonError, proxyJson, readJson, serviceUrls } from "../_lib";

export async function POST(request: Request) {
  const body = await readJson(request);
  const intentId = typeof body.intentId === "string" ? body.intentId : undefined;
  if (!intentId) return jsonError("intentId is required");

  return proxyJson(`${serviceUrls.orchestrator}/agent/discover`, {
    method: "POST",
    body: JSON.stringify({ intentId }),
  });
}
