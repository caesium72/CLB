import { NextResponse } from "next/server";
import { createDemoIntent, parseAllowedAgentIds } from "@/server/clb/orchestrator";
import { readJson } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  try {
    const intent = await createDemoIntent({
      token: typeof body.token === "string" ? body.token : undefined,
      task: typeof body.task === "string" ? body.task : undefined,
      input: typeof body.input === "string" ? body.input : undefined,
      budget: typeof body.budget === "string" ? body.budget : undefined,
      asset: typeof body.asset === "string" ? body.asset : undefined,
      network: typeof body.network === "string" ? body.network : undefined,
      allowedAgentIds: parseAllowedAgentIds(body.allowedAgentIds),
      validUntil: typeof body.validUntil === "string" ? body.validUntil : undefined,
    });
    return NextResponse.json(intent, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create intent" },
      { status: 500 },
    );
  }
}
