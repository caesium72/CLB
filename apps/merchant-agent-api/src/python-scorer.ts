import { type ScorerFn } from "@clb-acel/delivery-core";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

export type PythonScorerOptions = {
  projectRoot?: string;
  command?: string[];
};

function uvAvailable(): boolean {
  const result = spawnSync("uv", ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

function runCommand(cwd: string, command: string[], input?: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command[0]!, command.slice(1), { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`Python scorer failed (${exitCode}): ${stderr || stdout}`));
        return;
      }
      resolvePromise(stdout);
    });

    if (input) {
      proc.stdin.write(input);
    }
    proc.stdin.end();
  });
}

/** Optional subprocess hook to the uv Python scorer in experiments/risk-scoring. */
export function createPythonScorer(options: PythonScorerOptions = {}): ScorerFn {
  const projectRoot = options.projectRoot ?? resolve(process.cwd(), "experiments/risk-scoring");
  const command = options.command ?? ["uv", "run", "risk-score"];

  return async (input) => {
    const stdout = await runCommand(projectRoot, [...command, "--token", input.token, "--chain", input.chain]);
    const payload = JSON.parse(stdout) as {
      signals: {
        liquidityRisk: number;
        holderConcentrationRisk: number;
        contractRisk: number;
        marketVolatilityRisk: number;
        socialNarrativeRisk?: number;
      };
      riskScore: number;
      inputDataHash: string;
      modelVersion: string;
    };

    return {
      signals: payload.signals,
      riskScore: payload.riskScore,
      inputDataHash: payload.inputDataHash as `0x${string}`,
    };
  };
}

export function resolveScorerFromEnv(): ScorerFn | undefined {
  const mode = process.env.RISK_SCORER?.trim().toLowerCase();
  if (mode !== "python") {
    return undefined;
  }
  if (!uvAvailable()) {
    console.warn(
      "RISK_SCORER=python but `uv` is not on PATH — falling back to TypeScript scoreToken. Install uv: https://docs.astral.sh/uv/",
    );
    return undefined;
  }
  return createPythonScorer();
}
