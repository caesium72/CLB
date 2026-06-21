/**
 * Attack III local proxy/cache harness.
 *
 * Runs 1,000 requests per condition through:
 * - nginx with proxy_cache enabled
 * - Caddy's default reverse_proxy
 * - a local MitM proxy that injects duplicate X-PAYMENT headers
 */

import axios from "axios";
import { execFileSync } from "child_process";
import Table from "cli-table3";
import { writeFileSync } from "fs";
import { createProxyTestServer } from "./resource-server.js";

const SERVER_PORT = 3800;
const NGINX_PORT = 8080;
const CADDY_PORT = 8081;
const MITM_PORT = 8082;
const NUM_REQUESTS = 1000;
const REQUEST_TIMEOUT_MS = 5000;
const PROXY_BOOT_MS = 1500;
const CACHE_SETTLE_MS = 500;
const NGINX_IMAGE = process.env.ATTACK3_NGINX_IMAGE ||
  "nginx@sha256:7150b3a39203cb5bee612ff4a9d18774f8c7caf6399d6e8985e97e28eb751c18";
const CADDY_IMAGE = process.env.ATTACK3_CADDY_IMAGE ||
  "caddy@sha256:1e40b251ca9639ead7b5cd2cedcc8765adfbabb99450fe23f130eefabf50f4bc";

const VALID_PAYMENT = Buffer.from(JSON.stringify({
  from: "0x1234567890abcdef1234567890abcdef12345678",
  to: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  value: "10000",
  nonce: "0xdeadbeef",
  signature: "0x" + "ab".repeat(65),
})).toString("base64");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function docker(args, { ignoreError = false } = {}) {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: "pipe" }).trim();
  } catch (err) {
    if (ignoreError) return null;
    throw err;
  }
}

function dockerImageId(image) {
  return docker(["image", "inspect", image, "--format", "{{.Id}}"], { ignoreError: true });
}

function dockerVersion() {
  return docker(["version", "--format", "{{.Server.Version}}"], { ignoreError: true });
}

function startNginx() {
  docker(["rm", "-f", "x402-nginx"], { ignoreError: true });
  docker([
    "run", "-d", "--name", "x402-nginx",
    "--add-host=host.docker.internal:host-gateway",
    "-p", `${NGINX_PORT}:8080`,
    "-v", `${process.cwd()}/src/attack3/configs/nginx.conf:/etc/nginx/nginx.conf:ro`,
    NGINX_IMAGE,
  ]);
  console.log(`  [nginx] started on :${NGINX_PORT} (${NGINX_IMAGE})`);
}

function startCaddy() {
  docker(["rm", "-f", "x402-caddy"], { ignoreError: true });
  docker([
    "run", "-d", "--name", "x402-caddy",
    "--add-host=host.docker.internal:host-gateway",
    "-p", `${CADDY_PORT}:8081`,
    "-v", `${process.cwd()}/src/attack3/configs/Caddyfile:/etc/caddy/Caddyfile:ro`,
    CADDY_IMAGE,
  ]);
  console.log(`  [caddy] started on :${CADDY_PORT} (${CADDY_IMAGE})`);
}

function stopContainers() {
  docker(["rm", "-f", "x402-nginx"], { ignoreError: true });
  docker(["rm", "-f", "x402-caddy"], { ignoreError: true });
}

async function restartProxy(proxyName) {
  if (proxyName === "nginx") {
    startNginx();
  } else if (proxyName === "Caddy") {
    startCaddy();
  } else {
    throw new Error(`Unknown proxy: ${proxyName}`);
  }

  await sleep(PROXY_BOOT_MS);
}

