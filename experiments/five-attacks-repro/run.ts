/**
 * Phase 7D — Five Attacks on x402: Honest Reproduction
 *
 * Usage:
 *   bun run e2e:five-attacks
 *
 * What this does:
 *   1. Reads the committed attack2_real.json from the Five-Attacks artifact
 *      (arXiv:2605.11781) to extract the no-idempotency DGR series.
 *   2. Reproduces the Attack II (replay) DEFENSE in our CLB-ACEL stack:
 *      - buildValidBundle() + markReplayAttempt() confirms the local x402
 *        facilitator prevents the replay (NonceAlreadyConsumedError).
 *      - verifyTrace() confirms R9_NONCE_CONSUMED_EXACTLY_ONCE fails for the
 *        replayed bundle.
 *   3. Writes experiments/benchmarks/five-attacks-comparison.md with an honest
 *      mapping of all five published attacks to our stack's result.
 *
 * The Five-Attacks artifact is referenced by path and NOT re-vendored or
 * re-committed here. Their own `npm run attack2` re-runs the Hardhat testbed;
 * we only cite their committed evidence and reproduce our defense.
 *
 * Output is fully deterministic — no wall-clock timestamps, latencies, or
 * txHashes are written to the .md file.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildValidBundle, markReplayAttempt, verifyTrace } from "@clb-acel/attack-core";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ARTIFACT_JSON = resolve(
  import.meta.dir,
  "../../reference-papers/Five Attacks on x402/x402-attack-FDF1 (attack simulation)/results/attack2/attack2_real.json",
);

const OUT_DIR = resolve(import.meta.dir, "../benchmarks");
const OUT_MD = resolve(OUT_DIR, "five-attacks-comparison.md");

// ---------------------------------------------------------------------------
// 1. Parse the committed Attack II artifact
// ---------------------------------------------------------------------------

interface Attack2Row {
  n: number;
  idempotency: boolean;
  grantsIssued: number;
  settleSuccess: number;
  settleReverted: number;
  settleDuplicate: number;
  DSR: number;
  DGR: number;
  elapsed_ms: number;
}

interface Attack2Json {
  experiment: string;
  timestamp: string;
  chain: string;
  contract: string;
  results: Attack2Row[];
}

const artifactRaw = await Bun.file(ARTIFACT_JSON).text();
const artifact: Attack2Json = JSON.parse(artifactRaw);

// Extract no-idempotency rows (vanilla x402 behaviour)
const noIdempRows = artifact.results.filter((row) => !row.idempotency);
const idempRows = artifact.results.filter((row) => row.idempotency);

console.log("=== Attack II artifact (parsed from committed JSON) ===");
console.log(`  Experiment : ${artifact.experiment}`);
console.log(`  Timestamp  : ${artifact.timestamp}`);
console.log(`  Chain      : ${artifact.chain}`);
console.log("");
console.log("  No-idempotency rows (vanilla x402 — DGR = n):");
for (const row of noIdempRows) {
  console.log(`    n=${row.n}  DGR=${row.DGR}  grantsIssued=${row.grantsIssued}`);
}
console.log("");
console.log("  With-idempotency rows (DGR = 1 regardless of n):");
for (const row of idempRows) {
  console.log(`    n=${row.n}  DGR=${row.DGR}  grantsIssued=${row.grantsIssued}`);
}
console.log("");

// Sanity-check: every no-idempotency row must have DGR === n
for (const row of noIdempRows) {
  if (row.DGR !== row.n) {
    throw new Error(
      `Unexpected: artifact row n=${row.n} has DGR=${row.DGR} (expected ${row.n}). ` +
        "The artifact shape may have changed — re-inspect attack2_real.json.",
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Reproduce the Attack II DEFENSE in our stack
// ---------------------------------------------------------------------------

console.log("=== Reproducing Attack II defense in CLB-ACEL stack ===");

const base = await buildValidBundle();
const replay = await markReplayAttempt(base);

console.log(`  replay.prevented : ${replay.prevented}`);
console.log(`  replay.errorName : ${replay.errorName ?? "(none)"}`);

if (!replay.prevented) {
  console.error("ASSERTION FAILED: replay.prevented must be true");
  console.error("The local x402 facilitator did not reject the duplicate nonce.");
  process.exit(1);
}

const verification = await verifyTrace(replay.bundle);

console.log(`  verifier status  : ${verification.result.status}`);
console.log(`  failedRules      : ${verification.result.failedRules.join(", ")}`);

if (!verification.result.failedRules.includes("R9_NONCE_CONSUMED_EXACTLY_ONCE")) {
  console.error(
    "ASSERTION FAILED: verification.result.failedRules must include R9_NONCE_CONSUMED_EXACTLY_ONCE",
  );
  console.error(`Got: ${JSON.stringify(verification.result.failedRules)}`);
  process.exit(1);
}

console.log("");
console.log("  ASSERTION PASSED: replay.prevented === true");
console.log("  ASSERTION PASSED: failedRules includes R9_NONCE_CONSUMED_EXACTLY_ONCE");
console.log("");

// ---------------------------------------------------------------------------
// 3. Build the honest comparison markdown (deterministic — no wall-clock data)
// ---------------------------------------------------------------------------

// Format the DGR series from the parsed artifact for the table cell
const noIdempSeries = noIdempRows.map((row) => `n=${row.n}→DGR ${row.DGR}`).join("; ");

const md = `# Phase 7D — Five Attacks on x402: Honest Reproduction

We reference the local committed artifact at
\`reference-papers/Five Attacks on x402/x402-attack-FDF1 (attack simulation)/\`
(arXiv:2605.11781) and reproduce **only the defense** in our CLB-ACEL stack.
Their offense numbers come from their committed \`attack2_real.json\`
(experiment: "${artifact.experiment}", chain: "${artifact.chain}",
artifact timestamp: ${artifact.timestamp}); we do not re-run their Hardhat testbed.
The table below is an honest mapping — partial mitigations and out-of-scope items
are called out explicitly; we do not overclaim.

## Attack comparison

| Their attack | Our result | Mechanism |
| --- | --- | --- |
| I-A revert-grant / I-B settlement preemption | **Partially mitigated** | nonce = H(C) + R8/R9 pin a settlement to one commitment, so a granted resource cannot be re-bound to a different settlement; the optimistic-grant timing window itself is a web-/facilitator-layer issue we do not remove. |
| II replay / missing idempotency | **Eliminated** | single-use nonce derived from the commitment C; R9 consume-once. Their committed \`attack2_real.json\` (artifact timestamp: ${artifact.timestamp}) shows DGR = n without idempotency (${noIdempSeries}); our stack rejects the replayed settlement (facilitator \`prevented = true\` + verifier R9 fails), i.e. DGR collapses to 1. |
| III proxy/cache header manipulation | **Out of scope (cite their fix)** | a web-/HTTP-layer attack outside the payment-binding model; we cite the authors' own \`Cache-Control: no-store, private\` mitigation and do not claim to address it. |
| IV server-selection manipulation | **Mitigated when discovery is bound** | ERC-8004 identity binding (Phase 7B) plus decision-layer instrumentation (Phase 7D Task 6) makes the merchant choice auditable against the human's allowedPayees; we instrument the decision, we do not claim to enforce agent "competence". |

The paper's "five" attacks are I-A, I-B, II, III, and IV (Attack I has two settlement-path variants); all are mapped above.

## Attack II reproduction

The live reproduction asserts two properties:

1. **Facilitator prevented = true** — the local x402 facilitator rejected the
   second settlement attempt on the same nonce with \`NonceAlreadyConsumedError\`.
2. **Verifier R9 fails** — \`verifyTrace\` returns
   \`failedRules: ["R9_NONCE_CONSUMED_EXACTLY_ONCE"]\` for the replayed bundle,
   because \`bundle.nonceReplayAttempt === true\`.

Both assertions passed. The vanilla x402 DGR series from their artifact
(${noIdempSeries}) collapses to DGR = 1 under our R9 consume-once enforcement.

## What we do NOT claim

- We do not eliminate the optimistic-grant timing window of Attack I (web-layer).
- We do not address Attack III (HTTP cache headers) — that is a web-server concern.
- For Attack IV, "mitigation when discovery is bound" means the decision is
  auditable; it does not enforce that the agent's merchant ranking is optimal.
`;

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_MD, md, "utf8");

console.log(`=== Written: ${OUT_MD} ===`);
console.log("");
console.log("Done. Exit 0.");
