/**
 * Attack I: optimistic grants before settlement finality.
 *
 * The server grants after facilitator verification. Settlement is submitted
 * asynchronously, and the sweep applies the analytic reorg model.
 */

import { ethers } from "ethers";
import axios from "axios";
import Table from "cli-table3";
import { mkdirSync, writeFileSync } from "fs";
import { getContractArtifact } from "../shared/contract.js";
import { buildTransferAuthorization } from "../shared/crypto.js";
import { createAttack1Facilitator } from "./facilitator.js";
import { createAttack1Server } from "./resource-server.js";
import { BlockTicker } from "./block-ticker.js";

const RPC_URL = process.env.ATTACK1_RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = 31337;
const FACILITATOR_PORT = 3701;
const SERVER_PORT = 3700;
const PRICE = 10000; // 0.01 USDC

const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const FACILITATOR_URL = `http://localhost:${FACILITATOR_PORT}`;
const DEFAULT_REQUESTS = readPositiveInt(process.env.ATTACK1_REQUESTS, 5000);
const CONTROL_REQUESTS = readPositiveInt(process.env.ATTACK1_CONTROL_REQUESTS, 5000);
const CONFIG_LIMIT = readPositiveInt(process.env.ATTACK1_LIMIT_CONFIGS, 0);
const REQUEST_CONCURRENCY = readPositiveInt(process.env.ATTACK1_CONCURRENCY, 32);
const CLIENT_TIMEOUT_MS = readPositiveInt(process.env.ATTACK1_CLIENT_TIMEOUT_MS, 30 * 60 * 1000);
const RECEIPT_POLL_CONCURRENCY = readPositiveInt(process.env.ATTACK1_RECEIPT_POLL_CONCURRENCY, 128);
const RECEIPT_POLL_INTERVAL_MS = readPositiveInt(process.env.ATTACK1_RECEIPT_POLL_INTERVAL_MS, 250);
const RECEIPT_POLL_TIMEOUT_MS = readPositiveInt(process.env.ATTACK1_RECEIPT_POLL_TIMEOUT_MS, 15 * 60 * 1000);
const SETTLEMENT_RELAYER_COUNT = readPositiveInt(process.env.ATTACK1_SETTLEMENT_RELAYER_COUNT, 16);
const MAX_OUTSTANDING_SETTLEMENTS = readPositiveInt(
  process.env.ATTACK1_MAX_OUTSTANDING_SETTLEMENTS,
  Math.max(REQUEST_CONCURRENCY, SETTLEMENT_RELAYER_COUNT * 2)
);
const SCHEDULER_POLL_INTERVAL_MS = readPositiveInt(
  process.env.ATTACK1_SCHEDULER_POLL_INTERVAL_MS,
  100
);
const BLOCK_TIMES = readPositiveNumberList(process.env.ATTACK1_BLOCK_TIMES, [2, 4, 12]);
const WILSON_Z = 1.96;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveNumberList(value, fallback) {
  if (!value) return fallback;
  const parsed = value
    .split(",")
    .map((part) => Number.parseFloat(part.trim()))
    .filter((num) => Number.isFinite(num) && num > 0);
  return parsed.length > 0 ? parsed : fallback;
}

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function median(values) {
  return quantile(values, 0.5);
}

function iqr(values) {
  if (values.length === 0) return null;
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  return +(q3 - q1).toFixed(1);
}

function wilsonInterval(successes, total, z = WILSON_Z) {
  if (total <= 0) return null;
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
  return {
    low: Math.max(0, +(center - margin).toFixed(4)),
    high: Math.min(1, +(center + margin).toFixed(4)),
  };
}

function formatInterval(interval) {
  if (!interval) return "---";
  return `[${interval.low.toFixed(4)}, ${interval.high.toFixed(4)}]`;
}

function summarizeCounts(values) {
  const counts = {};
  for (const value of values) {
    if (!value) continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));
}

