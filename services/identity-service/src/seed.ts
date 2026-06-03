import type { RegisterAgentInput } from "@clb-acel/erc8004-adapter";
import { finalizeAgentCard } from "@clb-acel/erc8004-adapter";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Anvil default accounts — test-only keys, used when no env key is provided. */
const DEFAULT_MERCHANT_PRIVATE_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const DEFAULT_SHOPPING_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

const PLACEHOLDER_REGISTRY = "0x0000000000000000000000000000000000008004" as const;

export const DEFAULT_ANALYSIS_AGENT_ID = "analysis-agent-001";
export const DEFAULT_SHOPPING_AGENT_ID = "shopping-agent-001";
/** Decoy merchant for Phase 5b discovery narrative — lacks x402 support. */
export const DEFAULT_DECOY_AGENT_ID = "analysis-agent-002";

function accountAddress(envKey: string | undefined, fallback: Hex): Address {
  const key = (envKey?.trim() || fallback) as Hex;
  return privateKeyToAccount(key).address;
}

function registryAddr(): Address {
  return (process.env.ERC8004_REGISTRY_ADDRESS?.trim() || PLACEHOLDER_REGISTRY) as Address;
}

function chainId(): number {
  return Number(process.env.CHAIN_ID ?? 84532);
}

/**
 * Default analysis (merchant) and shopping agents so the identity service is
 * useful standalone. Keys derive from the same env vars used by the
 * merchant-agent-api and orchestrator so identities stay consistent.
 */
export function defaultAgents(): RegisterAgentInput[] {
  const merchant = accountAddress(process.env.MERCHANT_AGENT_PRIVATE_KEY, DEFAULT_MERCHANT_PRIVATE_KEY);
  const shopper = accountAddress(process.env.SHOPPING_AGENT_PRIVATE_KEY, DEFAULT_SHOPPING_PRIVATE_KEY);
  const merchantUrl = process.env.MERCHANT_AGENT_URL?.trim() || "http://localhost:4004";
  const shopperUrl = process.env.AGENT_ORCHESTRATOR_URL?.trim() || "http://localhost:4000";

  const analysisCard = finalizeAgentCard({
    agentId: DEFAULT_ANALYSIS_AGENT_ID,
    name: "Token Risk Analysis Agent",
    description: "Verified analysis agent selling signed token-risk reports over x402.",
    serviceEndpoints: [merchantUrl],
    owner: merchant,
    authorizedSigningKeys: [merchant],
    authorizedPaymentKeys: [merchant],
    supportedProtocols: ["x402", "ERC8004", "AP2"],
  });

  const shoppingCard = finalizeAgentCard({
    agentId: DEFAULT_SHOPPING_AGENT_ID,
    name: "Shopping Research Agent",
    description: "Executes paid research tasks on behalf of a human principal.",
    serviceEndpoints: [shopperUrl],
    owner: shopper,
    authorizedSigningKeys: [shopper],
    authorizedPaymentKeys: [shopper],
    supportedProtocols: ["AP2", "x402", "ERC8004"],
  });

  const decoyOwner = "0x0000000000000000000000000000000000000002" as Address;
  const decoyCard = finalizeAgentCard({
    agentId: DEFAULT_DECOY_AGENT_ID,
    name: "Unverified Token Scanner",
    description: "Unverified scanner listing token summaries without x402 settlement.",
    serviceEndpoints: ["http://localhost:4999"],
    owner: decoyOwner,
    authorizedSigningKeys: [decoyOwner],
    authorizedPaymentKeys: [decoyOwner],
    supportedProtocols: ["ERC8004"],
  });

  return [
    {
      card: analysisCard,
      registryAddr: registryAddr(),
      chainId: chainId(),
      agentURI: `${merchantUrl}/.well-known/agent-card.json`,
    },
    {
      card: decoyCard,
      registryAddr: registryAddr(),
      chainId: chainId(),
      agentURI: "http://localhost:4999/.well-known/agent-card.json",
    },
    {
      card: shoppingCard,
      registryAddr: registryAddr(),
      chainId: chainId(),
      agentURI: `${shopperUrl}/.well-known/agent-card.json`,
    },
  ];
}
