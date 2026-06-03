import { proxyJson, readJson, serviceUrls } from "../_lib";

export async function POST(request: Request) {
  const body = await readJson(request);
  return proxyJson(`${serviceUrls.orchestrator}/intent`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
