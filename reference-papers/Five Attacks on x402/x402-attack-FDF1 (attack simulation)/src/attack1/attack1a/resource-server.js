/**
 * Resource server for Attack I.
 *
 * The optimistic policy grants after verification. The conservative policy
 * waits for settlement and k confirmations before granting.
 */

import express from "express";
import axios from "axios";
import { ethers } from "ethers";

export function createAttack1Server(config) {
  const app = express();
  app.use(express.json());

  let kRequired = 0; // number of confirmations required before granting
  let receiverAddress = "";
  let provider = null; // set via configure
  let executionPolicy = "optimistic"; // optimistic | conservative

  const grants = []; // { payment_id, tx_hash, grant_time, confirmations_at_grant }
  const pendingSettlements = new Set();

  const stats = {
    totalRequests: 0,
    grantCount: 0,
    rejectCount: 0,
    rejectKinds: {},
    asyncSettleStarted: 0,
    asyncSettleCompleted: 0,
    asyncSettleFailed: 0,
  };

  const FACILITATOR_URL = `http://localhost:${config.facilitatorPort}`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function recordReject(kind, detail = "") {
    const key = detail ? `${kind}:${detail}`.slice(0, 200) : kind;
    stats.rejectKinds[key] = (stats.rejectKinds[key] || 0) + 1;
  }

  app.post("/configure", (req, res) => {
    if (req.body.k !== undefined) kRequired = req.body.k;
    if (req.body.receiver) receiverAddress = req.body.receiver;
    if (req.body.rpcUrl) provider = new ethers.JsonRpcProvider(req.body.rpcUrl);
    if (req.body.executionPolicy) executionPolicy = req.body.executionPolicy;
    grants.length = 0;
    stats.totalRequests = 0;
    stats.grantCount = 0;
    stats.rejectCount = 0;
    stats.rejectKinds = {};
    stats.asyncSettleStarted = 0;
    stats.asyncSettleCompleted = 0;
    stats.asyncSettleFailed = 0;
    res.json({ kRequired, receiverAddress, executionPolicy });
  });

  function trackPendingSettlement(promise) {
    pendingSettlements.add(promise);
    promise.finally(() => pendingSettlements.delete(promise));
    return promise;
  }

  function markSettlementSuccess(grantRecord, settleData) {
    grantRecord.tx_hash = settleData.tx_hash;
    grantRecord.blockNumber = settleData.blockNumber ?? null;
    grantRecord.submittedOnly = settleData.submittedOnly || false;
    grantRecord.settle_status = "settled";
    grantRecord.settle_error = null;
    grantRecord.settle_response_time = Date.now();
  }

  function markSettlementFailure(grantRecord, error) {
    grantRecord.settle_status = "failed";
    grantRecord.settle_error = `${error}`.slice(0, 200);
    grantRecord.settle_response_time = Date.now();
  }

  async function startBackgroundSettlement(xPayment, grantRecord) {
    stats.asyncSettleStarted++;
    try {
      const settleRes = await axios.post(`${FACILITATOR_URL}/settle`, {
        paymentPayload: xPayment,
        awaitReceipt: false,
      });
      if (!settleRes.data.settled) {
        stats.asyncSettleFailed++;
        markSettlementFailure(grantRecord, settleRes.data.error || "Settlement failed");
        return;
      }
      stats.asyncSettleCompleted++;
      markSettlementSuccess(grantRecord, settleRes.data);
    } catch (err) {
      stats.asyncSettleFailed++;
      const message = err.response?.data?.error || err.message || "unknown";
      markSettlementFailure(grantRecord, message);
    }
  }

  app.get("/api/data", async (req, res) => {
    stats.totalRequests++;
    const xPayment = req.headers["x-payment"];

    if (!xPayment) {
      return res.status(402).json({
        paymentRequirements: {
          amount: config.price,
          receiver: receiverAddress,
        },
      });
    }

    try {
      const verifyRes = await axios.post(`${FACILITATOR_URL}/verify`, {
        paymentPayload: xPayment,
        expectedReceiver: receiverAddress,
        expectedAmount: String(config.price),
      });
      if (!verifyRes.data.verified) {
        stats.rejectCount++;
        recordReject("verify_failed");
        return res.status(401).json({ error: "Verification failed" });
      }

      if (executionPolicy === "optimistic") {
        const grantRecord = {
          payment_id: verifyRes.data.payment_id,
          tx_hash: null,
          grant_time: Date.now(),
          kRequired,
          executionPolicy,
          blockNumber: null,
          submittedOnly: true,
          settle_status: "pending",
          settle_error: null,
          settle_response_time: null,
        };
        grants.push(grantRecord);
        stats.grantCount++;

        trackPendingSettlement(startBackgroundSettlement(xPayment, grantRecord));

        return res.status(200).json({
          data: { message: "Protected resource", ts: new Date().toISOString() },
          payment: grantRecord,
        });
      }

      const settleRes = await axios.post(`${FACILITATOR_URL}/settle`, {
        paymentPayload: xPayment,
        awaitReceipt: true,
      });
      if (!settleRes.data.settled) {
        stats.rejectCount++;
        recordReject("settle_failed", settleRes.data.error || "");
        return res.status(402).json({ error: "Settlement failed" });
      }

      const txBlockNumber = settleRes.data.blockNumber;

      // Blocks are produced by the harness, not by request handlers.
      if (executionPolicy === "conservative" && kRequired > 0 && provider && txBlockNumber) {
        const maxWaitMs = kRequired * 30_000 + 10_000; // generous timeout
        const pollIntervalMs = 100;
        const deadline = Date.now() + maxWaitMs;
        let actualConfirmations = 0;

        while (actualConfirmations < kRequired && Date.now() < deadline) {
          const currentBlock = await provider.getBlockNumber();
          actualConfirmations = currentBlock - txBlockNumber + 1;
          if (actualConfirmations < kRequired) {
            await sleep(pollIntervalMs);
          }
        }

        if (actualConfirmations < kRequired) {
          stats.rejectCount++;
          recordReject("confirmation_timeout");
          return res.status(402).json({
            error: `Timeout: ${actualConfirmations}/${kRequired} confirmations after ${maxWaitMs}ms`,
          });
        }
      }

      const grantRecord = {
        payment_id: verifyRes.data.payment_id,
        tx_hash: settleRes.data.tx_hash,
        grant_time: Date.now(),
        kRequired,
        executionPolicy,
        blockNumber: txBlockNumber,
        submittedOnly: settleRes.data.submittedOnly || false,
        settle_status: "settled",
        settle_error: null,
        settle_response_time: Date.now(),
      };
      grants.push(grantRecord);
      stats.grantCount++;

      return res.status(200).json({
        data: { message: "Protected resource", ts: new Date().toISOString() },
        payment: grantRecord,
      });
    } catch (err) {
      stats.rejectCount++;
      recordReject("server_error", err.message || "");
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/stats", (_req, res) => res.json({
    ...stats,
    executionPolicy,
    kRequired,
    pendingSettlements: pendingSettlements.size,
  }));
  app.get("/grants", (_req, res) => res.json(grants));
  app.post("/await-settlements", async (_req, res) => {
    await Promise.allSettled([...pendingSettlements]);
    res.json({ pendingSettlements: pendingSettlements.size, grants: grants.length });
  });
  app.post("/reset", (_req, res) => {
    grants.length = 0;
    stats.totalRequests = 0;
    stats.grantCount = 0;
    stats.rejectCount = 0;
    stats.rejectKinds = {};
    stats.asyncSettleStarted = 0;
    stats.asyncSettleCompleted = 0;
    stats.asyncSettleFailed = 0;
    res.json({ ok: true });
  });

  return app;
}
