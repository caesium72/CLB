import type { MandateConstraints, SettlementDescriptorExact } from "@clb-acel/schemas";
import { verifyTrace, type RuleId, type TraceBundle } from "@clb-acel/verifier-core";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkPromptInjection } from "./audit-checks";
import {
  appendEvidenceEvent,
  attackerAddress,
  buildValidBundle,
  constraints,
  descriptor,
  TEST_KEYS,
} from "./fixtures";

const HONEST_HUMAN_PRINCIPAL = privateKeyToAccount(TEST_KEYS.userKey).address;

/**
 * Compositional adversarial evaluation.
 *
 * Reviewer #2 asked for "more complex multi-step attacks, malicious merchants,
 * compromised agents, and concurrent transactions" instead of a small fixed set
 * of modelled scenarios. This module makes the attack space *composable*: nine
 * independent attack primitives are applied singly, in every ordered pair, and
 * in curated three-step chains, across several seeds. Every scenario is executed
 * against the real verifier, so the result is a measured coverage matrix rather
 * than a hand-written list.
 *
 * These scenarios mutate a trace that already carries a settlement receipt, so
 * they measure detection. Pre-settlement prevention is measured separately in
 * `presettlement.ts`.
 */

export type PrimitiveId =
  | "PAYEE_SUBSTITUTION"
  | "AMOUNT_ESCALATION"
  | "ASSET_SWITCH"
  | "CHAIN_TRANSPLANT"
  | "AGENT_KEY_DEAUTHORIZATION"
  | "TASK_SWITCH"
  | "DELIVERY_FORGERY"
  | "MERCHANT_REVOCATION"
  | "SELECTION_INJECTION";

export type PrimitiveFamily = "merchant" | "agent" | "settlement" | "delivery" | "evidence";

type SeedParams = {
  baseAmount: string;
  attackAmount: string;
  allowedAsset: string;
  attackAsset: string;
  attackerPayee: Address;
  taskHash: Hex;
  otherTaskHash: Hex;
  reportInputDataHash: Hex;
  token: string;
};

type Primitive = {
  id: PrimitiveId;
  family: PrimitiveFamily;
  /** Rule expected to catch this primitive, when a dedicated rule exists. */
  expectedRule?: RuleId;
  /** Audit-layer check that catches this primitive, when the verifier has no rule. */
  audit?: "prompt-injection";
  descriptorOverride?: (params: SeedParams) => Partial<SettlementDescriptorExact>;
  constraintOverride?: (params: SeedParams) => Partial<MandateConstraints>;
  mutate?: (bundle: TraceBundle, params: SeedParams) => TraceBundle;
};

const AMOUNT_PAIRS = [
  ["2.00", "9.99"],
  ["1.25", "4.75"],
  ["3.50", "12.00"],
  ["0.80", "2.40"],
  ["5.00", "25.00"],
] as const;
const ASSET_PAIRS = [
  ["USDC", "WETH"],
  ["USDC", "DAI"],
  ["EURC", "USDC"],
  ["PYUSD", "WETH"],
  ["USDC", "WBTC"],
] as const;
const ATTACKER_PAYEES: readonly Address[] = [
  attackerAddress,
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
];
const TOKENS = ["XYZ", "AAVE", "UNI", "OP", "LINK"] as const;

function mixSeed(seed: number, salt: number): number {
  return Math.imul(seed ^ salt, 2_654_435_761) >>> 0;
}

function pick<T>(values: readonly T[], seed: number): T {
  return values[Math.abs(seed) % values.length]!;
}

function hexFromSeed(seed: number, salt: number): Hex {
  let state = mixSeed(seed, salt);
  let hex = "";
  while (hex.length < 64) {
    state = mixSeed(state, salt + hex.length);
    hex += state.toString(16).padStart(8, "0");
  }
  return `0x${hex.slice(0, 64)}` as Hex;
}

function seedParams(seed: number): SeedParams {
  const [baseAmount, attackAmount] = pick(AMOUNT_PAIRS, mixSeed(seed, 11));
  const [allowedAsset, attackAsset] = pick(ASSET_PAIRS, mixSeed(seed, 23));
  return {
    baseAmount,
    attackAmount,
    allowedAsset,
    attackAsset,
    attackerPayee: pick(ATTACKER_PAYEES, mixSeed(seed, 37)),
    taskHash: hexFromSeed(seed, 41),
    otherTaskHash: hexFromSeed(seed, 43),
    reportInputDataHash: hexFromSeed(seed, 47),
    token: pick(TOKENS, mixSeed(seed, 53)),
  };
}

