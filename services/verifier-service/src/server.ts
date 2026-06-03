import { registerOpenApi } from "@clb-acel/service-kit";
import {
  verifyTrace,
  type TraceBundle,
  type VerifyTraceOutput,
} from "@clb-acel/verifier-core";
import Fastify, { type FastifyBaseLogger } from "fastify";

type BuildVerifierServerOptions = {
  logger?: boolean | FastifyBaseLogger;
};

const bundleBodySchema = { type: "object", additionalProperties: true } as const;

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
      const bundle = { ...(request.body as TraceBundle), traceId };
      const output = await verifyTrace(bundle);
      store.set(traceId, output);
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

  return app;
}
