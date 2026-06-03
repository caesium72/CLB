import { describe, expect, test } from "bun:test";
import { createIntent, runHumanPresent } from "../src/flow";
import { buildOrchestratorServer } from "../src/server";

describe("runHumanPresent (in-process Mode A)", () => {
  test("produces a fully bound, verified trace", async () => {
    const intent = createIntent({ token: "XYZ", budget: "2.00" });
    const trace = await runHumanPresent(intent);

    expect(trace.verification.result.status).toBe("PASS");
    expect(trace.verification.result.failedRules).toEqual([]);
    expect(trace.mandate.clbCommitment).toBe(trace.clbCommitment);
    expect(trace.paymentPayload.authorization.nonce).toBe(trace.nonce);
    expect(trace.settlement.nonce).toBe(trace.nonce);
    expect(trace.events).toHaveLength(7);
    expect(trace.graph.nodes).toHaveLength(7);
    expect(trace.verification.certificate.traceMerkleRoot).toBe(trace.merkleRoot);
  });

  test("flags an over-budget intent at R11 without breaking the commitment", async () => {
    const intent = createIntent({ token: "XYZ", budget: "1.00" });
    const trace = await runHumanPresent(intent, { price: "2.00" });

    expect(trace.verification.result.status).toBe("FAIL");
    expect(trace.verification.result.failedRules).toContain("R11_AMOUNT_WITHIN_MANDATE");
    expect(trace.verification.outcomes.R6_CLB_COMMITMENT_RECOMPUTES.ok).toBe(true);
    expect(trace.verification.outcomes.R8_PAYMENT_NONCE_EQUALS_HASH_C.ok).toBe(true);
  });
});

describe("orchestrator HTTP", () => {
  test("intent -> run -> trace round trip", async () => {
    const app = await buildOrchestratorServer({ logger: false });

    const created = await app.inject({ method: "POST", url: "/intent", payload: { token: "ABC" } });
    expect(created.statusCode).toBe(201);
    const intentId = created.json<{ intentId: string }>().intentId;

    const run = await app.inject({
      method: "POST",
      url: "/run-human-present",
      payload: { intentId },
    });
    expect(run.statusCode).toBe(201);
    const traceId = run.json<{ traceId: string }>().traceId;

    const fetched = await app.inject({ method: "GET", url: `/trace/${traceId}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<{ verification: { result: { status: string } } }>().verification.result.status).toBe(
      "PASS",
    );

    await app.close();
  });
});
