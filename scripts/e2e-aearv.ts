import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TEST_KEYS,
  attackerAddress,
  breakReportHash,
  buildValidBundle,
  constraints,
  descriptor,
} from "@clb-acel/attack-core";
import type { TraceBundle } from "@clb-acel/verifier-core";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recomputeEvidenceIntegrity } from "../packages/attack-core/src/trace-utils";
import {
  MANDATORY_RULES,
  VERIFICATION_LEVELS,
  computeRiskScore,
  createHumanApproval,
  verifyAdaptive,
  verifyAtLevel,
  type AdaptiveContext,
  type AdaptiveVerifyOutput,
  type RiskFactors,
  type VerificationLevel,
} from "../packages/verifier-core/src/adaptive";

/**
 * Novelty 5 evaluation — fixed V1 vs risk-adaptive vs always-V3.
 *
 * Every strategy verifies the SAME seeded corpus. The base `verifyTrace` call is
 * identical across strategies; only the additive checks differ. The risk model
 * is a deterministic prototype, not a model calibrated on external data.
 */

const SEEDS = [1_800_000_000_000, 1_800_000_000_017, 1_800_000_000_042] as const;
const HUMAN = privateKeyToAccount(TEST_KEYS.userKey).address;
const OUTPUT_DIR = join(process.cwd(), "experiments", "novelty", "aearv");

const LOW: RiskFactors = {
  identityAssurance: 1,
  authorizationRisk: 0,
  settlementRisk: 0,
  deliveryRisk: 0,
  historyRisk: 0,
};
const MEDIUM: RiskFactors = {
  identityAssurance: 1,
  authorizationRisk: 1,
  settlementRisk: 0.5,
  deliveryRisk: 0,
  historyRisk: 0,
};
const HIGH: RiskFactors = {
  identityAssurance: 0,
  authorizationRisk: 1,
  settlementRisk: 1,
  deliveryRisk: 1,
  historyRisk: 1,
};

type CaseKind = "honest" | "attack" | "policy-gap";
type CorpusCase = {
  id: string;
  seed: number;
  kind: CaseKind;
  label: string;
  bundle: TraceBundle;
  risk: RiskFactors;
  /** Trusted root supplied out-of-band (defaults to the bundle's own root). */
  trustedRoot?: Hex;
  withApproval: boolean;
};

function pick<T>(values: readonly T[], seed: number): T {
  return values[Math.abs(seed) % values.length]!;
}

const TOKENS = ["XYZ", "AAVE", "UNI", "OP", "LINK"] as const;
const AMOUNTS = ["2.00", "1.25", "3.50", "0.80", "5.00"] as const;
const ESCALATED = ["9.99", "4.75", "12.00", "2.40", "25.00"] as const;

