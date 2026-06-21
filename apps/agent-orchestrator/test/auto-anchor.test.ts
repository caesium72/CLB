import { describe, expect, it } from "bun:test";
import { buildMerchantServer } from "../../merchant-agent-api/src/server";
import { buildIdentityServer } from "../../../services/identity-service/src/server";
import { buildMandateServer } from "../../../services/mandate-service/src/server";
import { buildVerifierServer } from "../../../services/verifier-service/src/server";
import {
  createInMemoryEvidenceRepository,
  buildEvidenceServer,
} from "../../../services/evidence-service/src/server";
import { createIntent, runHumanPresentOverHttp } from "../src/http-flow";
import net from "node:net";

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

describe("auto-anchor", () => {
  it("auto-anchor is called once after a successful run with the correct merkleRoot", async () => {
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

    const anchored: unknown[] = [];
    const mockAnchorClient = {
      anchorTrace: async (input: unknown) => {
        anchored.push(input);
        return { txHash: "0xanchor" };
      },
    };

    try {
      const intent = createIntent({ token: "ANCHOR", intentId: "auto-anchor", budget: "2.00" });
      const out = await runHumanPresentOverHttp(intent, {
        urls: {
          evidence: evidenceServer.url,
          identity: identityServer.url,
          mandate: mandateServer.url,
          merchant: merchantServer.url,
          verifier: verifierServer.url,
        },
        config: { nowMs: Date.parse("2026-05-30T05:00:00.000Z") },
        anchorClient: mockAnchorClient,
      });

      expect(out.verification.result.status).toBe("PASS");
      expect(anchored).toHaveLength(1);
      expect((anchored[0] as { merkleRoot: string }).merkleRoot).toBe(out.merkleRoot);
    } finally {
      await Promise.all(closers.map((server) => server.close()));
    }
  });
});