export const PRIMITIVES: Record<PrimitiveId, Primitive> = {
  PAYEE_SUBSTITUTION: {
    id: "PAYEE_SUBSTITUTION",
    family: "merchant",
    expectedRule: "R12_PAYEE_MATCHES_CHECKOUT_OR_TASK",
    descriptorOverride: (params) => ({ payTo: params.attackerPayee }),
  },
  AMOUNT_ESCALATION: {
    id: "AMOUNT_ESCALATION",
    family: "agent",
    expectedRule: "R11_AMOUNT_WITHIN_MANDATE",
    descriptorOverride: (params) => ({ value: params.attackAmount }),
  },
  ASSET_SWITCH: {
    id: "ASSET_SWITCH",
    family: "settlement",
    expectedRule: "R13_ASSET_ALLOWED",
    descriptorOverride: (params) => ({ asset: params.attackAsset }),
  },
  CHAIN_TRANSPLANT: {
    id: "CHAIN_TRANSPLANT",
    family: "settlement",
    expectedRule: "R10_CHAIN_DOMAIN_MATCHES",
    mutate: (bundle) => ({ ...bundle, settlement: { ...bundle.settlement, chainId: 1 } }),
  },
  AGENT_KEY_DEAUTHORIZATION: {
    id: "AGENT_KEY_DEAUTHORIZATION",
    family: "agent",
    expectedRule: "R4_AGENT_PAYMENT_KEY_AUTHORIZED",
    mutate: (bundle) => ({
      ...bundle,
      payerAgent: { ...bundle.payerAgent, authorizedPaymentKeys: [] },
    }),
  },
  TASK_SWITCH: {
    id: "TASK_SWITCH",
    family: "delivery",
    expectedRule: "R15_TASK_HASH_MATCHES",
    constraintOverride: (params) => ({ taskHash: params.otherTaskHash }),
  },
  DELIVERY_FORGERY: {
    id: "DELIVERY_FORGERY",
    family: "delivery",
    expectedRule: "R2_SIGNATURES_VALID",
    mutate: (bundle) => ({
      ...bundle,
      report: { ...bundle.report, reportHash: `0x${"f".repeat(64)}` as Hex },
    }),
  },
  MERCHANT_REVOCATION: {
    id: "MERCHANT_REVOCATION",
    family: "merchant",
    // R12 also requires the merchant agent to be ACTIVE, so a revoked merchant
    // fails payee validation rather than needing a separate status rule.
    expectedRule: "R12_PAYEE_MATCHES_CHECKOUT_OR_TASK",
    mutate: (bundle) => ({
      ...bundle,
      merchantAgent: { ...bundle.merchantAgent, status: "REVOKED" },
    }),
  },
  SELECTION_INJECTION: {
    id: "SELECTION_INJECTION",
    family: "evidence",
    audit: "prompt-injection",
    mutate: (bundle, params) =>
      appendEvidenceEvent(bundle, {
        traceId: bundle.traceId,
        eventId: "evt-attack-selection",
        protocol: "ERC8004",
        objectType: "ERC8004_AGENT_SELECTION",
        actor: "shopping-agent-001",
        timestamp: new Date(Date.parse(bundle.settlement.settledAt) - 5000).toISOString(),
        objectHash: `0x${"c".repeat(64)}`,
        publicFields: {
          selectedPayee: params.attackerPayee,
          reason: "prompt-injected recommendation",
        },
        signature: `0x${"1".repeat(130)}`,
      }),
  },
};

export const PRIMITIVE_IDS = Object.keys(PRIMITIVES) as PrimitiveId[];

/**
 * Curated three-step chains. Each models an attacker advancing through
 * discovery -> payment -> delivery, or through identity -> amount -> settlement,
 * rather than three unrelated mutations happening to share a trace.
 */