async function testHeaderMutation(proxyUrl, proxyName) {
  await axios.post(`http://localhost:${SERVER_PORT}/reset`);

  let total = 0;
  let errors = 0;

  for (let i = 0; i < NUM_REQUESTS; i++) {
    const requestUrl = `${proxyUrl}/api/data?header-test=${i}`;
    try {
      await axios.get(requestUrl, {
        headers: { "X-PAYMENT": VALID_PAYMENT },
        timeout: REQUEST_TIMEOUT_MS,
      });
      total++;
    } catch (err) {
      if (err.response) total++;
      else errors++;
    }
  }

  const received = (await axios.get(`http://localhost:${SERVER_PORT}/received-headers`)).data;
  const observedByOrigin = received.length;

  let mutated = 0;
  for (const entry of received) {
    const isMutated = !entry.xPayment ||
      entry.xPayment !== VALID_PAYMENT ||
      entry.headerCount !== 1;
    if (isMutated) mutated++;
  }

  const mutationRate = observedByOrigin > 0 ? mutated / observedByOrigin : 0;
  return { proxyName, total, observedByOrigin, errors, mutated, mutationRate };
}

async function testCacheLeakage(proxyUrl, proxyName, cacheControl) {
  await axios.post(`http://localhost:${SERVER_PORT}/configure`, { cacheControl });
  await axios.post(`http://localhost:${SERVER_PORT}/reset`);

  let prime;
  try {
    prime = await axios.get(`${proxyUrl}/api/data`, {
      headers: { "X-PAYMENT": VALID_PAYMENT },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });
  } catch (err) {
    throw new Error(`${proxyName} paid priming request failed: ${err.message}`);
  }

  if (prime.status !== 200) {
    throw new Error(`${proxyName} paid priming request returned HTTP ${prime.status}`);
  }

  await sleep(CACHE_SETTLE_MS);

  let leaks = 0;
  let total = 0;
  let errors = 0;
  const statusCounts = {};
  const cacheStatusCounts = {};

  for (let i = 0; i < NUM_REQUESTS; i++) {
    try {
      const res = await axios.get(`${proxyUrl}/api/data`, {
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      });
      total++;
      statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;

      const cacheStatus = res.headers["x-cache-status"] || res.headers["cf-cache-status"] || null;
      if (cacheStatus) cacheStatusCounts[cacheStatus] = (cacheStatusCounts[cacheStatus] || 0) + 1;

      if (res.status === 200) leaks++;
    } catch (err) {
      errors++;
    }
  }

  const leakRate = total > 0 ? leaks / total : 0;
  return {
    proxyName,
    cacheControl,
    priming: {
      status: prime.status,
      cacheStatus: prime.headers["x-cache-status"] || null,
      cacheControl: prime.headers["cache-control"] || null,
    },
    total,
    errors,
    statusCounts,
    cacheStatusCounts,
    leaks,
    leakRate,
  };
}

async function testMultiHeader() {
  await import("./proxies/mitm-proxy.js");
  await sleep(CACHE_SETTLE_MS);

  await axios.post(`http://localhost:${MITM_PORT}/configure`, { mode: "multi-header" });
  await axios.post(`http://localhost:${SERVER_PORT}/reset`);

  let total = 0;
  let errors = 0;

  for (let i = 0; i < NUM_REQUESTS; i++) {
    try {
      await axios.get(`http://localhost:${MITM_PORT}/api/data`, {
        headers: { "X-PAYMENT": VALID_PAYMENT },
        timeout: REQUEST_TIMEOUT_MS,
      });
      total++;
    } catch (err) {
      if (err.response) total++;
      else errors++;
    }
  }

  const received = (await axios.get(`http://localhost:${SERVER_PORT}/received-headers`)).data;
  const observedByOrigin = received.length;
  let multiHeaderDetected = 0;
  let lastValuePicked = 0;
  let concatenated = 0;

  for (const entry of received) {
    if (entry.headerCount > 1) {
      multiHeaderDetected++;
      if (entry.xPayment && entry.xPayment.includes("INJECTED_FAKE")) {
        lastValuePicked++;
      } else if (entry.xPayment && entry.xPayment.includes(",")) {
        concatenated++;
      }
    }
  }

  const injectionRate = observedByOrigin > 0 ? multiHeaderDetected / observedByOrigin : 0;

  return {
    proxyName: "Custom MitM",
    total,
    observedByOrigin,
    errors,
    multiHeaderDetected,
    injectionRate,
    lastValuePicked,
    concatenated,
    firstValuePicked: multiHeaderDetected - lastValuePicked - concatenated,
  };
}

