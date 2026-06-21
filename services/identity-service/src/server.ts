import {
  AgentNotFoundError,
  MetadataHashMismatchError,
  createIdentityRegistry,
  createIdentityRegistryFromEnv,
  type Erc8004Registry,
  type IdentityRegistry,
  type RegisterAgentInput,
} from "@clb-acel/erc8004-adapter";
import { AgentCardSchema } from "@clb-acel/schemas";
import { registerOpenApi } from "@clb-acel/service-kit";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { defaultAgents } from "./seed";

export {
  createIdentityRegistry,
  createIdentityRegistryFromEnv,
  createInMemoryErc8004Registry,
} from "@clb-acel/erc8004-adapter";

type BuildIdentityServerOptions = {
  registry?: Erc8004Registry | IdentityRegistry;
  logger?: boolean | FastifyBaseLogger;
  seed?: boolean;
};

const RegisterBodySchema = z.object({
  card: AgentCardSchema,
  registryAddr: z.string().regex(/^0x[0-9a-fA-F]{40}$/u),
  chainId: z.number().int().positive(),
  agentURI: z.string().optional(),
});

const AuthorizeKeyBodySchema = z.object({
  key: z.string().regex(/^0x[0-9a-fA-F]{40}$/u),
});

const agentCardJsonSchema = {
  type: "object",
  additionalProperties: true,
} as const;

const registerBodyJsonSchema = {
  type: "object",
  required: ["card", "registryAddr", "chainId"],
  properties: {
    card: agentCardJsonSchema,
    registryAddr: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    chainId: { type: "integer" },
    agentURI: { type: "string" },
  },
} as const;

function getAgentId(params: unknown): string {
  const agentId = (params as { agentId?: unknown }).agentId;
  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new Error("agentId is required");
  }
  return agentId;
}

export async function buildIdentityServer(options: BuildIdentityServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const registry = options.registry ?? createIdentityRegistryFromEnv();

  await registerOpenApi(app, {
    title: "CLB-ACEL Identity Service",
    description: "ERC-8004 identity registry adapter (on-chain on Base Sepolia, in-memory offline).",
  });

  const shouldSeed = options.seed ?? ("kind" in registry ? registry.kind === "mock" : true);
  if (shouldSeed) {
    const seeded = await registry.list();
    if (seeded.length === 0) {
      for (const agent of defaultAgents()) {
        await registry.register(agent);
      }
    }
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AgentNotFoundError) {
      return reply.code(404).send({ error: error.message });
    }
    if (error instanceof MetadataHashMismatchError) {
      return reply.code(422).send({ error: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "Invalid request body", issues: error.issues });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.get("/health", async () => ({ ok: true, service: "identity-service" }));

  app.post(
    "/agents/register",
    { schema: { summary: "Register an ERC-8004 agent identity", body: registerBodyJsonSchema } },
    async (request, reply) => {
      const parsed: RegisterAgentInput = RegisterBodySchema.parse(request.body);
      const record = await registry.register(parsed);
      return reply.code(201).send(record);
    },
  );

  app.get(
    "/agents",
    { schema: { summary: "List registered agents" } },
    async () => ({ agents: await registry.list() }),
  );

  app.get(
    "/agents/:agentId",
    { schema: { summary: "Resolve an agent record by id" } },
    async (request, reply) => {
      const record = await registry.getAgent(getAgentId(request.params));
      if (!record) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      return record;
    },
  );

  app.get(
    "/agents/:agentId/card",
    { schema: { summary: "Get the agent card for an agent" } },
    async (request, reply) => {
      const record = await registry.getAgent(getAgentId(request.params));
      if (!record) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      return record.card;
    },
  );

  app.post(
    "/agents/:agentId/authorize-payment-key",
    { schema: { summary: "Authorize an additional payment key for an agent" } },
    async (request) => {
      const { key } = AuthorizeKeyBodySchema.parse(request.body);
      return registry.authorizePaymentKey(getAgentId(request.params), key as `0x${string}`);
    },
  );

  app.get(
    "/.well-known/agent-card.json",
    { schema: { summary: "Host the default (or ?agentId) agent card" } },
    async (request, reply) => {
      const query = request.query as { agentId?: string };
      const agents = await registry.list();
      const record = query.agentId
        ? await registry.getAgent(query.agentId)
        : (agents[0] ?? null);

      if (!record) {
        return reply.code(404).send({ error: "No agent card available" });
      }
      return record.card;
    },
  );

  return app;
}
