/**
 * Reviewer #4, Comment 4 — trace-length SCALING harness.
 *
 * Measures the two trace-length-sensitive operations identified by the review:
 *   (1) evidence integrity: linkEvidenceEvents -> hashEvidenceEvent -> buildMerkleRoot
 *   (2) verifyTrace: all R1–R17 rules + certificate hash
 * over synthetic but VALID evidence traces of 7, 16, 32, 64 and 128 events.
 *
 * Discipline (identical to scripts/e2e-performance.ts): every input is prepared
 * OUTSIDE the timed span; only the named operation is inside performance.now().
 * Warmup iterations are excluded. Raw samples are preserved in the results JSON.
 *
 * Synthetic events are built with the same shape/protocol enum as the fixture
 * generator in attack-core, and their hash chain, eventHashes and Merkle root
 * are recomputed so R1 genuinely passes (asserted once per size, outside timing).
 *
 * This is a ONE-MACHINE measurement. No public-network result is produced.
 *
 * Usage: bun run scripts/e2e-scaling.ts   (SCALING_SAMPLES=100 default)
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform } from "node:os";
import { join, resolve } from "node:path";
import { TEST_KEYS, buildValidBundle } from "@clb-acel/attack-core";
import {
  buildMerkleRoot,
  hashEvidenceEvent,
  linkEvidenceEvents,
} from "../packages/evidence-core/src/index";
import { verifyTrace } from "../packages/verifier-core/src/index";
import { privateKeyToAccount } from "viem/accounts";

const repoRoot = resolve(import.meta.dir, "..");
const artifactsDir = join(repoRoot, "experiments", "benchmarks");
const resultsPath = join(artifactsDir, "scaling-results.json");
const reportPath = join(artifactsDir, "scaling-report.md");

const SIZES = [7, 16, 32, 64, 128] as const;
const WARMUP = 2;

function sampleCount(): number {
  const raw = Number(process.env.SCALING_SAMPLES ?? process.env.PERF_SAMPLES ?? "100");
  return Number.isInteger(raw) && raw > 0 ? raw : 100;
}
const N = sampleCount();

type Summary = {
  mean: number;
  median: number;
  p50: number;
  p95: number;
  stddev: number; // sample (n-1) standard deviation
  sampleCount: number;
  min: number;
  max: number;
};

function summarize(values: number[]): Summary {
  const n = values.length;
  if (n === 0) {
    return { mean: 0, median: 0, p50: 0, p95: 0, stddev: 0, sampleCount: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const variance =
    n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : 0;
  return {
    mean,
    median,
    p50: median,
    p95: sorted[Math.max(0, Math.ceil(0.95 * n) - 1)]!,
    stddev: Math.sqrt(variance),
    sampleCount: n,
    min: sorted[0]!,
    max: sorted[n - 1]!,
  };
}

/** Run `op` N times with fresh inputs prepared OUTSIDE the recorded span. */
async function timeSeries<T>(
  prepare: () => T | Promise<T>,
  op: (input: T) => unknown | Promise<unknown>,
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < WARMUP; i += 1) await op(await prepare());
  for (let i = 0; i < N; i += 1) {
    const input = await prepare();
    const start = performance.now();
    await op(input);
    out.push(performance.now() - start);
  }
  return out;
}

/** Least-squares slope of log(mean time) vs log(event count). ~1 = linear. */
function logLogSlope(points: Array<{ n: number; mean: number }>): number {
  const usable = points.filter((p) => p.n > 0 && p.mean > 0);
  if (usable.length < 2) return 0;
  const xs = usable.map((p) => Math.log(p.n));
  const ys = usable.map((p) => Math.log(p.mean));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i]! - my), 0);
  const den = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

