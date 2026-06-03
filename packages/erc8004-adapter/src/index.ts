import { canonicalJson } from "@clb-acel/evidence-core";
import type { AgentCard, Address, HexString, IdentityRef } from "@clb-acel/schemas";
import { getAddress, keccak256, toBytes } from "viem";

export type AgentStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

/** Agent card fields excluding the derived integrity hash. */
export type AgentCardInput = Omit<AgentCard, "metadataHash">;

/**
 * On-registry record. Mirrors the fields of `MockERC8004IdentityRegistry.sol`
 * (agentId / owner / agentURI / authorizedSigningKeys / authorizedPaymentKeys /
 * status) plus the resolved agent card and registry coordinates.
 */
export type AgentRecord = {
  agentId: string;
  owner: Address;
  registryAddr: Address;
  chainId: number;
  agentURI: string;
  card: AgentCard;
  status: AgentStatus;
  registeredAt: string;
};

/** keccak256 over the canonical JSON of the card minus its own metadataHash. */
export function computeMetadataHash(card: AgentCardInput | AgentCard): HexString {
  const { metadataHash: _metadataHash, ...rest } = card as AgentCard;
  void _metadataHash;
  return keccak256(toBytes(canonicalJson(rest)));
}

/** Attach a deterministic `metadataHash` to a card input. */
export function finalizeAgentCard(input: AgentCardInput): AgentCard {
  return { ...input, metadataHash: computeMetadataHash(input) };
}

function normalizeKey(key: string): Address {
  return getAddress(key);
}

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

export type RegisterAgentInput = {
  card: AgentCard;
  registryAddr: Address;
  chainId: number;
  agentURI?: string;
};

/**
 * Adapter interface for an ERC-8004 identity registry. The in-memory
 * implementation backs the demo; a viem contract-backed implementation can be
 * dropped in later without changing service code.
 */
export interface Erc8004Registry {
  register(input: RegisterAgentInput): Promise<AgentRecord>;
  getAgent(agentId: string): Promise<AgentRecord | null>;
  authorizePaymentKey(agentId: string, key: Address): Promise<AgentRecord>;
  authorizeSigningKey(agentId: string, key: Address): Promise<AgentRecord>;
  setStatus(agentId: string, status: AgentStatus): Promise<AgentRecord>;
  list(): Promise<AgentRecord[]>;
}

export class AgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Agent ${agentId} is not registered`);
    this.name = "AgentNotFoundError";
  }
}

export class MetadataHashMismatchError extends Error {
  constructor(agentId: string) {
    super(`Agent ${agentId} card metadataHash does not match its contents`);
    this.name = "MetadataHashMismatchError";
  }
}

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
