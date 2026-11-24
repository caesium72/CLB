import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

/**
 * Watches the PoW-faucet signer on Sepolia. When the mining claim lands:
 *   1. bridge a small amount to Base Sepolia (canonical L1StandardBridge)
 *   2. run the public Base Sepolia guard evaluation
 *   3. record the outcome in watch-status.json
 *
 * Nothing here mines or passes a captcha — the human does that. This script
 * only observes balances and runs already-written tooling once funds exist.
 */

const root = resolve(import.meta.dir, "..");
const outDir = resolve(root, "experiments", "benchmarks", "reviewer2", "comment2", "public");
await mkdir(outDir, { recursive: true });
const statusPath = resolve(outDir, "watch-status.json");

const envText = await readFile(resolve(root, ".env"), "utf8");
const key = envText
  .split(/\r?\n/u)
  .find((line) => line.startsWith("DEPLOYER_PRIVATE_KEY="))
  ?.slice("DEPLOYER_PRIVATE_KEY=".length)
  .trim() as Hex | undefined;
if (!key || !/^0x[0-9a-fA-F]{64}$/u.test(key)) {
  throw new Error("DEPLOYER_PRIVATE_KEY missing/invalid — watcher cannot start");
}
const address = privateKeyToAccount(key).address;

const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const BASE_RPC = "https://sepolia.base.org";
const MIN_SEPOLIA_WEI = 1_500_000_000_000_000n; // 0.0015 ETH: bridge 0.001 + gas reserve
const POLL_MS = 15_000;
const MAX_ATTEMPTS = 360; // 90 minutes

async function balance(rpc: string): Promise<bigint> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_getBalance",
    params: [address, "latest"],
    id: 1,
  });
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${rpc} returned ${response.status}`);
  const json = (await response.json()) as { result?: string; error?: { message?: string } };
  if (!json.result) throw new Error(json.error?.message ?? "no balance result");
  return BigInt(json.result);
}

async function run(args: string[]): Promise<{ code: number; log: string }> {
  const proc = Bun.spawn([process.execPath, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, log: `${stdout}\n${stderr}`.slice(0, 20_000) };
}

const status: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  signer: address,
  sepoliaRpc: SEPOLIA_RPC,
  baseRpc: BASE_RPC,
  minSepoliaWei: MIN_SEPOLIA_WEI.toString(),
  phase: "WAITING_FOR_SEPOLIA_FUNDS",
  checks: [],
};
const save = () => writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
await save();

let bridged = false;
let bridgeAttempted = false;
let evaluated = false;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  try {
    const [sep, base] = await Promise.all([balance(SEPOLIA_RPC), balance(BASE_RPC)]);
    (status.checks as unknown[]).push({
      at: new Date().toISOString(),
      sepoliaWei: sep.toString(),
      baseWei: base.toString(),
    });
    if ((status.checks as unknown[]).length > 400) (status.checks as unknown[]).shift();
    console.log(`[${attempt}] sepolia=${sep} base=${base} phase=${status.phase}`);
    await save();

    if (!bridged && sep >= MIN_SEPOLIA_WEI) {
      status.phase = "BRIDGING";
      await save();
      const result = await run(["run", "scripts/bridge-sepolia-to-base.ts"]);
      status.bridge = result;
      bridged = result.code === 0;
      status.phase = bridged ? "WAITING_FOR_BASE_FUNDS" : "BRIDGE_FAILED";
      await save();
    }

    if (bridged && !evaluated && base > 0n) {
      status.phase = "RUNNING_PUBLIC_EVALUATION";
      await save();
      const result = await run(["run", "e2e:reviewer2:comment2:public"]);
      status.publicEvaluation = result;
      evaluated = result.code === 0;
      status.phase = evaluated ? "COMPLETE" : "PUBLIC_EVALUATION_FAILED";
      await save();
      break;
    }
  } catch (error) {
    (status.checks as unknown[]).push({
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    await save();
  }

  await new Promise((done) => setTimeout(done, POLL_MS));
}

status.finishedAt = new Date().toISOString();
await save();
console.log(`Watcher finished: ${status.phase}`);