async function buildCorpus(): Promise<CorpusCase[]> {
  const cases: CorpusCase[] = [];

  const add = async (params: {
    seed: number;
    label: string;
    kind: CaseKind;
    risk: RiskFactors;
    bundle: TraceBundle;
    trustedRoot?: Hex;
    withApproval: boolean;
  }): Promise<void> => {
    cases.push({
      id: `${params.seed}-${params.label}`,
      seed: params.seed,
      kind: params.kind,
      label: params.label,
      bundle: params.bundle,
      risk: params.risk,
      ...(params.trustedRoot ? { trustedRoot: params.trustedRoot } : {}),
      withApproval: params.withApproval,
    });
  };

  for (const seed of SEEDS) {
    const amount = pick(AMOUNTS, seed);
    const escalated = pick(ESCALATED, seed);
    const token = pick(TOKENS, seed);
    const common = {
      traceId: `aearv-${seed}-base`,
      settlementDescriptor: descriptor({ value: amount }),
      mandateConstraints: constraints({ maxAmount: amount }),
      token,
    };

    // 1. Honest low risk: correct for V1 only; always-V3 imposes an approval FP.
    await add({
      seed,
      label: "honest-low",
      kind: "honest",
      risk: LOW,
      bundle: await buildValidBundle({ ...common, traceId: `aearv-${seed}-honest-low` }),
      withApproval: false,
    });

    // 2. Honest medium risk: adaptive selects V2; always-V3 imposes an approval FP.
    await add({
      seed,
      label: "honest-medium",
      kind: "honest",
      risk: MEDIUM,
      bundle: await buildValidBundle({ ...common, traceId: `aearv-${seed}-honest-medium` }),
      withApproval: false,
    });

    // 3. Honest high risk with user approval: correct at every level.
    await add({
      seed,
      label: "honest-high-approved",
      kind: "honest",
      risk: HIGH,
      bundle: await buildValidBundle({ ...common, traceId: `aearv-${seed}-honest-high` }),
      withApproval: true,
    });

    // 4-8. Base-clean policy gaps that only additive checks can reject.
    const honest = await buildValidBundle({ ...common, traceId: `aearv-${seed}-gap-base` });

    const noIdentity = structuredClone(honest);
    noIdentity.events = noIdentity.events.filter(
      (event) => event.objectType !== "ERC8004_AGENT_IDENTITY",
    );
    await add({
      seed,
      label: "gap-identity-omission",
      kind: "policy-gap",
      risk: MEDIUM,
      bundle: recomputeEvidenceIntegrity(noIdentity),
      withApproval: true,
    });

    const noDelivery = structuredClone(honest);
    noDelivery.events = noDelivery.events.filter((event) => event.objectType !== "DELIVERY_PROOF");
    await add({
      seed,
      label: "gap-delivery-omission",
      kind: "policy-gap",
      risk: MEDIUM,
      bundle: recomputeEvidenceIntegrity(noDelivery),
      withApproval: true,
    });

    const rewritten = structuredClone(honest);
    rewritten.events[1]!.publicFields = { injected: "attacker-value" };
    await add({
      seed,
      label: "gap-unanchored-rewrite",
      kind: "policy-gap",
      risk: MEDIUM,
      bundle: recomputeEvidenceIntegrity(rewritten),
      trustedRoot: honest.merkleRoot,
      withApproval: true,
    });

    await add({
      seed,
      label: "gap-approval-gate",
      kind: "policy-gap",
      risk: HIGH,
      bundle: honest,
      withApproval: false,
    });

    const noIntent = structuredClone(honest);
    noIntent.events = noIntent.events.filter((event) => event.objectType !== "USER_INTENT");
    await add({
      seed,
      label: "gap-full-provenance",
      kind: "policy-gap",
      risk: HIGH,
      bundle: recomputeEvidenceIntegrity(noIntent),
      withApproval: true,
    });

    // 9-13. Mandatory-rule attacks: rejected by every strategy.
    await add({
      seed,
      label: "attack-payee",
      kind: "attack",
      risk: HIGH,
      bundle: await buildValidBundle({
        ...common,
        traceId: `aearv-${seed}-attack-payee`,
        settlementDescriptor: descriptor({ value: amount, payTo: attackerAddress }),
      }),
      withApproval: true,
    });

    await add({
      seed,
      label: "attack-amount",
      kind: "attack",
      risk: HIGH,
      bundle: await buildValidBundle({
        ...common,
        traceId: `aearv-${seed}-attack-amount`,
        settlementDescriptor: descriptor({ value: escalated }),
      }),
      withApproval: true,
    });

    await add({
      seed,
      label: "attack-replay",
      kind: "attack",
      risk: HIGH,
      bundle: {
        ...(await buildValidBundle({ ...common, traceId: `aearv-${seed}-attack-replay` })),
        nonceReplayAttempt: true,
      },
      withApproval: true,
    });

    await add({
      seed,
      label: "attack-delivery-forgery",
      kind: "attack",
      risk: HIGH,
      bundle: breakReportHash(
        await buildValidBundle({ ...common, traceId: `aearv-${seed}-attack-delivery` }),
      ),
      withApproval: true,
    });

    const chainAttack = await buildValidBundle({
      ...common,
      traceId: `aearv-${seed}-attack-chain`,
    });
    chainAttack.settlement.chainId = 1;
    await add({
      seed,
      label: "attack-chain-transplant",
      kind: "attack",
      risk: HIGH,
      bundle: chainAttack,
      withApproval: true,
    });
  }

  return cases;
}

type StrategyName = "fixedV1" | "adaptive" | "alwaysV3";

type StrategyMetrics = {
  cases: number;
  passed: number;
  failed: number;
  attackDetected: number;
  attackTotal: number;
  policyGapDetected: number;
  policyGapTotal: number;
  combinedThreatDetected: number;
  combinedThreatTotal: number;
  honestRejected: number;
  honestTotal: number;
  falsePositiveRate: number;
  latencyMs: { n: number; mean: number; p50: number; p95: number; max: number };
  extraChecksExecuted: number;
  extraChecksMean: number;
  levelCounts: Record<VerificationLevel, number>;
};

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)]!;
}

function latencyStats(values: number[]): StrategyMetrics["latencyMs"] {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  };
}

