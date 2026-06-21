import { NextResponse } from "next/server";
import { agentAddress, deliverServiceReport } from "@/server/clb/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Grammar-checker agent service: returns a signed ServiceReport for the text. */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { text?: unknown };
  try {
    body = (await request.json()) as { text?: unknown };
  } catch {
    body = {};
  }
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  try {
    const { report, detail } = await deliverServiceReport("grammar", { input: text });
    return NextResponse.json({ agent: agentAddress("grammar"), report, grammar: detail });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Grammar check failed" },
      { status: 502 },
    );
  }
}
