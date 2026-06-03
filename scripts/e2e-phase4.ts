/**
 * Phase 4 (Mode B) in-process delegated/predicate benchmark.
 *
 * Usage:
 *   bun run e2e:phase4
 *
 * 1. Runs the delegated flow (`runDelegated`) and asserts the verifier PASSes
 *    with R17 (predicate) ok.
 * 2. Demonstrates P5 prevention: the guard blocks an out-of-policy settlement.
 * 3. Best-effort parses `forge test --gas-report` for PredicatePaymentGuard and
 *    refreshes experiments/benchmarks/gas-report.md + phase4-results.json.
 */

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { settlementParamsFromExact } from "@clb-acel/clb-core";
import { createIntent, runDelegated } from "@clb-acel/agent-orchestrator/flow";
import { PredicateViolationError, createPredicateGuard } from "@clb-acel/predicate-adapter";

const OUT_DIR = resolve(import.meta.dir, "../experiments/benchmarks");
const CONTRACTS_DIR = resolve(import.meta.dir, "../contracts");
const NOW_MS = Date.parse("2026-05-30T05:00:00.000Z");

type GuardGas = { deploymentCost?: string; validateAndConsume?: string; source: "forge" | "unavailable" };

function parseForgeGas(): GuardGas {
  try {
    const output = execFileSync(
      "forge",
      ["test", "--match-contract", "PredicatePaymentGuardTest", "--gas-report"],
      { cwd: CONTRACTS_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const deployment = output.match(/Deployment Cost[^\n]*\n[^\n]*?(\d[\d,]*)/i)?.[1];
    const method = output.match(/validateAndConsume[^\n]*?(\d[\d,]*)\s*\|\s*(\d[\d,]*)/)?.[2];
    return {
      ...(deployment ? { deploymentCost: deployment } : {}),
      ...(method ? { validateAndConsume: method } : {}),
      source: "forge",
    };
  } catch {
    return { source: "unavailable" };
  }
}

function buildGasReport(gas: GuardGas): string {
  const guardDeploy = gas.deploymentCost ?? "Pending live forge gas parse";
  const guardMethod = gas.validateAndConsume ?? "Pending live forge gas parse";
  return [
    "# Phase 4 Gas Report",
    "",
    "| Component | Metric | Gas | Notes |",
    "| --- | --- | --- | --- |",
    "| AgenticAuditAnchor.sol | anchorTrace | Run `forge test --gas-report` | Mode A anchor. |",
    `| PredicatePaymentGuard.sol | deployment | ${guardDeploy} | Mode B caveat enforcer. |`,
    `| PredicatePaymentGuard.sol | validateAndConsume | ${guardMethod} | C' recompute + predicate + nonce consume. |`,
    "",
    gas.source === "forge"
      ? "_Numbers parsed live from `forge test --match-contract PredicatePaymentGuardTest --gas-report`._"
      : "_Foundry not available in this environment; run `cd contracts && forge test --gas-report` to populate._",
    "",
  ].join("\n");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main() {
  console.log("CLB-ACEL Phase 4 delegated (Mode B) benchmark");

  // 1. Happy-path delegated trace must PASS with R17 ok.
  const intent = createIntent({ token: "XYZ", intentId: "e2e-phase4" });
  const trace = await runDelegated(intent, { nowMs: NOW_MS });
  const { result, outcomes } = trace.verification;
  assert(result.status === "PASS", `delegated trace status ${result.status}`);
  assert(outcomes.R17_PREDICATE_TRUE_FOR_MODE_B.ok, "R17 predicate check did not pass");
  assert(trace.guardResult.allowed, "guard did not authorize the happy-path settlement");
  console.log(`OK happy path: ${result.status}, R17 ok, C'=${trace.modeBCommitment.slice(0, 18)}…`);

  // 2. P5 prevention: guard blocks an over-budget settlement.
  const guard = createPredicateGuard();
  const overBudget = { ...trace.concreteSettlement, value: "999999.00" };
  let prevented = false;
  try {
    await guard.assertSettlementAllowed({
      predicate: trace.predicateDescriptor.predicate,
      params: settlementParamsFromExact(overBudget, trace.payerAgent.agentId),
      commitment: {
        identityRef: {
          chainId: trace.payerAgent.chainId,
          registryAddr: trace.payerAgent.registryAddr,
          agentId: trace.payerAgent.agentId,
        },
        mandateDigest: trace.modeBCommitment,
        predicateId: trace.predicateDescriptor.predicateId,
        settlementParams: settlementParamsFromExact(overBudget, trace.payerAgent.agentId),
        domain: { name: "CLB-ACEL", version: "0.1", chainId: trace.payerAgent.chainId },
      },
      now: new Date(NOW_MS),
    });
  } catch (error) {
    prevented = error instanceof PredicateViolationError;
  }
  assert(prevented, "guard failed to block an over-budget settlement");
  console.log("OK P5 prevention: guard blocked an over-budget settlement");

  // 3. Gas + artifacts.
  const gas = parseForgeGas();
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(resolve(OUT_DIR, "gas-report.md"), buildGasReport(gas));
  await writeFile(
    resolve(OUT_DIR, "phase4-results.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date(NOW_MS).toISOString(),
        mode: "MODE_B_PREDICATE",
        traceId: trace.traceId,
        status: result.status,
        rulesChecked: trace.verification.certificate.rulesChecked,
        r17: outcomes.R17_PREDICATE_TRUE_FOR_MODE_B,
        modeBCommitment: trace.modeBCommitment,
        nonce: trace.nonce,
        predicate: trace.predicateDescriptor,
        concreteSettlement: trace.concreteSettlement,
        guardGas: gas,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nWrote Phase 4 artifacts to ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