const cases = await buildCorpus();
await mkdir(OUTPUT_DIR, { recursive: true });

const strategies: Record<StrategyName, StrategyMetrics> = {
  fixedV1: {
    cases: cases.length,
    passed: 0,
    failed: 0,
    attackDetected: 0,
    attackTotal: 0,
    policyGapDetected: 0,
    policyGapTotal: 0,
    combinedThreatDetected: 0,
    combinedThreatTotal: 0,
    honestRejected: 0,
    honestTotal: 0,
    falsePositiveRate: 0,
    latencyMs: { n: 0, mean: 0, p50: 0, p95: 0, max: 0 },
    extraChecksExecuted: 0,
    extraChecksMean: 0,
    levelCounts: { V1: 0, V2: 0, V3: 0 },
  },
  adaptive: {
    cases: cases.length,
    passed: 0,
    failed: 0,
    attackDetected: 0,
    attackTotal: 0,
    policyGapDetected: 0,
    policyGapTotal: 0,
    combinedThreatDetected: 0,
    combinedThreatTotal: 0,
    honestRejected: 0,
    honestTotal: 0,
    falsePositiveRate: 0,
    latencyMs: { n: 0, mean: 0, p50: 0, p95: 0, max: 0 },
    extraChecksExecuted: 0,
    extraChecksMean: 0,
    levelCounts: { V1: 0, V2: 0, V3: 0 },
  },
  alwaysV3: {
    cases: cases.length,
    passed: 0,
    failed: 0,
    attackDetected: 0,
    attackTotal: 0,
    policyGapDetected: 0,
    policyGapTotal: 0,
    combinedThreatDetected: 0,
    combinedThreatTotal: 0,
    honestRejected: 0,
    honestTotal: 0,
    falsePositiveRate: 0,
    latencyMs: { n: 0, mean: 0, p50: 0, p95: 0, max: 0 },
    extraChecksExecuted: 0,
    extraChecksMean: 0,
    levelCounts: { V1: 0, V2: 0, V3: 0 },
  },
};

type CaseRecord = {
  id: string;
  seed: number;
  kind: CaseKind;
  label: string;
  riskScore: number;
  decisions: Record<StrategyName, "PASS" | "FAIL">;
  levels: Record<StrategyName, VerificationLevel>;
  failedRules: Record<StrategyName, string[]>;
  failedAdaptiveChecks: Record<StrategyName, string[]>;
};

const records: CaseRecord[] = [];
const latencies: Record<StrategyName, number[]> = { fixedV1: [], adaptive: [], alwaysV3: [] };

for (const testCase of cases) {
  const score = computeRiskScore(testCase.risk);
  const context: AdaptiveContext = {
    expectedHumanPrincipal: HUMAN,
    expectedMerkleRoot: testCase.trustedRoot ?? testCase.bundle.merkleRoot,
    ...(testCase.withApproval
      ? {
          humanApproval: await createHumanApproval(testCase.bundle, "V3", score, TEST_KEYS.userKey),
        }
      : {}),
  };

  const runners: Array<[StrategyName, () => Promise<AdaptiveVerifyOutput>]> = [
    ["fixedV1", () => verifyAtLevel(testCase.bundle, "V1", context, testCase.risk)],
    ["adaptive", () => verifyAdaptive(testCase.bundle, testCase.risk, context)],
    ["alwaysV3", () => verifyAtLevel(testCase.bundle, "V3", context, testCase.risk)],
  ];

  const decisions = {} as CaseRecord["decisions"];
  const levels = {} as CaseRecord["levels"];
  const failedRules = {} as CaseRecord["failedRules"];
  const failedAdaptiveChecks = {} as CaseRecord["failedAdaptiveChecks"];

  for (const [name, run] of runners) {
    const start = performance.now();
    const output = await run();
    const elapsed = performance.now() - start;
    latencies[name].push(elapsed);

    // Invariant probe: every mandatory cryptographic rule is evaluated on every path.
    for (const rule of MANDATORY_RULES) {
      if (output.base.outcomes[rule] === undefined) {
        throw new Error(`${name}/${testCase.id}: mandatory rule ${rule} was not evaluated`);
      }
      if (!output.base.certificate.rulesChecked.includes(rule)) {
        throw new Error(`${name}/${testCase.id}: mandatory rule ${rule} missing from certificate`);
      }
    }

    const metrics = strategies[name];
    metrics.levelCounts[output.level] += 1;
    metrics.extraChecksExecuted += output.extraChecksExecuted;
    if (output.decision === "PASS") metrics.passed += 1;
    else metrics.failed += 1;

    if (testCase.kind === "attack") {
      metrics.attackTotal += 1;
      if (output.decision === "FAIL") metrics.attackDetected += 1;
    } else if (testCase.kind === "policy-gap") {
      metrics.policyGapTotal += 1;
      if (output.decision === "FAIL") metrics.policyGapDetected += 1;
    } else {
      metrics.honestTotal += 1;
      if (output.decision === "FAIL") metrics.honestRejected += 1;
    }
    if (testCase.kind !== "honest") {
      metrics.combinedThreatTotal += 1;
      if (output.decision === "FAIL") metrics.combinedThreatDetected += 1;
    }

    decisions[name] = output.decision;
    levels[name] = output.level;
    failedRules[name] = output.failedRules;
    failedAdaptiveChecks[name] = output.failedAdaptiveChecks;
  }

  records.push({
    id: testCase.id,
    seed: testCase.seed,
    kind: testCase.kind,
    label: testCase.label,
    riskScore: score,
    decisions,
    levels,
    failedRules,
    failedAdaptiveChecks,
  });
}