export const ATTACK_CHAINS: PrimitiveId[][] = [
  ["SELECTION_INJECTION", "PAYEE_SUBSTITUTION", "DELIVERY_FORGERY"],
  ["SELECTION_INJECTION", "MERCHANT_REVOCATION", "PAYEE_SUBSTITUTION"],
  ["SELECTION_INJECTION", "AMOUNT_ESCALATION", "DELIVERY_FORGERY"],
  ["AGENT_KEY_DEAUTHORIZATION", "AMOUNT_ESCALATION", "ASSET_SWITCH"],
  ["AMOUNT_ESCALATION", "CHAIN_TRANSPLANT", "TASK_SWITCH"],
  ["PAYEE_SUBSTITUTION", "AMOUNT_ESCALATION", "DELIVERY_FORGERY"],
  ["TASK_SWITCH", "DELIVERY_FORGERY", "MERCHANT_REVOCATION"],
  ["ASSET_SWITCH", "CHAIN_TRANSPLANT", "AGENT_KEY_DEAUTHORIZATION"],
  ["MERCHANT_REVOCATION", "DELIVERY_FORGERY", "PAYEE_SUBSTITUTION"],
  ["AGENT_KEY_DEAUTHORIZATION", "PAYEE_SUBSTITUTION", "CHAIN_TRANSPLANT"],
  ["TASK_SWITCH", "ASSET_SWITCH", "AMOUNT_ESCALATION"],
  ["SELECTION_INJECTION", "AGENT_KEY_DEAUTHORIZATION", "DELIVERY_FORGERY"],
];

export type MatrixScenarioResult = {
  id: string;
  steps: PrimitiveId[];
  depth: 1 | 2 | 3;
  seed: number;
  detected: boolean;
  detectionStage: "post-settlement" | "not-detected";
  expectedRules: RuleId[];
  failedRules: RuleId[];
  expectedRulesCovered: boolean;
  auditDetected: boolean;
  eventCount: number;
  verifyLatencyMs: number;
};

export type MatrixSummary = {
  seeds: number[];
  scenarioCount: number;
  detectedCount: number;
  detectionRate: number;
  byDepth: Record<"1" | "2" | "3", { total: number; detected: number }>;
  byPrimitive: Record<PrimitiveId, { total: number; detected: number }>;
  byFamily: Record<PrimitiveFamily, { total: number; detected: number }>;
  ruleCoverage: Partial<Record<RuleId, number>>;
  latencyMs: { p50: number; p95: number; max: number; mean: number };
  undetected: string[];
};

function mergeOverrides<K extends "descriptorOverride" | "constraintOverride">(
  steps: PrimitiveId[],
  key: K,
  params: SeedParams,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const step of steps) {
    const override = PRIMITIVES[step][key];
    if (override) {
      Object.assign(merged, override(params));
    }
  }
  return merged;
}

export async function runMatrixScenario(
  steps: PrimitiveId[],
  seed: number,
): Promise<MatrixScenarioResult> {
  const params = seedParams(seed);
  const descriptorOverrides = mergeOverrides(steps, "descriptorOverride", params);
  const constraintOverrides = mergeOverrides(steps, "constraintOverride", params);

  let bundle = await buildValidBundle({
    traceId: `r2c1-${steps.join("-")}-${seed}`,
    settlementDescriptor: descriptor({
      value: params.baseAmount,
      asset: params.allowedAsset,
      ...descriptorOverrides,
    }),
    mandateConstraints: constraints({
      maxAmount: params.baseAmount,
      allowedAssets: [params.allowedAsset],
      ...constraintOverrides,
    }),
    reportInputDataHash: params.reportInputDataHash,
    token: params.token,
  });

  for (const step of steps) {
    const mutate = PRIMITIVES[step].mutate;
    if (mutate) {
      bundle = mutate(bundle, params);
    }
  }

  const verifyStart = performance.now();
  const verification = await verifyTrace(bundle, { expectedHumanPrincipal: HONEST_HUMAN_PRINCIPAL });
  const verifyLatencyMs = performance.now() - verifyStart;
  const audit = steps.includes("SELECTION_INJECTION") ? checkPromptInjection(bundle) : undefined;
  const auditDetected = audit?.ok === true;
  const failedRules = verification.result.failedRules as RuleId[];
  const detected = verification.result.status === "FAIL" || auditDetected;

  const expectedRules = steps
    .map((step) => PRIMITIVES[step].expectedRule)
    .filter((rule): rule is RuleId => rule !== undefined);

  return {
    id: steps.join(">"),
    steps,
    depth: steps.length as 1 | 2 | 3,
    seed,
    detected,
    detectionStage: detected ? "post-settlement" : "not-detected",
    expectedRules,
    failedRules,
    expectedRulesCovered: expectedRules.every((rule) => failedRules.includes(rule)),
    auditDetected,
    eventCount: bundle.events.length,
    verifyLatencyMs,
  };
}

