import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  runAdversarialMatrix,
  runComposedAdversarialSequences,
  runPreSettlementScenarios,
} from "@clb-acel/attack-core";
import { runConcurrencyTrials } from "@clb-acel/x402-adapter";

const seed = Number(process.env.REVIEWER2_ATTACK_SEED ?? 1_800_000_000_000);
if (!Number.isSafeInteger(seed) || seed <= 0) {
  throw new Error("REVIEWER2_ATTACK_SEED must be a positive safe integer");
}

const outputDir = join(process.cwd(), "experiments", "benchmarks", "reviewer2", "comment1");
await mkdir(outputDir, { recursive: true });

function csv(header: string[], rows: Array<Array<string | number | boolean>>): string {
  return (
    [header.join(","), ...rows.map((row) => row.map((cell) => String(cell)).join(","))].join("\n") +
    "\n"
  );
}

// 1. Hand-written composed sequences (detection of named attack narratives).
const composed = await runComposedAdversarialSequences(seed);
await writeFile(
  join(outputDir, "composed-attack-results.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), seed, results: composed }, null, 2)}\n`,
);
await writeFile(
  join(outputDir, "composed-attack-results.csv"),
  csv(
    ["scenario", "detected", "prevented", "detection_stage", "failed_rules", "event_count"],
    composed.map((result) => [
      result.id,
      result.detected,
      result.prevented,
      result.detectionStage,
      `"${result.failedRules.join(";")}"`,
      result.eventCount,
    ]),
  ),
);

// 2. Compositional matrix: singles, all ordered pairs, curated chains, 5 seeds.
const matrix = await runAdversarialMatrix({
  seeds: [seed, seed + 17, seed + 42, seed + 99, seed + 137],
});
await writeFile(
  join(outputDir, "adversarial-matrix.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), ...matrix }, null, 2)}\n`,
);
await writeFile(
  join(outputDir, "adversarial-matrix.csv"),
  csv(
    [
      "scenario",
      "depth",
      "seed",
      "detected",
      "detection_stage",
      "expected_rules",
      "failed_rules",
      "expected_rules_covered",
      "audit_detected",
      "event_count",
    ],
    matrix.results.map((result) => [
      result.id,
      result.depth,
      result.seed,
      result.detected,
      result.detectionStage,
      `"${result.expectedRules.join(";")}"`,
      `"${result.failedRules.join(";")}"`,
      result.expectedRulesCovered,
      result.auditDetected,
      result.eventCount,
    ]),
  ),
);

// 3. Pre-settlement prevention: guard asked before any settlement call.
const presettlement = await runPreSettlementScenarios();
await writeFile(
  join(outputDir, "presettlement-results.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), results: presettlement }, null, 2)}\n`,
);
await writeFile(
  join(outputDir, "presettlement-results.csv"),
  csv(
    [
      "scenario",
      "addresses",
      "guard_allowed",
      "guard_error",
      "settlement_attempted",
      "receipt_issued",
      "prevented",
      "violations",
    ],
    presettlement.map((result) => [
      result.id,
      `"${result.addresses.join(";")}"`,
      result.guardAllowed,
      result.guardError ?? "",
      result.settlementAttempted,
      result.receiptIssued,
      result.prevented,
      `"${result.predicateViolations.join(";")}"`,
    ]),
  ),
);

// 4. Concurrency: same-nonce, distinct-nonce, and mixed bursts at several levels.
const concurrency = await runConcurrencyTrials({ levels: [2, 4, 8, 16, 32], trialsPerLevel: 20 });
await writeFile(
  join(outputDir, "concurrency-results.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), ...concurrency }, null, 2)}\n`,
);
await writeFile(
  join(outputDir, "concurrency-results.csv"),
  csv(
    [
      "level",
      "mode",
      "trial",
      "attempted",
      "settled",
      "rejected",
      "other_errors",
      "expected_settled",
      "ok",
    ],
    concurrency.results.map((result) => [
      result.level,
      result.mode,
      result.trial,
      result.attempted,
      result.settled,
      result.rejected,
      result.otherErrors,
      result.expectedSettled,
      result.ok,
    ]),
  ),
);

// 5. Human-readable summary for the manuscript and the response letter.
const depthRows = (["1", "2", "3"] as const)
  .map((depth) => {
    const bucket = matrix.summary.byDepth[depth];
    return `| ${depth} | ${bucket.total} | ${bucket.detected} | ${((bucket.detected / bucket.total) * 100).toFixed(1)}% |`;
  })
  .join("\n");

const familyRows = (
  Object.entries(matrix.summary.byFamily) as Array<[string, { total: number; detected: number }]>
)
  .map(
    ([family, bucket]) =>
      `| ${family} | ${bucket.total} | ${bucket.detected} | ${((bucket.detected / bucket.total) * 100).toFixed(1)}% |`,
  )
  .join("\n");

const concurrencyRows = concurrency.levels
  .map((level) => {
    const forLevel = concurrency.results.filter((result) => result.level === level);
    const sameNonce = forLevel.filter((result) => result.mode === "same-nonce");
    const distinct = forLevel.filter((result) => result.mode === "distinct-nonce");
    const mixed = forLevel.filter((result) => result.mode === "mixed");
    const settledOf = (rows: typeof forLevel) => rows.reduce((sum, row) => sum + row.settled, 0);
    return `| ${level} | ${sameNonce.length} | ${settledOf(sameNonce)} | ${settledOf(distinct)} | ${settledOf(mixed)} | ${forLevel.filter((r) => !r.ok).length} |`;
  })
  .join("\n");

const summary = `# Reviewer #2, Comment 1 — Evaluation Summary

Generated ${new Date().toISOString()} from seed base ${seed}.

## 1. Compositional adversarial matrix

- Attack primitives: 9 (merchant, agent, settlement, delivery, evidence families)
- Scenarios per seed: ${matrix.summary.scenarioCount / matrix.seeds.length} (9 singles + 72 ordered pairs + 12 curated chains)
- Seeds: ${matrix.seeds.length}
- Total executed scenarios: ${matrix.summary.scenarioCount}
- Detected: ${matrix.summary.detectedCount} (${(matrix.summary.detectionRate * 100).toFixed(2)}%)
- Undetected scenarios: ${matrix.summary.undetected.length === 0 ? "none" : matrix.summary.undetected.join(", ")}

| Steps in chain | Scenarios | Detected | Detection rate |
|---|---|---|---|
${depthRows}

| Attack family | Scenarios | Detected | Detection rate |
|---|---|---|---|
${familyRows}

## 2. Pre-settlement prevention (Mode B delegated flow)

| Scenario | Guard denied | Settlement attempted | Receipt issued | Prevented |
|---|---|---|---|---|
${presettlement
  .map(
    (result) =>
      `| ${result.id} | ${!result.guardAllowed || result.predicateViolations.length > 0} | ${result.settlementAttempted} | ${result.receiptIssued} | ${result.prevented} |`,
  )
  .join("\n")}

Prevented: ${presettlement.filter((result) => result.prevented).length}/${presettlement.length}.

## 3. Concurrent settlement

| Concurrency | Trials per mode | Settled (same nonce) | Settled (distinct nonces) | Settled (mixed) | Anomalies |
|---|---|---|---|---|---|
${concurrencyRows}

- Total concurrent attempts: ${concurrency.summary.totalAttempts}
- Total settled: ${concurrency.summary.totalSettled}
- Total rejected on nonce: ${concurrency.summary.totalRejected}
- Other errors: ${concurrency.summary.totalOtherErrors}
- Anomalies: ${concurrency.summary.anomalyCount}
- Limitation: the nonce reservation is in-process; cross-replica deployments need a shared nonce store.

## 4. Named composed sequences (post-settlement detection)

${composed.map((result) => `- ${result.id}: detected=${result.detected}, stage=${result.detectionStage}, failed=${result.failedRules.join("; ") || "audit"}`).join("\n")}
`;

await writeFile(join(outputDir, "SUMMARY.md"), summary);

console.log(
  JSON.stringify(
    {
      outputDir,
      composed: composed.length,
      matrixScenarios: matrix.summary.scenarioCount,
      matrixDetectionRate: matrix.summary.detectionRate,
      matrixUndetected: matrix.summary.undetected,
      presettlementPrevented: `${presettlement.filter((result) => result.prevented).length}/${presettlement.length}`,
      concurrencyTrials: concurrency.summary.trialCount,
      concurrencyAnomalies: concurrency.summary.anomalyCount,
    },
    null,
    2,
  ),
);
