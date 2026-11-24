import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  formatEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";

/**
 * Bridge a small amount of PoW-mined Sepolia ETH to Base Sepolia through the
 * canonical L1StandardBridge. Used only after the PoW faucet has funded the
 * signer on Sepolia. Never prints or stores the private key.
 */

const root = resolve(import.meta.dir, "..");
const envText = await readFile(resolve(root, ".env"), "utf8");
const readEnv = (name: string): string | undefined =>
  envText.split(/\r?\n/u).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).trim();

const key = readEnv("DEPLOYER_PRIVATE_KEY") as Hex | undefined;
if (!key || !/^0x[0-9a-fA-F]{64}$/u.test(key)) {
  console.log(JSON.stringify({ status: "NOT RUN", reason: "DEPLOYER_PRIVATE_KEY missing/invalid in .env" }, null, 2));
  process.exit(0);
}

const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const BASE_RPC = "https://sepolia.base.org";
const L1_STANDARD_BRIDGE: Address = "0xfd0Bf71F60660E2f608ed56e1659C450eB113120";
const BRIDGE_AMOUNT_ETH = process.env.BRIDGE_AMOUNT_ETH ?? "0.001";
const BRIDGE_ABI = parseAbi(["function depositETH(uint32 _minGasLimit, bytes _extraData) payable"]);

const account = privateKeyToAccount(key);
const l1 = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });
const l1Wallet = createWalletClient({ chain: sepolia, transport: http(SEPOLIA_RPC), account });
const l2 = createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC) });

const status = async () => ({
  signer: account.address,
  sepoliaBalance: formatEther(await l1.getBalance({ address: account.address })),
  baseSepoliaBalance: formatEther(await l2.getBalance({ address: account.address })),
});

const before = await status();
console.log("before:", JSON.stringify(before));

const needed = parseEther(BRIDGE_AMOUNT_ETH);
const available = await l1.getBalance({ address: account.address });
if (available < needed + parseEther("0.0003")) {
  console.log(
    JSON.stringify(
      {
        status: "NOT RUN",
        reason: "Sepolia balance too low to bridge + keep gas reserve",
        ...before,
        requestedEth: BRIDGE_AMOUNT_ETH,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const hash = await l1Wallet.writeContract({
  address: L1_STANDARD_BRIDGE,
  abi: BRIDGE_ABI,
  functionName: "depositETH",
  args: [200_000, "0x"],
  value: needed,
});
const receipt = await l1.waitForTransactionReceipt({ hash });
console.log(
  "bridge tx:",
  JSON.stringify({ hash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString() }),
);

let l2Balance = 0n;
for (let attempt = 0; attempt < 30; attempt += 1) {
  await new Promise((done) => setTimeout(done, 4000));
  l2Balance = await l2.getBalance({ address: account.address });
  if (l2Balance > 0n) break;
}

console.log(
  JSON.stringify(
    {
      status: l2Balance > 0n ? "BRIDGED" : "PENDING",
      signer: account.address,
      bridgeTxHash: hash,
      bridgeBlockNumber: receipt.blockNumber.toString(),
      l1TxExplorer: `https://sepolia.etherscan.io/tx/${hash}`,
      baseSepoliaBalance: formatEther(l2Balance),
      baseScan: "https://sepolia.basescan.org/address/" + account.address,
    },
    null,
    2,
  ),
);
