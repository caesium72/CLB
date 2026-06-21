import type { TokenRiskReport } from "@clb-acel/schemas";

export type LlmProvider = "openai" | "grok" | "heuristic";

/** Chat model ids, overridable via env (model names rotate — keep this current). */
function grokModel(): string {
  return process.env.GROK_MODEL?.trim() || "grok-4.3";
}
function openaiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

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

  const label = topSignal
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase();
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
      model: openaiModel(),
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
      model: grokModel(),
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

export type MerchantCandidate = {
  agentId: string;
  name: string;
  description: string;
  supportedProtocols: string[];
  rejected?: boolean;
  rejectedReason?: string;
};

export type SelectMerchantInput = {
  intent: { task: string; token: string; budget: string; asset: string };
  candidates: MerchantCandidate[];
  selectedAgentId: string;
  provider?: LlmProvider;
};

export type SelectMerchantResult = {
  provider: LlmProvider;
  rationale: string;
  generatedAt: string;
};

const SELECTION_SYSTEM_PROMPT =
  "You are a shopping agent. In 1-2 sentences, explain why you selected a merchant for the user's task. Name any rejected candidates and why. Write in plain commerce language. Do NOT mention payment-protocol names or technical identifiers.";

/** Deterministic, network-free rationale (no Date, no randomness). */
function heuristicSelectionRationale(input: SelectMerchantInput): string {
  const selected =
    input.candidates.find((candidate) => candidate.agentId === input.selectedAgentId) ??
    input.candidates[0];
  const selectedName = selected?.name ?? "the recommended merchant";

  const rejected = input.candidates.filter(
    (candidate) => candidate.agentId !== input.selectedAgentId && candidate.rejected,
  );

  let sentence =
    `Selected ${selectedName} because it offers verified ${input.intent.task} for ` +
    `${input.intent.token} with confirmable payment receipts within the ` +
    `${input.intent.budget} ${input.intent.asset} budget`;

  if (rejected.length > 0) {
    const skipped = rejected
      .map(
        (candidate) =>
          `${candidate.name} (${candidate.rejectedReason ?? "did not meet the requirements"})`,
      )
      .join(", ");
    sentence += `; skipped ${skipped}`;
  }

  return `${sentence}.`;
}

/** Commerce-only payload shared by both providers (no protocol identifiers). */
function selectionUserMessage(input: SelectMerchantInput): string {
  return JSON.stringify({
    intent: {
      task: input.intent.task,
      token: input.intent.token,
      budget: input.intent.budget,
      asset: input.intent.asset,
    },
    candidates: input.candidates.map((candidate) => ({
      name: candidate.name,
      description: candidate.description,
      selected: candidate.agentId === input.selectedAgentId,
      rejectedReason: candidate.rejectedReason,
    })),
  });
}

async function callOpenAiForSelection(input: SelectMerchantInput, apiKey: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openaiModel(),
      temperature: 0.2,
      messages: [
        { role: "system", content: SELECTION_SYSTEM_PROMPT },
        { role: "user", content: selectionUserMessage(input) },
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
    throw new Error("OpenAI returned an empty rationale");
  }
  return content;
}

