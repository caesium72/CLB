import { describe, expect, test } from "bun:test";
import net from "node:net";
import { attachMandateSignature } from "@clb-acel/ap2-adapter";
import { computeMandateDigest } from "@clb-acel/clb-core";
import {
  ContractPredicateGuard,
  PredicateOnChainRevertError,
  type ContractGuardWriter,
} from "@clb-acel/predicate-adapter";
import { buildMerchantServer } from "../../merchant-agent-api/src/server";
import { buildIdentityServer } from "../../../services/identity-service/src/server";
import { buildMandateServer } from "../../../services/mandate-service/src/server";
import { buildVerifierServer } from "../../../services/verifier-service/src/server";
import {
  createInMemoryEvidenceRepository,
  buildEvidenceServer,
} from "../../../services/evidence-service/src/server";
import { createIntent, prepareDelegatedOverHttp, runDelegatedOverHttp } from "../src/http-flow";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const DEFAULT_USER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const NOW = Date.parse("2026-05-30T05:00:00.000Z");

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
  if (!address || typeof address === "string")
    throw new Error("Could not resolve test server port");
  return { url: `http://127.0.0.1:${address.port}`, close: () => app.close() };
}

async function bootStack() {
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
  const [e, i, m, mc, v] = closers;
  return {
    urls: { evidence: e.url, identity: i.url, mandate: m.url, merchant: mc.url, verifier: v.url },
    close: () => Promise.all(closers.map((s) => s.close())),
  };
}

async function registerMandate(urls: { mandate: string }, intentId: string) {
  const human = privateKeyToAccount(DEFAULT_USER_PRIVATE_KEY);
  const intent = createIntent({ token: "PRED", intentId, budget: "2.00" });
  const prepared = await prepareDelegatedOverHttp(intent, {
    urls,
    humanPrincipal: human.address,
    config: { nowMs: NOW },
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
  return { intent, mandateId: registeredMandate.mandateId };
}

const GUARD = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Hex;

describe("runDelegatedOverHttp on-chain guard wiring", () => {
  test("happy delegated settlement returns a real on-chain tx hash (not reverted)", async () => {
    const stack = await bootStack();
    try {
      const { intent, mandateId } = await registerMandate(stack.urls, "onchain-happy");
      const writer: ContractGuardWriter = async () => ({ txHash: `0x${"ab".repeat(32)}` });
      const onchainGuard = new ContractPredicateGuard({ address: GUARD, writer });

      const trace = await runDelegatedOverHttp(intent, {
        urls: stack.urls,
        mandateId,
        config: { nowMs: NOW },
        onchainGuard,
      });

      expect(trace.onchain?.reverted).toBe(false);
      expect(trace.onchain?.txHash).toBe(`0x${"ab".repeat(32)}`);
      expect(trace.verification.outcomes.R17_PREDICATE_TRUE_FOR_MODE_B?.ok).toBe(true);
    } finally {
      await stack.close();
    }
  });

  test("predicate-violating settlement is prevented by an on-chain revert", async () => {
    const stack = await bootStack();
    try {
      const { intent, mandateId } = await registerMandate(stack.urls, "onchain-revert");
      // Writer stands in for the deployed guard: the typed revert the contract
      // would emit for an over-budget settlement (exercised for real in e2e:phase7-caveat).
      const writer: ContractGuardWriter = async () => {
        throw new PredicateOnChainRevertError("AmountExceedsMax");
      };
      const onchainGuard = new ContractPredicateGuard({ address: GUARD, writer });

      const trace = await runDelegatedOverHttp(intent, {
        urls: stack.urls,
        mandateId,
        config: { nowMs: NOW },
        onchainGuard,
      });

      expect(trace.onchain?.reverted).toBe(true);
      expect(trace.onchain?.reason).toBe("AmountExceedsMax");
    } finally {
      await stack.close();
    }
  });
});
