import {
  ATTACK_FIXTURES,
  MODE_B_PREDICATE_FIXTURES,
  buildBaselineMatrix,
  listAttacks,
  listPredicateAttacks,
  runAllAttacks,
  runAllPredicateAttacks,
  runAttack,
  runPredicateAttack,
  type AttackId,
  type PredicateAttackId,
} from "@clb-acel/attack-core";
import { registerOpenApi } from "@clb-acel/service-kit";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { z } from "zod";

type BuildAttackSimulatorServerOptions = {
  logger?: boolean | FastifyBaseLogger;
};

const passthroughBody = { type: "object", additionalProperties: true } as const;

const RunBodySchema = z.object({
  nowMs: z.number().int().positive().optional(),
});

function parseAttackId(params: unknown): AttackId {
  const attackId = (params as { attackId?: unknown }).attackId;
  if (!ATTACK_FIXTURES.some((fixture) => fixture.id === attackId)) {
    throw new Error(`Unknown attack fixture: ${String(attackId)}`);
  }
  return attackId as AttackId;
}

function parsePredicateAttackId(params: unknown): PredicateAttackId {
  const attackId = (params as { attackId?: unknown }).attackId;
  if (!MODE_B_PREDICATE_FIXTURES.some((fixture) => fixture.id === attackId)) {
    throw new Error(`Unknown attack fixture: ${String(attackId)}`);
  }
  return attackId as PredicateAttackId;
}

export async function buildAttackSimulatorServer(
  options: BuildAttackSimulatorServerOptions = {},
) {
  const app = Fastify({ logger: options.logger ?? true });
  let latestBenchmark: Awaited<ReturnType<typeof runAllAttacks>> | null = null;
  let latestP5Benchmark: Awaited<ReturnType<typeof runAllPredicateAttacks>> | null = null;

  await registerOpenApi(app, {
    title: "CLB-ACEL Attack Simulator",
    description: "Phase 3 attack fixtures, baseline matrix, and benchmark metrics.",
  });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  });

  app.options("/*", async (_request, reply) => reply.code(204).send());

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "Invalid request body", issues: error.issues });
    }
    const message = error instanceof Error ? error.message : "Internal error";
    const status = message.startsWith("Unknown attack fixture") ? 404 : 500;
    app.log.error(error);
    return reply.code(status).send({ error: message });
  });

  app.get("/health", async () => ({ ok: true, service: "attack-simulator" }));

  app.get("/attacks", { schema: { summary: "List available attack fixtures" } }, async () => ({
    attacks: listAttacks(),
  }));

  app.post(
    "/attacks/:attackId/run",
    { schema: { summary: "Run a single attack fixture", body: passthroughBody } },
    async (request, reply) => {
      const attackId = parseAttackId(request.params);
      const body = RunBodySchema.parse(request.body ?? {});
      const result = await runAttack(attackId, body);
      return reply.code(200).send(result);
    },
  );

  app.post(
    "/benchmark",
    {
      schema: {
        summary: "Run all attack fixtures and build the baseline matrix",
        body: passthroughBody,
      },
    },
    async (request, reply) => {
      const body = RunBodySchema.parse(request.body ?? {});
      latestBenchmark = await runAllAttacks(body);
      return reply.code(200).send(latestBenchmark);
    },
  );

  app.get(
    "/benchmark/latest",
    { schema: { summary: "Return latest in-memory benchmark" } },
    async (_request, reply) => {
      if (!latestBenchmark) {
        return reply.code(404).send({ error: "No benchmark has been run yet" });
      }
      return latestBenchmark;
    },
  );

  app.get("/benchmark/matrix", { schema: { summary: "Return the baseline matrix" } }, async () => {
    if (!latestBenchmark) {
      latestBenchmark = await runAllAttacks();
    }
    return { matrix: buildBaselineMatrix(latestBenchmark.results, ATTACK_FIXTURES) };
  });

  // --- Mode B / P5 predicate attacks (Phase 4 follow-up) -------------------

  app.get(
    "/attacks/predicate",
    { schema: { summary: "List Mode B predicate (P5) attack fixtures" } },
    async () => ({ attacks: listPredicateAttacks() }),
  );

  app.post(
    "/attacks/predicate/:attackId/run",
    { schema: { summary: "Run a single predicate (P5) fixture", body: passthroughBody } },
    async (request, reply) => {
      const attackId = parsePredicateAttackId(request.params);
      const result = await runPredicateAttack(attackId);
      return reply.code(200).send(result);
    },
  );

  app.post(
    "/benchmark/predicate",
    { schema: { summary: "Run all predicate fixtures + build the P5 matrix", body: passthroughBody } },
    async (_request, reply) => {
      latestP5Benchmark = await runAllPredicateAttacks();
      return reply.code(200).send(latestP5Benchmark);
    },
  );

  app.get(
    "/benchmark/predicate/matrix",
    { schema: { summary: "Return the P5 baseline matrix" } },
    async () => {
      if (!latestP5Benchmark) {
        latestP5Benchmark = await runAllPredicateAttacks();
      }
      return { matrix: latestP5Benchmark.matrix };
    },
  );

  return app;
}
