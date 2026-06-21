import express from "express";
import axios from "axios";
import { CONFIG } from "../shared/config.js";

const app = express();
app.use(express.json());

const FACILITATOR_URL = `http://localhost:${CONFIG.FACILITATOR_PORT}`;

const grants = new Map(); // payment_id → grant record
let idempotencyEnabled = false;
let receiverAddress = "";

const stats = {
  totalRequests: 0,
  grantCount: 0,
  grantDuplicate: 0,
  rejectCount: 0,
};

app.post("/configure", (req, res) => {
  if (req.body.idempotency !== undefined) idempotencyEnabled = !!req.body.idempotency;
  if (req.body.receiver) receiverAddress = req.body.receiver;
  grants.clear();
  Object.keys(stats).forEach((k) => (stats[k] = 0));
  res.json({ idempotencyEnabled, receiverAddress });
});

app.get("/api/data", async (req, res) => {
  stats.totalRequests++;
  const xPayment = req.headers["x-payment"];

  if (!xPayment) {
    return res.status(402).json({
      paymentRequirements: {
        resource_id: CONFIG.RESOURCE_ID,
        amount: CONFIG.RESOURCE_PRICE_USDC,
        token: "USDC",
        chain_id: CONFIG.CHAIN_ID,
        receiver: receiverAddress,
      },
    });
  }

  try {
    const verifyRes = await axios.post(`${FACILITATOR_URL}/verify`, {
      paymentPayload: xPayment,
    });

    if (!verifyRes.data.verified) {
      stats.rejectCount++;
      return res.status(401).json({ error: "Payment verification failed" });
    }

    const payId = verifyRes.data.payment_id;

    if (idempotencyEnabled && grants.has(payId)) {
      stats.grantDuplicate++;
      return res.status(409).json({
        error: "Duplicate payment",
        payment_id: payId,
      });
    }

    grants.set(payId, { granted_at: Date.now() });
    stats.grantCount++;

    axios.post(`${FACILITATOR_URL}/settle`, { paymentPayload: xPayment }).catch(() => {});

    return res.status(200).json({
      data: { message: "Protected resource", ts: new Date().toISOString() },
      payment: { payment_id: payId, status: "accepted" },
    });
  } catch (err) {
    stats.rejectCount++;
    return res.status(500).json({ error: "Facilitator unavailable" });
  }
});

app.get("/stats", (_req, res) => {
  res.json({ ...stats, idempotencyEnabled, uniqueGrants: grants.size });
});

app.post("/reset", (_req, res) => {
  grants.clear();
  Object.keys(stats).forEach((k) => (stats[k] = 0));
  res.json({ message: "reset" });
});

const port = CONFIG.RESOURCE_SERVER_PORT;

export function startResourceServer() {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[ResourceServer] listening on :${port}`);
      resolve(server);
    });
  });
}
