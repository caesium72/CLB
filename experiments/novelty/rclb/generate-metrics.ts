/**
 * Regenerates experiments/novelty/rclb/metrics.json from LIVE local execution.
 * Run from the repository root:
 *   bun run experiments/novelty/rclb/generate-metrics.ts
 *
 * Gas figures are read from the forge log produced by:
 *   forge test --match-contract RevocationAwareGuardTest -vv
 * using a TEMP forge-std remap (never a repo-local clone).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkRevocationAwareAcceptance,
  computeRevocationAwareCommitment,
} from "../../../packages/clb-core/src/epochs.ts";
import { createInMemoryEpochRegistry } from "../../../packages/erc8004-adapter/src/index.ts";
import {
  buildRevocationScenarioContext,
  runRevocationScenarios,
  summarizeRevocationMetrics,
} from "../../../packages/attack-core/src/revocation-scenarios.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES = 200;
const AGENT = "rclb-metrics-agent";
const FIELD_SEED = buildRevocationScenarioContext();

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

/** Wall-clock cost of ONE revoke + execution-time acceptance decision, in-process. */
async function measureRevocationLatency(): Promise<{
  samples: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}> {
  const measurements: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const epochs = createInMemoryEpochRegistry({
      [AGENT]: { identityEpoch: 1n, mandateEpoch: 1n },
    });
    const start = performance.now();
    const current = await epochs.revokeIdentity(AGENT);
    const outcome = checkRevocationAwareAcceptance({
      fields: FIELD_SEED.fields,
      commitment: FIELD_SEED.commitment,
      currentIdentityEpoch: current.identityEpoch,
      currentMandateEpoch: current.mandateEpoch,
      now: FIELD_SEED.fields.expiry - 1n,
    });
    const elapsed = performance.now() - start;
    if (outcome.ok || !outcome.violations.includes("IDENTITY_EPOCH_STALE")) {
      throw new Error(`expected post-revocation rejection, got ${outcome.detail}`);
    }
    measurements.push(elapsed);
  }
  const sorted = [...measurements].sort((a, b) => a - b);
  const sum = measurements.reduce((total, value) => total + value, 0);
  return {
    samples: SAMPLES,
    meanMs: sum / SAMPLES,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

async function readGasFromForgeLog(): Promise<{
  baselineGas: number;
  rclbGuardGas: number;
  overheadGas: number;
  source: string;
}> {
  const log = await readFile(resolve(here, "forge-rclb.log"), "utf8").catch(() => "");
  const read = (pattern: RegExp): number | null => {
    const match = log.match(pattern);
    return match ? Number(match[1]) : null;
  };
  const baselineGas = read(/RCLB baseline gas \(local EVM demo\):\s*(\d+)/);
  const rclbGuardGas = read(/RCLB guard gas \(local EVM demo\):\s*(\d+)/);
  const overheadGas = read(/RCLB overhead gas \(local EVM demo\):\s*(\d+)/);
  if (baselineGas === null || rclbGuardGas === null || overheadGas === null) {
    throw new Error(
      "forge-rclb.log missing gas logs; run forge test --match-contract RevocationAwareGuardTest -vv first",
    );
  }
  return {
    baselineGas,
    rclbGuardGas,
    overheadGas,
    source: "forge test --match-contract RevocationAwareGuardTest -vv (TEMP forge-std remap, local EVM)",
  };
}

const scenarios = runRevocationScenarios();
const metrics = summarizeRevocationMetrics(scenarios);
const revocationLatency = await measureRevocationLatency();
const gasOverhead = await readGasFromForgeLog();

const artifact = {
  generatedAt: new Date().toISOString(),
  novelty: "RCLB — Revocation-Aware Temporal Cross-Layer Binding",
  scope: "DEMO / LOCAL. Not a production deployment or a literature-priority claim.",
  environment: {
    bun: "1.4.5",
    forge: "1.10.0",
    solc: "0.8.28",
    execution: "in-process TS + local EVM (forge/anvil class); forge-std cloned to TEMP only",
  },
  commitmentConstruction: {
    formula: "C_t = keccak256(abi.encode(bytes32 C, uint256 E_I, uint256 E_M, uint64 T_expiry, bytes32 N))",
    acceptance: "E_I == current E_I && E_M == current E_M && t <= T_expiry && N not consumed",
    paymentNonce: "keccak256(C_t)",
    example: {
      baseCommitment: FIELD_SEED.baseCommitment,
      identityEpoch: "1",
      mandateEpoch: "1",
      expiry: FIELD_SEED.fields.expiry.toString(),
      nonce: FIELD_SEED.fields.nonce,
      commitment: FIELD_SEED.commitment,
      paymentNonce: FIELD_SEED.paymentNonce,
    },
  },
  scenarios: scenarios.map(({ id, description, expectedAccepted, accepted, violations, steps }) => ({
    id,
    description,
    expectedAccepted,
    accepted,
    violations,
    steps,
  })),
  metrics: {
    scenarioCount: metrics.scenarioCount,
    adversarialCount: metrics.adversarialCount,
    preventedCount: metrics.preventedCount,
    staleAcceptanceRate: metrics.staleAcceptanceRate,
    falseRejectionRate: metrics.falseRejectionRate,
    raceResistance: metrics.raceResistance,
    revocationLatencyMs: {
      ...revocationLatency,
      meaning: "in-process revokeIdentity + one acceptance decision; excludes network, consensus and RPC time",
    },
    gasOverhead: {
      ...gasOverhead,
      baselineDefinition:
        "same-shape accept that recomputes C_t, checks H(C_t) and writes one storage slot, without authority epoch reads or expiry checks",
      caveat:
        "delta also includes cold account access, ABI decode and the settlement event; LOCAL ANVIL / DEMO only",
    },
  },
};

await mkdir(here, { recursive: true });
await writeFile(resolve(here, "metrics.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(`wrote ${resolve(here, "metrics.json")}`);
console.log(JSON.stringify(artifact.metrics, null, 2));
