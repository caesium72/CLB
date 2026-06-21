/**
 * Merchant-agent service delivery — the single source of truth for what the two
 * real agents produce. Used by the in-process flow (runHumanPresent/runDelegated)
 * AND re-exported to the web-demo agent routes, so the artifact a buyer receives
 * is identical whether driven by the orchestrator or hit directly.
 *
 * No import of ./flow (keeps it cycle-free; flow.ts imports this).
 */
import { buildSignedServiceReport, signDeliveryBinding } from "@clb-acel/delivery-core";
import { checkGrammar, type GrammarResult } from "@clb-acel/llm-adapter";
import { DEFAULT_GRAMMAR_AGENT_ID, DEFAULT_WEATHER_AGENT_ID } from "@clb-acel/identity-service/seed";
import type { ServiceReport } from "@clb-acel/schemas";
import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type ServiceKind = "grammar" | "weather";

// Anvil fallbacks — MUST match identity-service/seed so each card's signing key
// equals the key that signs the ServiceReport (verifier R2/R4).
const DEFAULT_GRAMMAR_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const DEFAULT_WEATHER_KEY =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const;

export function agentKey(kind: ServiceKind): Hex {
  if (kind === "grammar") {
    return (process.env.GRAMMAR_AGENT_PRIVATE_KEY?.trim() || DEFAULT_GRAMMAR_KEY) as Hex;
  }
  return (process.env.WEATHER_AGENT_PRIVATE_KEY?.trim() ||
    process.env.SHOPPING_AGENT_PRIVATE_KEY?.trim() ||
    DEFAULT_WEATHER_KEY) as Hex;
}

export function agentAddress(kind: ServiceKind): Address {
  return privateKeyToAccount(agentKey(kind)).address;
}

/** Deterministic capability routing (the LLM-driven, evidence-recorded choice is in discover). */
export function serviceKindForIntent(input: { task: string; token?: string }): ServiceKind {
  const text = `${input.task} ${input.token ?? ""}`.toLowerCase();
  const weather = ["weather", "forecast", "temperature", "climate", "rain", "sunny"];
  return weather.some((k) => text.includes(k)) ? "weather" : "grammar";
}

export function merchantIdForKind(kind: ServiceKind): string {
  return kind === "weather" ? DEFAULT_WEATHER_AGENT_ID : DEFAULT_GRAMMAR_AGENT_ID;
}

/**
 * Service-aware x402 framing: the resource path the buyer is paying for and a
 * plain-language description. Replaces the legacy token-risk template
 * (`/risk-report?token=…`, "Token-risk report for …") so the 402 reflects the
 * agent that was actually selected (grammar vs weather) and its real subject.
 */
export function servicePaymentFraming(
  kind: ServiceKind,
  intent: { input?: string },
): { resourcePath: string; description: string } {
  if (kind === "weather") {
    const city = (intent.input ?? "").trim() || "the requested city";
    return {
      resourcePath: `forecast?city=${encodeURIComponent(city)}`,
      description: `Weather forecast for ${city}`,
    };
  }
  return { resourcePath: "proofread", description: "Proofread and correct the submitted text" };
}

export type WeatherForecast = {
  city: string;
  temperatureC: number;
  condition: string;
  summary: string;
  source: string;
};

const CONDITIONS = [
  "Clear",
  "Partly cloudy",
  "Cloudy",
  "Light rain",
  "Showers",
  "Windy",
  "Foggy",
  "Sunny",
] as const;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function weatherForecast(city: string): WeatherForecast {
  const seed = hashString(city.toLowerCase());
  const temperatureC = (seed % 35) - 5;
  const condition = CONDITIONS[seed % CONDITIONS.length]!;
  return {
    city,
    temperatureC,
    condition,
    summary: `${condition} in ${city}, around ${temperatureC}°C.`,
    source: "demo-deterministic",
  };
}

export type DeliveryDetail = GrammarResult | WeatherForecast;

/**
 * Produce the selected agent's signed ServiceReport for the given input, optionally
 * binding it to the settlement that paid for it (R14b). The merchant signs with its
 * own agent key, which matches its ERC-8004 card's authorized signing key.
 */
export async function deliverServiceReport(
  kind: ServiceKind,
  opts: {
    input: string;
    settlementTxHash?: string;
    generatedAt?: string;
    /** Force the deterministic (network-free) grammar pass for reproducible traces. */
    deterministic?: boolean;
  },
): Promise<{ report: ServiceReport; detail: DeliveryDetail }> {
  const key = agentKey(kind);

  let report: ServiceReport;
  let detail: DeliveryDetail;
  if (kind === "grammar") {
    const grammar = await checkGrammar({
      text: opts.input,
      ...(opts.deterministic ? { provider: "heuristic" as const } : {}),
    });
    detail = grammar;
    report = await buildSignedServiceReport(key, {
      service: "grammar",
      task: "Proofread and correct the submitted text",
      input: { text: opts.input },
      result: {
        correctedText: grammar.correctedText,
        issues: grammar.issues,
        summary: grammar.summary,
        provider: grammar.provider,
      },
      modelVersion: `grammar-${grammar.provider}-v1`,
      ...(opts.generatedAt ? { generatedAt: opts.generatedAt } : {}),
    });
  } else {
    const forecast = weatherForecast(opts.input);
    detail = forecast;
    report = await buildSignedServiceReport(key, {
      service: "weather",
      task: `Weather forecast for ${opts.input}`,
      input: { city: opts.input },
      result: { ...forecast },
      modelVersion: "weather-deterministic-v1",
      ...(opts.generatedAt ? { generatedAt: opts.generatedAt } : {}),
    });
  }

  if (opts.settlementTxHash) {
    const deliveryBinding = await signDeliveryBinding({
      settlementTxHash: opts.settlementTxHash,
      reportHash: report.reportHash,
      merchantKey: key,
    });
    report = { ...report, deliveryBinding };
  }

  return { report, detail };
}
