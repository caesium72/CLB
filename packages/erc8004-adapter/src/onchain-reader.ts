import type { AgentCard, Address } from "@clb-acel/schemas";
import { AgentCardSchema } from "@clb-acel/schemas";
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  type Hex,
} from "viem";
import { computeMetadataHash, finalizeAgentCard } from "./card";
import {
  AgentNotFoundError,
  type AgentRecord,
  type AgentStatus,
  type Erc8004Registry,
  type RegisterAgentInput,
} from "./types";

const MOCK_ERC8004_ABI = [
  {
    type: "function",
    name: "getAgent",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "agentURI", type: "string" },
      { name: "status", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "getAuthorizedPaymentKeys",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "getAuthorizedSigningKeys",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [{ name: "", type: "address[]" }],
  },
] as const;

const STATUS_BY_CODE: Record<number, AgentStatus> = {
  1: "ACTIVE",
  2: "SUSPENDED",
  3: "REVOKED",
};

export type OnchainRegistryConfig = {
  rpcUrl: string;
  registryAddr: Address;
  chainId: number;
};

export async function fetchAgentCard(uri: string): Promise<AgentCard> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to fetch agent card from ${uri} (${response.status})`);
  }
  const json = (await response.json()) as unknown;
  return AgentCardSchema.parse(json);
}

function overlayOnchainKeys(
  card: AgentCard,
  paymentKeys: Address[],
  signingKeys: Address[],
): AgentCard {
  const { metadataHash: _metadataHash, ...rest } = card;
  void _metadataHash;
  return finalizeAgentCard({
    ...rest,
    authorizedPaymentKeys: paymentKeys.map((key) => getAddress(key)),
    authorizedSigningKeys: signingKeys.map((key) => getAddress(key)),
  });
}

function readOnlyError(method: string): Error {
  return new Error(`On-chain registry is read-only; ${method} is not supported`);
}

/** viem-backed registry reader for `MockERC8004IdentityRegistry` / ERC-8004 on Base Sepolia. */
export function createOnchainErc8004Registry(config: OnchainRegistryConfig): Erc8004Registry & {
  kind: "onchain";
  getCard(agentId: string): Promise<AgentCard>;
} {
  const chain = defineChain({
    id: config.chainId,
    name: `chain-${config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const registryAddr = getAddress(config.registryAddr);

  async function resolveRecord(agentId: string): Promise<AgentRecord> {
    try {
      const [owner, agentURI, statusCode] = await client.readContract({
        address: registryAddr,
        abi: MOCK_ERC8004_ABI,
        functionName: "getAgent",
        args: [agentId],
      });
      const paymentKeys = (await client.readContract({
        address: registryAddr,
        abi: MOCK_ERC8004_ABI,
        functionName: "getAuthorizedPaymentKeys",
        args: [agentId],
      })) as Address[];
      const signingKeys = (await client.readContract({
        address: registryAddr,
        abi: MOCK_ERC8004_ABI,
        functionName: "getAuthorizedSigningKeys",
        args: [agentId],
      })) as Address[];

      let card: AgentCard;
      if (agentURI) {
        try {
          card = overlayOnchainKeys(await fetchAgentCard(agentURI), paymentKeys, signingKeys);
        } catch {
          card = finalizeAgentCard({
            agentId,
            name: agentId,
            description: "On-chain agent",
            serviceEndpoints: agentURI.startsWith("http") ? [agentURI] : [],
            owner: getAddress(owner),
            authorizedSigningKeys: signingKeys.map((key) => getAddress(key)),
            authorizedPaymentKeys: paymentKeys.map((key) => getAddress(key)),
            supportedProtocols: ["ERC8004"],
          });
        }
      } else {
        card = finalizeAgentCard({
          agentId,
          name: agentId,
          description: "On-chain agent",
          serviceEndpoints: [],
          owner: getAddress(owner),
          authorizedSigningKeys: signingKeys.map((key) => getAddress(key)),
          authorizedPaymentKeys: paymentKeys.map((key) => getAddress(key)),
          supportedProtocols: ["ERC8004"],
        });
      }

      if (card.agentId !== agentId) {
        card = { ...card, agentId, metadataHash: computeMetadataHash({ ...card, agentId }) };
      }

      return {
        agentId,
        owner: getAddress(owner),
        registryAddr,
        chainId: config.chainId,
        agentURI,
        card,
        status: STATUS_BY_CODE[Number(statusCode)] ?? "ACTIVE",
        registeredAt: new Date(0).toISOString(),
      };
    } catch {
      throw new AgentNotFoundError(agentId);
    }
  }

  return {
    kind: "onchain" as const,
    async getCard(agentId: string) {
      const record = await resolveRecord(agentId);
      return record.card;
    },
    async getAgent(agentId) {
      try {
        return await resolveRecord(agentId);
      } catch (error) {
        if (error instanceof AgentNotFoundError) {
          return null;
        }
        throw error;
      }
    },
    async register(_input: RegisterAgentInput) {
      throw readOnlyError("register");
    },
    async authorizePaymentKey(_agentId: string, _key: Address) {
      throw readOnlyError("authorizePaymentKey");
    },
    async authorizeSigningKey(_agentId: string, _key: Address) {
      throw readOnlyError("authorizeSigningKey");
    },
    async setStatus(_agentId: string, _status: AgentStatus) {
      throw readOnlyError("setStatus");
    },
    async list() {
      throw readOnlyError("list");
    },
  };
}

