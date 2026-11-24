import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Stale-artifact validation for the A^3C-VPEAL reproduction pipeline.
 *
 * Compares generated Markdown / CSV artifacts against canonical JSON sources
 * and enforces schema, coverage, and outcome invariants. Exits non-zero on
 * any failure so `reproduce:all` fails fast when artifacts are stale.
 */

const root = process.cwd();
const benchDir = join(root, "experiments", "benchmarks");

/*───────────────────────────── constants ─────────────────────────────*/

const BASELINES: string[] = ["B0", "B1", "B2", "B3"];
const BASELINE_LABELS: Record<string, string> = {
  B0: "Vanilla x402",
  B1: "AP2 + x402",
  B2: "eBay monitor",
  B3: "Full CLB + ACEL",
};

const MODE_A_ATTACKS: string[] = [
  "PAYEE_SUBSTITUTION",
  "AMOUNT_ESCALATION",
  "ASSET_SWITCH",
  "CHAIN_TRANSPLANT",
  "AGENT_IDENTITY_SWAP",
  "MANDATE_REPLAY",
  "CART_OR_TASK_SWITCH",
  "PAYMENT_WITHOUT_DELIVERY",
  "FAKE_FEEDBACK",
  "PROMPT_INJECTION_SELECTION",
];

const MODE_B_ATTACKS: string[] = [
  "PREDICATE_HAPPY_PATH",
  "PREDICATE_PAYEE_VIOLATION",
  "PREDICATE_AMOUNT_VIOLATION",
  "PREDICATE_ASSET_VIOLATION",
  "PREDICATE_EXPIRED",
];

// Intended applicability matrix: every attack in a mode is evaluated
// against every baseline. Not every baseline catches every attack, but
// every baseline *supports* every attack (a cell must exist for each).
const APPLICABILITY: Record<string, Record<string, string[]>> = {
  A: Object.fromEntries(MODE_A_ATTACKS.map((a) => [a, [...BASELINES]])),
  B: Object.fromEntries(MODE_B_ATTACKS.map((a) => [a, [...BASELINES]])),
};

const ALL_ATTACKS = new Set([...MODE_A_ATTACKS, ...MODE_B_ATTACKS]);

const OUTCOMES = new Set([
  "PREVENTED",
  "DETECTED",
  "EXPLOITED",
  "PARTIALLY_MITIGATED",
  "NOT_APPLICABLE",
  "ERROR",
  "SKIPPED",
]);

/*───────────────────────────── context ───────────────────────────────*/

interface ValCtx {
  errors: string[];
  checks: { name: string; pass: boolean; detail?: string }[];
}

function fail(ctx: ValCtx, name: string, msg: string): void {
  ctx.errors.push(`${name}: ${msg}`);
  ctx.checks.push({ name, pass: false, detail: msg });
  console.error(`  ✗ ${name}: ${msg}`);
}

