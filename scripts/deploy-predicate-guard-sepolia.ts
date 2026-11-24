/**
 * Deploy PredicatePaymentGuard to Base Sepolia and register the demo predicate,
 * so the Attack Lab can demonstrate a REAL on-chain Mode B rejection (a mined,
 * reverted tx viewable on BaseScan).
 *
 * Usage:
 *   bun run scripts/deploy-predicate-guard-sepolia.ts
 *
 * Requires: forge (Foundry), RPC_URL_BASE_SEPOLIA, DEPLOYER_PRIVATE_KEY (funded).
 * After it prints the address, set PREDICATE_GUARD_ADDRESS in .env (+ Vercel).
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { PREDICATE_GUARD_ABI, registerPredicateBound } from "@clb-acel/predicate-adapter";
import {
  GUARD_CHAIN_ID,
  GUARD_MANDATE_DIGEST,
  demoPredicateConfigs,
} from "../apps/web-demo/src/server/clb/predicate-guard";

const CONTRACTS_DIR = resolve(import.meta.dir, "../contracts");
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;

function deployGuard(rpc: string, key: Hex): Address {
  const out = execFileSync(
    "forge",
    [
      "create",
      "src/PredicatePaymentGuard.sol:PredicatePaymentGuard",
      "--rpc-url",
      rpc,
      "--private-key",
      key,
      "--broadcast",
      "--constructor-args",
      String(GUARD_CHAIN_ID),
    ],
    { cwd: CONTRACTS_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const address = out.match(/Deployed to:\s*(0x[0-9a-fA-F]{40})/)?.[1];
  if (!address) throw new Error(`could not parse deployed address:\n${out}`);
  return address as Address;
}

async function main() {
  const rpc = process.env.RPC_URL_BASE_SEPOLIA?.trim();
  const key = process.env.DEPLOYER_PRIVATE_KEY?.trim() as Hex | undefined;
  if (!rpc || !key) throw new Error("RPC_URL_BASE_SEPOLIA + DEPLOYER_PRIVATE_KEY required");

  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });

  // Idempotent: reuse an already-deployed guard (PREDICATE_GUARD_ADDRESS) so we can
  // add/register predicates without redeploying.
  let guard = process.env.PREDICATE_GUARD_ADDRESS?.trim() as Address | undefined;
  if (guard) {
    console.log(`• Reusing guard at ${guard}`);
  } else {
    console.log("Deploying PredicatePaymentGuard to Base Sepolia…");
    guard = deployGuard(rpc, key);
    console.log(`✓ Deployed: ${guard}`);
  }

  for (const { predicateId, config } of demoPredicateConfigs()) {
    // The legacy `registerPredicate` path can no longer settle (the guard reverts
    // `PredicateNotBound`), so register through the human-bound path as the
    // deployer principal. The demo settle path in apps/web-demo passes a ZERO
    // extras digest and GUARD_MANDATE_DIGEST, so the binding pins exactly those.
    const already = await publicClient.readContract({
      address: guard,
      abi: PREDICATE_GUARD_ABI,
      functionName: "isBound",
      args: [predicateId],
    });
    if (already) {
      console.log(`• Predicate "${predicateId}" already bound`);
      continue;
    }
    const txHash = await registerPredicateBound(
      { publicClient, walletClient, account },
      {
        address: guard,
        predicateId,
        config,
        principal: account.address,
        mandateDigest: GUARD_MANDATE_DIGEST,
        taskHash: ZERO_BYTES32,
        extraFieldsDigest: ZERO_BYTES32,
      },
    );
    console.log(`✓ Registered bound predicate "${predicateId}" (tx ${txHash})`);
  }

  console.log(`\nGuard: ${guard}\nEnsure .env (and Vercel) has:\n  PREDICATE_GUARD_ADDRESS=${guard}\n`);
}

main().catch((error) => {
  console.error(`\n✗ deploy failed: ${error.message}`);
  process.exit(1);
});
