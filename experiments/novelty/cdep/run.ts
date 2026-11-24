import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAUSAL_SCENARIOS,
  runCausalScenarios,
} from "../../../packages/attack-core/src/causal-delegation.ts";

/**
 * Deterministic CDEP experiment artifact. Re-run with:
 *   bun run experiments/novelty/cdep/run.ts
 * No clocks, keys, network calls or random values are written.
 */
const here = dirname(fileURLToPath(import.meta.url));
const results = runCausalScenarios();
const honest = results.filter((result) => result.id === "HONEST_DAG");
const attacks = results.filter((result) => result.id !== "HONEST_DAG");

const artifact = {
  experiment: "CDEP — causal delegation and execution provenance on a multi-agent DAG",
  generatedBy: "bun run experiments/novelty/cdep/run.ts",
  deterministic: true,
  method:
    "Each scenario is a fixed delegation-DAG fixture verified by the deterministic verifyCausalExecution() engine; expected finding codes are declared in the fixture, not inferred from the run.",
  cases: results.map((result) => ({
    id: result.id,
    description: result.description,
    mutation: result.mutation,
    expectedFindingCodes: result.expectedFindingCodes,
    observedFindingCodes: result.observedFindingCodes,
    ok: result.ok,
    matchedExpectation: result.detected,
  })),
  summary: {
    scenarioCount: CAUSAL_SCENARIOS.length,
    honestCases: honest.length,
    honestPassed: honest.filter((result) => result.ok && result.detected).length,
    attackCases: attacks.length,
    attacksDetected: attacks.filter((result) => !result.ok && result.detected).length,
    falsePositives: honest.filter((result) => !result.ok).length,
    falseNegatives: attacks.filter((result) => result.ok || !result.detected).length,
  },
  limitations: [
    "Fixtures are synthetic; no real multi-agent network, registry or on-chain settlement is exercised.",
    "Certificates carry no authenticated signatures; root and terminal anchors are supplied by the caller from a trusted source, not fetched by the verifier.",
    "The engine is offline and deterministic; it proves consistency of the presented DAG, not that the DAG is complete relative to an external event log.",
    "Settlement lineage checks the delegation branch scope only; verifier rules R10–R13 and R12 still govern the actual mandate/registry constraints.",
  ],
};

await mkdir(here, { recursive: true });
await writeFile(join(here, "results.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify(artifact.summary));
