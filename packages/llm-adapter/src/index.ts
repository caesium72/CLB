import type { TokenRiskReport } from "@clb-acel/schemas";

export type LlmProvider = "openai" | "grok" | "heuristic";

export type ExplainReportInput = {
  report: TokenRiskReport;
  provider?: LlmProvider;
};

export type ExplainReportResult = {
  provider: LlmProvider;
  explanation: string;
  generatedAt: string;
};

function heuristicExplanation(report: TokenRiskReport): string {
  const { signals, riskScore, token, chain } = report;
  const topSignal = Object.entries(signals).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "contractRisk";

  const label = topSignal.replace(/([A-Z])/g, " $1").trim().toLowerCase();
  const band = riskScore >= 0.7 ? "elevated" : riskScore >= 0.4 ? "moderate" : "lower";

  return [
    `Heuristic summary for ${token} on ${chain}: overall risk is ${band} (${riskScore.toFixed(3)}).`,
    `The strongest signal is ${label} at ${(signals[topSignal as keyof typeof signals] ?? 0).toFixed(3)}.`,
    "This explanation is deterministic and does not call an external LLM.",
  ].join(" ");
}

async function callOpenAi(report: TokenRiskReport, apiKey: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Explain token risk reports in plain language for a commerce operator. Keep it under 120 words.",
        },
        {
          role: "user",
          content: JSON.stringify({
            token: report.token,
            chain: report.chain,
            riskScore: report.riskScore,
            signals: report.signals,
            modelVersion: report.modelVersion,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI returned an empty explanation");
  }
  return content;
}

async function callGrok(report: TokenRiskReport, apiKey: string): Promise<string> {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-2-latest",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Explain token risk reports in plain language for a commerce operator. Keep it under 120 words.",
        },
        {
          role: "user",
          content: JSON.stringify({
            token: report.token,
            chain: report.chain,
            riskScore: report.riskScore,
            signals: report.signals,
            modelVersion: report.modelVersion,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Grok request failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Grok returned an empty explanation");
  }
  return content;
}

function resolveProvider(explicit?: LlmProvider): LlmProvider {
  if (explicit) {
    return explicit;
  }

  const configured = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (configured === "grok" || configured === "openai" || configured === "heuristic") {
    return configured;
  }

  if (process.env.GROK_API_KEY?.trim()) {
    return "grok";
  }
  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai";
  }
  return "heuristic";
}

/** Generate a human-readable explanation for a signed token-risk report. */
export async function explainRiskReport(input: ExplainReportInput): Promise<ExplainReportResult> {
  const provider = resolveProvider(input.provider);
  const generatedAt = new Date().toISOString();

  if (provider === "heuristic") {
    return {
      provider,
      explanation: heuristicExplanation(input.report),
      generatedAt,
    };
  }

  try {
    const explanation =
      provider === "grok"
        ? await callGrok(input.report, process.env.GROK_API_KEY!.trim())
        : await callOpenAi(input.report, process.env.OPENAI_API_KEY!.trim());

    return { provider, explanation, generatedAt };
  } catch {
    return {
      provider: "heuristic",
      explanation: heuristicExplanation(input.report),
      generatedAt,
    };
  }
}