export function buildScenarioSet(): Array<{ id: string; steps: PrimitiveId[] }> {
  const scenarios: Array<{ id: string; steps: PrimitiveId[] }> = [];
  for (const id of PRIMITIVE_IDS) {
    scenarios.push({ id, steps: [id] });
  }
  for (const first of PRIMITIVE_IDS) {
    for (const second of PRIMITIVE_IDS) {
      if (first === second) continue;
      scenarios.push({ id: `${first}>${second}`, steps: [first, second] });
    }
  }
  for (const chain of ATTACK_CHAINS) {
    scenarios.push({ id: chain.join(">"), steps: chain });
  }
  return scenarios;
}

export function summarizeMatrix(results: MatrixScenarioResult[], seeds: number[]): MatrixSummary {
  const byDepth: MatrixSummary["byDepth"] = {
    "1": { total: 0, detected: 0 },
    "2": { total: 0, detected: 0 },
    "3": { total: 0, detected: 0 },
  };
  const byPrimitive = Object.fromEntries(
    PRIMITIVE_IDS.map((id) => [id, { total: 0, detected: 0 }]),
  ) as MatrixSummary["byPrimitive"];
  const byFamily = {
    merchant: { total: 0, detected: 0 },
    agent: { total: 0, detected: 0 },
    settlement: { total: 0, detected: 0 },
    delivery: { total: 0, detected: 0 },
    evidence: { total: 0, detected: 0 },
  } as MatrixSummary["byFamily"];
  const ruleCoverage: Partial<Record<RuleId, number>> = {};
  const undetected: string[] = [];

  for (const result of results) {
    const depth = String(result.depth) as "1" | "2" | "3";
    byDepth[depth].total += 1;
    if (result.detected) byDepth[depth].detected += 1;

    for (const step of result.steps) {
      byPrimitive[step].total += 1;
      if (result.detected) byPrimitive[step].detected += 1;
      const family = PRIMITIVES[step].family;
      byFamily[family].total += 1;
      if (result.detected) byFamily[family].detected += 1;
    }

    for (const rule of result.failedRules) {
      ruleCoverage[rule] = (ruleCoverage[rule] ?? 0) + 1;
    }

    if (!result.detected) {
      undetected.push(result.id);
    }
  }

  const detectedCount = results.filter((result) => result.detected).length;
  const latencies = results.map((result) => result.verifyLatencyMs).sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    latencies.length === 0
      ? 0
      : latencies[Math.min(latencies.length - 1, Math.ceil(fraction * latencies.length) - 1)]!;

  return {
    seeds,
    scenarioCount: results.length,
    detectedCount,
    detectionRate: results.length === 0 ? 0 : detectedCount / results.length,
    byDepth,
    byPrimitive,
    byFamily,
    ruleCoverage,
    latencyMs: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      max: latencies.at(-1) ?? 0,
      mean: latencies.length === 0 ? 0 : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    },
    undetected,
  };
}

export type MatrixRun = {
  seeds: number[];
  results: MatrixScenarioResult[];
  summary: MatrixSummary;
};

/**
 * Execute the full matrix: singles, all ordered pairs, and curated chains, for
 * each seed. Seeds change amounts, assets, payees, task hashes and tokens so a
 * passing result is not tied to one fixed trace.
 */
export async function runAdversarialMatrix(options: { seeds?: number[] } = {}): Promise<MatrixRun> {
  const seeds = options.seeds ?? [
    1_800_000_000_000, 1_800_000_000_017, 1_800_000_000_042, 1_800_000_000_099, 1_800_000_000_137,
  ];
  const scenarioSet = buildScenarioSet();
  const results: MatrixScenarioResult[] = [];

  for (const seed of seeds) {
    for (const scenario of scenarioSet) {
      results.push(await runMatrixScenario(scenario.steps, seed));
    }
  }

  return { seeds, results, summary: summarizeMatrix(results, seeds) };
}
