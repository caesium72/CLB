import { issueMandate, verifyMandate, type IssueMandateInput } from "@clb-acel/ap2-adapter";
import type { CLBCommitmentInput, Mandate } from "@clb-acel/schemas";
import {
  IdentityRefSchema,
  MandateConstraintsSchema,
  MandateSchema,
  PredicateDescriptorSchema,
  SettlementDescriptorExactSchema,
} from "@clb-acel/schemas";
import { registerOpenApi } from "@clb-acel/service-kit";
import Fastify, { type FastifyBaseLogger } from "fastify";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

/** Anvil default account #0 — test-only human-principal signing key. */
const DEFAULT_USER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

type BuildMandateServerOptions = {
  userPrivateKey?: Hex;
  logger?: boolean | FastifyBaseLogger;
};

const ClbDomainSchema = z.object({
  name: z.literal("CLB-ACEL"),
  version: z.literal("0.1"),
  chainId: z.number().int().positive(),
  verifyingContract: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/u)
    .optional(),
});

const IntentBodySchema = z.object({
  mandateId: z.string().min(1).optional(),
  authorizedAgent: IdentityRefSchema,
  constraints: MandateConstraintsSchema,
  humanPrincipal: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/u)
    .optional(),
  parentMandateHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/u)
    .optional(),
  /** Delegated (Mode B) spending predicate the human authorizes. */
  predicate: PredicateDescriptorSchema.optional(),
});

const SettlementBodySchema = IntentBodySchema.extend({
  settlementDescriptor: SettlementDescriptorExactSchema,
  domain: ClbDomainSchema.optional(),
});

const VerifyBodySchema = z.object({
  mandate: MandateSchema,
  clb: z
    .object({
      identityRef: IdentityRefSchema,
      // Exact descriptor (Mode A) or predicate descriptor (Mode B).
      settlementDescriptor: z.union([SettlementDescriptorExactSchema, PredicateDescriptorSchema]),
      domain: ClbDomainSchema,
    })
    .optional(),
  expectedSigner: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/u)
    .optional(),
});

const RegisterBodySchema = z.union([
  MandateSchema,
  z.object({
    mandate: MandateSchema,
    clb: z
      .object({
        identityRef: IdentityRefSchema,
        settlementDescriptor: z.union([SettlementDescriptorExactSchema, PredicateDescriptorSchema]),
        domain: ClbDomainSchema,
      })
      .optional(),
    expectedSigner: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/u)
      .optional(),
  }),
]);

const passthroughBody = { type: "object", additionalProperties: true } as const;

export async function buildMandateServer(options: BuildMandateServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const envUserKey = process.env.USER_TEST_PRIVATE_KEY?.trim();
  const userPrivateKey =
    options.userPrivateKey ?? (envUserKey ? (envUserKey as Hex) : DEFAULT_USER_PRIVATE_KEY);
  const defaultChainId = Number(process.env.CHAIN_ID ?? 84532);
  const store = new Map<string, Mandate>();

  await registerOpenApi(app, {
    title: "CLB-ACEL Mandate Service",
    description: "AP2-style INTENT/CART/PAYMENT mandates bound to the CLB commitment.",
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "Invalid request body", issues: error.issues });
    }
    app.log.error(error);
    return reply.code(500).send({ error: error instanceof Error ? error.message : "Internal error" });
  });

  app.get("/health", async () => ({
    ok: true,
    service: "mandate-service",
    humanPrincipal: privateKeyToAccount(userPrivateKey).address,
  }));

  async function issueAndStore(input: IssueMandateInput): Promise<Mandate> {
    const mandate = await issueMandate(userPrivateKey, input);
    store.set(mandate.mandateId, mandate);
    return mandate;
  }

  app.post(
    "/mandates/intent",
    { schema: { summary: "Issue an AP2 INTENT mandate", body: passthroughBody } },
    async (request, reply) => {
      const body = IntentBodySchema.parse(request.body);
      const mandate = await issueAndStore({
        type: "INTENT",
        ...(body.mandateId ? { mandateId: body.mandateId } : {}),
        authorizedAgent: body.authorizedAgent,
        constraints: body.constraints,
        ...(body.humanPrincipal ? { humanPrincipal: body.humanPrincipal as Hex } : {}),
        ...(body.parentMandateHash ? { parentMandateHash: body.parentMandateHash as Hex } : {}),
        ...(body.predicate ? { predicate: body.predicate } : {}),
      });
      return reply.code(201).send(mandate);
    },
  );

  function settlementClb(body: z.infer<typeof SettlementBodySchema>): Omit<
    CLBCommitmentInput,
    "mandateDigest"
  > {
    return {
      identityRef: body.authorizedAgent,
      settlementDescriptor: body.settlementDescriptor,
      domain: body.domain ?? { name: "CLB-ACEL", version: "0.1", chainId: defaultChainId },
    };
  }

  for (const type of ["cart", "payment"] as const) {
    app.post(
      `/mandates/${type}`,
      {
        schema: {
          summary: `Issue an AP2 ${type.toUpperCase()} mandate bound to C`,
          body: passthroughBody,
        },
      },
      async (request, reply) => {
        const body = SettlementBodySchema.parse(request.body);
        const mandate = await issueAndStore({
          type: type === "cart" ? "CART" : "PAYMENT",
          ...(body.mandateId ? { mandateId: body.mandateId } : {}),
          authorizedAgent: body.authorizedAgent,
          constraints: body.constraints,
          ...(body.humanPrincipal ? { humanPrincipal: body.humanPrincipal as Hex } : {}),
          ...(body.parentMandateHash ? { parentMandateHash: body.parentMandateHash as Hex } : {}),
          clb: settlementClb(body),
        });
        return reply.code(201).send(mandate);
      },
    );
  }

  app.post(
    "/mandates/verify",
    { schema: { summary: "Verify a mandate signature and CLB binding", body: passthroughBody } },
    async (request) => {
      const body = VerifyBodySchema.parse(request.body);
      return verifyMandate(body.mandate, {
        ...(body.clb ? { clb: body.clb } : {}),
        ...(body.expectedSigner ? { expectedSigner: body.expectedSigner as Hex } : {}),
      });
    },
  );

  app.post(
    "/mandates/register",
    { schema: { summary: "Register an externally signed AP2 mandate", body: passthroughBody } },
    async (request, reply) => {
      const parsed = RegisterBodySchema.parse(request.body);
      const body = "mandate" in parsed ? parsed : { mandate: parsed };
      const verification = await verifyMandate(body.mandate, {
        ...(body.clb ? { clb: body.clb } : {}),
        ...(body.expectedSigner ? { expectedSigner: body.expectedSigner as Hex } : {}),
      });

      if (!verification.valid) {
        return reply.code(400).send({
          error: "Mandate signature or CLB binding is invalid",
          verification,
        });
      }

      store.set(body.mandate.mandateId, body.mandate);
      return reply.code(201).send({ mandate: body.mandate, verification });
    },
  );

  app.get(
    "/mandates/:mandateId",
    { schema: { summary: "Fetch a stored mandate by id" } },
    async (request, reply) => {
      const { mandateId } = request.params as { mandateId: string };
      const mandate = store.get(mandateId);
      if (!mandate) {
        return reply.code(404).send({ error: "Mandate not found" });
      }
      return mandate;
    },
  );

  return app;
}
