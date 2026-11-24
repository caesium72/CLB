/**
 * IRCV orchestrator — `bun run novelty:ircv`.
 *
 * Produces artifacts under experiments/novelty/ircv/; review-revision docs are
 * maintained separately. Counts, verdicts, seeds and tool versions are stable
 * across runs, but concrete commitments/nonces embed wall-clock timestamps in
 * the existing mandate fixtures, so raw digests differ between runs.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reproduceCounterexample } from "./counterexample-reproducer";
import { runDifferential } from "./differential-engine";
import {
  normalizeImplementationScenarios,
  type NormalizedScenario,
} from "./implementation-trace-normalizer";
import { loadFormalVocabulary, ROOT } from "./model-trace-generator";
import {
  runPropertyBasedTests,
  runSerializationChecks,
  type PropertyTestReport,
  type SerializationReport,
} from "./serialization-checker";
import type { DifferentialReport } from "./differential-engine";

const OUT = resolve(ROOT, "experiments/novelty/ircv");

async function writeJson(name: string, value: unknown): Promise<void> {
  await writeFile(resolve(OUT, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeMd(name: string, content: string): Promise<void> {
  await writeFile(resolve(OUT, name), content, "utf8");
}

function modelMd(vocabulary: Awaited<ReturnType<typeof loadFormalVocabulary>>): string {
  const rows = vocabulary.lemmas
    .map((lemma) => `| ${lemma.name} | ${lemma.quantifier} | ${lemma.committedStatus} (${lemma.steps ?? "?"} steps) |`)
    .join("\n");
  const rules = vocabulary.rules
    .map((rule) => `| ${rule.name} | ${rule.actions.map((action) => action.label).join(", ")} |`)
    .join("\n");
  return `# IRCV — normalized formal trace vocabulary

Source: \`${vocabulary.sources.spthy}\` (parsed only; Tamarin was NOT executed).
Committed proof: \`${vocabulary.sources.proof}\`; result: \`${vocabulary.sources.result}\`.
Toolchain from committed artifacts: Tamarin ${vocabulary.toolchainFromCommittedArtifacts.tamarin ?? "unknown"}, Maude ${vocabulary.toolchainFromCommittedArtifacts.maude ?? "unknown"}.

Theory **${vocabulary.theory}**: ${vocabulary.rules.length} rules, ${vocabulary.actionLabels.length} action labels, ${vocabulary.lemmas.length} lemmas.
All lemma statuses below are copied from the committed result file — **no new proof was run**.

## Rules and observable action facts

| Rule | Action facts |
| --- | --- |
${rules}

## Lemmas (committed statuses)

| Lemma | Quantifier | Status from committed result |
| --- | --- | --- |
${rows}

## Structural constraints used by the differential engine

${vocabulary.constraints.map((constraint) => `- **${constraint.id}** (${constraint.lemma}): ${constraint.description}`).join("\n")}

## Honest limits

${vocabulary.warnings.map((warning) => `- ${warning}`).join("\n")}
`;
}

function implementationMd(scenarios: NormalizedScenario[]): string {
  const rows = scenarios
    .map((scenario) => `| ${scenario.scenarioId} | ${scenario.scenarioKind} | ${scenario.verifier.status} | ${scenario.verifier.failedRules.join(", ") || "—"} | ${scenario.trace.events.length} |`)
    .join("\n");
  return `# IRCV — normalized implementation traces

Every trace uses \`ircv-trace/v1\`, the same schema as the model trace. Scenarios are existing fixtures; no protocol source was changed.

| Scenario | Kind | verifyTrace | Failed rules | Events |
| --- | --- | --- | --- | --- |
${rows}

Notes per scenario:

${scenarios.map((scenario) => `- **${scenario.scenarioId}**: ${scenario.description} Expected: ${scenario.expected}. ${scenario.notes.join(" ")}`).join("\n")}
`;
}

function differentialMd(report: DifferentialReport): string {
  const rows = report.scenarios
    .map((diff) => `| ${diff.scenarioId} | ${diff.conformance} | ${diff.violations.map((v) => v.constraintId).join(", ") || "—"} | ${diff.verifierStatus} | ${diff.result} |`)
    .join("\n");
  const diffs = report.scenarios.flatMap((diff) =>
    diff.violations.map((violation) => `- ${diff.scenarioId} / ${violation.constraintId}: expected ${violation.expected}; actual ${violation.actual}`),
  );
  return `# IRCV — differential report

Model source: \`${report.modelSource}\` (parsed only). Constraints evaluated: ${report.constraintsEvaluated.join(", ")}.

| Scenario | Conformance | Violated constraints | Verifier | Result |
| --- | --- | --- | --- | --- |
${rows}

## Concrete differences

${diffs.length > 0 ? diffs.join("\n") : "No constraint violations in comparable scenarios."}

## Coverage

- Observed event kinds (${report.kindCoverage.observedKinds.length}): ${report.kindCoverage.observedKinds.join(", ")}
- Mapped to model alphabet (${report.kindCoverage.mappedKinds.length}): ${report.kindCoverage.mappedKinds.join(", ")}
- Implementation-only (${report.kindCoverage.unmappedKinds.length}): ${report.kindCoverage.unmappedKinds.join(", ")}
- Model kinds not observed (${report.kindCoverage.modelKindsNotObserved.length}): ${report.kindCoverage.modelKindsNotObserved.join(", ") || "none"}

Summary: ${report.summary.totalScenarios} scenarios, ${report.summary.comparableScenarios} comparable, ${report.summary.resultsPass} PASS, ${report.summary.resultsFail} FAIL, ${report.summary.conformantHonestScenarios} conformant honest, ${report.summary.detectedAttackScenarios} detected attacks.

**Scope statement:** a PASS means the observed trace matched the recorded expectation for that scenario. It does NOT prove that the implementation refines the model in general: Mode A and RCLB are outside the model alphabet, fixture-level pre-settlement bypasses are reported explicitly, and the proof record was not re-checked.
`;
}

function serializationMd(report: SerializationReport): string {
  const rows = report.checks
    .map((check) => `| ${check.id} | ${check.field} | ${check.ok ? "MATCH" : "MISMATCH"} |`)
    .join("\n");
  return `# IRCV — serialization consistency

Method: ${report.method}

| Check | Field | Result |
| --- | --- | --- |
${rows}

${report.summary.total} checks: ${report.summary.matched} matched, ${report.summary.mismatched} mismatched.

## Findings (reported, not fixed)

${report.findings.map((finding) => `- **${finding.id}** (${finding.severity}): ${finding.detail}`).join("\n")}
`;
}

function propertyMd(report: PropertyTestReport): string {
  return `# IRCV — seeded cross-language property-based tests

- Status: **${report.status}**
- Seed: ${report.seed}
- Cases: ${report.caseCount}
- Solidity executed on: ${report.forgeVersion ?? "unavailable"} (solc ${report.solcVersion})
- Helper: \`${report.solidityHelper}\`
- Fields per case: ${report.fieldsChecked.join(", ")}
- Comparisons: ${report.counts.comparisons}; matched ${report.counts.matched}; mismatched ${report.counts.mismatched}; fully matched cases ${report.counts.casesFullyMatched}/${report.caseCount}
${report.reason ? `- Reason: ${report.reason}` : ""}

Mismatches (first 20): ${report.mismatches.slice(0, 20).map((m) => `case ${m.caseId} ${m.field}: TS ${m.typescript} vs Solidity ${m.solidity}`).join("; ") || "none"}
`;
}

function counterexampleMd(report: Awaited<ReturnType<typeof reproduceCounterexample>>): string {
  return `# IRCV — counterexample reproduction

- Status: **${report.status}**
- Source: ${report.source}
- Parsed scenario: ${report.parsedScenario ?? "none"}
- Expected rejection: ${report.expectedRejection}; actual rejection: ${report.actualRejection}
- Generated executable script: \`${report.generatedScript}\`

## Execution

- RCLB acceptance violations: ${report.execution.acceptanceViolations.join(", ") || "none"}
- Local facilitator accepted the payment: ${report.execution.facilitatorAccepted}
- verifyTrace status: ${report.execution.verifierStatus ?? "—"} / failed rules: ${report.execution.verifierFailedRules.join(", ") || "—"}
- Payment nonce: ${report.execution.paymentNonce ?? "—"}

${report.reason ? `Not runnable: ${report.reason}` : report.finding}
`;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  const vocabulary = await loadFormalVocabulary();
  await writeJson("model-trace.json", vocabulary);
  await writeMd("model-trace.md", modelMd(vocabulary));

  const scenarios = await normalizeImplementationScenarios();
  await writeJson("implementation-traces.json", scenarios);
  await writeMd("implementation-traces.md", implementationMd(scenarios));

  const differential = runDifferential(vocabulary, scenarios);
  await writeJson("differential-report.json", differential);
  await writeMd("differential-report.md", differentialMd(differential));

  const serialization = runSerializationChecks();
  await writeJson("serialization-report.json", serialization);
  await writeMd("serialization-report.md", serializationMd(serialization));

  const properties = await runPropertyBasedTests();
  await writeJson("property-tests.json", properties);
  await writeMd("property-tests.md", propertyMd(properties));

  const counterexample = await reproduceCounterexample();
  await writeJson("counterexample-report.json", counterexample);
  await writeMd("counterexample-report.md", counterexampleMd(counterexample));

  const rootPackage = JSON.parse(await Bun.file(resolve(ROOT, "package.json")).text()) as {
    devDependencies: Record<string, string>;
  };
  const viemPackage = JSON.parse(await Bun.file(resolve(ROOT, "node_modules/viem/package.json")).text()) as {
    version: string;
  };
  const versionInfo = {
    bun: Bun.version,
    typescript: rootPackage.devDependencies.typescript,
    viem: viemPackage.version,
    forge: properties.forgeVersion,
    solc: properties.solcVersion,
    tamarinFromCommittedProof: vocabulary.toolchainFromCommittedArtifacts.tamarin,
    maudeFromCommittedProof: vocabulary.toolchainFromCommittedArtifacts.maude,
    tamarinExecutedInThisRun: false,
  };

  const allPass =
    differential.summary.resultsFail === 0 &&
    serialization.summary.mismatched === 0 &&
    properties.status === "PASS" &&
    counterexample.status === "PASS";

  const summary = {
    schema: "ircv-summary/v1",
    status: allPass ? "PASS" : "FAIL",
    toolVersions: versionInfo,
    coverage: {
      modelRules: vocabulary.rules.length,
      modelActionLabels: vocabulary.actionLabels.length,
      modelLemmasWithCommittedStatus: vocabulary.lemmas.filter((lemma) => lemma.committedStatus === "verified").length,
      constraintsEvaluated: differential.constraintsEvaluated.length,
      comparableScenarios: differential.summary.comparableScenarios,
      totalScenarios: differential.summary.totalScenarios,
      observedKindsMapped: differential.kindCoverage.mappedKinds.length,
      observedKindsTotal: differential.kindCoverage.observedKinds.length,
      serializationChecks: serialization.summary.total,
      propertyCases: properties.caseCount,
      propertySeed: properties.seed,
      propertyComparisons: properties.counts.comparisons,
    },
    componentResults: {
      differential: `${differential.summary.resultsPass}/${differential.summary.totalScenarios} PASS`,
      serialization: `${serialization.summary.matched}/${serialization.summary.total} matched`,
      propertyTests: `${properties.status} (${properties.counts.casesFullyMatched}/${properties.caseCount} cases)`,
      counterexample: counterexample.status,
    },
    uncovered: [
      "Mode A exact traces are outside the Mode B model alphabet.",
      "RCLB / revocation epochs are absent from clb-aligned.spthy; the stale-epoch counterexample is executable but out-of-model.",
      "No new Tamarin proof was attempted; existing 'verified' statuses were copied from the committed result file.",
      "The normalization is an abstract event projection, not a bisimulation proof; field-level symbolic equality is approximated by concrete digests/addresses.",
      "Fixture-level predicate attacks settle in the direct facilitator path; the pre-settlement guard is a separate earlier gate.",
      "Concrete commitments/nonces embed fixture wall-clock timestamps; counts and verdicts are stable, raw digests are not byte-stable across runs.",
    ],
  };
  await writeJson("ircv-summary.json", summary);

  const summaryMd = `# Novelty 2 — IRCV: implementation summary

**Status: ${summary.status}**. Tool versions: bun ${versionInfo.bun}, viem ${versionInfo.viem}, TypeScript ${versionInfo.typescript}, forge ${versionInfo.forge ?? "unavailable"}, solc ${versionInfo.solc}. Tamarin ${versionInfo.tamarinFromCommittedProof ?? "unknown"} / Maude ${versionInfo.maudeFromCommittedProof ?? "unknown"} come from the committed proof file; Tamarin was not executed.

| Component | Result |
| --- | --- |
| Formal vocabulary | ${vocabulary.rules.length} rules, ${vocabulary.actionLabels.length} action labels, ${vocabulary.lemmas.length} lemmas (${summary.coverage.modelLemmasWithCommittedStatus} verified in committed result) |
| Differential engine | ${summary.componentResults.differential} |
| Serialization consistency | ${summary.componentResults.serialization} |
| Cross-language PBT | ${summary.componentResults.propertyTests}, seed ${properties.seed} |
| Counterexample reproduction | ${summary.componentResults.counterexample} |

Detailed artifacts: \`model-trace.json/.md\`, \`implementation-traces.json/.md\`, \`differential-report.json/.md\`, \`serialization-report.json/.md\`, \`property-tests.json/.md\`, \`counterexample-report.json/.md\`.

## Coverage achieved

${Object.entries(summary.coverage).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## What remains NOT PROVEN

${summary.uncovered.map((item) => `- ${item}`).join("\n")}

## Honest findings

${serialization.findings.map((finding) => `- ${finding.id} (${finding.severity}): ${finding.detail}`).join("\n") || "- None"}
`;
  await writeMd("REPORT.md", summaryMd);

  console.log("=== IRCV (Novelty 2) ===");
  console.log(`  Formal vocabulary : ${vocabulary.rules.length} rules / ${vocabulary.actionLabels.length} labels / ${vocabulary.lemmas.length} lemmas (committed statuses)`);
  console.log(`  Differential      : ${summary.componentResults.differential}`);
  console.log(`  Serialization     : ${summary.componentResults.serialization}`);
  console.log(`  Cross-language PBT: ${summary.componentResults.propertyTests} (seed ${properties.seed})`);
  console.log(`  Counterexample    : ${summary.componentResults.counterexample}`);
  console.log(`  Overall           : ${summary.status}`);
  console.log(`  Artifacts         : ${OUT}`);
}

await main();
