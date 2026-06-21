/**
 * One-off: ensure GRAMMAR_AGENT_PRIVATE_KEY and WEATHER_AGENT_PRIVATE_KEY exist
 * in the repo-root .env, then print agent addresses + Base Sepolia balances.
 *
 *  - Grammar agent: a freshly generated key (the new merchant to register).
 *  - Weather agent: reuses SHOPPING_AGENT_PRIVATE_KEY, whose address (0x1028D6B0…)
 *    is the already-registered canonical weather agent (id 6823) wallet.
 *
 * Never prints private keys. Idempotent: re-running does not regenerate keys.
 * Run:  bun run scripts/setup-agent-keys.ts
 */
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, formatEther, http } from "viem";
import { baseSepolia } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV_PATH = join(process.cwd(), ".env");
if (!existsSync(ENV_PATH)) {
  console.error(`No .env at ${ENV_PATH} — run from the repo root.`);
  process.exit(1);
}
const envText = readFileSync(ENV_PATH, "utf8");

function envHas(key: string): boolean {
  return new RegExp(`^\\s*${key}\\s*=`, "m").test(envText);
}

const shoppingKey = process.env.SHOPPING_AGENT_PRIVATE_KEY?.trim();
if (!shoppingKey) {
  console.error("SHOPPING_AGENT_PRIVATE_KEY missing from .env");
  process.exit(1);
}

const grammarKey = (process.env.GRAMMAR_AGENT_PRIVATE_KEY?.trim() ||
  generatePrivateKey()) as `0x${string}`;
const weatherKey = (process.env.WEATHER_AGENT_PRIVATE_KEY?.trim() ||
  shoppingKey) as `0x${string}`;

const appended: string[] = [];
if (!envHas("GRAMMAR_AGENT_PRIVATE_KEY")) {
  appended.push(`GRAMMAR_AGENT_PRIVATE_KEY=${grammarKey}`);
}
if (!envHas("WEATHER_AGENT_PRIVATE_KEY")) {
  appended.push(`WEATHER_AGENT_PRIVATE_KEY=${weatherKey}`);
}
if (appended.length > 0) {
  appendFileSync(ENV_PATH, `\n# --- project-v3: merchant agent keys (testnet) ---\n${appended.join("\n")}\n`);
}

const grammarAddr = privateKeyToAccount(grammarKey).address;
const weatherAddr = privateKeyToAccount(weatherKey).address;
const deployerAddr = process.env.DEPLOYER_PRIVATE_KEY
  ? privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY.trim() as `0x${string}`).address
  : "(DEPLOYER_PRIVATE_KEY unset)";

const rpc = process.env.RPC_URL_BASE_SEPOLIA?.trim() || process.env.RPC_URL?.trim();
const client = rpc ? createPublicClient({ chain: baseSepolia, transport: http(rpc) }) : null;

async function balance(addr: string): Promise<string> {
  if (!client || !addr.startsWith("0x")) return "n/a";
  try {
    const wei = await client.getBalance({ address: addr as `0x${string}` });
    return `${formatEther(wei)} ETH`;
  } catch (e) {
    return `err: ${e instanceof Error ? e.message.slice(0, 40) : "read failed"}`;
  }
}

console.log("\n.env updated:", appended.length ? appended.map((l) => l.split("=")[0]).join(", ") : "(no changes — keys already present)");
console.log("\nBase Sepolia agent addresses (private keys stay in .env, never printed):\n");
console.log(`  GRAMMAR agent (NEW — fund this): ${grammarAddr}`);
console.log(`     balance: ${await balance(grammarAddr)}`);
console.log(`  WEATHER agent (id 6823, = shopping wallet): ${weatherAddr}`);
console.log(`     balance: ${await balance(weatherAddr)}`);
console.log(`  DEPLOYER (pays registration gas): ${deployerAddr}`);
console.log(`     balance: ${await balance(deployerAddr)}`);
console.log("\nFund the GRAMMAR address with Base Sepolia ETH (free): https://www.alchemy.com/faucets/base-sepolia");
console.log("Ensure DEPLOYER has ETH too (it pays the register() + setAgentWallet() gas).\n");