for (const name of Object.keys(strategies) as StrategyName[]) {
  const metrics = strategies[name];
  metrics.latencyMs = latencyStats(latencies[name]!);
  metrics.extraChecksMean = metrics.extraChecksExecuted / metrics.cases;
  metrics.falsePositiveRate = metrics.honestRejected / metrics.honestTotal;
}

// Hard assertions: the evaluation must fail loudly if the invariant breaks.
for (const name of Object.keys(strategies) as StrategyName[]) {
  const metrics = strategies[name];
  if (metrics.attackDetected !== metrics.attackTotal) {
    throw new Error(`${name} missed a mandatory-rule attack`);
  }
}
if (strategies.fixedV1.falsePositiveRate !== 0 || strategies.adaptive.falsePositiveRate !== 0) {
  throw new Error("fixed V1 or adaptive produced a false positive on an honest bundle");
}
if (
  strategies.adaptive.policyGapDetected <= strategies.fixedV1.policyGapDetected ||
  strategies.alwaysV3.policyGapDetected < strategies.adaptive.policyGapDetected
) {
  throw new Error("adaptive assurance is not monotone on the seeded corpus");
}
if (strategies.adaptive.extraChecksExecuted >= strategies.alwaysV3.extraChecksExecuted) {
  throw new Error("adaptive did not reduce additive checks versus always-V3");
}

const counts = {
  total: cases.length,
  honest: cases.filter((c) => c.kind === "honest").length,
  attack: cases.filter((c) => c.kind === "attack").length,
  policyGap: cases.filter((c) => c.kind === "policy-gap").length,
};

const payload = {
  generatedAt: new Date().toISOString(),
  novelty: "AEARV (Novelty 5)",
  disclaimer:
    "Deterministic prototype risk model. Weights and thresholds are a priori engineering choices, NOT empirically calibrated or externally validated.",
  seeds: [...SEEDS],
  n: counts,
  mandatoryRules: MANDATORY_RULES,
  riskWeights: { identityAssurance: 0.2, authorizationRisk: 0.25, settlementRisk: 0.2, deliveryRisk: 0.2, historyRisk: 0.15 },
  thresholds: { v2: 0.34, v3: 0.67 },
  strategies,
  cases: records,
};

await writeFile(
  join(OUTPUT_DIR, "aearv-evaluation.json"),
  `${JSON.stringify(payload, null, 2)}\n`,
);

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const rate = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);
const strategyRow = (name: StrategyName): string => {
  const m = strategies[name];
  return (
    `| ${name} | ${m.cases} | ${m.attackDetected}/${m.attackTotal} (${pct(rate(m.attackDetected, m.attackTotal))}) | ` +
    `${m.policyGapDetected}/${m.policyGapTotal} (${pct(rate(m.policyGapDetected, m.policyGapTotal))}) | ` +
    `${m.honestRejected}/${m.honestTotal} (${pct(m.falsePositiveRate)}) | ` +
    `${m.latencyMs.mean.toFixed(3)} | ${m.latencyMs.p95.toFixed(3)} | ${m.extraChecksExecuted} (${m.extraChecksMean.toFixed(2)}/case) | ` +
    `${m.levelCounts.V1}/${m.levelCounts.V2}/${m.levelCounts.V3} |`
  );
};

