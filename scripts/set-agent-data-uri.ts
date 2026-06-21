/**
 * Replace an agent's on-chain tokenURI with a self-contained `data:application/json`
 * URI on the canonical ERC-8004 Identity Registry (Base Sepolia). 8004scan then
 * renders the metadata directly from the URI instead of fetching a hosted card —
 * needed because the agents were registered with a localhost card URL.
 *
 * The registry exposes setAgentURI(uint256 agentId, string agentURI); only the
 * agent's owner (the deployer) can call it.
 *
 * Usage: bun run scripts/set-agent-data-uri.ts grammar
 *        bun run scripts/set-agent-data-uri.ts weather
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const SET_AGENT_URI_ABI = [
  {
    type: "function",
    name: "setAgentURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "agentURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const q = value[0];
      const end = value.indexOf(q, 1);
      value = end === -1 ? value.slice(1) : value.slice(1, end);
    } else {
      const c = value.search(/\s#/u);
      if (c !== -1) value = value.slice(0, c).trim();
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Public host the card's service endpoints should point at (never localhost on-chain). */
function publicBase(): string {
  const fromEnv = process.env.CANONICAL_APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = fromEnv && fromEnv.startsWith("https://") ? fromEnv : "https://agentic-web3.alaminia.com";
  return base.replace(/\/$/u, "");
}

const REGISTRATION_V1 = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

function cardFor(kind: "grammar" | "weather", base: string) {
  if (kind === "grammar") {
    return {
      type: REGISTRATION_V1,
      name: "CLB-ACEL Grammar Agent",
      description:
        "A trustless agent that proofreads and corrects English text — fixing grammar, spelling, and " +
        "punctuation. Paid per check over x402; its identity lives on the canonical ERC-8004 Identity " +
        "Registry and its cross-layer-binding verification certificates are recorded on-chain.",
      image: "",
      services: [{ name: "grammar", endpoint: `${base}/api/agents/grammar` }],
      x402Support: true,
      active: true,
      supportedTrust: ["cross-layer-binding"],
    };
  }
  return {
    type: REGISTRATION_V1,
    name: "CLB-ACEL Weather Agent",
    description:
      "A trustless agent that returns a weather update for a city. Paid per request over x402; its " +
      "identity lives on the canonical ERC-8004 Identity Registry and its cross-layer-binding " +
      "verification certificates are recorded on-chain as ERC-8004 validation entries.",
    image: "",
    services: [{ name: "weather", endpoint: `${base}/api/agents/weather` }],
    x402Support: true,
    active: true,
    supportedTrust: ["cross-layer-binding"],
  };
}

const AGENT_IDS: Record<string, bigint> = { grammar: 6827n, weather: 6823n };

async function main(): Promise<void> {
  loadEnvFile(resolve(import.meta.dir, "../.env"));
  const kind = (process.argv[2] ?? "grammar") as "grammar" | "weather";
  const agentId = AGENT_IDS[kind];
  if (agentId === undefined) throw new Error(`unknown agent "${kind}" (use grammar|weather)`);

  const rpcUrl = process.env.RPC_URL_BASE_SEPOLIA?.trim() ?? "https://sepolia.base.org";
  const registryAddr = (process.env.ERC8004_IDENTITY_REGISTRY_CANONICAL?.trim() ??
    "0x8004A818BFB912233c491871b3d84c89A494BD9e") as Address;
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim() as Hex;
  if (!deployerKey) throw new Error("Missing DEPLOYER_PRIVATE_KEY");

  const base = publicBase();
  const card = cardFor(kind, base);
  const dataUri = `data:application/json;base64,${Buffer.from(JSON.stringify(card), "utf8").toString("base64")}`;

  const deployer = privateKeyToAccount(deployerKey);
  const transport = http(rpcUrl);
  const walletClient = createWalletClient({ chain: baseSepolia, transport, account: deployer });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });

  console.log(`Agent: ${kind} (id ${agentId}) | registry ${registryAddr}`);
  console.log(`Owner (deployer): ${deployer.address}`);
  console.log(`Service endpoint in card: ${card.services[0]!.endpoint}`);
  console.log(`New tokenURI: data:application/json;base64,… (${dataUri.length} chars)`);

  const before = await publicClient.readContract({
    address: registryAddr,
    abi: SET_AGENT_URI_ABI,
    functionName: "tokenURI",
    args: [agentId],
  });
  console.log(`Current tokenURI: ${before.slice(0, 60)}${before.length > 60 ? "…" : ""}`);

  const sim = await publicClient.simulateContract({
    address: registryAddr,
    abi: SET_AGENT_URI_ABI,
    functionName: "setAgentURI",
    args: [agentId, dataUri],
    account: deployer,
  });
  const tx = await walletClient.writeContract(sim.request);
  console.log(`setAgentURI tx: ${tx}`);
  await publicClient.waitForTransactionReceipt({ hash: tx });

  // Read-after-write can hit an RPC node that hasn't caught up; retry a few times.
  let after = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    after = await publicClient.readContract({
      address: registryAddr,
      abi: SET_AGENT_URI_ABI,
      functionName: "tokenURI",
      args: [agentId],
    });
    if (after.startsWith("data:application/json")) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const ok = after.startsWith("data:application/json");
  console.log(`${ok ? "✓" : "✗"} new tokenURI: ${after.slice(0, 60)}…`);
  console.log(`8004scan: https://testnet.8004scan.io/agents/base-sepolia/${agentId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
