/**
 * Phase 7A headline e2e: on-chain Mode B prevention.
 *
 * Usage:
 *   bun run e2e:phase7-caveat
 *
 * Self-contained (no HTTP services). Boots/awaits Anvil, deploys
 * PredicatePaymentGuard, registers a spending predicate, then settles two
 * delegated (Mode B) settlements THROUGH the contract:
 *   - a predicate-violating (over-budget) settlement -> asserts a REAL on-chain
 *     revert (AmountExceedsMax) before any transfer;
 *   - a happy settlement -> asserts success + captures gas.
 * Writes experiments/benchmarks/{phase7-caveat.json, phase7-caveat-gas.md}.
 *
 * Requires `forge` + `anvil` (Foundry). If Anvil is already running on RPC_URL
 * it is reused; otherwise a local instance is spawned and torn down.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { settlementParamsFromExact } from "@clb-acel/clb-core";
import {
  ContractPredicateGuard,
  PREDICATE_GUARD_ABI,
  makeViemGuardWriter,
} from "@clb-acel/predicate-adapter";
import type { ModeBSettlementInput } from "@clb-acel/clb-core";
import type { SettlementDescriptorExact } from "@clb-acel/schemas";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const OUT_DIR = resolve(import.meta.dir, "../experiments/benchmarks");
const CONTRACTS_DIR = resolve(import.meta.dir, "../contracts");
const RPC_URL = process.env.RPC_URL?.trim() ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
// Deterministic Anvil dev accounts.
const DEPLOYER_KEY =
  (process.env.DEPLOYER_PRIVATE_KEY?.trim() as Hex | undefined) ??
  ("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex);
const MERCHANT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address; // Anvil #1
const REGISTRY = "0x0000000000000000000000000000000000008004" as Address;
const AGENT_ID = "shopping-agent-001";
const PREDICATE_ID = "predicate-phase7a";
const MANDATE_DIGEST = `0x${"11".repeat(32)}` as Hex;
const MAX_VALUE_ATOMIC = 5_000_000n; // 5 USDC
const NOW_MS = Date.parse("2026-05-30T05:00:00.000Z");

function anvilChain() {
  return {
    id: CHAIN_ID,
    name: CHAIN_ID === 31337 ? "Anvil Local" : `Chain ${CHAIN_ID}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  } as const;
}

async function rpcReachable(): Promise<boolean> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
    });
    const payload = (await res.json()) as { result?: string };
    return Boolean(payload.result);
  } catch {
    return false;
  }
}

async function ensureAnvil(): Promise<ChildProcess | null> {
  if (await rpcReachable()) {
    console.log(`✓ Anvil reachable at ${RPC_URL}`);
    return null;
  }
  console.log("• Anvil not reachable — spawning a local instance…");
  const proc = spawn("anvil", ["--chain-id", String(CHAIN_ID), "--silent"], {
    stdio: "ignore",
    detached: false,
  });
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    if (await rpcReachable()) {
      console.log(`✓ Anvil started at ${RPC_URL}`);
      return proc;
    }
  }
  proc.kill();
  throw new Error("anvil failed to start within 10s (is Foundry installed?)");
}

function deployGuard(): Address {
  const out = execFileSync(
    "forge",
    [
      "create",
      "src/PredicatePaymentGuard.sol:PredicatePaymentGuard",
      "--rpc-url",
      RPC_URL,
      "--private-key",
      DEPLOYER_KEY,
      "--broadcast",
      "--constructor-args",
      String(CHAIN_ID),
    ],
    { cwd: CONTRACTS_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const address = out.match(/Deployed to:\s*(0x[0-9a-fA-F]{40})/)?.[1];
  if (!address) throw new Error(`could not parse deployed address from forge output:\n${out}`);
  return address as Address;
}

function parseValidateGas(): string | undefined {
  try {
    const output = execFileSync(
      "forge",
      ["test", "--match-contract", "PredicatePaymentGuardTest", "--gas-report"],
      { cwd: CONTRACTS_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return output.match(/validateAndConsume[^\n]*?(\d[\d,]*)\s*\|\s*(\d[\d,]*)/)?.[2];
  } catch {
    return undefined;
  }
}

function buildModeBInput(descriptor: SettlementDescriptorExact): ModeBSettlementInput {
  return {
    identityRef: { chainId: CHAIN_ID, registryAddr: REGISTRY, agentId: AGENT_ID },
    mandateDigest: MANDATE_DIGEST,
    predicateId: PREDICATE_ID,
    settlementParams: settlementParamsFromExact(descriptor, AGENT_ID),
    domain: { name: "CLB-ACEL", version: "0.1", chainId: CHAIN_ID },
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  console.log("CLB-ACEL Phase 7A — on-chain Mode B prevention e2e\n");
  const spawned = await ensureAnvil();

  try {
    const account = privateKeyToAccount(DEPLOYER_KEY);
    const publicClient = createPublicClient({ chain: anvilChain(), transport: http(RPC_URL) });
    const walletClient = createWalletClient({
      account,
      chain: anvilChain(),
      transport: http(RPC_URL),
    });

    const guardAddress = deployGuard();
    console.log(`✓ PredicatePaymentGuard deployed: ${guardAddress}`);

    // Register the spending predicate the settlements are checked against.
    const registerHash = await walletClient.writeContract({
      address: guardAddress,
      abi: PREDICATE_GUARD_ABI,
      functionName: "registerPredicate",
      args: [
        PREDICATE_ID,
        {
          allowedPayees: [MERCHANT],
          allowedAssetHashes: [keccak256(toBytes("USDC"))],
          allowedChainIds: [BigInt(CHAIN_ID)],
          maxValueAtomic: MAX_VALUE_ATOMIC,
          validUntil: 18446744073709551615n, // type(uint64).max
          registered: true,
        },
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: registerHash });
    console.log(`✓ Predicate "${PREDICATE_ID}" registered (maxValueAtomic=${MAX_VALUE_ATOMIC})`);

    const writer = makeViemGuardWriter({ publicClient, walletClient, account });
    const guard = new ContractPredicateGuard({ address: guardAddress, writer });

    const validBefore = new Date(NOW_MS + 3_600_000).toISOString();
    const baseDescriptor: SettlementDescriptorExact = {
      chainId: CHAIN_ID,
      network: "anvil-local",
      asset: "USDC",
      payTo: MERCHANT,
      value: "2.00",
      validBefore,
      x402Scheme: "exact",
    };

    // 1. VIOLATING: over-budget (9.00 > 5.00 max) must REVERT on-chain.
    const violatingInput = buildModeBInput({ ...baseDescriptor, value: "9.00" });
    const violating = await guard.settleOnChain({
      predicate: {
        allowedAssets: ["USDC"],
        allowedPayees: [MERCHANT],
        maxValue: "5.00",
        validUntil: validBefore,
        allowedChainIds: [CHAIN_ID],
        allowedAgentIds: [AGENT_ID],
      },
      params: violatingInput.settlementParams,
      commitment: violatingInput,
    });
    assert(violating.reverted, "over-budget settlement should revert on-chain");
    assert(
      violating.reason === "AmountExceedsMax",
      `unexpected revert reason: ${violating.reason}`,
    );
    console.log(`✓ REVERTED: ${violating.reason} (over-budget Mode B prevented in-protocol)`);

    // 2. HAPPY: within budget settles once.
    const happyInput = buildModeBInput(baseDescriptor);
    const happy = await guard.settleOnChain({
      predicate: {
        allowedAssets: ["USDC"],
        allowedPayees: [MERCHANT],
        maxValue: "5.00",
        validUntil: validBefore,
        allowedChainIds: [CHAIN_ID],
        allowedAgentIds: [AGENT_ID],
      },
      params: happyInput.settlementParams,
      commitment: happyInput,
    });
    assert(!happy.reverted, "happy settlement should not revert");
    assert(Boolean(happy.txHash), "happy settlement should return a tx hash");
    const receipt = await publicClient.waitForTransactionReceipt({ hash: happy.txHash! });
    const gasUsed = receipt.gasUsed.toString();
    console.log(`✓ HAPPY: settled tx ${happy.txHash!.slice(0, 18)}… (gasUsed=${gasUsed})`);

    // Confirm replay is blocked (single-use nonce).
    const replay = await guard.settleOnChain({
      predicate: {
        allowedAssets: ["USDC"],
        allowedPayees: [MERCHANT],
        maxValue: "5.00",
        validUntil: validBefore,
        allowedChainIds: [CHAIN_ID],
        allowedAgentIds: [AGENT_ID],
      },
      params: happyInput.settlementParams,
      commitment: happyInput,
    });
    assert(replay.reverted && replay.reason === "NonceAlreadyConsumed", "replay should be blocked");
    console.log(`✓ REPLAY blocked: ${replay.reason}`);

    const forgeGas = parseValidateGas();
    const artifact = {
      phase: "7A",
      chainId: CHAIN_ID,
      guardAddress,
      predicateId: PREDICATE_ID,
      violating: {
        reverted: violating.reverted,
        reason: violating.reason,
        commitment: violating.commitment,
        nonce: violating.nonce,
        value: "9.00",
        maxValue: "5.00",
      },
      happy: {
        reverted: happy.reverted,
        txHash: happy.txHash,
        commitment: happy.commitment,
        nonce: happy.nonce,
        gasUsed,
        value: "2.00",
      },
      replay: { reverted: replay.reverted, reason: replay.reason },
      gas: {
        happyPathOnChainGasUsed: gasUsed,
        validateAndConsumeForgeReport: forgeGas ?? "unavailable",
        source: forgeGas ? "forge+anvil" : "anvil",
      },
      generatedAt: new Date().toISOString(),
    };

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
      resolve(OUT_DIR, "phase7-caveat.json"),
      `${JSON.stringify(artifact, null, 2)}\n`,
    );

    const gasMd = [
      "# Phase 7A Gas Report — On-chain Mode B Prevention",
      "",
      "| Path | Method | Gas | Notes |",
      "| --- | --- | --- | --- |",
      `| Happy settlement | validateAndConsume (live Anvil) | ${gasUsed} | C' recompute + predicate + single-use nonce. |`,
      `| Forge gas report | validateAndConsume (avg) | ${forgeGas ?? "run forge --gas-report"} | From \`forge test --gas-report\`. |`,
      "",
      `Violating (over-budget) settlement reverted on-chain with **${artifact.violating.reason}** before any transfer.`,
      `Replay of the happy nonce reverted with **${artifact.replay.reason}**.`,
      "",
    ].join("\n");
    await writeFile(resolve(OUT_DIR, "phase7-caveat-gas.md"), `${gasMd}\n`);

    console.log("\n✓ Wrote experiments/benchmarks/phase7-caveat.json + phase7-caveat-gas.md");
    console.log("\nAll Phase 7A on-chain assertions passed.");
  } finally {
    if (spawned) {
      spawned.kill();
      console.log("• Spawned Anvil stopped.");
    }
  }
}

main().catch((error) => {
  console.error(`\n✗ e2e:phase7-caveat failed: ${error.message}`);
  process.exit(1);
});
