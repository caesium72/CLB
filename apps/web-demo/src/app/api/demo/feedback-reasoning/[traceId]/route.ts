import { NextResponse } from "next/server";
import { explainFeedbackScore } from "@clb-acel/llm-adapter";
import { storedTrace } from "@/server/clb/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Plain-language reasoning behind the deterministic ERC-8004 feedback score for a
 * trace. The score + pass/fail factors come from the verifier (already on the
 * trace); an LLM only narrates them (decision-layer prose, never a verifier input).
 */
export async function GET(_request: Request, context: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await context.params;
  const trace = await storedTrace(traceId);
  if (!trace) {
    return NextResponse.json({ error: "Trace not found" }, { status: 404 });
  }
  const assessment = trace.recommendedFeedback;
  if (!assessment) {
    return NextResponse.json({ error: "No feedback assessment on this trace" }, { status: 404 });
  }

  const report = trace.report as unknown as Record<string, unknown>;
  const agentName = trace.merchantAgent?.card?.name ?? `agent #${trace.merchantAgent?.agentId ?? ""}`;
  const service = typeof report.service === "string" ? report.service : "task";

  const { explanation, provider } = await explainFeedbackScore({
    agentName,
    service,
    score: assessment.score,
    status: assessment.status,
    rulesPassed: assessment.rulesPassed,
    rulesChecked: assessment.rulesChecked,
    factors: assessment.factors.map((factor) => ({ label: factor.label, ok: factor.ok })),
  });

  return NextResponse.json({ traceId, assessment, explanation, provider });
}