async function runWithConcurrency(total, concurrency, worker) {
  const limit = Math.max(1, Math.min(concurrency, total));
  const results = new Array(total);
  let nextIndex = 0;

  async function loop() {
    while (true) {
      const current = nextIndex++;
      if (current >= total) {
        return;
      }
      results[current] = await worker(current);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => loop()));
  return results;
}

async function runClosedLoopRequests({
  total,
  requestConcurrency,
  maxOutstandingSettlements,
  schedulerPollIntervalMs,
  getPendingSettlements,
  worker,
}) {
  const results = new Array(total);
  const active = new Set();
  let nextIndex = 0;

  function launch(index) {
    const promise = worker(index)
      .then((result) => {
        results[index] = result;
      })
      .finally(() => {
        active.delete(promise);
      });
    active.add(promise);
  }

  while (nextIndex < total || active.size > 0) {
    let launched = 0;

    if (nextIndex < total) {
      const pendingSettlements = await getPendingSettlements();
      const concurrencySlots = Math.max(0, requestConcurrency - active.size);
      const outstandingSlots = Math.max(0, maxOutstandingSettlements - pendingSettlements - active.size);
      const launchCount = Math.min(concurrencySlots, outstandingSlots, total - nextIndex);

      for (let i = 0; i < launchCount; i++) {
        launch(nextIndex++);
      }
      launched = launchCount;
    }

    if (nextIndex >= total && active.size === 0) {
      break;
    }

    if (launched === 0) {
      if (active.size > 0) {
        await Promise.race(active);
      } else {
        await sleep(schedulerPollIntervalMs);
      }
    }
  }

  return results;
}

async function resolveGrantBlockNumbers(provider, grants) {
  const grantsByHash = new Map();

  for (const grant of grants) {
    if (!grant.tx_hash || grant.blockNumber != null) continue;
    if (!grantsByHash.has(grant.tx_hash)) grantsByHash.set(grant.tx_hash, []);
    grantsByHash.get(grant.tx_hash).push(grant);
  }

  if (grantsByHash.size === 0) {
    return { resolved: 0, unresolved: 0 };
  }

  const pending = new Set(grantsByHash.keys());
  const deadline = Date.now() + RECEIPT_POLL_TIMEOUT_MS;
  let resolved = 0;

  while (pending.size > 0 && Date.now() < deadline) {
    const batch = [...pending];
    const receipts = await runWithConcurrency(batch.length, RECEIPT_POLL_CONCURRENCY, async (index) => {
      try {
        return await provider.getTransactionReceipt(batch[index]);
      } catch {
        return null;
      }
    });

    let madeProgress = false;
    for (let i = 0; i < batch.length; i++) {
      const receipt = receipts[i];
      if (!receipt || receipt.blockNumber == null) continue;

      const txHash = batch[i];
      for (const grant of grantsByHash.get(txHash) || []) {
        grant.blockNumber = receipt.blockNumber;
      }
      pending.delete(txHash);
      resolved++;
      madeProgress = true;
    }

    if (pending.size === 0) break;
    await sleep(madeProgress ? 50 : RECEIPT_POLL_INTERVAL_MS);
  }

  return {
    resolved,
    unresolved: pending.size,
  };
}

async function deployUSDC(provider) {
  const deployer = await provider.getSigner(0);
  const artifact = getContractArtifact();
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const usdc = await factory.deploy();
  await usdc.waitForDeployment();
  const addr = await usdc.getAddress();
  console.log(`[Setup] MockUSDC deployed at ${addr}`);
  return { usdc, address: addr };
}

async function setupAccounts(usdc, provider) {
  const deployer = await provider.getSigner(0);
  const accounts = await provider.listAccounts();
  const receiver = accounts[2].address;
  const payer = ethers.Wallet.createRandom().connect(provider);

  await deployer.sendTransaction({ to: payer.address, value: ethers.parseEther("10") });
  // Fund the payer for the full sweep.
  await usdc.connect(deployer).mint(payer.address, 10000000000); // 10,000 USDC

  console.log(`[Setup] Payer=${payer.address}, Receiver=${receiver}`);
  return { payer, receiver };
}

