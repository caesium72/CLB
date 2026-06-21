import type { AgentCard, Address } from "@clb-acel/schemas";

export type AgentStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

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

export type RegisterAgentInput = {
  card: AgentCard;
  registryAddr: Address;
  chainId: number;
  agentURI?: string;
};

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

export interface Erc8004Registry {
  register(input: RegisterAgentInput): Promise<AgentRecord>;
  getAgent(agentId: string): Promise<AgentRecord | null>;
  authorizePaymentKey(agentId: string, key: Address): Promise<AgentRecord>;
  authorizeSigningKey(agentId: string, key: Address): Promise<AgentRecord>;
  setStatus(agentId: string, status: AgentStatus): Promise<AgentRecord>;
  list(): Promise<AgentRecord[]>;
}
