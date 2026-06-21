import type { AgentCard, Address } from "@clb-acel/schemas";
import { AgentCardSchema } from "@clb-acel/schemas";
import { createPublicClient, defineChain, getAddress, http } from "viem";
import { finalizeAgentCard } from "./card";
import { AgentNotFoundError, type AgentRecord } from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

// Read-only ABI for the canonical ERC-8004 Identity Registry (ERC-721 + 8004 extensions).
// Confirmed against the deployed contract on Base Sepolia (0x8004A818…) and the authoritative
// erc-8004-contracts ABI (abis/IdentityRegistry.json): name "AgentIdentity", symbol "AGENT".
const CANONICAL_IDENTITY_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getMetadata",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "metadataKey", type: "string" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
] as const;

export type CanonicalMapInput = {
  agentId: string; // decimal string of the uint256 tokenId
  owner: Address;
  agentWallet: Address;
  fetchedCard: AgentCard; // card body served at tokenURI
};

/** Pure: assemble our AgentCard from canonical primitives (no live dependency). */
export function mapCanonicalToCard(input: CanonicalMapInput): AgentCard {
  const wallet = getAddress(input.agentWallet);
  const existingPayment = input.fetchedCard.authorizedPaymentKeys.map((k) => getAddress(k));
  const paymentKeys = existingPayment.some((k) => k === wallet)
    ? existingPayment
    : [...existingPayment, wallet];
  // Canonical Identity Registry has no signingKeys array — use the verified agentWallet as the
  // canonical signing identity. Extended signing keys can be stored via setMetadata and overlaid here.
  const existingSigning = input.fetchedCard.authorizedSigningKeys.map((k) => getAddress(k));
  const signingKeys = existingSigning.some((k) => k === wallet)
    ? existingSigning
    : [...existingSigning, wallet];
  const { metadataHash: _drop, ...rest } = input.fetchedCard;
  void _drop;
  return finalizeAgentCard({
    ...rest,
    agentId: input.agentId,
    owner: getAddress(input.owner),
    authorizedPaymentKeys: paymentKeys,
    authorizedSigningKeys: signingKeys,
    supportedProtocols: rest.supportedProtocols.includes("ERC8004")
      ? rest.supportedProtocols
      : [...rest.supportedProtocols, "ERC8004"],
  });
}

/** ERC-8004 `registration-v1` card body (the canonical on-chain card schema). */
export type RegistrationV1 = {
  type?: string;
  name?: string;
  description?: string;
  image?: string;
  services?: { name?: string; endpoint?: string }[];
  x402Support?: boolean;
  active?: boolean;
  supportedTrust?: string[];
};

/** Heuristic: is this JSON an ERC-8004 registration-v1 card (vs. our AgentCard)? */
export function isRegistrationV1(json: unknown): json is RegistrationV1 {
  if (!json || typeof json !== "object") return false;
  const obj = json as Record<string, unknown>;
  if (typeof obj.type === "string" && obj.type.includes("registration")) return true;
  return Array.isArray(obj.services);
}

/** Map an ERC-8004 registration-v1 card → our AgentCard. owner/keys are placeholders that
 *  mapCanonicalToCard overlays with the on-chain owner + verified agentWallet. */
export function mapRegistrationV1ToCard(reg: RegistrationV1, agentId: string): AgentCard {
  const serviceEndpoints = (reg.services ?? [])
    .map((s) => s.endpoint)
    .filter((e): e is string => typeof e === "string" && /^https?:\/\//u.test(e));
  const supportedProtocols: AgentCard["supportedProtocols"] = ["ERC8004"];
  if (reg.x402Support) supportedProtocols.push("x402");
  return finalizeAgentCard({
    agentId,
    name: reg.name && reg.name.length > 0 ? reg.name : `agent-${agentId}`,
    description: reg.description ?? "",
    serviceEndpoints,
    owner: ZERO_ADDRESS,
    authorizedSigningKeys: [],
    authorizedPaymentKeys: [],
    supportedProtocols,
  });
}

/** Fetch the tokenURI body (http(s) or `data:`) and parse it as our AgentCard OR registration-v1. */
export async function fetchCanonicalCardBody(uri: string, agentId: string): Promise<AgentCard> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to fetch agent card from ${uri} (${response.status})`);
  }
  const json = (await response.json()) as unknown;
  const asAgentCard = AgentCardSchema.safeParse(json);
  if (asAgentCard.success) return asAgentCard.data;
  if (isRegistrationV1(json)) return mapRegistrationV1ToCard(json, agentId);
  throw new Error(`Unrecognized agent card body at ${uri}`);
}

export type CanonicalRegistryConfig = { rpcUrl: string; registryAddr: Address; chainId: number };

export type CanonicalIdentityRegistry = {
  kind: "canonical";
  getCard(agentId: string): Promise<AgentCard>;
  getAgent(agentId: string): Promise<AgentRecord | null>;
};

/** Read-only canonical ERC-8004 Identity Registry reader (numeric agentId). */
export function createCanonicalErc8004Registry(
  config: CanonicalRegistryConfig,
): CanonicalIdentityRegistry {
  const chain = defineChain({
    id: config.chainId,
    name: `chain-${config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const registryAddr = getAddress(config.registryAddr);

  async function resolve(agentId: string): Promise<AgentRecord> {
    try {
      const tokenId = BigInt(agentId); // throws SyntaxError on non-numeric — caught here
      const [owner, tokenURI, agentWallet] = await Promise.all([
        client.readContract({
          address: registryAddr,
          abi: CANONICAL_IDENTITY_ABI,
          functionName: "ownerOf",
          args: [tokenId],
        }),
        client.readContract({
          address: registryAddr,
          abi: CANONICAL_IDENTITY_ABI,
          functionName: "tokenURI",
          args: [tokenId],
        }),
        client.readContract({
          address: registryAddr,
          abi: CANONICAL_IDENTITY_ABI,
          functionName: "getAgentWallet",
          args: [tokenId],
        }),
      ]);
      const fetchedCard = await fetchCanonicalCardBody(tokenURI as string, agentId);
      const card = mapCanonicalToCard({
        agentId,
        owner: getAddress(owner as Address),
        agentWallet: getAddress(agentWallet as Address),
        fetchedCard,
      });
      return {
        agentId,
        owner: getAddress(owner as Address),
        registryAddr,
        chainId: config.chainId,
        agentURI: tokenURI as string,
        card,
        status: "ACTIVE",
        registeredAt: new Date(0).toISOString(),
      };
    } catch {
      throw new AgentNotFoundError(agentId);
    }
  }

  return {
    kind: "canonical" as const,
    async getCard(agentId) {
      return (await resolve(agentId)).card;
    },
    async getAgent(agentId) {
      try {
        return await resolve(agentId);
      } catch (e) {
        if (e instanceof AgentNotFoundError) return null;
        throw e;
      }
    },
  };
}
