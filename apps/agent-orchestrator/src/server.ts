import { registerOpenApi } from "@clb-acel/service-kit";
import {
  ATTACK_FIXTURES,
  MODE_B_PREDICATE_FIXTURES,
  runAttack,
  runPredicateAttack,
  type AttackId,
  type PredicateAttackId,
} from "@clb-acel/attack-core";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { z } from "zod";
import {
  createIntent,
  runDelegated,
  runHumanPresent,
  type Intent,
  type ModeBTraceResult,
  type TraceResult,
} from "./flow";
import {
  discoverAgentsForIntent,
  prepareDelegatedOverHttp,
  prepareHumanPresentOverHttp,
  quoteForIntent,
  runDelegatedOverHttp,
  runHumanPresentOverHttp,
} from "./http-flow";

type BuildOrchestratorServerOptions = {
  logger?: boolean | FastifyBaseLogger;
};

const passthroughBody = { type: "object", additionalProperties: true } as const;

const IntentBodySchema = z.object({
  token: z.string().min(1),
  task: z.string().optional(),
  budget: z.string().optional(),
  asset: z.string().optional(),
  network: z.string().optional(),
  intentId: z.string().optional(),
});

const RunBodySchema = z.object({
  intentId: z.string().optional(),
  mandateId: z.string().optional(),
  token: z.string().optional(),
  task: z.string().optional(),
  budget: z.string().optional(),
  asset: z.string().optional(),
  network: z.string().optional(),
  transport: z.enum(["in-process", "http"]).optional(),
});

const AgentDiscoverBodySchema = z.object({
  intentId: z.string().min(1),
});

const AgentQuoteBodySchema = z.object({
  intentId: z.string().min(1),
  mode: z.enum(["a", "b"]).default("a"),
});

const PrepareBodySchema = RunBodySchema.extend({
  mode: z.enum(["a", "b"]).optional(),
  humanPrincipal: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/u)
    .optional(),
});

const AttackBodySchema = z.object({
  transport: z.enum(["in-process", "http"]).optional(),
  nowMs: z.number().int().positive().optional(),
});

function parseAttackName(params: unknown): AttackId {
  const attackName = (params as { attackName?: unknown }).attackName;
  if (!ATTACK_FIXTURES.some((fixture) => fixture.id === attackName)) {
    throw new Error(`Unknown attack fixture: ${String(attackName)}`);
  }
  return attackName as AttackId;
}

function parsePredicateAttackName(params: unknown): PredicateAttackId {
  const attackName = (params as { attackName?: unknown }).attackName;
  if (!MODE_B_PREDICATE_FIXTURES.some((fixture) => fixture.id === attackName)) {
    throw new Error(`Unknown attack fixture: ${String(attackName)}`);
  }
  return attackName as PredicateAttackId;
}

