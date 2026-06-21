/**
 * Phase 2 live integration smoke test.
 *
 * Prerequisites:
 *   - .env with DATABASE_URL, chain/anchor vars (for on-chain anchor step)
 *   - Anvil on RPC_URL (default http://127.0.0.1:8545)
 *   - All six backend services running (see scripts/start-all-services.sh)
 *
 * Usage: bun run e2e:phase2
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, keccak256, toBytes, type Address, type Hex } from "viem";

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) {
    return;
  }
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(import.meta.dir, "../.env"));

const AGENTIC_AUDIT_ANCHOR_ABI = [
  {
    type: "function",
    name: "isAnchored",
    stateMutability: "view",
    inputs: [{ name: "traceId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function traceIdToBytes32(traceId: string): Hex {
  return keccak256(toBytes(traceId));
}

type StepResult = { name: string; ok: boolean; detail: string };

const ORCHESTRATOR = process.env.AGENT_ORCHESTRATOR_URL?.trim() ?? "http://localhost:4000";
const EVIDENCE = process.env.EVIDENCE_SERVICE_URL?.trim() ?? "http://localhost:4001";
const IDENTITY = process.env.IDENTITY_SERVICE_URL?.trim() ?? "http://localhost:4002";
const MANDATE = process.env.MANDATE_SERVICE_URL?.trim() ?? "http://localhost:4003";
const MERCHANT = process.env.MERCHANT_AGENT_URL?.trim() ?? "http://localhost:4004";
const VERIFIER = process.env.VERIFIER_SERVICE_URL?.trim() ?? "http://localhost:4005";
const RPC_URL = process.env.RPC_URL?.trim() ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
const ANCHOR_ADDRESS = process.env.AUDIT_ANCHOR_ADDRESS?.trim() as Address | undefined;

function anvilChain() {
  return {
    id: CHAIN_ID,
    name: CHAIN_ID === 31337 ? "Anvil Local" : `Chain ${CHAIN_ID}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  } as const;
}

const results: StepResult[] = [];

function pass(name: string, detail: string) {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}: ${detail}`);
}

function fail(name: string, detail: string): never {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name}: ${detail}`);
  printSummary();
  process.exit(1);
}

function printSummary() {
  console.log("\n── Phase 2 E2E summary ──");
  for (const step of results) {
    console.log(`${step.ok ? "✓" : "✗"} ${step.name}`);
  }
  const failed = results.filter((step) => !step.ok).length;
  console.log(failed === 0 ? "\nAll steps passed." : `\n${failed} step(s) failed.`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

async function checkHealth(name: string, url: string) {
  try {
    const { status, body } = await fetchJson<{ ok?: boolean; service?: string }>(`${url}/health`);
    if (status !== 200 || !body.ok) {
      fail(name, `unhealthy (${status}) at ${url}/health`);
    }
    pass(name, body.service ?? "ok");
  } catch (error) {
    fail(name, `not reachable at ${url}/health — start scripts/start-all-services.sh (${error})`);
  }
}

async function checkAnvil() {
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
    });
    const payload = (await response.json()) as { result?: string };
    const chainId = Number.parseInt(payload.result ?? "0", 16);
    if (!chainId) {
      fail("Anvil RPC", `no chainId from ${RPC_URL}`);
    }
    pass("Anvil RPC", `chainId ${chainId} at ${RPC_URL}`);
  } catch (error) {
    fail("Anvil RPC", `not reachable at ${RPC_URL} — run: anvil --chain-id 31337`);
  }
}

type TraceResponse = {
  traceId: string;
  transport?: string;
  events: unknown[];
  merkleRoot: Hex;
  verification: {
    result: { status: string; failedRules: string[] };
    certificate: { certificateHash: Hex; traceMerkleRoot: Hex };
  };
  report: { token: string; riskScore: number };
};

async function main() {
  console.log("CLB-ACEL Phase 2 live E2E smoke test\n");

  await checkAnvil();
  await checkHealth("identity-service", IDENTITY);
  await checkHealth("mandate-service", MANDATE);
  await checkHealth("merchant-agent-api", MERCHANT);
  await checkHealth("evidence-service", EVIDENCE);
  await checkHealth("verifier-service", VERIFIER);
  await checkHealth("agent-orchestrator", ORCHESTRATOR);

  const intentId = `e2e-${Date.now()}`;
  const { status: runStatus, body: trace } = await fetchJson<TraceResponse & { error?: string }>(
    `${ORCHESTRATOR}/run-human-present`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intentId,
        token: "E2E",
        budget: "2.00",
        transport: "http",
      }),
    },
  );

  if (runStatus !== 201) {
    fail(
      "HTTP orchestrator flow",
      `POST /run-human-present returned ${runStatus}${trace.error ? `: ${trace.error}` : ""}`,
    );
  }
  if (trace.verification.result.status !== "PASS") {
    fail(
      "Verifier PASS",
      `status=${trace.verification.result.status} failed=${trace.verification.result.failedRules.join(", ")}`,
    );
  }
  pass(
    "HTTP orchestrator flow",
    `traceId=${trace.traceId} rules PASS events=${trace.events.length}`,
  );

  const { status: evidenceStatus, body: stored } = await fetchJson<{ events: unknown[] }>(
    `${EVIDENCE}/traces/${trace.traceId}`,
  );
  if (evidenceStatus !== 200 || stored.events.length !== 7) {
    fail("Evidence persistence", `expected 7 events in Postgres, got ${stored.events.length}`);
  }
  pass("Evidence persistence", `7 events stored for ${trace.traceId}`);

  const { status: verifyStatus, body: cert } = await fetchJson<{ certificateHash: Hex }>(
    `${VERIFIER}/verify/${trace.traceId}/certificate`,
  );
  if (verifyStatus !== 200) {
    fail("Verifier certificate", `GET certificate returned ${verifyStatus}`);
  }
  pass("Verifier certificate", cert.certificateHash);

  const { status: explainStatus, body: explained } = await fetchJson<{
    provider: string;
    explanation: string;
  }>(`${MERCHANT}/risk-report/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report: trace.report }),
  });
  if (explainStatus !== 200 || !explained.explanation) {
    fail("LLM explanation", `POST /risk-report/explain returned ${explainStatus}`);
  }
  pass("LLM explanation", `${explained.provider}: ${explained.explanation.slice(0, 80)}…`);

  if (!ANCHOR_ADDRESS) {
    pass("On-chain anchor", "skipped — set AUDIT_ANCHOR_ADDRESS in .env to test anchoring");
  } else {
    const publicClient = createPublicClient({ chain: anvilChain(), transport: http(RPC_URL) });
    const bytecode = await publicClient.getBytecode({ address: ANCHOR_ADDRESS });
    if (!bytecode || bytecode === "0x") {
      fail(
        "On-chain anchor",
        `no contract at ${ANCHOR_ADDRESS} — Anvil was likely restarted. Redeploy:\n` +
          "  cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \\\n" +
          "    --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      );
    }

    const { status: anchorStatus, body: anchorBody } = await fetchJson<{
      status: string;
      txHash?: Hex;
      error?: string;
    }>(`${EVIDENCE}/traces/${trace.traceId}/anchor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ traceHash: trace.verification.certificate.certificateHash }),
    });

    if (anchorStatus === 201 && anchorBody.status === "ANCHORED" && anchorBody.txHash) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: anchorBody.txHash });
      if (receipt.status !== "success") {
        fail("On-chain anchor", `transaction reverted: ${anchorBody.txHash}`);
      }
      pass("On-chain anchor", `txHash=${anchorBody.txHash} confirmed on ${ANCHOR_ADDRESS}`);
    } else if (anchorStatus === 409) {
      const traceIdBytes32 = traceIdToBytes32(trace.traceId);
      const alreadyAnchored =
        anchorBody.error?.includes("already anchored") ||
        (await publicClient.readContract({
          address: ANCHOR_ADDRESS,
          abi: AGENTIC_AUDIT_ANCHOR_ABI,
          functionName: "isAnchored",
          args: [traceIdBytes32],
        }));
      if (alreadyAnchored) {
        pass("On-chain anchor", `trace already anchored on ${ANCHOR_ADDRESS} (auto-anchor or prior run)`);
      } else {
        fail(
          "On-chain anchor",
          anchorBody.error ??
            "anchor failed — redeploy contracts if Anvil was restarted, then retry",
        );
      }
    } else {
      fail("On-chain anchor", `unexpected response ${anchorStatus}: ${JSON.stringify(anchorBody)}`);
    }
  }

  printSummary();
  console.log("\nManual UI checks (optional):");
  console.log("  1. bun run dev  →  http://localhost:3000");
  console.log("  2. Walk screens 1–6, 8 (intent → verify → anchor)");
  console.log("  3. /mandate — connect MetaMask on Anvil 31337 and sign EIP-712");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
