import { buildEvidenceGraph, buildMerkleRoot } from "@clb-acel/evidence-core";
import {
  AGENTIC_AUDIT_ANCHOR_ABI,
  computeTraceHash,
  createAnchorClientFromEnv,
  traceIdToBytes32,
  type AnchorClient,
  type AnchorTraceResult,
} from "@clb-acel/anchor-core";
import { createPublicClient, http, type Address } from "viem";
import { EvidenceEventSchema } from "@clb-acel/schemas";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import {
  createInMemoryEvidenceRepository,
  createPostgresEvidenceRepository,
  type EvidenceRepository,
} from "./repository";

export { createInMemoryEvidenceRepository };

type BuildEvidenceServerOptions = {
  repository?: EvidenceRepository;
  anchorClient?: AnchorClient | null;
  logger?: boolean | FastifyBaseLogger;
};

const eventBodySchema = {
  type: "object",
  required: [
    "traceId",
    "eventId",
    "protocol",
    "objectType",
    "actor",
    "timestamp",
    "objectHash",
    "publicFields",
    "signature",
  ],
  properties: {
    traceId: { type: "string" },
    eventId: { type: "string" },
    protocol: {
      type: "string",
      enum: ["USER", "ERC8004", "AP2", "ACP", "X402", "CHAIN", "DELIVERY", "VERIFIER", "ATTACK"],
    },
    objectType: { type: "string" },
    actor: { type: "string" },
    timestamp: { type: "string", format: "date-time" },
    objectHash: { type: "string", pattern: "^0x[0-9a-fA-F]+$" },
    previousEventHash: { type: "string", pattern: "^0x[0-9a-fA-F]+$" },
    publicFields: { type: "object", additionalProperties: true },
    privateRef: { type: "string" },
    signature: { type: "string", pattern: "^0x[0-9a-fA-F]+$" },
  },
} as const;

function getTraceId(params: unknown): string {
  const traceId = (params as { traceId?: unknown }).traceId;

  if (typeof traceId !== "string" || traceId.length === 0) {
    throw new Error("traceId is required");
  }

  return traceId;
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Add your Neon connection string to the repo root .env file.",
    );
  }

  return databaseUrl;
}

export async function buildEvidenceServer(options: BuildEvidenceServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const repository =
    options.repository ?? (await createPostgresEvidenceRepository(requireDatabaseUrl()));
  const anchorClient =
    options.anchorClient === undefined ? createAnchorClientFromEnv() : options.anchorClient;

  app.addHook("onClose", async () => {
    await repository.close();
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "CLB-ACEL Evidence Service",
        version: "0.1.0",
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  app.get("/health", async () => ({ ok: true, service: "evidence-service" }));

  app.post(
    "/events",
    {
      schema: {
        summary: "Append an evidence event to a trace",
        body: eventBodySchema,
      },
    },
    async (request, reply) => {
      const parsed = EvidenceEventSchema.parse(request.body);
      const stored = await repository.appendEvent(parsed);

      return reply.code(201).send(stored);
    },
  );

  app.get("/traces/:traceId", async (request) => {
    const traceId = getTraceId(request.params);
    const events = await repository.getTraceEvents(traceId);

    return {
      traceId,
      events: events.map((stored) => stored.event),
      eventHashes: events.map((stored) => stored.eventHash),
    };
  });

  app.get("/traces/:traceId/graph", async (request) => {
    const traceId = getTraceId(request.params);
    const events = await repository.getTraceEvents(traceId);

    return buildEvidenceGraph(events.map((stored) => stored.event));
  });

  app.post("/traces/:traceId/merkle", async (request) => {
    const traceId = getTraceId(request.params);
    const events = await repository.getTraceEvents(traceId);
    const eventHashes = events.map((stored) => stored.eventHash);

    return {
      traceId,
      eventHashes,
      merkleRoot: buildMerkleRoot(eventHashes),
    };
  });

  app.get("/traces/:traceId/anchor/status", async (request, reply) => {
    const traceId = getTraceId(request.params);
    const events = await repository.getTraceEvents(traceId);
    const eventHashes = events.map((stored) => stored.eventHash);
    const merkleRoot = buildMerkleRoot(eventHashes);
    const traceHash = computeTraceHash({ traceId, merkleRoot, eventHashes });
    const contractAddress = process.env.AUDIT_ANCHOR_ADDRESS?.trim() as Address | undefined;
    const rpcUrl = process.env.RPC_URL?.trim();
    const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
    const chainId = Number(process.env.CHAIN_ID ?? 31337);
    const configured = Boolean(contractAddress && rpcUrl && deployerPrivateKey);
    let anchored = false;
    let readError: string | undefined;

    if (contractAddress && rpcUrl) {
      try {
        const client = createPublicClient({
          chain: {
            id: chainId,
            name: chainId === 31337 ? "Anvil Local" : `Chain ${chainId}`,
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: { default: { http: [rpcUrl] } },
          },
          transport: http(rpcUrl),
        });
        anchored = await client.readContract({
          address: contractAddress,
          abi: AGENTIC_AUDIT_ANCHOR_ABI,
          functionName: "isAnchored",
          args: [traceIdToBytes32(traceId)],
        });
      } catch (error) {
        readError = error instanceof Error ? error.message : "Anchor read failed";
      }
    }

    return reply.send({
      traceId,
      eventHashes,
      merkleRoot,
      traceHash,
      chainId,
      contractAddress,
      configured,
      anchored,
      readError,
      requirements: {
        AUDIT_ANCHOR_ADDRESS: Boolean(contractAddress),
        RPC_URL: Boolean(rpcUrl),
        DEPLOYER_PRIVATE_KEY: Boolean(deployerPrivateKey),
      },
    });
  });

  app.post("/traces/:traceId/anchor", async (request, reply) => {
    const traceId = getTraceId(request.params);
    const events = await repository.getTraceEvents(traceId);
    const eventHashes = events.map((stored) => stored.eventHash);
    const merkleRoot = buildMerkleRoot(eventHashes);
    const body = (request.body ?? {}) as { traceHash?: string };
    const traceHash = (body.traceHash ?? computeTraceHash({ traceId, merkleRoot, eventHashes })) as `0x${string}`;

    if (!anchorClient) {
      return reply.code(202).send({
        traceId,
        eventHashes,
        merkleRoot,
        traceHash,
        status: "PENDING_CONTRACT",
        message: "Set AUDIT_ANCHOR_ADDRESS, RPC_URL, and DEPLOYER_PRIVATE_KEY to anchor on-chain.",
      });
    }

    try {
      const anchored: AnchorTraceResult = await anchorClient.anchorTrace({
        traceId,
        merkleRoot,
        traceHash,
      });

      return reply.code(201).send({
        traceId,
        eventHashes,
        merkleRoot,
        traceHash,
        status: anchored.status,
        txHash: anchored.txHash,
        contractAddress: anchored.contractAddress,
        metadataURI: anchored.metadataURI,
      });
    } catch (error) {
      return reply.code(409).send({
        traceId,
        merkleRoot,
        traceHash,
        status: "ANCHOR_FAILED",
        error: error instanceof Error ? error.message : "Anchor failed",
      });
    }
  });

  return app;
}
