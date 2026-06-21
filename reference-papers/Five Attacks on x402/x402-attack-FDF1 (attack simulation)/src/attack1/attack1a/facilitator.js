/**
 * Facilitator used by Attack I.
 *
 * Modes: honest, optimistic-bug, byzantine.
 */

import express from "express";
import { ethers } from "ethers";
import { decodePaymentPayload } from "../shared/crypto.js";
import { getContractArtifact } from "../shared/contract.js";

export function createAttack1Facilitator(config) {
  const app = express();
  app.use(express.json());

  let provider;
  let relayers = [];
  let honestyMode = "honest"; // honest | optimistic-bug | byzantine
  let verifyResponseDelayMs = 0;
  let nextRelayerIndex = 0;

  const stats = {
    verifyCount: 0,
    settleCount: 0,
    settleSuccess: 0,
    settleReverted: 0,
    errorKinds: {},
    relayerUsage: {},
  };

  // Submitted settlement transactions for diagnostics.
  const settledTxs = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function resetRelayerQueues() {
    nextRelayerIndex = 0;
    for (const relayer of relayers) {
      relayer.queue = Promise.resolve();
      relayer.queueDepth = 0;
      relayer.submitted = 0;
    }
  }

  function enqueueOnRelayer(relayer, task) {
    relayer.queueDepth++;
    const run = relayer.queue.then(task, task);
    relayer.queue = run.then(
      () => {
        relayer.queueDepth--;
      },
      () => {
        relayer.queueDepth--;
      }
    );
    return run;
  }

  function pickRelayer() {
    if (relayers.length === 0) {
      throw new Error("Facilitator relayer pool is not initialized");
    }

    const startIndex = nextRelayerIndex % relayers.length;
    let best = relayers[startIndex];

    for (let offset = 1; offset < relayers.length; offset++) {
      const candidate = relayers[(startIndex + offset) % relayers.length];
      if (candidate.queueDepth < best.queueDepth) {
        best = candidate;
      }
    }

    nextRelayerIndex = (best.index + 1) % relayers.length;
    return best;
  }

  function recordError(kind, err) {
    const raw = err?.shortMessage || err?.reason || err?.message || String(err);
    const key = `${kind}:${raw}`.slice(0, 200);
    stats.errorKinds[key] = (stats.errorKinds[key] || 0) + 1;
  }

  app.post("/configure", (req, res) => {
    if (req.body.mode) honestyMode = req.body.mode;
    if (req.body.verifyResponseDelayMs !== undefined) {
      verifyResponseDelayMs = req.body.verifyResponseDelayMs;
    }
    resetRelayerQueues();
    settledTxs.length = 0;
    stats.verifyCount = 0;
    stats.settleCount = 0;
    stats.settleSuccess = 0;
    stats.settleReverted = 0;
    stats.errorKinds = {};
    stats.relayerUsage = {};
    res.json({ honestyMode, verifyResponseDelayMs, relayerCount: relayers.length });
  });

  async function initChain(usdcAddress, rpcUrl) {
    provider = new ethers.JsonRpcProvider(rpcUrl);
    const accounts = await provider.listAccounts();
    const artifact = getContractArtifact();
    const desiredRelayerCount = Number.isFinite(config.relayerCount)
      ? Math.max(1, config.relayerCount)
      : 1;

    if (accounts.length - 1 < desiredRelayerCount) {
      throw new Error(
        `Need ${desiredRelayerCount} relayer accounts, only ${Math.max(accounts.length - 1, 0)} available`
      );
    }

    relayers = [];
    for (let i = 0; i < desiredRelayerCount; i++) {
      const account = accounts[i + 1];
      const signer = new ethers.NonceManager(await provider.getSigner(account.address));
      relayers.push({
        index: i,
        address: account.address,
        signer,
        usdc: new ethers.Contract(usdcAddress, artifact.abi, signer),
        queue: Promise.resolve(),
        queueDepth: 0,
        submitted: 0,
      });
    }

    resetRelayerQueues();
    console.log(
      `[Facilitator-A1] chain connected, mode=${honestyMode}, relayers=${relayers.length}`
    );
  }

  async function respondVerify(res, payload, statusCode = 200) {
    if (verifyResponseDelayMs > 0) {
      await sleep(verifyResponseDelayMs);
    }
    return res.status(statusCode).json(payload);
  }

  app.post("/verify", async (req, res) => {
    stats.verifyCount++;
    const {
      paymentPayload: encoded,
      expectedReceiver,
      expectedAmount,
    } = req.body;

    if (honestyMode === "byzantine") {
      return respondVerify(res, { verified: true, payment_id: "byzantine-fake" });
    }

    try {
      const pp = decodePaymentPayload(encoded);
      const domain = {
        name: "USD Coin",
        version: "1",
        chainId: config.chainId,
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
      const now = Math.floor(Date.now() / 1000);
      const validSignature = recovered.toLowerCase() === pp.from.toLowerCase();
      const receiverMatches = !expectedReceiver
        || pp.to.toLowerCase() === expectedReceiver.toLowerCase();
      const amountMatches = expectedAmount === undefined
        || BigInt(pp.value) === BigInt(expectedAmount);
      const timeWindowValid = now >= Number(pp.validAfter) && now <= Number(pp.validBefore);
      const valid = validSignature && receiverMatches && amountMatches && timeWindowValid;

      return respondVerify(res, { verified: valid, payment_id: pp.nonce });
    } catch (err) {
      return respondVerify(res, { verified: false, error: err.message }, 400);
    }
  });

  app.post("/settle", async (req, res) => {
    stats.settleCount++;
    const { paymentPayload: encoded, awaitReceipt = true } = req.body;

    if (honestyMode === "byzantine") {
      return res.json({
        settled: true,
        tx_hash: "0x" + "b".repeat(64),
        confirmations: 0,
        submittedOnly: !awaitReceipt,
      });
    }

    const pp = decodePaymentPayload(encoded);

    const relayer = pickRelayer();
    stats.relayerUsage[relayer.address] = (stats.relayerUsage[relayer.address] || 0) + 1;

    // Serialize submission per relayer; receipt waits run outside the queue.
    let tx;
    try {
      tx = await enqueueOnRelayer(relayer, async () => {
        relayer.submitted++;
        return await relayer.usdc.transferWithAuthorization(
          pp.from,
          pp.to,
          BigInt(pp.value),
          pp.validAfter,
          pp.validBefore,
          pp.nonce,
          pp.v,
          pp.r,
          pp.s
        );
      });
    } catch (err) {
      stats.settleReverted++;
      recordError("send", err);
      return res.json({ settled: false, error: err.reason || err.message });
    }

    try {
      if (honestyMode === "optimistic-bug" || !awaitReceipt) {
        let receipt = null;
        try {
          // Do not block optimistic settlement on receipt indexing.
          receipt = await provider.getTransactionReceipt(tx.hash);
        } catch {
          receipt = null;
        }
        stats.settleSuccess++;
        settledTxs.push({
          hash: tx.hash,
          nonce: pp.nonce,
          time: Date.now(),
          submittedOnly: true,
          relayer: relayer.address,
        });
        return res.json({
          settled: true,
          tx_hash: tx.hash,
          blockNumber: receipt?.blockNumber ?? null,
          confirmations: receipt ? 1 : 0,
          submittedOnly: true,
        });
      }

      const receipt = await tx.wait();
      stats.settleSuccess++;
      settledTxs.push({
        hash: receipt.hash,
        nonce: pp.nonce,
        time: Date.now(),
        submittedOnly: false,
        relayer: relayer.address,
      });
      return res.json({
        settled: true,
        tx_hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        confirmations: 1,
        submittedOnly: false,
      });
    } catch (err) {
      stats.settleReverted++;
      recordError("receipt", err);
      return res.json({ settled: false, error: err.reason || err.message });
    }
  });

  app.get("/stats", (_req, res) => res.json({
    ...stats,
    honestyMode,
    verifyResponseDelayMs,
    relayerCount: relayers.length,
    relayers: relayers.map((relayer) => ({
      address: relayer.address,
      queueDepth: relayer.queueDepth,
      submitted: relayer.submitted,
    })),
    settledTxCount: settledTxs.length,
  }));
  app.get("/settled-txs", (_req, res) => res.json(settledTxs));
  app.post("/reset", (_req, res) => {
    resetRelayerQueues();
    settledTxs.length = 0;
    stats.verifyCount = 0;
    stats.settleCount = 0;
    stats.settleSuccess = 0;
    stats.settleReverted = 0;
    stats.errorKinds = {};
    stats.relayerUsage = {};
    res.json({ ok: true });
  });

  return { app, initChain };
}
