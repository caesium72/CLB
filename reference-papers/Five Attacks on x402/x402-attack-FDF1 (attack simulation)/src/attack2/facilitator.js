import express from "express";
import { ethers } from "ethers";
import { decodePaymentPayload } from "../shared/crypto.js";
import { getContractArtifact } from "../shared/contract.js";
import { CONFIG } from "../shared/config.js";

const app = express();
app.use(express.json());

let provider, facilitatorWallet, usdc;

const settledPayIds = new Map(); // nonce → tx result
let idempotencyEnabled = false;

const stats = {
  verifyCount: 0,
  settleCount: 0,
  settleSuccess: 0,      // on-chain tx succeeded
  settleReverted: 0,     // on-chain tx reverted (e.g. nonce reuse)
  settleDuplicate: 0,    // caught by app-layer idempotency
};

export async function initChain(usdcAddress) {
  provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const accounts = await provider.listAccounts();
  facilitatorWallet = await provider.getSigner(accounts[1].address);

  const artifact = getContractArtifact();
  usdc = new ethers.Contract(usdcAddress, artifact.abi, facilitatorWallet);

  console.log(`[Facilitator] Connected to chain, USDC=${usdcAddress}, wallet=${facilitatorWallet.address}`);
}

app.post("/configure", (req, res) => {
  if (req.body.idempotency !== undefined) {
    idempotencyEnabled = !!req.body.idempotency;
  }
  settledPayIds.clear();
  Object.keys(stats).forEach((k) => (stats[k] = 0));
  res.json({ idempotencyEnabled });
});

app.post("/verify", (req, res) => {
  stats.verifyCount++;
  const { paymentPayload: encoded } = req.body;
  if (!encoded) return res.status(400).json({ error: "Missing paymentPayload" });

  try {
    const pp = decodePaymentPayload(encoded);

    const domain = {
      name: "USD Coin",
      version: "1",
      chainId: CONFIG.CHAIN_ID,
      verifyingContract: pp.usdcAddress,
    };
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };
    const message = {
      from: pp.from,
      to: pp.to,
      value: BigInt(pp.value),
      validAfter: pp.validAfter,
      validBefore: pp.validBefore,
      nonce: pp.nonce,
    };

    const sig = ethers.Signature.from({ v: pp.v, r: pp.r, s: pp.s });
    const recovered = ethers.verifyTypedData(domain, types, message, sig);

    const valid = recovered.toLowerCase() === pp.from.toLowerCase();

    return res.json({
      verified: valid,
      payment_id: pp.nonce,
      payer: recovered,
    });
  } catch (err) {
    return res.status(400).json({ verified: false, error: err.message });
  }
});

app.post("/settle", async (req, res) => {
  stats.settleCount++;
  const { paymentPayload: encoded } = req.body;
  if (!encoded) return res.status(400).json({ error: "Missing paymentPayload" });

  const pp = decodePaymentPayload(encoded);
  const payId = pp.nonce;

  if (idempotencyEnabled && settledPayIds.has(payId)) {
    stats.settleDuplicate++;
    return res.json({
      settled: false,
      duplicate: true,
      payment_id: payId,
      reason: "app-layer-idempotency",
    });
  }

  try {
    const tx = await usdc.transferWithAuthorization(
      pp.from,
      pp.to,
      BigInt(pp.value),
      pp.validAfter,
      pp.validBefore,
      pp.nonce,
      pp.v,
      pp.r,
      pp.s,
    );
    const receipt = await tx.wait();

    settledPayIds.set(payId, { tx_hash: receipt.hash, status: "success" });
    stats.settleSuccess++;

    return res.json({
      settled: true,
      payment_id: payId,
      tx_hash: receipt.hash,
      blockNumber: receipt.blockNumber,
    });
  } catch (err) {
    stats.settleReverted++;
    settledPayIds.set(payId, { status: "reverted", error: err.message });

    return res.json({
      settled: false,
      payment_id: payId,
      reason: "on-chain-revert",
      error: err.reason || err.message,
    });
  }
});

app.get("/stats", (_req, res) => {
  res.json({ ...stats, idempotencyEnabled, uniqueSettlements: settledPayIds.size });
});

app.post("/reset", (_req, res) => {
  settledPayIds.clear();
  Object.keys(stats).forEach((k) => (stats[k] = 0));
  res.json({ message: "reset" });
});

const port = CONFIG.FACILITATOR_PORT;

export function startFacilitator(usdcAddress) {
  return initChain(usdcAddress).then(() => {
    return new Promise((resolve) => {
      const server = app.listen(port, () => {
        console.log(`[Facilitator] listening on :${port} | idempotency=${idempotencyEnabled}`);
        resolve(server);
      });
    });
  });
}