export async function buildOrchestratorServer(options: BuildOrchestratorServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const intents = new Map<string, Intent>();
  const traces = new Map<string, TraceResult>();
  const delegatedTraces = new Map<string, ModeBTraceResult>();

  await registerOpenApi(app, {
    title: "CLB-ACEL Agent Orchestrator",
    description: "Coordinates the Mode A human-present flow across the protocol layers.",
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "Invalid request body", issues: error.issues });
    }
    const message = error instanceof Error ? error.message : "Internal error";
    if (message.startsWith("Unknown attack fixture")) {
      return reply.code(404).send({ error: message });
    }
    app.log.error(error);
    return reply.code(500).send({ error: message });
  });

  app.get("/health", async () => ({ ok: true, service: "agent-orchestrator" }));

  app.post(
    "/intent",
    { schema: { summary: "Create a user intent", body: passthroughBody } },
    async (request, reply) => {
      const body = IntentBodySchema.parse(request.body);
      const intent = createIntent(body);
      intents.set(intent.intentId, intent);
      return reply.code(201).send(intent);
    },
  );

  app.post(
    "/attack/:attackName",
    { schema: { summary: "Run a Phase 3 attack fixture", body: passthroughBody } },
    async (request, reply) => {
      const attackName = parseAttackName(request.params);
      const body = AttackBodySchema.parse(request.body ?? {});
      if (body.transport === "http") {
        request.log.warn("HTTP attack transport requested; using deterministic in-process fixtures for Phase 3");
      }
      const result = await runAttack(attackName, { nowMs: body.nowMs });
      return reply.code(200).send({
        ...result,
        traceSummary: {
          traceId: result.traceId,
          status: result.verification.result.status,
          failedRules: result.verification.result.failedRules,
          preventionLayer: result.preventionLayer,
        },
      });
    },
  );

  app.post(
    "/attack/predicate/:attackName",
    { schema: { summary: "Run a Phase 4 predicate (P5) attack fixture", body: passthroughBody } },
    async (request, reply) => {
      const attackName = parsePredicateAttackName(request.params);
      const result = await runPredicateAttack(attackName);
      return reply.code(200).send({
        ...result,
        traceSummary: {
          traceId: result.traceId,
          status: result.verification.result.status,
          failedRules: result.verification.result.failedRules,
          preventionLayer: result.preventionLayer,
        },
      });
    },
  );

  app.post(
    "/agent/discover",
    { schema: { summary: "Discover merchant agents for an intent (Phase 5b narrative)", body: passthroughBody } },
    async (request, reply) => {
      const body = AgentDiscoverBodySchema.parse(request.body ?? {});
      const intent = intents.get(body.intentId);
      if (!intent) {
        return reply.code(404).send({ error: `Intent not found: ${body.intentId}` });
      }
      const discovery = await discoverAgentsForIntent(intent);
      return reply.code(200).send(discovery);
    },
  );

  app.post(
    "/agent/quote",
    { schema: { summary: "Fetch cart or delegation quote for an intent (Phase 5b narrative)", body: passthroughBody } },
    async (request, reply) => {
      const body = AgentQuoteBodySchema.parse(request.body ?? {});
      const intent = intents.get(body.intentId);
      if (!intent) {
        return reply.code(404).send({ error: `Intent not found: ${body.intentId}` });
      }
      const quote = await quoteForIntent(intent, body.mode);
      return reply.code(200).send(quote);
    },
  );

  app.post(
    "/run-human-present",
    { schema: { summary: "Run the Mode A human-present flow", body: passthroughBody }, },
    async (request, reply) => {
      const body = RunBodySchema.parse(request.body ?? {});

      const intent =
        (body.intentId ? intents.get(body.intentId) : undefined) ??
        createIntent({
          token: body.token ?? "XYZ",
          ...(body.task ? { task: body.task } : {}),
          ...(body.budget ? { budget: body.budget } : {}),
          ...(body.asset ? { asset: body.asset } : {}),
          ...(body.network ? { network: body.network } : {}),
        });
      intents.set(intent.intentId, intent);

      const trace =
        body.transport === "http" || process.env.ORCHESTRATOR_TRANSPORT?.trim() === "http"
          ? await runHumanPresentOverHttp(intent, { ...(body.mandateId ? { mandateId: body.mandateId } : {}) })
          : await runHumanPresent(intent);
      traces.set(trace.traceId, trace);
      return reply.code(201).send(trace);
    },
  );

  app.post(
    "/prepare/human-present",
    { schema: { summary: "Prepare a Mode A wallet-signing payload", body: passthroughBody } },
    async (request, reply) => {
      const body = PrepareBodySchema.parse(request.body ?? {});
      const intent =
        (body.intentId ? intents.get(body.intentId) : undefined) ??
        createIntent({
          token: body.token ?? "XYZ",
          ...(body.task ? { task: body.task } : {}),
          ...(body.budget ? { budget: body.budget } : {}),
          ...(body.asset ? { asset: body.asset } : {}),
          ...(body.network ? { network: body.network } : {}),
        });
      intents.set(intent.intentId, intent);
      const prepared = await prepareHumanPresentOverHttp(intent, {
        ...(body.humanPrincipal ? { humanPrincipal: body.humanPrincipal as `0x${string}` } : {}),
      });
      return reply.code(200).send({ intent, ...prepared });
    },
  );

  app.post(
    "/prepare/delegated",
    { schema: { summary: "Prepare a Mode B predicate wallet-signing payload", body: passthroughBody } },
    async (request, reply) => {
      const body = PrepareBodySchema.parse(request.body ?? {});
      const intent =
        (body.intentId ? intents.get(body.intentId) : undefined) ??
        createIntent({
          token: body.token ?? "XYZ",
          ...(body.task ? { task: body.task } : {}),
          ...(body.budget ? { budget: body.budget } : {}),
          ...(body.asset ? { asset: body.asset } : {}),
          ...(body.network ? { network: body.network } : {}),
        });
      intents.set(intent.intentId, intent);
      const prepared = await prepareDelegatedOverHttp(intent, {
        ...(body.humanPrincipal ? { humanPrincipal: body.humanPrincipal as `0x${string}` } : {}),
      });
      return reply.code(200).send({ intent, ...prepared });
    },
  );

  app.post(
    "/run-delegated",
    { schema: { summary: "Run the Mode B delegated/predicate flow", body: passthroughBody } },
    async (request, reply) => {
      const body = RunBodySchema.parse(request.body ?? {});

      const intent =
        (body.intentId ? intents.get(body.intentId) : undefined) ??
        createIntent({
          token: body.token ?? "XYZ",
          ...(body.task ? { task: body.task } : {}),
          ...(body.budget ? { budget: body.budget } : {}),
          ...(body.asset ? { asset: body.asset } : {}),
          ...(body.network ? { network: body.network } : {}),
        });
      intents.set(intent.intentId, intent);

      const trace =
        body.transport === "http" || process.env.ORCHESTRATOR_TRANSPORT?.trim() === "http"
          ? await runDelegatedOverHttp(intent, { ...(body.mandateId ? { mandateId: body.mandateId } : {}) })
          : await runDelegated(intent);
      delegatedTraces.set(trace.traceId, trace);
      return reply.code(201).send(trace);
    },
  );

  app.get(
    "/trace/:traceId",
    { schema: { summary: "Fetch an assembled trace and its verification" } },
    async (request, reply) => {
      const { traceId } = request.params as { traceId: string };
      const trace = traces.get(traceId) ?? delegatedTraces.get(traceId);
      if (!trace) {
        return reply.code(404).send({ error: "Trace not found" });
      }
      return trace;
    },
  );

  app.get(
    "/traces",
    { schema: { summary: "List assembled trace ids" } },
    async () => ({ traceIds: [...traces.keys(), ...delegatedTraces.keys()] }),
  );

  return app;
}