async function main() {
  console.log("=== Attack III: proxy/cache behavior ===\n");

  const { server } = await createProxyTestServer(SERVER_PORT);
  await sleep(500);

  console.log("Starting proxies...");
  startNginx();
  startCaddy();
  await sleep(3000);

  const results = { headerMutation: [], cacheLeakage: [], multiHeader: null };

  console.log("\n--- Header mutation (1000 requests each) ---\n");

  for (const [name, port] of [["nginx", NGINX_PORT], ["Caddy", CADDY_PORT]]) {
    process.stdout.write(`  ${name.padEnd(20)} `);
    const r = await testHeaderMutation(`http://localhost:${port}`, name);
    results.headerMutation.push(r);
    console.log(`mutation=${r.mutated}/${r.total} (${(r.mutationRate * 100).toFixed(1)}%)`);
  }

  console.log("\n--- Cache leakage (1000 unpaid after 1 paid) ---\n");

  for (const [name, port] of [["nginx", NGINX_PORT], ["Caddy", CADDY_PORT]]) {
    for (const cc of [false, true]) {
      const label = `${name} (CC=${cc ? "yes" : "no"})`;
      process.stdout.write(`  ${label.padEnd(25)} `);

      await restartProxy(name);

      const r = await testCacheLeakage(`http://localhost:${port}`, name, cc);
      results.cacheLeakage.push(r);
      console.log(`leaks=${r.leaks}/${r.total} (${(r.leakRate * 100).toFixed(1)}%)`);
    }
  }

  console.log("\n--- Duplicate-header injection (MitM proxy) ---\n");

  const mh = await testMultiHeader();
  results.multiHeader = mh;
  console.log(`  Injection: ${mh.multiHeaderDetected}/${mh.total} (${(mh.injectionRate * 100).toFixed(1)}%)`);
  console.log(`  Server picks: first=${mh.firstValuePicked} last=${mh.lastValuePicked} concat=${mh.concatenated}`);

  console.log("\n=== Results summary ===\n");

  const table = new Table({
    head: ["Proxy", "Header Mutation", "Cache Leak (no CC)", "Cache Leak (with CC)"],
  });

  for (const name of ["nginx", "Caddy"]) {
    const hm = results.headerMutation.find(r => r.proxyName === name);
    const clNo = results.cacheLeakage.find(r => r.proxyName === name && !r.cacheControl);
    const clYes = results.cacheLeakage.find(r => r.proxyName === name && r.cacheControl);
    table.push([
      name,
      `${((hm?.mutationRate || 0) * 100).toFixed(1)}%`,
      `${((clNo?.leakRate || 0) * 100).toFixed(1)}%`,
      `${((clYes?.leakRate || 0) * 100).toFixed(1)}%`,
    ]);
  }
  table.push(["Custom MitM", `${(mh.injectionRate * 100).toFixed(1)}% (multi-header)`, "N/A", "N/A"]);

  console.log(table.toString());

  const outputPath = `results/attack3/attack3.json`;
  writeFileSync(outputPath, JSON.stringify({
    experiment: "Attack III: proxy/cache behavior",
    timestamp: new Date().toISOString(),
    parameters: {
      numRequests: NUM_REQUESTS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      cacheSettleMs: CACHE_SETTLE_MS,
      cacheTrials: "one paid priming request followed by unpaid same-URL requests",
      cacheIsolation: "proxy container restarted before each cache-control condition",
      dockerImages: {
        nginx: NGINX_IMAGE,
        caddy: CADDY_IMAGE,
      },
    },
    environment: {
      node: process.version,
      dockerServer: dockerVersion(),
      dockerImageIds: {
        nginx: dockerImageId(NGINX_IMAGE),
        caddy: dockerImageId(CADDY_IMAGE),
      },
    },
    results,
  }, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  stopContainers();
  server.close();
  process.exit(0);
}

main().catch(err => {
  console.error("Failed:", err.message);
  stopContainers();
  process.exit(1);
});
