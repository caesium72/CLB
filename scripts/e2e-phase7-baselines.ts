/**
 * Phase 7D baseline-comparison e2e.
 *
 * Usage:
 *   bun run e2e:phase7-baselines
 *
 * Self-contained (no HTTP services, no on-chain interaction).
 * Runs all 15 attack/predicate fixtures through three weaker baselines
 * (Vanilla x402, AP2+x402, eBay monitor) and full CLB-ACEL, then writes:
 *   experiments/benchmarks/baseline-comparison.json
 *   experiments/benchmarks/baseline-comparison.md
 *
 * The output is fully deterministic (fixed scenario + fixed generatedAt),
 * so the CI drift guard `git diff --exit-code` can reliably catch regressions.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GENERATED_AT, runBaselineMatrix } from "@clb-acel/attack-core";
import type { BaselineMatrixRow, Cell } from "@clb-acel/attack-core";

const OUT_DIR = resolve(import.meta.dir, "../experiments/benchmarks");

function cellLabel(c: Cell): string {
  return c === "ACCEPT" ? "Accepted" : "Rejected";
}

function renderMarkdown(rows: BaselineMatrixRow[]): string {
  const header = [
    "# Phase 7D — Baseline Composition Comparison",
    "",
    "Each weaker stack ACCEPTs (misses) at least one cross-layer attack that full CLB-ACEL REJECTs (catches), confirming that the binding rules and predicate semantics are load-bearing.",
    "",
    "| Attack | Mode | Vanilla x402 | AP2 + x402 | eBay monitor | Full CLB-ACEL | CLB detection |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  const tableRows = rows.map((row) => {
    const cols = [
      row.label,
      row.mode,
      cellLabel(row.vanilla),
      cellLabel(row.ap2x402),
      cellLabel(row.ebay),
      cellLabel(row.clbacel),
      row.clbDetection,
    ];
    return `| ${cols.join(" | ")} |`;
  });

  const legend = [
    "",
    "> **Legend:** For the three baseline columns, `Accepted` on an attack row means the attack was **missed** by that baseline. `Rejected` means it was caught. For the CLB-ACEL column, `Rejected` is the correct outcome for attacks.",
    "",
    "> **Mode B note:** For AP2 compatibility, a Mode B mandate mirrors the human-signed `SpendingPredicate` fields (payee / amount / asset / validUntil) into `mandate.constraints`. Baselines that read those constraints can therefore *incidentally* catch a single-field violation — AP2+x402 flags the payee/amount/asset rows, and the eBay monitor flags the payee/expiry rows. But each baseline still misses the dimensions it does not check (AP2+x402 misses the expiry deadline; the eBay monitor misses amount and asset), and none of them bind the full predicate to the settlement commitment C′ or enforce it at the on-chain guard + R17. Only CLB-ACEL evaluates the predicate as one cryptographically-bound rule and prevents the violation in-protocol; the baselines, at best, detect one field after the fact.",
    "",
  ];

  return [...header, ...tableRows, ...legend].join("\n");
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  console.log("CLB-ACEL Phase 7D — Baseline Composition Comparison\n");

  const matrix = await runBaselineMatrix();
  const rows = Object.values(matrix);

  // ── Sanity assertion: each baseline must miss ≥1 attack that CLB catches ──
  for (const base of ["vanilla", "ap2x402", "ebay"] as const) {
    const found = rows.some((row) => row.clbacel === "REJECT" && row[base] === "ACCEPT");
    assert(
      found,
      `Baseline "${base}" caught every attack CLB-ACEL catches — expected it to miss at least one (this would invalidate the paper's claim).`,
    );
    console.log(`✓ Baseline "${base}" misses ≥1 attack that CLB-ACEL catches`);
  }

  await mkdir(OUT_DIR, { recursive: true });

  // ── Write JSON ─────────────────────────────────────────────────────────────
  const jsonArtifact = { generatedAt: GENERATED_AT, rows };
  await writeFile(
    resolve(OUT_DIR, "baseline-comparison.json"),
    `${JSON.stringify(jsonArtifact, null, 2)}\n`,
  );
  console.log("✓ Wrote experiments/benchmarks/baseline-comparison.json");

  // ── Write Markdown ─────────────────────────────────────────────────────────
  const md = renderMarkdown(rows);
  await writeFile(resolve(OUT_DIR, "baseline-comparison.md"), `${md}\n`);
  console.log("✓ Wrote experiments/benchmarks/baseline-comparison.md");

  console.log("\nAll Phase 7D baseline-comparison assertions passed.");
}

main().catch((error: Error) => {
  console.error(`\n✗ e2e:phase7-baselines failed: ${error.message}`);
  process.exit(1);
});
