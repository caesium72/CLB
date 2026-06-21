/**
 * Register the CLB-ACEL Agent Orchestrator (the buyer-side agent that acts on the human's behalf)
 * on the CANONICAL ERC-8004 Identity Registry (Base Sepolia, 0x8004A818…). Unlike the merchant
 * agents, the orchestrator sells no service, so its metadata is a self-contained
 * `data:application/json;base64,…` URI (no hosted card URL).
 *
 * Two on-chain steps (same ABI/EIP-712 as register-canonical-agents.ts):
 *   1. register(dataUri)            — deployer mints the agent NFT; returns the numeric agentId.
 *   2. setAgentWallet(agentId, …)   — sets the orchestrator's verified wallet (SHOPPING_AGENT key);
 *      the wallet signs the EIP-712 AgentWalletSet consent, the deployer submits the tx.
 *
 * Funding: the DEPLOYER pays gas for both txs; the orchestrator wallet only signs off-chain.
 * Idempotent: writes "orchestrator-agent-001" to experiments/canonical-agents.json; re-running
 * skips if that agentId still resolves to the deployer as owner.
 *
 * Prerequisites (.env): RPC_URL_BASE_SEPOLIA, DEPLOYER_PRIVATE_KEY, SHOPPING_AGENT_PRIVATE_KEY
 *   (the orchestrator wallet), ERC8004_IDENTITY_REGISTRY_CANONICAL, CHAIN_ID (=84532).
 *
 * Usage: bun run setup:register-orchestrator
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
import {
  ORCHESTRATOR_WALLET,
  orchestratorMetadataDataUri,
} from "../apps/web-demo/src/lib/orchestrator";

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

const EIP712_TYPES = {
  AgentWalletSet: [
    { name: "agentId", type: "uint256" },
    { name: "newWallet", type: "address" },
    { name: "owner", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const MAX_DEADLINE_DELAY_SECONDS = 300n;

type AgentRecord = {
  agentId: string;
  wallet: Address;
  registerTx: Hex;
  setWalletTx?: Hex;
  metadata?: string;
  done?: boolean;
};

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    // Strip inline comments on unquoted values, then unwrap quotes.
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
  const orchestratorKey = requireEnv("SHOPPING_AGENT_PRIVATE_KEY") as Hex;
  const chainId = Number(process.env.CHAIN_ID ?? 84532);

  const deployer = privateKeyToAccount(deployerKey);
  const wallet = privateKeyToAccount(orchestratorKey);
  if (wallet.address.toLowerCase() !== ORCHESTRATOR_WALLET.toLowerCase()) {
    throw new Error(
      `SHOPPING_AGENT_PRIVATE_KEY address ${wallet.address} != ORCHESTRATOR_WALLET ${ORCHESTRATOR_WALLET}. ` +
        `Update apps/web-demo/src/lib/orchestrator.ts ORCHESTRATOR_WALLET if you changed the key.`,
    );
  }

  const agentURI = orchestratorMetadataDataUri();
  const transport = http(rpcUrl);
  const walletClient = createWalletClient({ chain: baseSepolia, transport, account: deployer });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });

  const domain = {
    name: "ERC8004IdentityRegistry",
    version: "1",
    chainId,
    verifyingContract: registryAddr,
  } as const;

  const recordPath = resolve(import.meta.dir, "../experiments/canonical-agents.json");
  const records: Record<string, AgentRecord> = existsSync(recordPath)
    ? (JSON.parse(readFileSync(recordPath, "utf8")) as Record<string, AgentRecord>)
    : {};
  const label = "orchestrator-agent-001";
  const prior = records[label];

  console.log("Canonical Identity Registry:", registryAddr);
  console.log("RPC:", rpcUrl, "| chainId:", chainId);
  console.log("Deployer (owner, pays gas):", deployer.address);
  console.log("Orchestrator wallet:", wallet.address);
  console.log("Metadata URI:", `${agentURI.slice(0, 48)}… (${agentURI.length} chars)`);
  console.log("");

  if (prior?.done) {
    console.log(`✓ ${label} already registered as agentId ${prior.agentId} — nothing to do`);
    console.log(`  Set in .env: NEXT_PUBLIC_ORCHESTRATOR_AGENT_ID=${prior.agentId}`);
    return;
  }

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
    console.log(`↩ resuming ${label} — agentId ${agentId} registered, retrying setAgentWallet`);
  } else {
    const sim = await publicClient.simulateContract({
      address: registryAddr,
      abi: CANONICAL_IDENTITY_ABI,
      functionName: "register",
      args: [agentURI],
      account: deployer,
    });
    registerTx = await walletClient.writeContract(sim.request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: registerTx });
    const events = parseEventLogs({
      abi: CANONICAL_IDENTITY_ABI,
      logs: receipt.logs,
      eventName: "Registered",
    });
    const rawId = events[0]?.args.agentId ?? sim.result;
    if (rawId === undefined) throw new Error("could not determine agentId");
    agentId = rawId as bigint;
    console.log(`✓ registered ${label} as agentId ${agentId} (tx ${registerTx})`);

    records[label] = {
      agentId: agentId.toString(),
      wallet: wallet.address,
      registerTx,
      metadata: "data:application/json;base64",
    };
    writeFileSync(recordPath, `${JSON.stringify(records, null, 2)}\n`);
    await new Promise((r) => setTimeout(r, 4000));
  }

  const block = await publicClient.getBlock();
  const deadline = block.timestamp + MAX_DEADLINE_DELAY_SECONDS - 30n;
  const signature = await wallet.signTypedData({
    domain,
    types: EIP712_TYPES,
    primaryType: "AgentWalletSet",
    message: { agentId, newWallet: wallet.address, owner: deployer.address, deadline },
  });
  const walletSim = await publicClient.simulateContract({
    address: registryAddr,
    abi: CANONICAL_IDENTITY_ABI,
    functionName: "setAgentWallet",
    args: [agentId, wallet.address, deadline, signature],
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
  const ok = verified.toLowerCase() === wallet.address.toLowerCase();
  console.log(`  ${ok ? "✓" : "✗"} setAgentWallet ${wallet.address} (tx ${setWalletTx})`);

  records[label] = {
    agentId: agentId.toString(),
    wallet: wallet.address,
    registerTx,
    setWalletTx,
    metadata: "data:application/json;base64",
    done: true,
  };
  writeFileSync(recordPath, `${JSON.stringify(records, null, 2)}\n`);

  console.log("");
  console.log(`✓ Wrote record → ${recordPath}`);
  console.log(`  8004scan:   https://testnet.8004scan.io/agents/base-sepolia/${agentId}`);
  console.log("");
  console.log("Add to .env (and Vercel):");
  console.log(`  NEXT_PUBLIC_ORCHESTRATOR_AGENT_ID=${agentId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
