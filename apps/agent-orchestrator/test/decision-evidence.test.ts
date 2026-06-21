import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildMerchantServer } from "../../merchant-agent-api/src/server";
import { buildIdentityServer } from "../../../services/identity-service/src/server";
import { buildMandateServer } from "../../../services/mandate-service/src/server";
import { buildVerifierServer } from "../../../services/verifier-service/src/server";
import {
  createInMemoryEvidenceRepository,
  buildEvidenceServer,
} from "../../../services/evidence-service/src/server";
import { createIntent, discoverAgentsForIntent, runHumanPresentOverHttp } from "../src/http-flow";
import net from "node:net";

const previousLlmProvider = process.env.LLM_PROVIDER;

beforeAll(() => {
  // Deterministic + network-free for CI: force the heuristic provider.
  process.env.LLM_PROVIDER = "heuristic";
});

afterAll(() => {
  if (previousLlmProvider === undefined) {
    delete process.env.LLM_PROVIDER;
  } else {
    process.env.LLM_PROVIDER = previousLlmProvider;
  }
});

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

describe("DECISION_CONTEXT audit evidence", () => {
  test("discoverAgentsForIntent returns a real heuristic rationale + provider", async () => {
    const identity = await buildIdentityServer({ logger: false, seed: true });
    const identityServer = await startServer(identity);
    try {
      const intent = createIntent({ token: "PEPE", task: "Analyze PEPE token risk" });
      const discovery = await discoverAgentsForIntent(intent, {
        urls: { identity: identityServer.url },
      });
      expect(discovery.rationale.length).toBeGreaterThan(10);
      expect(discovery.llmProvider).toBe("heuristic");
    } finally {
      await identityServer.close();
    }
  });

  test("a full Mode A trace records exactly one audit-only DECISION_CONTEXT event", async () => {
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
      const intent = createIntent({ token: "HTTP", intentId: "decision-e2e", budget: "2.00" });
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

      // The audit event must not regress verification.
      expect(trace.verification.result.status).toBe("PASS");

      const decisionEvents = trace.events.filter(
        (event) => event.objectType === "DECISION_CONTEXT",
      );
      expect(decisionEvents).toHaveLength(1);

      const decision = decisionEvents[0]!;
      const publicFields = decision.publicFields as Record<string, unknown>;

      expect(Array.isArray(publicFields.candidates)).toBe(true);
      expect((publicFields.candidates as unknown[]).length).toBeGreaterThanOrEqual(1);
      expect(publicFields.selected).toBeTruthy();
      expect(typeof publicFields.rationale).toBe("string");
      expect((publicFields.rationale as string).length).toBeGreaterThan(10);
      expect(String(publicFields.llmProvider)).toMatch(/openai|grok|heuristic/);

      // Audit-only: it must NOT carry an enforced flag.
      expect("enforced" in publicFields).toBe(false);
      expect("enforced" in (decision as Record<string, unknown>)).toBe(false);
    } finally {
      await Promise.all(closers.map((server) => server.close()));
    }
  });
});