async function runConfig({
  provider,
  payer,
  receiver,
  usdcAddress,
  usdc,
  pReorg,
  kRequired,
  facilitatorMode,
  numRequests,
  networkDelay,
  executionPolicy = "optimistic",
  blockTimeSec = BLOCK_TIMES[0],
}) {
  await axios.post(`${FACILITATOR_URL}/configure`, {
    mode: facilitatorMode,
    verifyResponseDelayMs: networkDelay,
  });
  await axios.post(`${SERVER_URL}/configure`, {
    k: kRequired,
    receiver,
    rpcUrl: RPC_URL,
    executionPolicy,
  });

  let revertGrants = 0;
  let totalGrants = 0;
  const gfLatencies = [];
  let clientFailures = [];
  let grantRecords = [];
  let receiptResolution = { resolved: 0, unresolved: 0 };

  // Mine blocks at the configured T_b for honest-facilitator runs.
  let ticker = null;
  const useBlockTicker = facilitatorMode !== "byzantine";
  if (useBlockTicker) {
    await provider.send("evm_setAutomine", [false]);
    ticker = new BlockTicker(provider, blockTimeSec * 1000);
    ticker.start();
  }

  try {
    // Run the configured request workload.
    const executeRequest = async () => {
      const { encoded } = await buildTransferAuthorization(payer, {
        usdcAddress,
        to: receiver,
        value: PRICE,
        chainId: CHAIN_ID,
      });

      const t0 = Date.now();
      try {
        const res = await axios.get(`${SERVER_URL}/api/data`, {
          headers: { "x-payment": encoded },
          timeout: CLIENT_TIMEOUT_MS,
        });
        if (res.status === 200) {
          return {
            granted: true,
            grantTime: res.data?.payment?.grant_time ?? Date.now(),
          };
        }
      } catch (err) {
        return {
          granted: false,
          clientFailure: err.response
            ? `http_${err.response.status}:${err.response.data?.error || "unknown"}`
            : `network:${err.code || err.message || "unknown"}`,
        };
      }
      return { granted: false };
    };

    const requestResults = executionPolicy === "optimistic"
      ? await runClosedLoopRequests({
        total: numRequests,
        requestConcurrency: REQUEST_CONCURRENCY,
        maxOutstandingSettlements: MAX_OUTSTANDING_SETTLEMENTS,
        schedulerPollIntervalMs: SCHEDULER_POLL_INTERVAL_MS,
        getPendingSettlements: async () => {
          try {
            const statsRes = await axios.get(`${SERVER_URL}/stats`, {
              timeout: CLIENT_TIMEOUT_MS,
            });
            return statsRes.data?.pendingSettlements ?? 0;
          } catch {
            return 0;
          }
        },
        worker: executeRequest,
      })
      : await runWithConcurrency(numRequests, REQUEST_CONCURRENCY, executeRequest);

    totalGrants = requestResults.filter((result) => result.granted).length;
    clientFailures = summarizeCounts(requestResults.map((result) => result.clientFailure));

    if (executionPolicy === "optimistic" && totalGrants > 0) {
      await axios.post(`${SERVER_URL}/await-settlements`, {}, {
        timeout: CLIENT_TIMEOUT_MS,
      });
    }

    grantRecords = (await axios.get(`${SERVER_URL}/grants`, {
      timeout: CLIENT_TIMEOUT_MS,
    })).data;

    if (facilitatorMode !== "byzantine" && executionPolicy !== "conservative") {
      // Resolve async settlement blocks before computing T_gf.
      receiptResolution = await resolveGrantBlockNumbers(provider, grantRecords);

      const byBlock = new Map();
      for (const grant of grantRecords) {
        const blockNumber = grant.blockNumber;
        if (blockNumber == null) continue;
        if (!byBlock.has(blockNumber)) byBlock.set(blockNumber, []);
        byBlock.get(blockNumber).push(grant);
      }

      const sortedBlocks = [...byBlock.entries()].sort((a, b) => a[0] - b[0]);
      if (sortedBlocks.length > 0) {
        const maxTargetBlock = Math.max(
          ...sortedBlocks.map(([blockNum]) => blockNum + Math.max(kRequired - 1, 0))
        );
        const globalDeadline = Date.now() + (Math.max(kRequired, 1) + 5) * blockTimeSec * 1000 + 60000;

        while (Date.now() < globalDeadline) {
          const currentBlock = await provider.getBlockNumber();
          if (currentBlock >= maxTargetBlock) break;
          await sleep(100);
        }

        for (const [blockNum, grants] of sortedBlocks) {
          const targetBlock = blockNum + Math.max(kRequired - 1, 0);
          let tFinal = ticker?.getTimeAtBlock(targetBlock) ?? null;
          if (tFinal === null) {
            tFinal = Date.now();
          }

          for (const grant of grants) {
            const tGf = (tFinal - grant.grant_time) / 1000;
            gfLatencies.push(+Math.max(0, tGf).toFixed(1));
          }
        }
      }
    }

    // Apply the analytic revert model to observed grants.
    for (const grant of grantRecords) {
      if (facilitatorMode === "byzantine") {
        revertGrants++;
        continue;
      }

      if (executionPolicy === "conservative") {
        continue;
      }

      const revertProb = kRequired === 0
        ? pReorg
        : Math.pow(pReorg, kRequired);
      if (Math.random() < revertProb) {
        revertGrants++;
      }
    }
  } finally {
    // Restore automine before the next config reset.
    if (ticker) await ticker.stop();
    await provider.send("evm_setAutomine", [true]);
  }

  const RGP = totalGrants > 0 ? revertGrants / totalGrants : 0;
  const rgpCi95 = wilsonInterval(revertGrants, totalGrants);
  const medianTgfRaw = (facilitatorMode === "byzantine" || executionPolicy === "conservative" || gfLatencies.length === 0)
    ? null
    : median(gfLatencies);
  const medianTgf = medianTgfRaw != null ? +medianTgfRaw.toFixed(1) : null;
  const tgfIqr = (facilitatorMode === "byzantine" || executionPolicy === "conservative" || gfLatencies.length === 0)
    ? null
    : iqr(gfLatencies);
  let serverStats = null;
  let facilitatorStats = null;

  try {
    const [serverRes, facilitatorRes] = await Promise.all([
      axios.get(`${SERVER_URL}/stats`),
      axios.get(`${FACILITATOR_URL}/stats`),
    ]);
    serverStats = serverRes.data;
    facilitatorStats = facilitatorRes.data;
  } catch {
    // Diagnostics are best-effort only.
  }

  return {
    pReorg,
    kRequired,
    facilitatorMode,
    networkDelay,
    blockTimeSec,
    executionPolicy,
    numRequests,
    totalGrants,
    revertGrants,
    RGP,
    rgpCi95,
    medianTgf,
    tgfIqr,
    eeeUsd: parseFloat(((revertGrants * PRICE) / 1_000_000).toFixed(4)),
    clientFailures,
    receiptResolution,
    serverStats,
    facilitatorStats,
    reorgModel: facilitatorMode === "byzantine"
      ? "byzantine facilitator: grant without valid settlement"
      : executionPolicy === "conservative"
        ? "conservative baseline: grant after k confirmations"
        : `analytic: p_revert = ${kRequired === 0 ? "p_reorg" : "p_reorg^k"}`,
  };
}