async function main(): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });

  const seedBundle = await buildValidBundle({ traceId: "r4c4-scaling-seed" });
  const human = privateKeyToAccount(TEST_KEYS.userKey).address;
  const settledAt = seedBundle.settlement.settledAt;

  type EvidenceEventLike = Parameters<typeof linkEvidenceEvents>[0][number];
  type Bundle = typeof seedBundle;

  const PROTOCOLS = ["USER", "ERC8004", "AP2", "X402", "X402", "CHAIN", "DELIVERY"] as const;
  const OBJECT_TYPES = [
    "USER_INTENT",
    "ERC8004_AGENT_IDENTITY",
    "AP2_CART_MANDATE",
    "X402_PAYMENT_REQUIREMENT",
    "X402_PAYMENT_PAYLOAD",
    "CHAIN_SETTLEMENT",
    "DELIVERY_PROOF",
  ] as const;

  function makeEvents(size: number): EvidenceEventLike[] {
    return Array.from({ length: size }, (_, index) => {
      const objectType = OBJECT_TYPES[index % OBJECT_TYPES.length]!;
      return {
        traceId: `r4c4-scaling-${size}`,
        eventId: `evt-${index + 1}`,
        protocol: PROTOCOLS[index % PROTOCOLS.length]!,
        objectType,
        actor: "orchestrator",
        timestamp: new Date(Date.parse(settledAt) - (size - index) * 1000).toISOString(),
        objectHash: `0x${index.toString(16).padStart(64, "0")}`,
        publicFields: { objectType, index },
        signature: `0x${"1".repeat(130)}`,
      };
    });
  }

  function bundleWithEvents(base: Bundle, raw: EvidenceEventLike[]): Bundle {
    const events = linkEvidenceEvents(raw);
    const eventHashes = events.map(hashEvidenceEvent);
    return { ...base, events, eventHashes, merkleRoot: buildMerkleRoot(eventHashes) };
  }

  const evidenceBoundary =
    "linkEvidenceEvents(events) + events.map(hashEvidenceEvent) + buildMerkleRoot(hashes) — hash-chained evidence plus Merkle root; raw events prepared outside timer.";
  const verifierBoundary =
    "await verifyTrace(validSyntheticBundle, {expectedHumanPrincipal}) — R1–R17 rules + certificate hash; valid bundle (chain, eventHashes, Merkle root) prepared outside timer.";

  const series: Record<
    string,
    { metricId: string; unit: "ms"; boundary: string; eventCount: number; summary: Summary; samples: number[] }
  > = {};
  const validity: Array<{ eventCount: number; status: string; failedRules: string[]; merkleRoot: string }> = [];

  for (const size of SIZES) {
    const validBundle = bundleWithEvents(seedBundle, makeEvents(size));
    // Assert validity OUTSIDE the timed span: a failed trace would make the
    // measurement meaningless (the verifier could short-circuit).
    const probe = await verifyTrace(validBundle, { expectedHumanPrincipal: human });
    if (probe.result.status !== "PASS") {
      throw new Error(`synthetic ${size}-event bundle is invalid: ${probe.result.failedRules.join(", ")}`);
    }
    validity.push({
      eventCount: size,
      status: probe.result.status,
      failedRules: probe.result.failedRules,
      merkleRoot: validBundle.merkleRoot,
    });

    const evidenceSamples = await timeSeries(
      () => makeEvents(size),
      (events) => {
        const linked = linkEvidenceEvents(events);
        buildMerkleRoot(linked.map(hashEvidenceEvent));
      },
    );
    const verifySamples = await timeSeries(
      () => validBundle,
      (bundle) => verifyTrace(bundle, { expectedHumanPrincipal: human }),
    );

    series[`evidenceChain_n${size}`] = {
      metricId: "S1",
      unit: "ms",
      boundary: evidenceBoundary,
      eventCount: size,
      summary: summarize(evidenceSamples),
      samples: evidenceSamples,
    };
    series[`verifyTrace_n${size}`] = {
      metricId: "S2",
      unit: "ms",
      boundary: verifierBoundary,
      eventCount: size,
      summary: summarize(verifySamples),
      samples: verifySamples,
    };
  }

  const cpuInfo = cpus();
  const environment = {
    runtime: "bun",
    bunVersion: process.versions.bun ?? "unknown",
    nodeVersion: process.version,
    platform: platform(),
    arch: arch(),
    cpuModel: cpuInfo[0]?.model ?? "unknown",
    logicalCores: cpuInfo.length,
    machineCount: 1,
  };

  const trend = (prefix: string) => {
    const points = SIZES.map((size) => ({
      n: size,
      mean: series[`${prefix}_n${size}`]!.summary.mean,
    }));
    const slope = logLogSlope(points);
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const previous = points[points.length - 2]!;
    const interpretation =
      slope < 0.5
        ? "sublinear over this range: a size-independent cost (ECDSA signature checks / certificate hashing) dominates the per-event term; the per-event hash work is still present but masked."
        : slope <= 1.3
          ? "approximately linear in trace length; the Merkle reduction is O(n log n) but log2(n) <= 7 here, so the trend is near-linear."
          : "superlinear; linkEvidenceEvents currently reallocates its array per event (O(n^2) allocations), so growth can exceed the theoretical O(n log n) Merkle cost.";
    return {
      logLogSlope: slope,
      interpretation,
      endpointRatio: last.mean / first.mean,
      endpointSizeRatio: last.n / first.n,
      marginalMsPerEventAtLargest: (last.mean - previous.mean) / (last.n - previous.n),
      meanPerEventMs: Object.fromEntries(points.map((p) => [p.n, p.mean / p.n])),
    };
  };

  const document = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    reviewer: 4,
    comment: 4,
    topic: "SCALING — trace-length sensitivity of evidence integrity and verification",
    configuration: {
      eventCounts: [...SIZES],
      samplesPerSize: N,
      warmupIterationsExcluded: WARMUP,
      envOverrides: {
        SCALING_SAMPLES: process.env.SCALING_SAMPLES ?? null,
        PERF_SAMPLES: process.env.PERF_SAMPLES ?? null,
      },
    },
    environment,
    oneMachineLimitation:
      "ONE MACHINE ONLY. These numbers are not a multi-machine, multi-OS or cloud result and must not be presented as one.",
    baseSepolia:
      "NOT RUN — signer unfunded; see reviewer-2/comment-2/funding-guide.md; public harness ready at e2e:reviewer2:comment2:public. No public-network timing or gas is claimed here.",
    validity,
    boundaries: { evidenceChain: evidenceBoundary, verifyTrace: verifierBoundary },
    complexity: {
      evidenceChain: trend("evidenceChain"),
      verifyTrace: trend("verifyTrace"),
    },
    series,
  };
  await writeFile(resultsPath, `${JSON.stringify(document, null, 2)}\n`);
  const sha256 = createHash("sha256").update(await readFile(resultsPath)).digest("hex");

  const fmt = (v: number) => v.toFixed(4);
  const lines: string[] = [
    "# Reviewer #4 Comment 4 — Scaling (trace length)",
    "",
    `- Samples per size: **${N}** (warmup ${WARMUP}, excluded).`,
    `- Sizes (events): **${SIZES.join(", ")}**.`,
    `- Machine: **${environment.cpuModel}** · ${environment.logicalCores} logical cores · ${environment.platform}/${environment.arch} · ${environment.bunVersion}.`,
    `- **ONE MACHINE ONLY** — no multi-machine, multi-OS or cloud claim is made.`,
    `- Base Sepolia: **NOT RUN — signer unfunded; see reviewer-2/comment-2/funding-guide.md; public harness ready at e2e:reviewer2:comment2:public.**`,
    `- Raw samples + full precision: \`experiments/benchmarks/scaling-results.json\` (sha256 \`${sha256}\`).`,
    "",
    "All synthetic bundles passed R1–R17 with a valid hash chain, eventHashes and Merkle root before timing (asserted outside the timed span).",
    "",
    "| Series | Events | Mean (ms) | Median | p50 | p95 | Stddev | n | Min | Max | ms/event |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const size of SIZES) {
    for (const prefix of ["evidenceChain", "verifyTrace"]) {
      const s = series[`${prefix}_n${size}`]!.summary;
      lines.push(
        `| \`${prefix}_n${size}\` | ${size} | ${fmt(s.mean)} | ${fmt(s.median)} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.stddev)} | ${s.sampleCount} | ${fmt(s.min)} | ${fmt(s.max)} | ${fmt(s.mean / size)} |`,
      );
    }
  }
  lines.push(
    "",
    "## Complexity trend (log–log least squares)",
    "",
    `- Evidence chain: slope **${document.complexity.evidenceChain.logLogSlope.toFixed(3)}**, endpoint ${fmt(document.complexity.evidenceChain.meanPerEventMs[7]! * 7)} → ${fmt(document.complexity.evidenceChain.meanPerEventMs[128]! * 128)} ms (${document.complexity.evidenceChain.endpointRatio.toFixed(2)}× for ${document.complexity.evidenceChain.endpointSizeRatio.toFixed(2)}× events), marginal ${fmt(document.complexity.evidenceChain.marginalMsPerEventAtLargest)} ms/event at the largest step — ${document.complexity.evidenceChain.interpretation}`,
    `- verifyTrace: slope **${document.complexity.verifyTrace.logLogSlope.toFixed(3)}**, endpoint ${fmt(document.complexity.verifyTrace.meanPerEventMs[7]! * 7)} → ${fmt(document.complexity.verifyTrace.meanPerEventMs[128]! * 128)} ms (${document.complexity.verifyTrace.endpointRatio.toFixed(2)}× for ${document.complexity.verifyTrace.endpointSizeRatio.toFixed(2)}× events), marginal ${fmt(document.complexity.verifyTrace.marginalMsPerEventAtLargest)} ms/event at the largest step — ${document.complexity.verifyTrace.interpretation}`,
    "",
    "## Exact timing boundaries",
    "",
    `- \`evidenceChain\`: ${evidenceBoundary}`,
    `- \`verifyTrace\`: ${verifierBoundary}`,
    "",
  );
  await writeFile(reportPath, lines.join("\n"));

  console.log(
    JSON.stringify(
      {
        outputDir: artifactsDir,
        sizes: [...SIZES],
        samplesPerSize: N,
        seriesCount: Object.keys(series).length,
        evidenceSlope: document.complexity.evidenceChain.logLogSlope,
        verifySlope: document.complexity.verifyTrace.logLogSlope,
        sha256,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`\n✗ scaling benchmark failed: ${error instanceof Error ? error.stack : error}`);
  process.exit(1);
});