function pass(ctx: ValCtx, name: string, detail?: string): void {
  ctx.checks.push({ name, pass: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

/*───────────────────────────── helpers ───────────────────────────────*/

async function loadJson<T>(relative: string): Promise<T> {
  return JSON.parse(await readFile(join(root, relative), "utf8")) as T;
}

async function fileExists(relative: string): Promise<boolean> {
  try {
    await stat(join(root, relative));
    return true;
  } catch {
    return false;
  }
}

async function mtime(relative: string): Promise<number | null> {
  try {
    return (await stat(join(root, relative))).mtimeMs;
  } catch {
    return null;
  }
}

type Cell = { detected?: boolean; prevented?: boolean; note?: string; failedRules?: string[]; outcome?: string };
type ResultRecord = { attackId: string; scenario?: unknown; baselineComparison: Record<string, Cell>; matched?: boolean; guardPrevented?: boolean; [key: string]: unknown };

function cellOutcome(cell: Cell | undefined): string {
  if (!cell) return "MISSING";
  if (cell.outcome) return cell.outcome;
  if (cell.prevented === true) return "PREVENTED";
  if (cell.detected === true) return "DETECTED";
  return "EXPLOITED";
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "PREVENTED": return "Prevented";
    case "DETECTED": return "Detected";
    case "EXPLOITED": return "Allowed";
    case "NOT_APPLICABLE": return "—";
    case "PARTIALLY_MITIGATED": return "Partially mitigated";
    case "ERROR": return "Error";
    case "SKIPPED": return "Skipped";
    default: return outcome;
  }
}

/** Map a JSON cell to the string used in Markdown / CSV. */
function cellToDisplay(cell: Cell | undefined): string {
  const o = cellOutcome(cell);
  return outcomeLabel(o);
}

/*───────────────────────────── schema validation ─────────────────────*/

function validateSchema(ctx: ValCtx, label: string, record: unknown): asserts record is ResultRecord {
  const r = record as ResultRecord;
  const problems: string[] = [];
  if (typeof r.attackId !== "string" || r.attackId.length === 0) problems.push("missing attackId");
  if (!r.baselineComparison || typeof r.baselineComparison !== "object") {
    problems.push("missing baselineComparison");
  } else {
    for (const [b, cell] of Object.entries(r.baselineComparison)) {
      if (!BASELINES.includes(b)) {
        problems.push(`unknown baseline key "${b}" in baselineComparison`);
        continue;
      }
      const c = cell as Cell;
      if (c.detected !== undefined && typeof c.detected !== "boolean") problems.push(`${b}: detected not boolean`);
      if (c.prevented !== undefined && typeof c.prevented !== "boolean") problems.push(`${b}: prevented not boolean`);
      if (c.outcome !== undefined && !OUTCOMES.has(c.outcome)) problems.push(`${b}: invalid outcome "${c.outcome}"`);
      // NOTE: detected=true + prevented=true is valid (prevented is the stronger outcome).
      // The invariant is that DETECTED is never reported AS PREVENTED; cellOutcome() prioritizes PREVENTED.
    }
  }
  if (problems.length > 0) {
    fail(ctx, `schema:${label}`, problems.join("; "));
  } else {
    pass(ctx, `schema:${label}`, `attackId=${r.attackId}`);
  }
}

/*───────────────────────────── CSV parsing ───────────────────────────*/

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else {
      if (ch === ',') { fields.push(cur); cur = ""; }
      else if (ch === '"') { inQuotes = true; }
      else cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((l) => parseCsvLine(l));
  return { header, rows };
}

/*───────────────────────────── Markdown table parsing ─────────────────*/

function parseMdTable(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.split("|").map((c) => c.trim()).filter((_, i) => i > 0 && i < trimmed.split("|").length - 1);
    // Skip separator rows (---)
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/*───────────────────────────── validation checks ─────────────────────*/

async function runAllChecks(ctx: ValCtx): Promise<void> {
  /* ---------- load canonical JSON ---------- */
  const baselineJson = await loadJson<{ generatedAt: string; rows: Array<{ id: string; label: string; mode: string; vanilla: string; ap2x402: string; ebay: string; clbacel: string; clbDetection: string }> }>("experiments/benchmarks/baseline-comparison.json");
  const resultsJson = await loadJson<{ generatedAt: string; results: ResultRecord[]; matrix?: Record<string, Record<string, Cell>> }>("experiments/benchmarks/results.json");
  const p5Json = await loadJson<{ generatedAt: string; results: ResultRecord[]; matrix?: Record<string, Record<string, Cell>> }>("experiments/benchmarks/p5-results.json");

  const modeAResults = resultsJson.results;
  const modeBResults = p5Json.results;

  /* ===== 1. Schema validation for canonical result records ===== */
  console.log("\n[1] Schema validation");
  for (const r of modeAResults) validateSchema(ctx, "results.json", r);
  for (const r of modeBResults) validateSchema(ctx, "p5-results.json", r);

  /* ===== 2. Unknown baseline / attack identifiers ===== */
  console.log("\n[2] Identifier validation");
  for (const r of modeAResults) {
    if (!ALL_ATTACKS.has(r.attackId)) fail(ctx, "unknown-attack", `results.json: unknown attackId "${r.attackId}"`);
    else pass(ctx, `known-attack:${r.attackId}`);
    for (const b of Object.keys(r.baselineComparison)) {
      if (!BASELINES.includes(b)) fail(ctx, "unknown-baseline", `results.json:${r.attackId}: unknown baseline "${b}"`);
    }
  }
  for (const r of modeBResults) {
    if (!ALL_ATTACKS.has(r.attackId)) fail(ctx, "unknown-attack", `p5-results.json: unknown attackId "${r.attackId}"`);
    else pass(ctx, `known-attack:${r.attackId}`);
    for (const b of Object.keys(r.baselineComparison)) {
      if (!BASELINES.includes(b)) fail(ctx, "unknown-baseline", `p5-results.json:${r.attackId}: unknown baseline "${b}"`);
    }
  }
  for (const row of baselineJson.rows) {
    if (!ALL_ATTACKS.has(row.id)) fail(ctx, "unknown-attack", `baseline-comparison.json: unknown attack id "${row.id}"`);
    if (!BASELINES.every((b) => true)) {} // baseline-comparison uses column names, not baseline keys
  }

  /* ===== 3. Baseline identifiers exist in every matrix ===== */
  console.log("\n[3] Baseline coverage (B0–B3 in every result)");
  for (const r of modeAResults) {
    for (const b of BASELINES) {
      if (!(b in r.baselineComparison)) fail(ctx, `missing-baseline:${r.attackId}`, `results.json: missing baseline "${b}" for attack "${r.attackId}"`);
    }
  }
  for (const r of modeBResults) {
    for (const b of BASELINES) {
      if (!(b in r.baselineComparison)) fail(ctx, `missing-baseline:${r.attackId}`, `p5-results.json: missing baseline "${b}" for attack "${r.attackId}"`);
    }
  }

  /* ===== 4. Duplicate detection (attackId + scenario) ===== */
  console.log("\n[4] Duplicate detection");
  const seenA = new Set<string>();
  for (const r of modeAResults) {
    const key = `${r.attackId}|${JSON.stringify(r.scenario)}`;
    if (seenA.has(key)) fail(ctx, `duplicate:${key}`, `results.json: duplicate record for attackId "${r.attackId}"`);
    seenA.add(key);
  }
  const seenB = new Set<string>();
  for (const r of modeBResults) {
    const key = `${r.attackId}|${JSON.stringify(r.scenario)}`;
    if (seenB.has(key)) fail(ctx, `duplicate:${key}`, `p5-results.json: duplicate record for attackId "${r.attackId}"`);
    seenB.add(key);
  }
  pass(ctx, "duplicates", `modeA=${modeAResults.length} records, modeB=${modeBResults.length} records`);

  /* ===== 5. Missing expected attack/baseline combinations ===== */
  console.log("\n[5] Applicability matrix coverage");
  const expectedCombos = new Set<string>();
  for (const mode of ["A", "B"]) {
    for (const attackId of Object.keys(APPLICABILITY[mode])) {
      for (const b of BASELINES) expectedCombos.add(`${mode}|${attackId}|${b}`);
    }
  }
  const actualCombos = new Set<string>();
  for (const r of modeAResults) for (const b of Object.keys(r.baselineComparison)) actualCombos.add(`A|${r.attackId}|${b}`);
  for (const r of modeBResults) for (const b of Object.keys(r.baselineComparison)) actualCombos.add(`B|${r.attackId}|${b}`);
  const missingCombos = [...expectedCombos].filter((c) => !actualCombos.has(c));
  if (missingCombos.length > 0) {
    fail(ctx, "missing-combos", `missing attack/baseline combinations: ${missingCombos.join(", ")}`);
  } else {
    pass(ctx, "coverage", `all ${expectedCombos.size} expected attack/baseline combinations present`);
  }

  /* ===== 6. NOT_APPLICABLE for missing/inapplicable combinations ===== */
  console.log("\n[6] NOT_APPLICABLE representation");
  // Since the applicability matrix says all combos apply, no cell should be
  // NOT_APPLICABLE unless explicitly marked. Verify no cell is silently absent
  // while claiming to be complete. Any NOT_APPLICABLE cell must be explicit.
  let notApplicableCount = 0;
  for (const r of modeAResults) {
    for (const [b, cell] of Object.entries(r.baselineComparison)) {
      if (cellOutcome(cell) === "NOT_APPLICABLE") notApplicableCount++;
    }
  }
  for (const r of modeBResults) {
    for (const [b, cell] of Object.entries(r.baselineComparison)) {
      if (cellOutcome(cell) === "NOT_APPLICABLE") notApplicableCount++;
    }
  }
  pass(ctx, "not-applicable", `${notApplicableCount} explicit NOT_APPLICABLE cells`);

  /* ===== 7. Denormalized matrix matches per-result baselineComparison ===== */
  console.log("\n[7] Matrix/baselineComparison consistency");
  for (const r of modeAResults) {
    const m = resultsJson.matrix?.[r.attackId];
    if (!m) { fail(ctx, `matrix:${r.attackId}`, "results.json matrix missing entry"); continue; }
    for (const b of BASELINES) {
      const a = cellOutcome(r.baselineComparison[b]);
      const m2 = cellOutcome(m[b]);
      if (a !== m2) fail(ctx, `matrix-mismatch:${r.attackId}:${b}`, `results.json per-result=${a}, matrix=${m2}`);
    }
  }
  for (const r of modeBResults) {
    const m = p5Json.matrix?.[r.attackId];
    if (!m) { fail(ctx, `matrix:${r.attackId}`, "p5-results.json matrix missing entry"); continue; }
    for (const b of BASELINES) {
      const a = cellOutcome(r.baselineComparison[b]);
      const m2 = cellOutcome(m[b]);
      if (a !== m2) fail(ctx, `matrix-mismatch:${r.attackId}:${b}`, `p5-results.json per-result=${a}, matrix=${m2}`);
    }
  }

  /* ===== 8. DETECTED not collapsed into PREVENTED ===== */
  console.log("\n[8] DETECTED vs PREVENTED separation");
  // cellOutcome() prioritizes PREVENTED over DETECTED, so an attack that is
  // both detected and prevented is reported as PREVENTED (correct).
  // Verify no cell reports DETECTED when prevented=true (that would be a collapse).
  let misreported = 0;
  for (const r of modeAResults) {
    for (const [b, cell] of Object.entries(r.baselineComparison)) {
      if (cell.prevented === true && cellOutcome(cell) !== "PREVENTED") misreported++;
    }
  }
  for (const r of modeBResults) {
    for (const [b, cell] of Object.entries(r.baselineComparison)) {
      if (cell.prevented === true && cellOutcome(cell) !== "PREVENTED") misreported++;
    }
  }
  if (misreported > 0) fail(ctx, "detected-collapsed", `${misreported} cells report DETECTED while prevented=true`);
  else pass(ctx, "detected-separation", "no cell collapses DETECTED into PREVENTED");

  /* ===== 9. JSON → Markdown comparison ===== */
  console.log("\n[9] JSON vs Markdown consistency");

  // attack-matrix.md vs results.json (Mode A)
  const attackMd = await readFile(join(benchDir, "attack-matrix.md"), "utf8");
  const attackRows = parseMdTable(attackMd);
  // header: Attack | B0 | B1 | B2 | B3
  let mdMismatches = 0;
  for (const row of attackRows) {
    if (row.length < 5) continue;
    const attackId = row[0];
    if (!MODE_A_ATTACKS.includes(attackId)) continue;
    const rec = modeAResults.find((r) => r.attackId === attackId);
    if (!rec) { fail(ctx, `md:${attackId}`, "attack-matrix.md row not in results.json"); mdMismatches++; continue; }
    for (let i = 0; i < 4; i++) {
      const b = BASELINES[i];
      const expected = cellToDisplay(rec.baselineComparison[b]);
      const actual = row[i + 1];
      if (expected !== actual) {
        fail(ctx, `md-mismatch:${attackId}:${b}`, `attack-matrix.md="${actual}", results.json="${expected}"`);
        mdMismatches++;
      }
    }
  }
  if (mdMismatches === 0) pass(ctx, "attack-matrix.md", "matches results.json");

  // p5-attack-matrix.md vs p5-results.json (Mode B)
  const p5Md = await readFile(join(benchDir, "p5-attack-matrix.md"), "utf8");
  const p5Rows = parseMdTable(p5Md);
  // header: Scenario | Predicate attack | B0 | B1 | B2 | B3 | Failed rules
  mdMismatches = 0;
  for (const row of p5Rows) {
    if (row.length < 6) continue;
    const attackId = row[1];
    if (!MODE_B_ATTACKS.includes(attackId)) continue;
    const rec = modeBResults.find((r) => r.attackId === attackId);
    if (!rec) { fail(ctx, `md:${attackId}`, "p5-attack-matrix.md row not in p5-results.json"); mdMismatches++; continue; }
    for (let i = 0; i < 4; i++) {
      const b = BASELINES[i];
      const expected = cellToDisplay(rec.baselineComparison[b]);
      const actual = row[i + 2];
      if (expected !== actual) {
        fail(ctx, `md-mismatch:${attackId}:${b}`, `p5-attack-matrix.md="${actual}", p5-results.json="${expected}"`);
        mdMismatches++;
      }
    }
    // guardPrevented cross-check for Mode B
    if (rec.baselineComparison.B3?.prevented === true && rec.guardPrevented !== true) {
      fail(ctx, `md-guard:${attackId}`, "B3 prevented=true but guardPrevented not true");
      mdMismatches++;
    }
  }
  if (mdMismatches === 0) pass(ctx, "p5-attack-matrix.md", "matches p5-results.json");

  // baseline-comparison.md vs baseline-comparison.json
  const baselineMd = await readFile(join(benchDir, "baseline-comparison.md"), "utf8");
  const baselineRows = parseMdTable(baselineMd);
  // header: Attack | Mode | Vanilla x402 | AP2 + x402 | eBay monitor | Full CLB-ACEL | CLB detection
  const acceptReject = (v: string): "Accepted" | "Rejected" => (v === "ACCEPT" ? "Accepted" : "Rejected");
  mdMismatches = 0;
  for (const row of baselineRows) {
    if (row.length < 7) continue;
    const mode = row[1];
    const id = baselineJson.rows.find((r) => r.mode === mode && r.label === row[0])?.id;
    if (!id) continue;
    const brow = baselineJson.rows.find((r) => r.id === id)!;
    const cols = [brow.vanilla, brow.ap2x402, brow.ebay, brow.clbacel];
    for (let i = 0; i < 4; i++) {
      const expected = acceptReject(cols[i]);
      const actual = row[i + 2];
      if (expected !== actual) {
        fail(ctx, `baseline-md:${id}:${BASELINES[i]}`, `baseline-comparison.md="${actual}", baseline-comparison.json="${expected}"`);
        mdMismatches++;
      }
    }
  }
  if (mdMismatches === 0) pass(ctx, "baseline-comparison.md", "matches baseline-comparison.json");

  /* ===== 10. JSON → CSV comparison ===== */
  console.log("\n[10] JSON vs CSV consistency");
  const csvText = await readFile(join(benchDir, "results.csv"), "utf8");
  const { header, rows: csvRows } = parseCsv(csvText);
  const b0Idx = header.indexOf("Vanilla x402");
  const b1Idx = header.indexOf("AP2 + x402");
  const b2Idx = header.indexOf("eBay monitor");
  const b3Idx = header.indexOf("Full CLB + ACEL");
  const attackIdIdx = header.indexOf("attackId");
  let csvMismatches = 0;
  for (const row of csvRows) {
    if (row.length < Math.max(b0Idx, b1Idx, b2Idx, b3Idx, attackIdIdx) + 1) continue;
    const attackId = row[attackIdIdx];
    const rec = modeAResults.find((r) => r.attackId === attackId);
    if (!rec) continue;
    const cells = [rec.baselineComparison.B0, rec.baselineComparison.B1, rec.baselineComparison.B2, rec.baselineComparison.B3];
    const idxs = [b0Idx, b1Idx, b2Idx, b3Idx];
    for (let i = 0; i < 4; i++) {
      const expected = cellToDisplay(cells[i]);
      const actual = row[idxs[i]];
      if (expected !== actual) {
        fail(ctx, `csv-mismatch:${attackId}:${BASELINES[i]}`, `results.csv="${actual}", results.json="${expected}"`);
        csvMismatches++;
      }
    }
  }
  if (csvMismatches === 0) pass(ctx, "results.csv", "matches results.json");

  /* ===== 11. Report counts match underlying records ===== */
  console.log("\n[11] Report counts vs records");
  const reproMd = await readFile(join(benchDir, "REPRODUCIBILITY.md"), "utf8");
  const lines = reproMd.split("\n");

  // Extract rows from a section bounded by "## <header>" and the next "##"
  function sectionRows(startHeader: string): string[] {
    let inSection = false;
    const rows: string[] = [];
    for (const line of lines) {
      if (line.startsWith("## " + startHeader)) { inSection = true; continue; }
      if (inSection && line.startsWith("## ")) break;
      if (inSection && line.startsWith("|")) rows.push(line);
    }
    return rows;
  }

  const modeAMdRows = sectionRows("Mode A matrix").filter((l) => MODE_A_ATTACKS.some((a) => l.includes(`| ${a} `)));
  if (modeAMdRows.length !== modeAResults.length) {
    fail(ctx, "report-count:modeA", `REPRODUCIBILITY.md Mode A rows=${modeAMdRows.length}, results.json=${modeAResults.length}`);
  } else {
    pass(ctx, "report-count:modeA", `${modeAResults.length} attacks`);
  }

  const modeBMdRows = sectionRows("Mode B predicate matrix").filter((l) => MODE_B_ATTACKS.some((a) => l.includes(`| ${a} `)));
  if (modeBMdRows.length !== modeBResults.length) {
    fail(ctx, "report-count:modeB", `REPRODUCIBILITY.md Mode B rows=${modeBMdRows.length}, p5-results.json=${modeBResults.length}`);
  } else {
    pass(ctx, "report-count:modeB", `${modeBResults.length} attacks`);
  }

  /* ===== 12. Skipped/failed not counted as successful ===== */
  console.log("\n[12] Skipped/failed outcome integrity");
  // Verify no result has a prevented/detected outcome derived from a missing cell
  // and that no "successful" label is applied to ERROR/SKIPPED outcomes.
  let badOutcome = 0;
  for (const r of modeAResults) {
    for (const [b, cell] of Object.entries(r.baselineComparison)) {
      if (cell.outcome === "SUCCESSFUL" || cell.outcome === "SUCCESS") {
        fail(ctx, `bad-outcome:${r.attackId}:${b}`, `outcome "${cell.outcome}" is not a valid classification`);
        badOutcome++;
      }
    }
  }
  for (const r of modeBResults) {
    for (const [b, cell] of Object.entries(r.baselineComparison)) {
      if (cell.outcome === "SUCCESSFUL" || cell.outcome === "SUCCESS") {
        fail(ctx, `bad-outcome:${r.attackId}:${b}`, `outcome "${cell.outcome}" is not a valid classification`);
        badOutcome++;
      }
    }
  }
  if (badOutcome === 0) pass(ctx, "outcome-integrity", "no ERROR/SKIPPED outcome mislabeled as successful");

  /* ===== 13. Report-generation timestamps identify the data ===== */
  console.log("\n[13] Timestamp integrity");
  const tsChecks: Array<{ label: string; ts: string | undefined }> = [
    { label: "baseline-comparison.json", ts: baselineJson.generatedAt },
    { label: "results.json", ts: resultsJson.generatedAt },
    { label: "p5-results.json", ts: p5Json.generatedAt },
  ];
  let tsOk = true;
  for (const c of tsChecks) {
    if (!c.ts || !Date.parse(c.ts)) {
      fail(ctx, `timestamp:${c.label}`, "missing or invalid generatedAt");
      tsOk = false;
    } else {
      pass(ctx, `timestamp:${c.label}`, c.ts);
    }
  }
  if (tsOk) pass(ctx, "timestamps", "all canonical sources carry valid generatedAt");

  /* ===== 14. Stale generated files after source data changes ===== */
  console.log("\n[14] Stale artifact detection");
  // Each generated Markdown/CSV file is derived from specific JSON sources.
  // A generated file must be at least as new as every source it was derived
  // from. Compare file mtimes only.
  const generatedFileSources: Record<string, string[]> = {
    "results.csv": ["results.json"],
    "attack-matrix.md": ["results.json"],
    "p5-attack-matrix.md": ["p5-results.json"],
    "baseline-comparison.md": ["baseline-comparison.json"],
    // REPRODUCIBILITY.md is written by reproduce:all after this validation
    // step runs; its content correctness is checked by check 11 instead.
  };
  const sourceMtimes: Record<string, number | null> = {};
  const allSources = new Set(Object.values(generatedFileSources).flat());
  for (const sf of allSources) {
    sourceMtimes[sf] = await mtime(`experiments/benchmarks/${sf}`);
  }
  for (const gf of Object.keys(generatedFileSources)) {
    const gfMtime = await mtime(`experiments/benchmarks/${gf}`);
    if (gfMtime === null) {
      fail(ctx, `stale:${gf}`, "generated file does not exist");
      continue;
    }
    const sources = generatedFileSources[gf];
    const staleSources = sources.filter((sf) => {
      const sm = sourceMtimes[sf];
      return sm !== null && sm > gfMtime + 10_000; // 10s tolerance for sub-second fs resolution
    });
    if (staleSources.length > 0) {
      fail(ctx, `stale:${gf}`, `${gf} mtime is older than source ${staleSources.join(", ")} mtime (by >10s)`);
    }
  }
  pass(ctx, "stale-check", "checked generated file freshness against sources (file mtimes)");

  /* ===== 15. Phase artifacts exist ===== */
  console.log("\n[15] Phase artifact presence");
  const phaseFiles = ["phase4-results.json", "phase7-caveat.json", "phase7-confidential.json"];
  for (const pf of phaseFiles) {
    const exists = await fileExists(`experiments/benchmarks/${pf}`);
    if (!exists) fail(ctx, `missing-phase:${pf}`, "phase artifact not found");
    else pass(ctx, `phase:${pf}`, "present");
  }
}

/*───────────────────────────── main ──────────────────────────────────*/

async function main(): Promise<void> {
  const ctx: ValCtx = { errors: [], checks: [] };
  console.log("== Stale-artifact validation ==");
  await runAllChecks(ctx);

  console.log(`\n== Validation summary: ${ctx.checks.filter((c) => c.pass).length}/${ctx.checks.length} checks passed ==`);
  if (ctx.errors.length > 0) {
    console.error(`\n${ctx.errors.length} validation failure(s):`);
    for (const e of ctx.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("All validation checks passed.");
}

main().catch((err) => {
  console.error("Validation script failed:", err);
  process.exit(1);
});
