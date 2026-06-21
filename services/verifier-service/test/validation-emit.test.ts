import { describe, expect, test } from "bun:test";
import { breakReportHash, buildValidBundle } from "@clb-acel/attack-core";
import { createValidationRegistry } from "@clb-acel/erc8004-adapter";
import { buildVerifierServer } from "../src/server";

describe("validation emit", () => {
  test("PASS emits a validation entry retrievable by traceId; FAIL emits none", async () => {
    // Inject the mock adapter so the test is deterministic + offline regardless of env.
    const app = await buildVerifierServer({
      logger: false,
      validationRegistry: createValidationRegistry({}),
    });

    // PASS path
    const pass = await buildValidBundle({ traceId: "trace-pass" });
    const passVerify = await app.inject({ method: "POST", url: "/verify/trace-pass", payload: pass });
    expect(passVerify.json<{ result: { status: string } }>().result.status).toBe("PASS");

    const validation = await app.inject({ method: "GET", url: "/verify/trace-pass/validation" });
    expect(validation.statusCode).toBe(200);
    expect(validation.json<{ result: boolean }>().result).toBe(true);

    // read-back carries the same certificateHash the verifier produced
    const certificate = await app.inject({ method: "GET", url: "/verify/trace-pass/certificate" });
    expect(validation.json<{ certificateHash: string }>().certificateHash).toBe(
      certificate.json<{ certificateHash: string }>().certificateHash,
    );

    // FAIL path — a broken report hash fails verification; no validation entry is emitted
    const fail = breakReportHash(await buildValidBundle({ traceId: "trace-fail" }));
    const failVerify = await app.inject({ method: "POST", url: "/verify/trace-fail", payload: fail });
    expect(failVerify.json<{ result: { status: string } }>().result.status).toBe("FAIL");

    const noValidation = await app.inject({ method: "GET", url: "/verify/trace-fail/validation" });
    expect(noValidation.statusCode).toBe(404);

    await app.close();
  });
});
