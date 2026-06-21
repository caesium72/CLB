/**
 * Register the CLB-ACEL Weather Agent on the CANONICAL ERC-8004 Identity Registry (Base Sepolia,
 * 0x8004A818BFB912233c491871b3d84c89A494BD9e). After this runs, the agent is a public ERC-721 token
 * visible to any ERC-8004 explorer (8004scan / 8004agents.ai) among the live agent set, with its
 * registration-v1 card served from the web-demo (Vercel).
 *
 * Two on-chain steps (ABI + EIP-712 confirmed against the deployed contract and
 * erc-8004-contracts abis/IdentityRegistry.json):
 *   1. register(agentURI)            — deployer mints the agent NFT; returns the numeric agentId.
 *   2. setAgentWallet(agentId, ...)  — sets the verified receiving wallet. The wallet itself must
 *      sign an EIP-712 `AgentWalletSet` consent; the owner (deployer) submits the tx.
 *
 * Idempotent: the assigned agentId is persisted to experiments/canonical-agents.json. Re-running
 * skips any agent whose recorded agentId still resolves to the deployer as owner.
 *
 * Prerequisites (.env): RPC_URL_BASE_SEPOLIA, DEPLOYER_PRIVATE_KEY, ERC8004_IDENTITY_REGISTRY_CANONICAL,
 *   CHAIN_ID (=84532), CANONICAL_WEATHER_AGENT_URI (public card URL, e.g.
 *   https://<app>.vercel.app/.well-known/agent-card.json), and a wallet key
 *   (WEATHER_AGENT_PRIVATE_KEY, else SHOPPING_AGENT_PRIVATE_KEY).
 *
 * Usage: bun run setup:register-canonical
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// ABI confirmed against the deployed canonical Identity Registry and abis/IdentityRegistry.json.
const CANONICAL_IDENTITY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setAgentWallet",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newWallet", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

// EIP-712 wallet-consent, confirmed from IdentityRegistryUpgradeable.sol:
//   AGENT_WALLET_SET_TYPEHASH = keccak256(
//     "AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)")
//   domain = __EIP712_init("ERC8004IdentityRegistry", "1") bound to the registry address.
const EIP712_TYPES = {
  AgentWalletSet: [
    { name: "agentId", type: "uint256" },
    { name: "newWallet", type: "address" },
    { name: "owner", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const MAX_DEADLINE_DELAY_SECONDS = 300n; // contract enforces deadline <= block.timestamp + 5 minutes

type AgentRecord = { agentId: string; wallet: Address; registerTx: Hex; setWalletTx?: Hex; done?: boolean };

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

async function main(): Promise<void> {
  loadEnvFile(resolve(import.meta.dir, "../.env"));
  const rpcUrl = process.env.RPC_URL_BASE_SEPOLIA?.trim() ?? "https://sepolia.base.org";
  const registryAddr = requireEnv("ERC8004_IDENTITY_REGISTRY_CANONICAL") as Address;
  const deployerKey = requireEnv("DEPLOYER_PRIVATE_KEY") as Hex;
  const chainId = Number(process.env.CHAIN_ID ?? 84532);

  // The demo agent: a simple, universally-understood Weather Agent whose ERC-8004 registration-v1
  // card is hosted on the web-demo (Vercel). Set CANONICAL_WEATHER_AGENT_URI to its public card URL,
  // e.g. https://<app>.vercel.app/.well-known/agent-card.json (or /api/agent-card).
  const weatherUri = requireEnv("CANONICAL_WEATHER_AGENT_URI");
  // The agent's receiving wallet (signs the EIP-712 setAgentWallet consent). Reuse SHOPPING_AGENT key
  // unless a dedicated WEATHER_AGENT_PRIVATE_KEY is provided.
  const weatherWalletKey = (process.env.WEATHER_AGENT_PRIVATE_KEY?.trim() ??
    requireEnv("SHOPPING_AGENT_PRIVATE_KEY")) as Hex;

  // The grammar agent: the second demo merchant (real LLM grammar checking). Registered only when
  // its own key is present; its card is served at /api/agents/grammar/card on the web-demo (Vercel).
  const appBase = (process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "http://localhost:3000").replace(/\/$/u, "");
  const grammarWalletKey = process.env.GRAMMAR_AGENT_PRIVATE_KEY?.trim() as Hex | undefined;
  const grammarUri =
    process.env.CANONICAL_GRAMMAR_AGENT_URI?.trim() ?? `${appBase}/api/agents/grammar/card`;

  const deployer = privateKeyToAccount(deployerKey);
  const transport = http(rpcUrl);
  const walletClient = createWalletClient({ chain: baseSepolia, transport, account: deployer });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });

  const domain = {
    name: "ERC8004IdentityRegistry",
    version: "1",
    chainId,
    verifyingContract: registryAddr,
  } as const;

  const agents = [
    {
      label: "weather-agent-001",
      agentURI: weatherUri,
      wallet: privateKeyToAccount(weatherWalletKey),
    },
  ];
  if (grammarWalletKey) {
    agents.push({
      label: "grammar-agent-001",
      agentURI: grammarUri,
      wallet: privateKeyToAccount(grammarWalletKey),
    });
  }

  const recordPath = resolve(import.meta.dir, "../experiments/canonical-agents.json");
  const records: Record<string, AgentRecord> = existsSync(recordPath)
    ? (JSON.parse(readFileSync(recordPath, "utf8")) as Record<string, AgentRecord>)
    : {};

  console.log("Canonical Identity Registry:", registryAddr);
  console.log("RPC:", rpcUrl, "| chainId:", chainId);
  console.log("Deployer (owner):", deployer.address);
  console.log("");

  for (const agent of agents) {
    const prior = records[agent.label];

    // Idempotency: fully done — skip entirely.
    if (prior?.done) {
      console.log(`✓ ${agent.label} fully done as agentId ${prior.agentId} — skip`);
      continue;
    }

    // Determine agentId + registerTx: resume from a prior partial record, or register fresh.
    let agentId: bigint;
    let registerTx: Hex;

    const resumable = prior?.agentId
      ? await publicClient
          .readContract({
            address: registryAddr,
            abi: CANONICAL_IDENTITY_ABI,
            functionName: "ownerOf",
            args: [BigInt(prior.agentId)],
          })
          .then(
            (owner) => (owner as Address).toLowerCase() === deployer.address.toLowerCase(),
            () => false,
          )
      : false;

    if (resumable && prior) {
      agentId = BigInt(prior.agentId);
      registerTx = prior.registerTx;
      console.log(`↩ resuming ${agent.label} — agentId ${agentId} registered, retrying setAgentWallet`);
    } else {
      // 1. register(agentURI) → numeric agentId. Use the on-chain event as the authoritative source.
      const sim = await publicClient.simulateContract({
        address: registryAddr,
        abi: CANONICAL_IDENTITY_ABI,
        functionName: "register",
        args: [agent.agentURI],
        account: deployer,
      });
      registerTx = await walletClient.writeContract(sim.request);
      const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerTx });
      const regEvents = parseEventLogs({
        abi: CANONICAL_IDENTITY_ABI,
        logs: registerReceipt.logs,
        eventName: "Registered",
      });
      // Prefer the on-chain event over sim.result — sim.result can be stale if lastId advanced.
      const rawId = regEvents[0]?.args.agentId ?? sim.result;
      if (rawId === undefined) throw new Error(`could not determine agentId for ${agent.label}`);
      agentId = rawId as bigint;
      console.log(`✓ registered ${agent.label} as agentId ${agentId} (tx ${registerTx})`);

      // Persist partial record immediately — a subsequent setAgentWallet failure is now resumable.
      records[agent.label] = { agentId: agentId.toString(), wallet: agent.wallet.address, registerTx };
      writeFileSync(recordPath, `${JSON.stringify(records, null, 2)}\n`);

      // Give RPC nodes 4 s to propagate the new token before simulating against the new state.
      await new Promise((r) => setTimeout(r, 4000));
    }

    // 2. setAgentWallet — the agent's WALLET signs EIP-712 consent; the owner (deployer) submits.
    const block = await publicClient.getBlock();
    const deadline = block.timestamp + MAX_DEADLINE_DELAY_SECONDS - 30n; // within the 5-min window
    const signature = await agent.wallet.signTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: "AgentWalletSet",
      message: {
        agentId,
        newWallet: agent.wallet.address,
        owner: deployer.address,
        deadline,
      },
    });
    const walletSim = await publicClient.simulateContract({
      address: registryAddr,
      abi: CANONICAL_IDENTITY_ABI,
      functionName: "setAgentWallet",
      args: [agentId, agent.wallet.address, deadline, signature],
      account: deployer,
    });
    const setWalletTx = await walletClient.writeContract(walletSim.request);
    await publicClient.waitForTransactionReceipt({ hash: setWalletTx });
    const verified = (await publicClient.readContract({
      address: registryAddr,
      abi: CANONICAL_IDENTITY_ABI,
      functionName: "getAgentWallet",
      args: [agentId],
    })) as Address;
    const ok = verified.toLowerCase() === agent.wallet.address.toLowerCase();
    console.log(
      `  ${ok ? "✓" : "✗"} setAgentWallet ${agent.wallet.address} (tx ${setWalletTx})` +
        (ok ? "" : ` — getAgentWallet returned ${verified}`),
    );
    console.log(`  8004scan:     https://testnet.8004scan.io/agent/${agentId}`);
    console.log(`  8004agents:   https://8004agents.ai/base-sepolia/agent/${agentId}`);

    records[agent.label] = {
      agentId: agentId.toString(),
      wallet: agent.wallet.address,
      registerTx,
      setWalletTx,
      done: true,
    };
    writeFileSync(recordPath, `${JSON.stringify(records, null, 2)}\n`);
  }

  console.log("");
  console.log(`Wrote agentId record → ${recordPath}`);
  console.log("Set ERC8004_IDENTITY_MODE=canonical to resolve these via the canonical reader.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
