import { jsonError, proxyJson, readJson, serviceUrls } from "../_lib";

export async function POST(request: Request) {
  const body = await readJson(request);
  const intentId = typeof body.intentId === "string" ? body.intentId : undefined;
  const mode = body.mode === "b" ? "b" : "a";
  if (!intentId) return jsonError("intentId is required");

  return proxyJson(`${serviceUrls.orchestrator}/agent/quote`, {
    method: "POST",
    body: JSON.stringify({ intentId, mode }),
  });
}
