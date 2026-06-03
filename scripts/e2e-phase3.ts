/**
 * Phase 3 in-process attack benchmark.
 *
 * Usage:
 *   bun run e2e:phase3          # deterministic in-process fixtures
 *   bun run e2e:phase3 --live   # hit ATTACK_SIMULATOR_URL /benchmark
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ATTACK_FIXTURES,
  BASELINE_LABELS,
  buildBaselineMatrix,
  percentile,
  runAllAttacks,
  type AttackRunResult,
  type BaselineMatrix,
} from "@clb-acel/attack-core";

const OUT_DIR = resolve(import.meta.dir, "../experiments/benchmarks");
const ATTACK_SIMULATOR = process.env.ATTACK_SIMULATOR_URL?.trim() ?? "http://localhost:4006";

type Benchmark = Awaited<ReturnType<typeof runAllAttacks>>;

function cellLabel(cell: { detected: boolean; prevented: boolean }) {
  if (cell.prevented) {
    return "Prevented";
  }
  return cell.detected ? "Detected" : "Allowed";
}

const BASELINE_IDS = ["B0", "B1", "B2", "B3"] as const;

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function buildCsv(results: AttackRunResult[], matrix: BaselineMatrix): string {
  const rows = [
    [
      "attackId",
      "expectedResultCode",
      "matched",
      "failedRules",
      "preventionLayer",
      "verifyLatencyMs",
      "eventCount",
      "storageBytesEstimate",
      ...BASELINE_IDS.map((id) => BASELINE_LABELS[id]),
    ],
  ];

  for (const result of results) {
    const row = matrix[result.attackId];
    rows.push([
      result.attackId,
      result.expectedResultCode,
      String(result.matched),
      result.verification.result.failedRules.join(";"),
      result.preventionLayer,
      result.metrics.verifyLatencyMs.toFixed(3),
      String(result.metrics.eventCount),
      String(result.metrics.storageBytesEstimate),
      ...BASELINE_IDS.map((id) => cellLabel(row[id])),
    ]);
  }

  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function buildMatrixMarkdown(matrix: BaselineMatrix): string {
  const lines = [
    "# Phase 3 Attack Matrix",
    "",
    `| Attack | ${BASELINE_IDS.map((id) => `${BASELINE_LABELS[id]} (${id})`).join(" | ")} |`,
    "| --- | --- | --- | --- | --- |",
  ];

  for (const fixture of ATTACK_FIXTURES) {
    const row = matrix[fixture.id];
    lines.push(
      `| ${fixture.id} | ${BASELINE_IDS.map((id) => cellLabel(row[id])).join(" | ")} |`,
    );
  }

  lines.push("");
  lines.push(
    BASELINE_IDS.map(
      (id) => `${id} = ${BASELINE_LABELS[id]}: ${id === "B0" ? "No CLB binding." : id === "B1" ? "AP2 mandate without nonce binding." : id === "B2" ? "Audit-only detection." : "Full CLB + ACEL with x402 replay prevention."}`,
    ).join("\n"),
  );
  return `${lines.join("\n")}\n`;
}

function buildLatencyReport(results: AttackRunResult[]): string {
  const verify = results.map((result) => result.metrics.verifyLatencyMs);
  const settle = results
    .map((result) => result.metrics.settlementLatencyMs)
    .filter((value): value is number => typeof value === "number");

  return [
    "# Phase 3 Latency Report",
    "",
    `- Verify p50: ${percentile(verify, 50).toFixed(3)} ms`,
    `- Verify p95: ${percentile(verify, 95).toFixed(3)} ms`,
    `- Settlement replay p50: ${percentile(settle, 50).toFixed(3)} ms`,
    `- Fixtures: ${results.length}`,
    "",
  ].join("\n");
}

function buildGasReport(): string {
  return [
    "# Phase 3 Gas Report",
    "",
    "| Component | Status | Notes |",
    "| --- | --- | --- |",
    "| AgenticAuditAnchor.sol | Pending live forge gas parse | Run `cd contracts && forge test --gas-report`. |",
    "| Predicate guard | Phase 4 | Out of scope for Mode A Phase 3. |",
    "",
  ].join("\n");
}

async function runLive(): Promise<Benchmark> {
  const response = await fetch(`${ATTACK_SIMULATOR}/benchmark`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nowMs: Date.now() }),
  });
  if (!response.ok) {
    throw new Error(`POST /benchmark failed with ${response.status}`);
  }
  return (await response.json()) as Benchmark;
}

async function writeArtifacts(benchmark: Benchmark) {
  await mkdir(OUT_DIR, { recursive: true });
  const matrix = buildBaselineMatrix(benchmark.results, ATTACK_FIXTURES);
  const failed = benchmark.results.filter((result) => !result.matched);

  if (failed.length > 0) {
    throw new Error(`Unmatched attack fixtures: ${failed.map((result) => result.attackId).join(", ")}`);
  }

  await writeFile(resolve(OUT_DIR, "results.json"), `${JSON.stringify({ ...benchmark, matrix }, null, 2)}\n`);
  await writeFile(resolve(OUT_DIR, "results.csv"), buildCsv(benchmark.results, matrix));
  await writeFile(resolve(OUT_DIR, "attack-matrix.md"), buildMatrixMarkdown(matrix));
  await writeFile(resolve(OUT_DIR, "latency-report.md"), buildLatencyReport(benchmark.results));
  await writeFile(resolve(OUT_DIR, "gas-report.md"), buildGasReport());
  await writeFile(
    resolve(OUT_DIR, "README.md"),
    [
      "# Phase 3 Benchmarks",
      "",
      "Regenerate these artifacts from the repository root:",
      "",
      "```bash",
      "bun run e2e:phase3",
      "```",
      "",
      "Use `bun run e2e:phase3 --live` to run through the attack-simulator service on port 4006.",
      "",
    ].join("\n"),
  );
}

async function main() {
  const live = process.argv.includes("--live");
  console.log(`CLB-ACEL Phase 3 attack benchmark (${live ? "live service" : "in-process"})`);

  const benchmark = live ? await runLive() : await runAllAttacks({ nowMs: Date.now() });
  await writeArtifacts(benchmark);

  for (const result of benchmark.results) {
    console.log(
      `${result.matched ? "OK" : "FAIL"} ${result.attackId}: ${result.preventionLayer}, failed=${result.verification.result.failedRules.join(",") || "audit"}`,
    );
  }
  console.log(`\nWrote artifacts to ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
