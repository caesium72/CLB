import {
  createValidationRegistry,
  type ValidationEnv,
  type ValidationRegistry,
} from "@clb-acel/erc8004-adapter";
import { registerOpenApi } from "@clb-acel/service-kit";
import {
  verifyTrace,
  type TraceBundle,
  type VerifyTraceOutput,
} from "@clb-acel/verifier-core";
import Fastify, { type FastifyBaseLogger } from "fastify";
import type { Address } from "viem";

type BuildVerifierServerOptions = {
  logger?: boolean | FastifyBaseLogger;
  /** Inject a validation registry (tests pass mock); defaults to the env-selected adapter. */
  validationRegistry?: ValidationRegistry;
};

/** Env-selected validation adapter: mock (default/offline) | onchain (our CrossLayerBindingValidator) | canonical (gated by O1). */
function validationRegistryFromEnv(): ValidationRegistry {
  return createValidationRegistry({
    mode: process.env.VALIDATION_REGISTRY_MODE?.trim() as ValidationEnv["mode"],
    rpcUrl: process.env.RPC_URL_BASE_SEPOLIA?.trim(),
    chainId: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined,
    validatorAddr: process.env.CLB_VALIDATOR_ADDRESS?.trim() as ValidationEnv["validatorAddr"],
    validationRegistryAddr: process.env.VALIDATION_REGISTRY_CANONICAL?.trim() as ValidationEnv["validationRegistryAddr"],
    deployerKey: process.env.DEPLOYER_PRIVATE_KEY?.trim() as ValidationEnv["deployerKey"],
    canonicalValidationConfirmed: process.env.O1_VALIDATION_CONFIRMED === "true",
  });
}

const bundleBodySchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    /** Independently anchored human signer; never read from bundle.mandate. */
    expectedHumanPrincipal: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
  },
} as const;

/**
 * Demo anchor for local/CI callers that predate this field. In a real deployment
 * set VERIFIER_HUMAN_PRINCIPAL (or pass an injected anchor) from the human
 * registry; the value below is the address of the fixtures' honest test signer,
 * not anything read out of the submitted bundle.
 */
const DEMO_HUMAN_PRINCIPAL = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

function resolveHumanPrincipal(body: unknown): Address {
  const configured = process.env.VERIFIER_HUMAN_PRINCIPAL?.trim();
  const fromBody = (body as { expectedHumanPrincipal?: unknown } | null)?.expectedHumanPrincipal;
  const candidate = configured ?? (typeof fromBody === "string" ? fromBody : undefined);
  if (candidate && /^0x[0-9a-fA-F]{40}$/u.test(candidate)) {
    return candidate as Address;
  }
  return DEMO_HUMAN_PRINCIPAL;
}

function getTraceId(params: unknown): string {
  const traceId = (params as { traceId?: unknown }).traceId;
  if (typeof traceId !== "string" || traceId.length === 0) {
    throw new Error("traceId is required");
  }
  return traceId;
}

export async function buildVerifierServer(options: BuildVerifierServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const store = new Map<string, VerifyTraceOutput>();
  const validationRegistry = options.validationRegistry ?? validationRegistryFromEnv();

  await registerOpenApi(app, {
    title: "CLB-ACEL Verifier Service",
    description: "Deterministic Mode A verifier (rules R1-R14). No LLM verification.",
  });

  app.get("/health", async () => ({ ok: true, service: "verifier-service" }));

  app.post(
    "/verify/:traceId",
    { schema: { summary: "Verify a trace bundle and store its certificate", body: bundleBodySchema } },
    async (request, reply) => {
      const traceId = getTraceId(request.params);
      const expectedHumanPrincipal = resolveHumanPrincipal(request.body);
      const { expectedHumanPrincipal: _anchor, ...bundleBody } = (request.body ?? {}) as TraceBundle & {
        expectedHumanPrincipal?: string;
      };
      void _anchor;
      const bundle = { ...bundleBody, traceId };
      const output = await verifyTrace(bundle, { expectedHumanPrincipal });
      store.set(traceId, output);

      // On PASS, emit a validation entry via the selected adapter. On FAIL, emit nothing.
      // The certificate fields map 1:1 to the canonical validationResponse (see validation-registry).
      if (output.result.status === "PASS") {
        const cert = output.certificate;
        try {
          await validationRegistry.record({
            traceId,
            certificateHash: cert.certificateHash,
            result: true,
            merkleRoot: cert.traceMerkleRoot,
            settlementTxHash: cert.settlementTxHash ?? "",
            responseURI: `/verify/${traceId}/certificate`,
          });
        } catch (error) {
          // A validation-write failure must not fail the verification response itself.
          app.log.error({ err: error, traceId }, "validation emit failed");
        }
      }

      return reply.code(200).send({
        result: output.result,
        certificate: output.certificate,
        outcomes: output.outcomes,
      });
    },
  );

  app.get(
    "/verify/:traceId/result",
    { schema: { summary: "Fetch the stored verification result" } },
    async (request, reply) => {
      const output = store.get(getTraceId(request.params));
      if (!output) {
        return reply.code(404).send({ error: "No verification result for trace" });
      }
      return { result: output.result, outcomes: output.outcomes };
    },
  );

  app.get(
    "/verify/:traceId/certificate",
    { schema: { summary: "Fetch the stored verification certificate" } },
    async (request, reply) => {
      const output = store.get(getTraceId(request.params));
      if (!output) {
        return reply.code(404).send({ error: "No verification certificate for trace" });
      }
      return output.certificate;
    },
  );

  app.get(
    "/verify/:traceId/validation",
    { schema: { summary: "Fetch the validation entry emitted for a PASSed trace" } },
    async (request, reply) => {
      const record = await validationRegistry.get(getTraceId(request.params));
      if (!record) {
        return reply.code(404).send({ error: "No validation entry for trace" });
      }
      return record;
    },
  );

  return app;
}
