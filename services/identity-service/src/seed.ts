import type { RegisterAgentInput } from "@clb-acel/erc8004-adapter";
import { finalizeAgentCard } from "@clb-acel/erc8004-adapter";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Anvil default accounts — test-only keys, used when no env key is provided. */
const DEFAULT_MERCHANT_PRIVATE_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const DEFAULT_SHOPPING_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const DEFAULT_GRAMMAR_PRIVATE_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const DEFAULT_WEATHER_PRIVATE_KEY =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const;

const PLACEHOLDER_REGISTRY = "0x0000000000000000000000000000000000008004" as const;
const CANONICAL_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;

export const DEFAULT_ANALYSIS_AGENT_ID = "analysis-agent-001";
/**
 * The buyer-side orchestrator's canonical ERC-8004 token id (Base Sepolia). It is
 * registered as "CLB-ACEL Agent Orchestrator" with a data: metadata URI and its
 * verified wallet = SHOPPING_AGENT key. Numeric so the UI links it to 8004scan.
 */
export const DEFAULT_SHOPPING_AGENT_ID = "6861";
/** Decoy merchant for Phase 5b discovery narrative — lacks x402 support. */
export const DEFAULT_DECOY_AGENT_ID = "analysis-agent-002";
/** Real canonical ERC-8004 merchant agents (Base Sepolia token ids). */
export const DEFAULT_GRAMMAR_AGENT_ID = "6827";
export const DEFAULT_WEATHER_AGENT_ID = "6823";

function accountAddress(envKey: string | undefined, fallback: Hex): Address {
  const key = (envKey?.trim() || fallback) as Hex;
  return privateKeyToAccount(key).address;
}

function registryAddr(): Address {
  return (process.env.ERC8004_REGISTRY_ADDRESS?.trim() || PLACEHOLDER_REGISTRY) as Address;
}

/** Canonical ERC-8004 Identity Registry — where the real grammar/weather agents live. */
function canonicalRegistryAddr(): Address {
  return (process.env.ERC8004_IDENTITY_REGISTRY_CANONICAL?.trim() || CANONICAL_REGISTRY) as Address;
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000").replace(/\/$/u, "");
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
    name: "CLB-ACEL Agent Orchestrator",
    description:
      "The buyer-side agent that acts on a human principal's behalf — discovers a service agent, " +
      "authorizes within the human's limits (AP2), and settles over x402.",
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

  // Real canonical ERC-8004 merchant agents (ids 6823 weather, 6827 grammar). Their signing keys
  // match the wallets that sign each ServiceReport, so the verifier's R2/R4 hold.
  const grammar = accountAddress(process.env.GRAMMAR_AGENT_PRIVATE_KEY, DEFAULT_GRAMMAR_PRIVATE_KEY);
  const weather = accountAddress(
    process.env.WEATHER_AGENT_PRIVATE_KEY ?? process.env.SHOPPING_AGENT_PRIVATE_KEY,
    DEFAULT_WEATHER_PRIVATE_KEY,
  );
  const base = appBaseUrl();

  const grammarCard = finalizeAgentCard({
    agentId: DEFAULT_GRAMMAR_AGENT_ID,
    name: "Grammar Checker Agent",
    description:
      "Proofreads and corrects English text — fixes grammar, spelling, and punctuation. Paid per check over x402.",
    serviceEndpoints: [`${base}/api/agents/grammar`],
    owner: grammar,
    authorizedSigningKeys: [grammar],
    authorizedPaymentKeys: [grammar],
    supportedProtocols: ["x402", "ERC8004", "AP2"],
  });

  const weatherCard = finalizeAgentCard({
    agentId: DEFAULT_WEATHER_AGENT_ID,
    name: "Weather Agent",
    description:
      "Returns a weather forecast (conditions and temperature) for a given city. Paid per request over x402.",
    serviceEndpoints: [`${base}/api/agents/weather`],
    owner: weather,
    authorizedSigningKeys: [weather],
    authorizedPaymentKeys: [weather],
    supportedProtocols: ["x402", "ERC8004", "AP2"],
  });

  return [
    {
      card: grammarCard,
      registryAddr: canonicalRegistryAddr(),
      chainId: chainId(),
      agentURI: `${base}/api/agents/grammar/card`,
    },
    {
      card: weatherCard,
      registryAddr: canonicalRegistryAddr(),
      chainId: chainId(),
      agentURI: `${base}/api/agents/weather/card`,
    },
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
      registryAddr: canonicalRegistryAddr(),
      chainId: chainId(),
      agentURI: "data:application/json (CLB-ACEL Agent Orchestrator)",
    },
  ];
}
