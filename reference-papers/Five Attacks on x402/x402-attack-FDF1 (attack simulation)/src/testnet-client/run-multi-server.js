import { ethers } from "ethers";
import axios from "axios";
import crypto from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { TESTNET } from "./config.js";
import { signPayment } from "./signer.js";

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("Usage: PRIVATE_KEY=0x... node src/testnet-client/run-multi-server.js");
  process.exit(1);
}

const wallet = new ethers.Wallet(PRIVATE_KEY);

const SERVERS = Object.entries(TESTNET.TARGETS)
  .filter(([, ep]) => ep.url && ep.payTo)
  .map(([name, ep]) => ({
    name,
    url: ep.url,
    method: ep.method || "GET",
    body: ep.body || undefined,
    amount: ep.amount,
    payTo: ep.payTo,
    headerName: ep.headerName || "x-payment",
    maxTimeoutSeconds: ep.maxTimeoutSeconds,
  }));

if (SERVERS.length === 0) {
  console.error(
    "No endpoints configured. Populate ENDPOINT_1_* and/or ENDPOINT_2_* in your .env."
  );
  process.exit(1);
}

function endpointFingerprint(url) {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 12);
}

function addressFingerprint(address) {
  return crypto.createHash("sha256").update(address.toLowerCase()).digest("hex").slice(0, 12);
}

async function sendRequest(server, encoded) {
  const config = {
    headers: { [server.headerName]: encoded },
    timeout: 30000,
    validateStatus: () => true,
  };

  if (server.method === "POST") {
    return axios.post(server.url, server.body, {
      ...config,
      headers: { ...config.headers, "Content-Type": "application/json" },
    });
  }
  return axios.get(server.url, config);
}

async function sendUnpaidRequest(server) {
  const config = { timeout: 30000, validateStatus: () => true };
  if (server.method === "POST") {
    return axios.post(server.url, server.body, {
      ...config,
      headers: { "Content-Type": "application/json" },
    });
  }
  return axios.get(server.url, config);
}

async function testServer(server) {
  console.log(`\n=== ${server.name} ===`);
  console.log(`  Endpoint: ${endpointFingerprint(server.url)}`);
  console.log(`  Price: ${ethers.formatUnits(server.amount, 6)} USDC`);

  const result = {
    name: server.name,
    endpointFingerprint: endpointFingerprint(server.url),
    price: ethers.formatUnits(server.amount, 6),
  };

  console.log("\n  [1] Paid request:");
  const { encoded } = await signPayment(wallet, {
    payTo: server.payTo,
    amount: server.amount,
    maxTimeoutSeconds: server.maxTimeoutSeconds,
    extra: { name: TESTNET.USDC_NAME, version: TESTNET.USDC_VERSION },
  });

  try {
    const res = await sendRequest(server, encoded);
    result.paidStatus = res.status;
    result.cacheControl = res.headers["cache-control"] || "NOT SET";
    result.paymentResponse = !!res.headers["payment-response"];
    result.vercelCache = res.headers["x-vercel-cache"] || res.headers["x-cache-status"] || "N/A";
    result.cfCache = res.headers["cf-cache-status"] || "N/A";

    console.log(`    Status: ${res.status}`);
    console.log(`    Cache-Control: ${result.cacheControl}`);
    console.log(`    PAYMENT-RESPONSE: ${result.paymentResponse ? "present" : "MISSING"}`);
    console.log(`    CDN cache: vercel=${result.vercelCache} cf=${result.cfCache}`);

    if (res.status === 200) {
      const hasNoStore = result.cacheControl.includes("no-store");
      const hasPrivate = result.cacheControl.includes("private");
      result.cacheVulnerable = !hasNoStore && !hasPrivate;

      if (result.cacheVulnerable) {
        console.log(`    missing no-store/private`);
      } else {
        console.log(`    Cache-Control contains no-store/private`);
      }

      result.dataPreview = JSON.stringify(res.data).slice(0, 100);
    }
  } catch (err) {
    console.log(`    Error: ${err.message}`);
    result.error = err.message;
    return result;
  }

  if (result.paidStatus !== 200) {
    console.log(`    Skipping replay/unpaid tests (paid request failed)`);
    return result;
  }

  console.log("\n  [2] Replay same signature 5x:");
  await new Promise(r => setTimeout(r, 500));

  let cacheHits = 0;
  let sameContent = 0;
  const firstData = result.dataPreview;

  for (let i = 0; i < 5; i++) {
    try {
      const res = await sendRequest(server, encoded);
      const cache = res.headers["x-vercel-cache"] || res.headers["cf-cache-status"] || "?";
      const content = res.status === 200 ? JSON.stringify(res.data).slice(0, 100) : "";
      const isSame = content === firstData;

      if (cache === "HIT") cacheHits++;
      if (isSame && res.status === 200) sameContent++;

      console.log(`    #${i + 1}: ${res.status} | cache=${cache} | same_content=${isSame}`);
    } catch (err) {
      console.log(`    #${i + 1}: ERR`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  result.replayCacheHits = cacheHits;
  result.replaySameContent = sameContent;

  console.log("\n  [3] Unpaid request:");

  try {
    const res = await sendUnpaidRequest(server);
    result.unpaidStatus = res.status;
    result.unpaidCache = res.headers["x-vercel-cache"] || res.headers["cf-cache-status"] || "?";

    console.log(`    Status: ${res.status} | cache=${result.unpaidCache}`);

    if (res.status === 200) {
      console.log(`    unpaid request returned 200`);
      result.unpaidLeaked = true;
    } else {
      console.log(`    unpaid request returned ${res.status}`);
      result.unpaidLeaked = false;
    }
  } catch (err) {
    console.log(`    Error: ${err.message}`);
  }

  return result;
}

async function main() {
  console.log("=== Multi-Server x402 Cache Audit ===");
  console.log(`Wallet fingerprint: ${addressFingerprint(wallet.address)}`);
  console.log(`Servers: ${SERVERS.length}`);

  const allResults = [];

  for (const server of SERVERS) {
    const result = await testServer(server);
    allResults.push(result);
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("\n\n=== SUMMARY ===\n");
  console.log("Server          | Paid | Cache-Control              | CDN Leaks? | Unpaid Gets 200?");
  console.log("----------------|------|----------------------------|------------|------------------");
  for (const r of allResults) {
    const paid = r.paidStatus || "ERR";
    const cc = (r.cacheControl || "?").slice(0, 26).padEnd(26);
    const leak = r.replayCacheHits > 0 ? `${r.replayCacheHits}/5 HIT` : "no";
    const unpaid = r.unpaidLeaked ? "YES" : r.unpaidStatus ? "no" : "?";
    console.log(`${r.name.padEnd(16)}| ${String(paid).padEnd(5)}| ${cc} | ${leak.padEnd(10)} | ${unpaid}`);
  }

  mkdirSync("results/attack3", { recursive: true });
  const outputPath = `results/attack3/live_cache_audit_local_${Date.now()}.json`;
  writeFileSync(outputPath, JSON.stringify({
    experiment: "Live endpoint cache audit",
    timestamp: new Date().toISOString(),
    results: allResults,
  }, null, 2));
  console.log(`\nResults saved to ${outputPath}`);
}

main().catch(err => {
  console.error("Failed:", err.message);
  process.exit(1);
});
