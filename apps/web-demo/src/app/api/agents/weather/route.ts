import { NextResponse } from "next/server";
import { agentAddress, deliverServiceReport } from "@/server/clb/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Weather agent service: returns a signed ServiceReport for the city. */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { city?: unknown };
  try {
    body = (await request.json()) as { city?: unknown };
  } catch {
    body = {};
  }
  const city = typeof body.city === "string" && body.city.trim() ? body.city.trim() : "London";
  try {
    const { report, detail } = await deliverServiceReport("weather", { input: city });
    return NextResponse.json({ agent: agentAddress("weather"), report, forecast: detail });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Weather lookup failed" },
      { status: 502 },
    );
  }
}
