import { proxyJson, readJson, serviceUrls } from "../_lib";

export async function POST(request: Request) {
  const body = await readJson(request);
  const mode = body.mode === "b" ? "run-delegated" : "run-human-present";
  return proxyJson(`${serviceUrls.orchestrator}/${mode}`, {
    method: "POST",
    body: JSON.stringify({ ...body, transport: "http" }),
  });
}
