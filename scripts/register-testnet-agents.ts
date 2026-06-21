/**
 * Register CLB-ACEL demo agents on the deployed MockERC8004IdentityRegistry (Base Sepolia).
 *
 * Prerequisites:
 *   - .env with DEPLOYER_PRIVATE_KEY, ERC8004_REGISTRY_ADDRESS, RPC_URL_BASE_SEPOLIA
 *   - SHOPPING_AGENT_PRIVATE_KEY, MERCHANT_AGENT_PRIVATE_KEY (for payment key addresses)
 *   - identity-service + merchant-agent-api will be running when the on-chain reader fetches agentURIs
 *
 * Usage: bun run setup:register-agents
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  DEFAULT_ANALYSIS_AGENT_ID,
  DEFAULT_DECOY_AGENT_ID,
  DEFAULT_SHOPPING_AGENT_ID,
} from "../services/identity-service/src/seed";

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(resolve(import.meta.dir, "../.env"));

const MOCK_REGISTRY_ABI = [
  {
    type: "function",
    name: "registerAgent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "agentURI", type: "string" },
      { name: "initialSigningKeys", type: "address[]" },
      { name: "initialPaymentKeys", type: "address[]" },
    ],
    outputs: [],
  },
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
    type: "error",
    name: "AgentExists",
    inputs: [{ name: "agentId", type: "string" }],
  },
] as const;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

async function alreadyRegistered(
  client: ReturnType<typeof createPublicClient>,
  registry: Address,
  agentId: string,
): Promise<boolean> {
  try {
    await client.readContract({
      address: registry,
      abi: MOCK_REGISTRY_ABI,
      functionName: "getAgent",
      args: [agentId],
    });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL_BASE_SEPOLIA?.trim() ?? "https://sepolia.base.org";
  const registry = requireEnv("ERC8004_REGISTRY_ADDRESS") as Address;
  const deployerKey = requireEnv("DEPLOYER_PRIVATE_KEY") as Hex;
  const shopperKey = requireEnv("SHOPPING_AGENT_PRIVATE_KEY") as Hex;
  const merchantKey = requireEnv("MERCHANT_AGENT_PRIVATE_KEY") as Hex;

  const identityUrl = process.env.IDENTITY_SERVICE_URL?.trim() ?? "http://localhost:4002";
  const merchantUrl = process.env.MERCHANT_AGENT_URL?.trim() ?? "http://localhost:4004";

  const shopper = privateKeyToAccount(shopperKey).address;
  const merchant = privateKeyToAccount(merchantKey).address;
  const deployer = privateKeyToAccount(deployerKey);

  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({
    chain: baseSepolia,
    transport,
    account: deployer,
  });

  const agents: Array<{
    agentId: string;
    agentURI: string;
    signingKeys: Address[];
    paymentKeys: Address[];
  }> = [
    {
      agentId: DEFAULT_SHOPPING_AGENT_ID,
      agentURI: `${identityUrl}/.well-known/agent-card.json?agentId=${DEFAULT_SHOPPING_AGENT_ID}`,
      signingKeys: [shopper],
      paymentKeys: [shopper],
    },
    {
      agentId: DEFAULT_ANALYSIS_AGENT_ID,
      agentURI: `${merchantUrl}/.well-known/agent-card.json`,
      signingKeys: [merchant],
      paymentKeys: [merchant],
    },
    {
      agentId: DEFAULT_DECOY_AGENT_ID,
      agentURI: `${identityUrl}/.well-known/agent-card.json?agentId=${DEFAULT_DECOY_AGENT_ID}`,
      signingKeys: ["0x0000000000000000000000000000000000000002"],
      paymentKeys: ["0x0000000000000000000000000000000000000002"],
    },
  ];

  console.log("Registry:", registry);
  console.log("RPC:", rpcUrl);
  console.log("Shopping agent:", shopper);
  console.log("Merchant agent:", merchant);
  console.log("");

  for (const agent of agents) {
    if (await alreadyRegistered(publicClient, registry, agent.agentId)) {
      console.log(`✓ ${agent.agentId} already registered — skip`);
      continue;
    }

    const hash = await walletClient.writeContract({
      address: registry,
      abi: MOCK_REGISTRY_ABI,
      functionName: "registerAgent",
      args: [agent.agentId, agent.agentURI, agent.signingKeys, agent.paymentKeys],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✓ registered ${agent.agentId} (tx ${hash})`);
  }

  console.log("");
  console.log("Set in .env:");
  console.log(`  TEST_AGENT_ID=${DEFAULT_SHOPPING_AGENT_ID}`);
  console.log("");
  console.log("Start services (identity + merchant must be up for agentURI fetch):");
  console.log("  ./scripts/start-all-services.sh");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
