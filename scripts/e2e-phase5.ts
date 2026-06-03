/**
 * Phase 5 live HTTP demo smoke test.
 *
 * Starts the Fastify services on loopback, registers wallet-style mandates, runs
 * Mode A + Mode B through HTTP transport, and checks evidence/verifier APIs.
 */

import net from "node:net";
import { buildClbTypedData, computeMandateDigest } from "@clb-acel/clb-core";
import { buildMerchantServer } from "../apps/merchant-agent-api/src/server";
import { createIntent, prepareDelegatedOverHttp, prepareHumanPresentOverHttp, runDelegatedOverHttp, runHumanPresentOverHttp } from "../apps/agent-orchestrator/src/http-flow";
import { attachMandateSignature } from "../packages/ap2-adapter/src/index";
import { buildEvidenceServer, createInMemoryEvidenceRepository } from "../services/evidence-service/src/server";
import { buildIdentityServer } from "../services/identity-service/src/server";
import { buildMandateServer } from "../services/mandate-service/src/server";
import { buildVerifierServer } from "../services/verifier-service/src/server";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const NOW_MS = Date.parse("2026-05-30T05:00:00.000Z");
const USER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a local port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function startServer(app: Awaited<ReturnType<typeof buildEvidenceServer>>) {
  await app.listen({ port: await freePort(), host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Could not resolve server port");
  return { url: `http://127.0.0.1:${address.port}`, close: () => app.close() };
}

async function main() {
  console.log("CLB-ACEL Phase 5 live HTTP demo smoke test");

  const evidence = await buildEvidenceServer({
    repository: createInMemoryEvidenceRepository(),
    anchorClient: null,
    logger: false,
  });
  const apps = await Promise.all([
    startServer(evidence),
    startServer(await buildIdentityServer({ logger: false, seed: true })),
    startServer(await buildMandateServer({ logger: false })),
    startServer(await buildMerchantServer({ logger: false })),
    startServer(await buildVerifierServer({ logger: false })),
  ]);
  const [evidenceServer, identityServer, mandateServer, merchantServer, verifierServer] = apps;
  const urls = {
    evidence: evidenceServer.url,
    identity: identityServer.url,
    mandate: mandateServer.url,
    merchant: merchantServer.url,
    verifier: verifierServer.url,
  };
  const human = privateKeyToAccount(USER_PRIVATE_KEY);

  try {
    const modeAIntent = createIntent({ token: "P5A", intentId: "phase5-mode-a", budget: "2.00" });
    const modeAPrepared = await prepareHumanPresentOverHttp(modeAIntent, {
      urls,
      humanPrincipal: human.address,
      config: { nowMs: NOW_MS },
    });
    const modeASignature = await human.signTypedData(
      buildClbTypedData({
        ...modeAPrepared.clb,
        mandateDigest: computeMandateDigest(modeAPrepared.mandateDraft as never),
      }),
    );
    const modeAMandate = attachMandateSignature(modeAPrepared.mandateDraft, {
      signature: modeASignature,
      clb: modeAPrepared.clb,
    });
    const registerA = await fetch(`${urls.mandate}/mandates/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mandate: modeAMandate, clb: modeAPrepared.clb, expectedSigner: human.address }),
    });
    assert(registerA.status === 201, `Mode A mandate register status ${registerA.status}`);
    const traceA = await runHumanPresentOverHttp(modeAIntent, {
      urls,
      mandateId: modeAMandate.mandateId,
      config: { nowMs: NOW_MS },
    });
    assert(traceA.verification.result.status === "PASS", "Mode A verifier did not PASS");
    console.log(`OK Mode A HTTP: ${traceA.traceId}`);

    const modeBIntent = createIntent({ token: "P5B", intentId: "phase5-mode-b", budget: "2.00" });
    const modeBPrepared = await prepareDelegatedOverHttp(modeBIntent, {
      urls,
      humanPrincipal: human.address,
      config: { nowMs: NOW_MS },
    });
    const modeBSignature = await human.signMessage({
      message: { raw: computeMandateDigest(modeBPrepared.mandateDraft as never) },
    });
    const modeBMandate = attachMandateSignature(modeBPrepared.mandateDraft, { signature: modeBSignature });
    const registerB = await fetch(`${urls.mandate}/mandates/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mandate: modeBMandate, expectedSigner: human.address }),
    });
    assert(registerB.status === 201, `Mode B mandate register status ${registerB.status}`);
    const traceB = await runDelegatedOverHttp(modeBIntent, {
      urls,
      mandateId: modeBMandate.mandateId,
      config: { nowMs: NOW_MS },
    });
    assert(traceB.verification.result.status === "PASS", "Mode B verifier did not PASS");
    assert(traceB.verification.outcomes.R17_PREDICATE_TRUE_FOR_MODE_B.ok, "Mode B R17 did not PASS");
    console.log(`OK Mode B HTTP: ${traceB.traceId}, R17 PASS`);

    for (const traceId of [traceA.traceId, traceB.traceId]) {
      const evidenceResponse = await fetch(`${urls.evidence}/traces/${traceId}`);
      const certificateResponse = await fetch(`${urls.verifier}/verify/${traceId}/certificate`);
      assert(evidenceResponse.status === 200, `evidence ${traceId} unavailable`);
      assert(certificateResponse.status === 200, `certificate ${traceId} unavailable`);
    }
    console.log("OK evidence + verifier API checks");

    const anchorConfigured = Boolean(process.env.AUDIT_ANCHOR_ADDRESS && process.env.RPC_URL && process.env.DEPLOYER_PRIVATE_KEY);
    console.log(anchorConfigured ? "Anchor env configured; use the UI button for tx feedback." : "Anchor env not configured; on-chain step skipped.");
  } finally {
    await Promise.all(apps.map((app) => app.close()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
