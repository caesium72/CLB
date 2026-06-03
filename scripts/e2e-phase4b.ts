/**
 * Phase 4 follow-up: P5 predicate-attack benchmark (Mode B).
 *
 * Usage:
 *   bun run e2e:phase4b
 *
 * Runs the predicate attack fixtures, asserts each matches its expected outcome
 * (R17 FAIL + guard prevention for violations; PASS for the happy path), and
 * writes experiments/benchmarks/{p5-attack-matrix.md,p5-results.json}.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BASELINE_LABELS,
  PREDICATE_ATTACK_LABELS,
  runAllPredicateAttacks,
  type BaselineId,
  type PredicateAttackRunResult,
} from "@clb-acel/attack-core";

const OUT_DIR = resolve(import.meta.dir, "../experiments/benchmarks");
const BASELINE_IDS: BaselineId[] = ["B0", "B1", "B2", "B3"];

function cell(cell: { detected: boolean; prevented: boolean }): string {
  if (cell.prevented) return "Prevented";
  return cell.detected ? "Detected" : "Allowed";
}

type Benchmark = Awaited<ReturnType<typeof runAllPredicateAttacks>>;

function buildMatrixMarkdown(benchmark: Benchmark): string {
  const lines = [
    "# Phase 4 (P5) Predicate Attack Matrix — Mode B",
    "",
    "Separate from the Phase 3 binding matrix: this evaluates **predicate soundness**",
    "(P5) for the delegated flow. Violations fail R17 and are prevented at the",
    "predicate guard; the happy path settles and passes.",
    "",
    `| Scenario | Predicate attack | ${BASELINE_IDS.map((id) => `${BASELINE_LABELS[id]} (${id})`).join(" | ")} | Failed rules |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const result of benchmark.results) {
    const row = benchmark.matrix[result.attackId];
    const failed = result.verification.result.failedRules.join(", ") || "—";
    lines.push(
      `| ${PREDICATE_ATTACK_LABELS[result.attackId]} | ${result.attackId} | ${BASELINE_IDS.map((id) => cell(row[id])).join(" | ")} | ${failed} |`,
    );
  }
  lines.push("");
  lines.push("B0 = Vanilla x402, B1 = AP2 + x402, B2 = ACEL audit-only, B3 = Full CLB + ACEL (guard + R17).");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main() {
  console.log("CLB-ACEL Phase 4 follow-up: P5 predicate attack benchmark");
  const benchmark = await runAllPredicateAttacks();

  const unmatched = benchmark.results.filter((result: PredicateAttackRunResult) => !result.matched);
  if (unmatched.length > 0) {
    throw new Error(`Unmatched predicate fixtures: ${unmatched.map((r) => r.attackId).join(", ")}`);
  }

  for (const result of benchmark.results) {
    const violation = result.expectedFailedRules.length > 0;
    if (violation) {
      assert(result.verification.result.status === "FAIL", `${result.attackId} should FAIL`);
      assert(result.guardPrevented, `${result.attackId} should be prevented at the guard`);
    } else {
      assert(result.verification.result.status === "PASS", `${result.attackId} should PASS`);
    }
    console.log(
      `OK ${result.attackId}: ${result.preventionLayer}, failed=${result.verification.result.failedRules.join(",") || "none"}`,
    );
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(resolve(OUT_DIR, "p5-attack-matrix.md"), buildMatrixMarkdown(benchmark));
  await writeFile(resolve(OUT_DIR, "p5-results.json"), `${JSON.stringify(benchmark, null, 2)}\n`);
  console.log(`\nWrote P5 artifacts to ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