async function callGrokForSelection(input: SelectMerchantInput, apiKey: string): Promise<string> {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: grokModel(),
      temperature: 0.2,
      messages: [
        { role: "system", content: SELECTION_SYSTEM_PROMPT },
        { role: "user", content: selectionUserMessage(input) },
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
    throw new Error("Grok returned an empty rationale");
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

// ---------------------------------------------------------------------------
// LLM-driven agent selection (the shopping agent DECIDES which agent fits).
// Decision-layer only: recorded as evidence, never a verifier input.
// ---------------------------------------------------------------------------

export type AgentChoiceCandidate = {
  agentId: string;
  name: string;
  /** What the agent can do, in plain language. */
  description: string;
  supportedProtocols: string[];
};

export type AgentSelectionInput = {
  intent: {
    task: string;
    asset: string;
    maxPrice: string;
    network: string;
    /** When set, only these agentIds are acceptable to the human. */
    allowedAgentIds?: string[];
  };
  candidates: AgentChoiceCandidate[];
  provider?: LlmProvider;
};

export type AgentVerdict = { agentId: string; eligible: boolean; reason: string };

export type AgentSelectionResult = {
  provider: LlmProvider;
  /** The chosen agent, or null when none can fulfil the task within constraints. */
  selectedAgentId: string | null;
  reasoning: string;
  perAgent: AgentVerdict[];
  generatedAt: string;
};

const AGENT_SELECT_SYSTEM_PROMPT =
  "You are a shopping agent choosing which service agent can fulfil the user's task within their " +
  "constraints (asset, max price, network, and an optional allow-list of agent ids). Pick exactly " +
  "ONE agent whose capability matches the task, or none if no agent fits. " +
  'Return STRICT JSON only: {"selectedAgentId": string|null, "reasoning": string, ' +
  '"perAgent": [{"agentId": string, "eligible": boolean, "reason": string}]}. ' +
  "Judge capability by the agent description vs the task. Plain commerce language, JSON only.";

/** Deterministic capability match: keyword overlap between task and agent name/description. */
function heuristicAgentSelection(input: AgentSelectionInput): Omit<AgentSelectionResult, "provider" | "generatedAt"> {
  const task = input.intent.task.toLowerCase();
  const allow = input.intent.allowedAgentIds;
  const WEATHER = ["weather", "forecast", "temperature", "climate", "rain", "sunny"];
  const GRAMMAR = ["grammar", "proofread", "spelling", "spell", "punctuation", "correct", "edit", "rewrite", "text"];

  const perAgent: AgentVerdict[] = input.candidates.map((c) => {
    const hay = `${c.name} ${c.description}`.toLowerCase();
    const isWeather = WEATHER.some((k) => hay.includes(k));
    const isGrammar = GRAMMAR.some((k) => hay.includes(k));
    const taskWantsWeather = WEATHER.some((k) => task.includes(k));
    const taskWantsGrammar = GRAMMAR.some((k) => task.includes(k));
    const capabilityMatch =
      (isWeather && taskWantsWeather) || (isGrammar && taskWantsGrammar);
    const allowed = !allow || allow.length === 0 || allow.includes(c.agentId);
    const eligible = capabilityMatch && allowed;
    const reason = !allowed
      ? "Not in the allowed-agents list."
      : capabilityMatch
        ? "Capability matches the requested task."
        : "Capability does not match the requested task.";
    return { agentId: c.agentId, eligible, reason };
  });

  const winner = perAgent.find((v) => v.eligible);
  return {
    selectedAgentId: winner?.agentId ?? null,
    reasoning: winner
      ? `Selected ${input.candidates.find((c) => c.agentId === winner.agentId)?.name ?? winner.agentId} — its capability matches the task within your constraints.`
      : "No available agent can fulfil this task within your constraints.",
    perAgent,
  };
}

async function callChatForSelection(
  provider: "openai" | "grok",
  apiKey: string,
  input: AgentSelectionInput,
): Promise<Omit<AgentSelectionResult, "provider" | "generatedAt">> {
  const url = provider === "grok" ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = provider === "grok" ? grokModel() : openaiModel();
  const user = JSON.stringify({
    task: input.intent.task,
    constraints: {
      asset: input.intent.asset,
      maxPrice: input.intent.maxPrice,
      network: input.intent.network,
      allowedAgentIds: input.intent.allowedAgentIds ?? null,
    },
    candidates: input.candidates.map((c) => ({
      agentId: c.agentId,
      name: c.name,
      description: c.description,
    })),
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: AGENT_SELECT_SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`${provider} request failed (${response.status})`);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error(`${provider} returned an empty selection`);
  const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
    selectedAgentId?: string | null;
    reasoning?: string;
    perAgent?: AgentVerdict[];
  };
  // Guard: the model must only pick a real candidate id.
  const valid = input.candidates.some((c) => c.agentId === parsed.selectedAgentId);
  return {
    selectedAgentId: valid ? (parsed.selectedAgentId as string) : null,
    reasoning: parsed.reasoning ?? "",
    perAgent: Array.isArray(parsed.perAgent) ? parsed.perAgent : [],
  };
}

/**
 * Choose which agent fulfils the task. LLM-driven with a deterministic fallback;
 * never throws. The result is recorded as decision-layer evidence, not enforced.
 */
export async function selectAgentForTask(input: AgentSelectionInput): Promise<AgentSelectionResult> {
  const provider = resolveProvider(input.provider);
  const generatedAt = new Date().toISOString();
  if (provider === "heuristic") {
    return { provider, ...heuristicAgentSelection(input), generatedAt };
  }
  try {
    const apiKey =
      provider === "grok" ? process.env.GROK_API_KEY!.trim() : process.env.OPENAI_API_KEY!.trim();
    const result = await callChatForSelection(provider, apiKey, input);
    // If the model couldn't pick a valid candidate, fall back to the deterministic match.
    if (result.selectedAgentId === null && input.candidates.length > 0) {
      const h = heuristicAgentSelection(input);
      if (h.selectedAgentId) return { provider, ...h, generatedAt };
    }
    return { provider, ...result, generatedAt };
  } catch {
    return { provider: "heuristic", ...heuristicAgentSelection(input), generatedAt };
  }
}

// ---------------------------------------------------------------------------
// Grammar-checker agent capability (real merchant work).
// ---------------------------------------------------------------------------

export type GrammarIssue = {
  original: string;
  suggestion: string;
  explanation: string;
};

export type GrammarResult = {
  provider: LlmProvider;
  correctedText: string;
  issues: GrammarIssue[];
  summary: string;
  generatedAt: string;
};

const GRAMMAR_SYSTEM_PROMPT =
  "You are a precise grammar, spelling, and punctuation checker. Given a passage, " +
  'return STRICT JSON only: {"correctedText": string, "issues": [{"original": string, ' +
  '"suggestion": string, "explanation": string}], "summary": string}. Fix grammar, spelling, ' +
  "and punctuation while preserving the author's meaning. Output JSON only — no prose, no code fences.";

/** Deterministic, network-free grammar pass (no Date, no randomness). */
function heuristicGrammar(text: string): Omit<GrammarResult, "provider" | "generatedAt"> {
  const issues: GrammarIssue[] = [];
  const original = text;
  let corrected = text.replace(/[ \t]+/g, " ").replace(/\s+\n/g, "\n").trim();
  if (corrected !== original.trim()) {
    issues.push({
      original: "uneven spacing",
      suggestion: "single spaces",
      explanation: "Collapsed repeated whitespace.",
    });
  }
  const iFixed = corrected.replace(/(^|\s)i(\s|$|[.,!?])/g, (_m, a: string, b: string) => `${a}I${b}`);
  if (iFixed !== corrected) {
    issues.push({ original: "i", suggestion: "I", explanation: "Capitalized the pronoun 'I'." });
    corrected = iFixed;
  }
  const first = corrected[0];
  if (first !== undefined && first !== first.toUpperCase()) {
    issues.push({
      original: first,
      suggestion: first.toUpperCase(),
      explanation: "Capitalized the first letter of the sentence.",
    });
    corrected = first.toUpperCase() + corrected.slice(1);
  }
  if (corrected.length > 0 && !/[.!?]$/.test(corrected)) {
    issues.push({
      original: "(missing terminal punctuation)",
      suggestion: ".",
      explanation: "Added a period at the end of the sentence.",
    });
    corrected = `${corrected}.`;
  }
  const summary =
    issues.length === 0
      ? "No grammar issues found."
      : `Found and fixed ${issues.length} issue${issues.length === 1 ? "" : "s"}.`;
  return { correctedText: corrected, issues, summary };
}

async function callChatForGrammar(
  provider: "openai" | "grok",
  apiKey: string,
  text: string,
): Promise<Omit<GrammarResult, "provider" | "generatedAt">> {
  const url = provider === "grok" ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = provider === "grok" ? grokModel() : openaiModel();
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: GRAMMAR_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`${provider} request failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`${provider} returned an empty grammar result`);
  }
  const json = content.replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed = JSON.parse(json) as {
    correctedText?: string;
    issues?: GrammarIssue[];
    summary?: string;
  };
  if (typeof parsed.correctedText !== "string") {
    throw new Error(`${provider} returned malformed grammar JSON`);
  }
  return {
    correctedText: parsed.correctedText,
    issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 25) : [],
    summary: parsed.summary ?? "Grammar check complete.",
  };
}

/**
 * Real grammar-checking merchant capability. Uses the configured LLM (Grok/OpenAI)
 * and falls back to a deterministic pass when no provider/key is set or a call
 * fails — so the agent always delivers a signable artifact. Never throws.
 */
export async function checkGrammar(input: {
  text: string;
  provider?: LlmProvider;
}): Promise<GrammarResult> {
  const provider = resolveProvider(input.provider);
  const generatedAt = new Date().toISOString();
  const text = input.text ?? "";

  if (provider === "heuristic") {
    return { provider, ...heuristicGrammar(text), generatedAt };
  }
  try {
    const apiKey =
      provider === "grok" ? process.env.GROK_API_KEY!.trim() : process.env.OPENAI_API_KEY!.trim();
    const result = await callChatForGrammar(provider, apiKey, text);
    return { provider, ...result, generatedAt };
  } catch {
    return { provider: "heuristic", ...heuristicGrammar(text), generatedAt };
  }
}

/**
 * Narrate WHY a merchant was selected, in plain commerce language.
 *
 * Audit-only: this rationale is recorded as evidence but never enforced by the
 * verifier. Always resolves (never throws); falls back to a deterministic
 * heuristic when no provider/API key is configured or any call fails.
 */
export async function selectMerchantWithRationale(
  input: SelectMerchantInput,
): Promise<SelectMerchantResult> {
  const provider = resolveProvider(input.provider);
  const generatedAt = new Date().toISOString();

  if (provider === "heuristic") {
    return {
      provider,
      rationale: heuristicSelectionRationale(input),
      generatedAt,
    };
  }

  try {
    const rationale =
      provider === "grok"
        ? await callGrokForSelection(input, process.env.GROK_API_KEY!.trim())
        : await callOpenAiForSelection(input, process.env.OPENAI_API_KEY!.trim());

    return { provider, rationale, generatedAt };
  } catch {
    return {
      provider: "heuristic",
      rationale: heuristicSelectionRationale(input),
      generatedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Feedback-score explanation (the client agent explains, in plain language,
// WHY it left this reputation score). The score and pass/fail factors are
// FIXED deterministic inputs from the verifier — the LLM only narrates them.
// Decision-layer prose only: never a verifier input.
// ---------------------------------------------------------------------------

export type FeedbackFactorInput = { label: string; ok: boolean };

export type ExplainFeedbackInput = {
  agentName: string;
  service: string;
  score: number;
  status: "PASS" | "FAIL" | "WARNING";
  rulesPassed: number;
  rulesChecked: number;
  factors: FeedbackFactorInput[];
  provider?: LlmProvider;
};

export type ExplainFeedbackResult = {
  provider: LlmProvider;
  explanation: string;
  generatedAt: string;
};

function heuristicFeedbackExplanation(input: ExplainFeedbackInput): string {
  const failed = input.factors.filter((factor) => !factor.ok);
  if (input.status === "PASS" && failed.length === 0) {
    return (
      `Gave ${input.agentName} ${input.score}/100: all ${input.rulesChecked} binding checks passed — ` +
      `the ${input.service} job was delivered, paid within budget, and cryptographically bound to the payment.`
    );
  }
  const issues = failed.map((factor) => factor.label.toLowerCase()).join("; ");
  return (
    `Gave ${input.agentName} ${input.score}/100: ${input.rulesPassed}/${input.rulesChecked} checks passed. ` +
    `Concerns: ${issues || "one or more binding checks did not hold"}.`
  );
}

const FEEDBACK_SYSTEM_PROMPT =
  "You are a client agent leaving a reputation score for a service agent after a job. " +
  "The numeric score and the list of pass/fail factors are FIXED facts from a deterministic " +
  "verifier — you must NOT change them or invent new ones. Explain, in ONE or TWO plain " +
  "commerce sentences, why this score was given, grounded only in those factors. No protocol " +
  "jargon, no rule ids, no markdown.";

function feedbackUserMessage(input: ExplainFeedbackInput): string {
  const lines = input.factors.map((factor) => `- ${factor.ok ? "OK" : "FAILED"}: ${factor.label}`);
  return (
    `Agent: ${input.agentName} (service: ${input.service})\n` +
    `Score: ${input.score}/100 (${input.status})\n` +
    `Checks passed: ${input.rulesPassed}/${input.rulesChecked}\n` +
    `Factors:\n${lines.join("\n")}`
  );
}

async function callChatForFeedback(
  input: ExplainFeedbackInput,
  provider: "grok" | "openai",
  apiKey: string,
): Promise<string> {
  const url = provider === "grok" ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: provider === "grok" ? grokModel() : openaiModel(),
      temperature: 0.2,
      messages: [
        { role: "system", content: FEEDBACK_SYSTEM_PROMPT },
        { role: "user", content: feedbackUserMessage(input) },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`${provider} request failed (${response.status})`);
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`${provider} returned an empty explanation`);
  }
  return content;
}

/** Plain-language narration of a deterministic feedback score (heuristic fallback). */
export async function explainFeedbackScore(input: ExplainFeedbackInput): Promise<ExplainFeedbackResult> {
  const provider = resolveProvider(input.provider);
  const generatedAt = new Date().toISOString();
  if (provider === "heuristic") {
    return { provider, explanation: heuristicFeedbackExplanation(input), generatedAt };
  }
  try {
    const explanation = await callChatForFeedback(
      input,
      provider,
      (provider === "grok" ? process.env.GROK_API_KEY! : process.env.OPENAI_API_KEY!).trim(),
    );
    return { provider, explanation, generatedAt };
  } catch {
    return { provider: "heuristic", explanation: heuristicFeedbackExplanation(input), generatedAt };
  }
}
