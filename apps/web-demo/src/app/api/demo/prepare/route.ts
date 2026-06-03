import { proxyJson, readJson, serviceUrls } from "../_lib";

export async function POST(request: Request) {
  const body = await readJson(request);
  const mode = body.mode === "b" ? "delegated" : "human-present";
  return proxyJson(`${serviceUrls.orchestrator}/prepare/${mode}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
