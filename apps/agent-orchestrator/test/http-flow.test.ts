import { describe, expect, test } from "bun:test";
import { attachMandateSignature } from "@clb-acel/ap2-adapter";
import { computeMandateDigest } from "@clb-acel/clb-core";
import { buildMerchantServer } from "../../merchant-agent-api/src/server";
import { buildIdentityServer } from "../../../services/identity-service/src/server";
import { buildMandateServer } from "../../../services/mandate-service/src/server";
import { buildVerifierServer } from "../../../services/verifier-service/src/server";
import { createInMemoryEvidenceRepository, buildEvidenceServer } from "../../../services/evidence-service/src/server";
import { DEFAULT_ANALYSIS_AGENT_ID } from "@clb-acel/identity-service/seed";
import { createIntent, discoverAgentsForIntent, prepareDelegatedOverHttp, quoteForIntent, runDelegatedOverHttp, runHumanPresentOverHttp } from "../src/http-flow";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import net from "node:net";

const DEFAULT_USER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a test port")));
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
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve test server port");
  }
  return { url: `http://127.0.0.1:${address.port}`, close: () => app.close() };
}

describe("runHumanPresentOverHttp", () => {
  test("runs Mode A across live HTTP services", async () => {
    const evidence = await buildEvidenceServer({
      repository: createInMemoryEvidenceRepository(),
      anchorClient: null,
      logger: false,
    });
    const identity = await buildIdentityServer({ logger: false, seed: true });
    const mandate = await buildMandateServer({ logger: false });
    const merchant = await buildMerchantServer({ logger: false });
    const verifier = await buildVerifierServer({ logger: false });

    const closers = await Promise.all([
      startServer(evidence),
      startServer(identity),
      startServer(mandate),
      startServer(merchant),
      startServer(verifier),
    ]);
    const [evidenceServer, identityServer, mandateServer, merchantServer, verifierServer] = closers;

    try {
      const intent = createIntent({ token: "HTTP", intentId: "http-e2e", budget: "2.00" });
      const trace = await runHumanPresentOverHttp(intent, {
        urls: {
          evidence: evidenceServer.url,
          identity: identityServer.url,
          mandate: mandateServer.url,
          merchant: merchantServer.url,
          verifier: verifierServer.url,
        },
        config: { nowMs: Date.parse("2026-05-30T05:00:00.000Z") },
      });

      expect(trace.transport).toBe("http");
      expect(trace.verification.result.status).toBe("PASS");
      expect(trace.events).toHaveLength(8);

      const stored = await fetch(`${evidenceServer.url}/traces/${trace.traceId}`);
      expect(stored.status).toBe(200);
      expect((await stored.json()).events).toHaveLength(8);
    } finally {
      await Promise.all(closers.map((server) => server.close()));
    }
  });

  test("runs Mode B delegated flow across live HTTP services with a registered INTENT mandate", async () => {
    const evidence = await buildEvidenceServer({
      repository: createInMemoryEvidenceRepository(),
      anchorClient: null,
      logger: false,
    });
    const identity = await buildIdentityServer({ logger: false, seed: true });
    const mandate = await buildMandateServer({ logger: false });
    const merchant = await buildMerchantServer({ logger: false });
    const verifier = await buildVerifierServer({ logger: false });

    const closers = await Promise.all([
      startServer(evidence),
      startServer(identity),
      startServer(mandate),
      startServer(merchant),
      startServer(verifier),
    ]);
    const [evidenceServer, identityServer, mandateServer, merchantServer, verifierServer] = closers;
    const urls = {
      evidence: evidenceServer.url,
      identity: identityServer.url,
      mandate: mandateServer.url,
      merchant: merchantServer.url,
      verifier: verifierServer.url,
    };

    try {
      const intent = createIntent({ token: "PRED", intentId: "http-mode-b", budget: "2.00" });
      const human = privateKeyToAccount(DEFAULT_USER_PRIVATE_KEY);
      const prepared = await prepareDelegatedOverHttp(intent, {
        urls,
        humanPrincipal: human.address,
        config: { nowMs: Date.parse("2026-05-30T05:00:00.000Z") },
      });
      const signature = await human.signMessage({
        message: { raw: computeMandateDigest(prepared.mandateDraft as never) },
      });
      const registeredMandate = attachMandateSignature(prepared.mandateDraft, { signature });
      const register = await fetch(`${urls.mandate}/mandates/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mandate: registeredMandate, expectedSigner: human.address }),
      });
      expect(register.status).toBe(201);

      const trace = await runDelegatedOverHttp(intent, {
        urls,
        mandateId: registeredMandate.mandateId,
        config: { nowMs: Date.parse("2026-05-30T05:00:00.000Z") },
      });

      expect(trace.transport).toBe("http");
      expect(trace.verification.result.status).toBe("PASS");
      expect(trace.verification.outcomes.R17_PREDICATE_TRUE_FOR_MODE_B?.ok).toBe(true);
      expect(trace.events).toHaveLength(8);
    } finally {
      await Promise.all(closers.map((server) => server.close()));
    }
  });
});

describe("discoverAgentsForIntent", () => {
  test("selects the verified analysis merchant", async () => {
    const identity = await buildIdentityServer({ logger: false, seed: true });
    const identityServer = await startServer(identity);
    try {
      const intent = createIntent({ token: "PEPE", task: "Analyze PEPE token risk" });
      const discovery = await discoverAgentsForIntent(intent, { urls: { identity: identityServer.url } });
      expect(discovery.selectedMerchantId).toBe(DEFAULT_ANALYSIS_AGENT_ID);
      expect(discovery.activity.length).toBeGreaterThan(0);
      expect(discovery.candidates.some((candidate) => candidate.selected)).toBe(true);
    } finally {
      await identityServer.close();
    }
  });
});

describe("quoteForIntent", () => {
  test("returns a cart quote for Mode A", async () => {
    const identity = await buildIdentityServer({ logger: false, seed: true });
    const merchant = await buildMerchantServer({ logger: false });
    const identityServer = await startServer(identity);
    const merchantServer = await startServer(merchant);
    try {
      const intent = createIntent({ token: "XYZ" });
      const quote = await quoteForIntent(intent, "a", {
        urls: { identity: identityServer.url, merchant: merchantServer.url },
      });
      expect(quote.kind).toBe("cart");
      if (quote.kind === "cart") {
        expect(quote.product).toContain("XYZ");
        expect(quote.price).toBeTruthy();
      }
    } finally {
      await Promise.all([identityServer.close(), merchantServer.close()]);
    }
  });
});
