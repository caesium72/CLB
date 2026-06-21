import { ethers } from "ethers";
import axios from "axios";
import Table from "cli-table3";
import { writeFileSync } from "fs";
import { getContractArtifact } from "../shared/contract.js";
import { buildTransferAuthorization } from "../shared/crypto.js";
import { CONFIG } from "../shared/config.js";
import { startFacilitator } from "./facilitator.js";
import { startResourceServer } from "./resource-server.js";

const SERVER_URL = `http://localhost:${CONFIG.RESOURCE_SERVER_PORT}`;
const FACILITATOR_URL = `http://localhost:${CONFIG.FACILITATOR_PORT}`;

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

  // Keep the payer external to the default Hardhat accounts.
  await deployer.sendTransaction({ to: payer.address, value: ethers.parseEther("1") });
  await usdc.connect(deployer).mint(payer.address, CONFIG.PAYER_MINT_AMOUNT);

  const balance = await usdc.balanceOf(payer.address);
  console.log(`[Setup] Payer=${payer.address}, USDC balance=${balance}`);
  console.log(`[Setup] Receiver=${receiver}`);

  return { payer, receiver };
}

async function runExperiment(n, idempotency, payer, receiver, usdcAddress) {
  await axios.post(`${SERVER_URL}/configure`, { idempotency, receiver });
  await axios.post(`${FACILITATOR_URL}/configure`, { idempotency });

  const { encoded } = await buildTransferAuthorization(payer, {
    usdcAddress,
    to: receiver,
    value: CONFIG.RESOURCE_PRICE_USDC,
    chainId: CONFIG.CHAIN_ID,
  });

  const startTime = Date.now();

  const promises = Array.from({ length: n }, (_, i) =>
    axios
      .get(`${SERVER_URL}/api/data`, { headers: { "x-payment": encoded } })
      .then((res) => ({ index: i, status: res.status, granted: true }))
      .catch((err) => ({ index: i, status: err.response?.status || 0, granted: false }))
  );

  const responses = await Promise.all(promises);
  const elapsed = Date.now() - startTime;

  // The resource server settles asynchronously after granting.
  await new Promise((r) => setTimeout(r, 2000));

  const facStats = (await axios.get(`${FACILITATOR_URL}/stats`)).data;

  const grantsIssued = responses.filter((r) => r.granted).length;

  const DSR = facStats.settleSuccess;
  const DGR = grantsIssued;

  return {
    n,
    idempotency,
    grantsIssued,
    settleSuccess: facStats.settleSuccess,
    settleReverted: facStats.settleReverted,
    settleDuplicate: facStats.settleDuplicate,
    DSR,
    DGR,
    elapsed_ms: elapsed,
  };
}

async function main() {
  console.log("=== x402 Attack II: Replay / Idempotency (Real Chain) ===\n");

  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  try {
    await provider.getBlockNumber();
  } catch {
    console.error("ERROR: Hardhat node not running. Start it with: npx hardhat node --config hardhat.config.cjs");
    process.exit(1);
  }

  const { usdc, address: usdcAddress } = await deployUSDC(provider);

  const { payer, receiver } = await setupAccounts(usdc, provider);

  await startFacilitator(usdcAddress);
  await startResourceServer();
  await axios.post(`${SERVER_URL}/configure`, { receiver });

  console.log("\n--- Starting experiments ---\n");

  const allResults = [];

  for (const idempotency of [false, true]) {
    const label = idempotency ? "With pay_id idempotency" : "No idempotency check";
    console.log(`\n[Config] ${label}\n`);

    for (const n of CONFIG.REPLAY_COUNTS) {
      // Reset spend capacity between replay sizes.
      const deployer = await provider.getSigner(0);
      await usdc.connect(deployer).mint(payer.address, CONFIG.PAYER_MINT_AMOUNT);

      process.stdout.write(`  n=${String(n).padEnd(4)} `);
      const result = await runExperiment(n, idempotency, payer, receiver, usdcAddress);
      allResults.push(result);

      console.log(
        `grants=${result.grantsIssued}, settle_ok=${result.settleSuccess}, ` +
        `settle_revert=${result.settleReverted}, settle_dup=${result.settleDuplicate} ` +
        `| DSR=${result.DSR} DGR=${result.DGR} (${result.elapsed_ms}ms)`
      );
    }
  }

  console.log("\n\n=== Results Summary (Table 4 Format) ===\n");
  console.log("Values: DSR / DGR");
  console.log("DSR = on-chain successful settlements (EIP-3009 nonce enforced)");
  console.log("DGR = HTTP-layer resource grants (application-layer)\n");

  const table = new Table({
    head: ["Implementation", "n=1", "n=5", "n=10", "n=50", "Idempotency"],
  });

  const noCheck = allResults.filter((r) => !r.idempotency);
  const withCheck = allResults.filter((r) => r.idempotency);

  const fmt = (r) => `${r.DSR} / ${r.DGR}`;

  table.push(
    ["Testbed (no check)", ...noCheck.map(fmt), "✗"],
    ["Testbed (pay_id)", ...withCheck.map(fmt), "✓"],
  );

  console.log(table.toString());

  const outputPath = `results/attack2/attack2_real.json`;
  writeFileSync(outputPath, JSON.stringify({
    experiment: "Attack II Replay — Real Chain",
    timestamp: new Date().toISOString(),
    chain: "Hardhat local",
    contract: usdcAddress,
    results: allResults,
  }, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Experiment failed:", err);
  process.exit(1);
});