async function main() {
  console.log("=== Attack I: Facilitator Race / Optimistic-Grant Revert ===\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  try {
    await provider.getBlockNumber();
  } catch {
    console.error("ERROR: Hardhat node not running. Start with: npx hardhat node --config hardhat.config.cjs");
    process.exit(1);
  }

  const { usdc, address: usdcAddress } = await deployUSDC(provider);
  const { payer, receiver } = await setupAccounts(usdc, provider);

  const facilitatorModule = createAttack1Facilitator({
    chainId: CHAIN_ID,
    relayerCount: SETTLEMENT_RELAYER_COUNT,
  });
  await facilitatorModule.initChain(usdcAddress, RPC_URL);
  const fServer = await new Promise((r) => {
    const s = facilitatorModule.app.listen(FACILITATOR_PORT, () => r(s));
  });

  const serverApp = createAttack1Server({
    facilitatorPort: FACILITATOR_PORT,
    price: PRICE,
  });
  const rServer = await new Promise((r) => {
    const s = serverApp.listen(SERVER_PORT, () => r(s));
  });

  await axios.post(`${SERVER_URL}/configure`, {
    receiver,
    k: 0,
    rpcUrl: RPC_URL,
    executionPolicy: "optimistic",
  });

  console.log(`[Facilitator] :${FACILITATOR_PORT}`);
  console.log(`[Server] :${SERVER_PORT}\n`);

  // Parameter sweep.
  const optimisticBaseConfigs = [
    { pReorg: 0,    kRequired: 0,  facilitatorMode: "honest", networkDelay: 0,   numRequests: DEFAULT_REQUESTS, executionPolicy: "optimistic" },
    { pReorg: 0.01, kRequired: 0,  facilitatorMode: "honest", networkDelay: 100, numRequests: DEFAULT_REQUESTS, executionPolicy: "optimistic" },
    { pReorg: 0.05, kRequired: 0,  facilitatorMode: "honest", networkDelay: 200, numRequests: DEFAULT_REQUESTS, executionPolicy: "optimistic" },
    { pReorg: 0.05, kRequired: 0,  facilitatorMode: "honest", networkDelay: 400, numRequests: DEFAULT_REQUESTS, executionPolicy: "optimistic" },
    { pReorg: 0.05, kRequired: 3,  facilitatorMode: "honest", networkDelay: 200, numRequests: DEFAULT_REQUESTS, executionPolicy: "optimistic" },
    { pReorg: 0.05, kRequired: 6,  facilitatorMode: "honest", networkDelay: 200, numRequests: DEFAULT_REQUESTS, executionPolicy: "optimistic" },
    { pReorg: 0.05, kRequired: 12, facilitatorMode: "honest", networkDelay: 200, numRequests: DEFAULT_REQUESTS, executionPolicy: "optimistic" },
  ];

  const configs = [
    ...BLOCK_TIMES.flatMap((blockTimeSec) => optimisticBaseConfigs.map((cfg) => ({
      ...cfg,
      blockTimeSec,
    }))),
    {
      pReorg: 0.05,
      kRequired: 3,
      facilitatorMode: "honest",
      networkDelay: 200,
      numRequests: CONTROL_REQUESTS,
      executionPolicy: "conservative",
      blockTimeSec: BLOCK_TIMES[0],
      label: "conservative-baseline",
    },
    {
      pReorg: 0.05,
      kRequired: 0,
      facilitatorMode: "byzantine",
      networkDelay: 0,
      numRequests: CONTROL_REQUESTS,
      executionPolicy: "optimistic",
      blockTimeSec: BLOCK_TIMES[0],
      label: "byzantine",
    },
  ];

  const selectedConfigs = CONFIG_LIMIT > 0 ? configs.slice(0, CONFIG_LIMIT) : configs;

  const allResults = [];

  for (const cfg of selectedConfigs) {
    const label = cfg.label || `p=${cfg.pReorg} T_b=${cfg.blockTimeSec}s k=${cfg.kRequired} δ=${cfg.networkDelay}ms F=${cfg.facilitatorMode} P=${cfg.executionPolicy}`;
    process.stdout.write(`  ${label.padEnd(55)} `);

    // Reset chain state before each config.
    await provider.send("hardhat_reset", []);
    const freshDeploy = await deployUSDC(provider);
    const freshAccounts = await setupAccounts(freshDeploy.usdc, provider);
    await facilitatorModule.initChain(freshDeploy.address, RPC_URL);

    const result = await runConfig({
      provider,
      payer: freshAccounts.payer,
      receiver: freshAccounts.receiver,
      usdcAddress: freshDeploy.address,
      usdc: freshDeploy.usdc,
      ...cfg,
    });
    allResults.push({ ...result, label });

    console.log(
      `grants=${result.totalGrants} reverts=${result.revertGrants} ` +
      `RGP=${result.RGP.toFixed(4)} ` +
      `CI=${formatInterval(result.rgpCi95)} ` +
      `T_gf=${result.medianTgf === null ? "---" : `${result.medianTgf}s`} ` +
      `IQR=${result.tgfIqr === null ? "---" : `${result.tgfIqr}s`}`
    );
  }

  console.log("\n=== Results Summary (Table 3 Format) ===\n");

  const table = new Table({
    head: ["Config", "p_reorg", "T_b", "δ", "k", "Policy", "F mode", "RGP_k", "95% CI", "T_gf", "IQR", "Grants", "Reverts"],
  });

  for (const r of allResults) {
    table.push([
      r.label || "",
      r.pReorg,
      `${r.blockTimeSec}s`,
      `${r.networkDelay}ms`,
      r.kRequired,
      r.executionPolicy,
      r.facilitatorMode,
      r.RGP.toFixed(4),
      formatInterval(r.rgpCi95),
      r.medianTgf === null ? "---" : `${r.medianTgf}s`,
      r.tgfIqr === null ? "---" : `${r.tgfIqr}s`,
      r.totalGrants,
      r.revertGrants,
    ]);
  }

  console.log(table.toString());

  console.log("\nKey verification points:");
  console.log("- p_reorg=0 → RGP should be ~0 (no reorgs, no reverts)");
  console.log("- p_reorg=0.05, k=0 → RGP should be ~0.05 (matches p_reorg)");
  console.log("- Increasing k → RGP decreases (security-latency tradeoff)");
  console.log("- Increasing T_b → T_gf increases for the same k");
  console.log("- Conservative baseline → RGP should be 0.0");
  console.log("- Byzantine F → RGP=1.0 (always fake settlement)");

  mkdirSync("results/attack1", { recursive: true });
  const outputPath = `results/attack1/attack1_analytic_${Date.now()}.json`;
  writeFileSync(outputPath, JSON.stringify({
    experiment: "Attack I: Facilitator Race",
    version: "analytic sweep",
    timestamp: new Date().toISOString(),
    chain: "Hardhat local",
    contract: usdcAddress,
    parameters: {
      defaultRequests: DEFAULT_REQUESTS,
      controlRequests: CONTROL_REQUESTS,
      blockTimeSecondsSweep: BLOCK_TIMES,
      requestConcurrency: REQUEST_CONCURRENCY,
      clientTimeoutMs: CLIENT_TIMEOUT_MS,
      receiptPollConcurrency: RECEIPT_POLL_CONCURRENCY,
      receiptPollIntervalMs: RECEIPT_POLL_INTERVAL_MS,
      receiptPollTimeoutMs: RECEIPT_POLL_TIMEOUT_MS,
      maxOutstandingSettlements: MAX_OUTSTANDING_SETTLEMENTS,
      schedulerPollIntervalMs: SCHEDULER_POLL_INTERVAL_MS,
      settlementRelayerCount: SETTLEMENT_RELAYER_COUNT,
      configLimit: CONFIG_LIMIT || "all",
    },
    results: allResults,
  }, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  fServer.close();
  rServer.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Experiment failed:", err);
  process.exit(1);
});