const summary = `# AEARV evaluation — fixed V1 vs adaptive vs always-V3

Generated ${payload.generatedAt}. Seeds: ${SEEDS.join(", ")}. Cases: n=${counts.total} (${counts.honest} honest, ${counts.attack} mandatory-rule attacks, ${counts.policyGap} base-clean policy gaps).

All three strategies verify the same seeded corpus with the same unchanged base \`verifyTrace\` call; the mandatory cryptographic rules R1, R2, R5, R6, R8, R9, R10, R17 are evaluated on every path. Higher levels only ADD checks.

> LIMITATION: the risk score is a deterministic prototype with a priori weights (0.20/0.25/0.20/0.20/0.15) and cut-points (0.34, 0.67). It is NOT calibrated or validated on external incident data. These numbers describe this prototype on this synthetic corpus only.

| Strategy | n | Mandatory-attack detected | Policy-gap detected | Honest FP | Latency mean ms | Latency p95 ms | Extra checks (total/mean) | V1/V2/V3 cases |
|---|---|---|---|---|---|---|---|---|
${(["fixedV1", "adaptive", "alwaysV3"] as StrategyName[]).map(strategyRow).join("\n")}

## Derived comparisons

- Latency overhead vs fixed V1: adaptive ${(strategies.adaptive.latencyMs.mean - strategies.fixedV1.latencyMs.mean).toFixed(3)} ms/case; always-V3 ${(strategies.alwaysV3.latencyMs.mean - strategies.fixedV1.latencyMs.mean).toFixed(3)} ms/case. Timings are single-run measurements and are noisy; treat them as indicative, not a benchmark.
- Adaptive reduces additive checks from ${strategies.alwaysV3.extraChecksExecuted} (always-V3) to ${strategies.adaptive.extraChecksExecuted} across ${counts.total} cases (${(((strategies.alwaysV3.extraChecksExecuted - strategies.adaptive.extraChecksExecuted) / strategies.alwaysV3.extraChecksExecuted) * 100).toFixed(1)}% fewer).
- Adaptive preserves 100% mandatory-rule attack detection while matching fixed V1's ${pct(strategies.fixedV1.falsePositiveRate)} honest false-positive rate; always-V3 rejects ${strategies.alwaysV3.honestRejected}/${strategies.alwaysV3.honestTotal} honest bundles that carry no approval (low- and medium-risk), solely because the V3 human-approval gate is imposed on them.

## Per-case decisions

| case | seed | kind | risk R | V1 | adaptive (level) | V3 | failed adaptive checks (adaptive) |
|---|---|---|---|---|---|---|---|
${records
  .map(
    (r) =>
      `| ${r.id} | ${r.seed} | ${r.kind} | ${r.riskScore.toFixed(3)} | ${r.decisions.fixedV1} | ${r.decisions.adaptive} (${r.levels.adaptive}) | ${r.decisions.alwaysV3} | ${r.failedAdaptiveChecks.adaptive.join(";") || "-"} |`,
  )
  .join("\n")}

Raw per-run data: \`experiments/novelty/aearv/aearv-evaluation.json\`.
`;

await writeFile(join(OUTPUT_DIR, "SUMMARY.md"), summary);

console.log(
  JSON.stringify(
    {
      outputDir: OUTPUT_DIR,
      n: counts,
      seeds: SEEDS,
      strategies: {
        fixedV1: {
          attackDetected: strategies.fixedV1.attackDetected,
          policyGapDetected: strategies.fixedV1.policyGapDetected,
          honestFP: strategies.fixedV1.honestRejected,
          extraChecks: strategies.fixedV1.extraChecksExecuted,
          meanLatencyMs: strategies.fixedV1.latencyMs.mean,
        },
        adaptive: {
          levelCounts: strategies.adaptive.levelCounts,
          attackDetected: strategies.adaptive.attackDetected,
          policyGapDetected: strategies.adaptive.policyGapDetected,
          honestFP: strategies.adaptive.honestRejected,
          extraChecks: strategies.adaptive.extraChecksExecuted,
          meanLatencyMs: strategies.adaptive.latencyMs.mean,
        },
        alwaysV3: {
          attackDetected: strategies.alwaysV3.attackDetected,
          policyGapDetected: strategies.alwaysV3.policyGapDetected,
          honestFP: strategies.alwaysV3.honestRejected,
          extraChecks: strategies.alwaysV3.extraChecksExecuted,
          meanLatencyMs: strategies.alwaysV3.latencyMs.mean,
        },
      },
    },
    null,
    2,
  ),
);
