import type { AgentCard, Address, IdentityRef } from "@clb-acel/schemas";
import { getAddress } from "viem";
import { computeMetadataHash, finalizeAgentCard, type AgentCardInput } from "./card";
import { createCanonicalErc8004Registry } from "./canonical-reader";
import { createOnchainErc8004Registry } from "./onchain-reader";
import type {
  AgentRecord,
  AgentStatus,
  Erc8004Registry,
  RegisterAgentInput,
} from "./types";

export * from "./types";
export { computeMetadataHash, finalizeAgentCard, type AgentCardInput } from "./card";
export { createOnchainErc8004Registry, fetchAgentCard } from "./onchain-reader";
export {
  createCanonicalErc8004Registry,
  mapCanonicalToCard,
  type CanonicalIdentityRegistry,
  type CanonicalMapInput,
  type CanonicalRegistryConfig,
} from "./canonical-reader";
export {
  createValidationRegistry,
  CLB_VALIDATOR_TAG,
  type ValidationEnv,
  type ValidationInput,
  type ValidationRecord,
  type ValidationRegistry,
} from "./validation-registry";

export function isPaymentKeyAuthorized(record: AgentRecord, key: string): boolean {
  const target = normalizeKey(key);
  return record.card.authorizedPaymentKeys.some((authorized) => normalizeKey(authorized) === target);
}

export function isSigningKeyAuthorized(record: AgentRecord, key: string): boolean {
  const target = normalizeKey(key);
  return record.card.authorizedSigningKeys.some((authorized) => normalizeKey(authorized) === target);
}

export function identityRefFor(record: AgentRecord): IdentityRef {
  return {
    chainId: record.chainId,
    registryAddr: record.registryAddr,
    agentId: record.agentId,
  };
}

function normalizeKey(key: string): Address {
  return getAddress(key);
}

export { AgentNotFoundError, MetadataHashMismatchError } from "./types";
import { AgentNotFoundError, MetadataHashMismatchError } from "./types";

export function createInMemoryErc8004Registry(): Erc8004Registry {
  const agents = new Map<string, AgentRecord>();

  function requireAgent(agentId: string): AgentRecord {
    const record = agents.get(agentId);
    if (!record) {
      throw new AgentNotFoundError(agentId);
    }
    return record;
  }

  function withCard(record: AgentRecord, card: AgentCard): AgentRecord {
    const updated: AgentRecord = {
      ...record,
      card: { ...card, metadataHash: computeMetadataHash(card) },
    };
    agents.set(record.agentId, updated);
    return updated;
  }

  return {
    async register(input) {
      if (input.card.metadataHash !== computeMetadataHash(input.card)) {
        throw new MetadataHashMismatchError(input.card.agentId);
      }

      const record: AgentRecord = {
        agentId: input.card.agentId,
        owner: getAddress(input.card.owner),
        registryAddr: getAddress(input.registryAddr),
        chainId: input.chainId,
        agentURI: input.agentURI ?? input.card.serviceEndpoints[0] ?? "",
        card: input.card,
        status: "ACTIVE",
        registeredAt: new Date().toISOString(),
      };

      agents.set(record.agentId, record);
      return record;
    },
    async getAgent(agentId) {
      return agents.get(agentId) ?? null;
    },
    async authorizePaymentKey(agentId, key) {
      const record = requireAgent(agentId);
      const normalized = normalizeKey(key);

      if (isPaymentKeyAuthorized(record, normalized)) {
        return record;
      }

      return withCard(record, {
        ...record.card,
        authorizedPaymentKeys: [...record.card.authorizedPaymentKeys, normalized],
      });
    },
    async authorizeSigningKey(agentId, key) {
      const record = requireAgent(agentId);
      const normalized = normalizeKey(key);

      if (isSigningKeyAuthorized(record, normalized)) {
        return record;
      }

      return withCard(record, {
        ...record.card,
        authorizedSigningKeys: [...record.card.authorizedSigningKeys, normalized],
      });
    },
    async setStatus(agentId, status) {
      const record = requireAgent(agentId);
      const updated: AgentRecord = { ...record, status };
      agents.set(agentId, updated);
      return updated;
    },
    async list() {
      return [...agents.values()];
    },
  };
}

export type IdentityRegistryEnv = {
  rpcUrl?: string;
  registryAddr?: Address;
  chainId?: number;
};

export type IdentityRegistry = Erc8004Registry & {
  kind: "mock" | "onchain" | "canonical";
  getCard(agentId: string): Promise<AgentCard>;
};

/** Select an on-chain reader when RPC + registry are configured; otherwise in-memory mock. */
export function createIdentityRegistry(env: IdentityRegistryEnv = {}): IdentityRegistry {
  const rpcUrl = env.rpcUrl?.trim();
  const registryAddr = env.registryAddr;
  const chainId = env.chainId ?? 84532;

  if (rpcUrl && registryAddr) {
    return createOnchainErc8004Registry({ rpcUrl, registryAddr, chainId });
  }

  const mock = createInMemoryErc8004Registry();
  return {
    ...mock,
    kind: "mock" as const,
    async getCard(agentId: string) {
      const record = await mock.getAgent(agentId);
      if (!record) {
        throw new AgentNotFoundError(agentId);
      }
      return record.card;
    },
  };
}

export function createIdentityRegistryFromEnv(): IdentityRegistry {
  const mode = process.env.ERC8004_IDENTITY_MODE?.trim();
  const rpcUrl =
    process.env.RPC_URL_BASE_SEPOLIA?.trim() ?? process.env.RPC_URL?.trim();
  const chainId = Number(process.env.CHAIN_ID ?? 84532);

  if (mode === "canonical") {
    const registryAddr = process.env.ERC8004_IDENTITY_REGISTRY_CANONICAL?.trim() as
      | Address
      | undefined;
    if (!rpcUrl || !registryAddr) {
      throw new Error(
        "canonical identity mode requires RPC_URL_BASE_SEPOLIA + ERC8004_IDENTITY_REGISTRY_CANONICAL",
      );
    }
    const canonical = createCanonicalErc8004Registry({ rpcUrl, registryAddr, chainId });
    const readOnly = (method: string): Promise<never> =>
      Promise.reject(
        new Error(
          `canonical identity registry is read-only; ${method} is not supported (use setup:register-canonical)`,
        ),
      );
    return {
      kind: "canonical",
      getCard: (agentId) => canonical.getCard(agentId),
      getAgent: (agentId) => canonical.getAgent(agentId),
      register: () => readOnly("register"),
      authorizePaymentKey: () => readOnly("authorizePaymentKey"),
      authorizeSigningKey: () => readOnly("authorizeSigningKey"),
      setStatus: () => readOnly("setStatus"),
      list: () => readOnly("list"),
    };
  }

  const registryAddr = process.env.ERC8004_REGISTRY_ADDRESS?.trim() as Address | undefined;
  return createIdentityRegistry({ rpcUrl, registryAddr, chainId });
}
