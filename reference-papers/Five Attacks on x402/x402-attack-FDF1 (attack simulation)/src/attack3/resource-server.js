/**
 * Local origin for Attack III.
 *
 * It models the response-header behavior relevant to the cache experiment:
 * paid responses include PAYMENT-RESPONSE and, unless configured otherwise,
 * no Cache-Control header. It does not run full x402 verification.
 */

import express from "express";

export function createProxyTestServer(port = 3800) {
  const app = express();

  const receivedHeaders = [];
  const stats = { total: 0, granted: 0, rejected: 0 };
  let cacheControlEnabled = false;

  app.post("/configure", express.json(), (req, res) => {
    if (req.body.cacheControl !== undefined) {
      cacheControlEnabled = !!req.body.cacheControl;
    }
    receivedHeaders.length = 0;
    Object.keys(stats).forEach(k => stats[k] = 0);
    res.json({ ok: true, cacheControlEnabled });
  });

  app.get("/api/data", (req, res) => {
    stats.total++;

    const raw = req.rawHeaders;
    const allPaymentHeaders = [];
    for (let i = 0; i < raw.length; i += 2) {
      const name = raw[i].toLowerCase();
      if (name === "x-payment" || name === "payment-signature") {
        allPaymentHeaders.push({ name: raw[i], value: raw[i + 1] });
      }
    }

    const xPayment = req.headers["x-payment"] || req.headers["payment-signature"];

    receivedHeaders.push({
      xPayment: xPayment || null,
      allHeaders: allPaymentHeaders,
      headerCount: allPaymentHeaders.length,
      rawValue: req.headers["x-payment"],
      timestamp: Date.now(),
    });

    if (!xPayment) {
      stats.rejected++;
      return res.status(402).json({
        x402Version: 2,
        error: "Payment required",
        accepts: [],
      });
    }

    stats.granted++;

    res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({
      success: true,
      network: "eip155:84532",
      transaction: "0x" + "a".repeat(64),
    })).toString("base64"));

    if (cacheControlEnabled) {
      res.setHeader("Cache-Control", "no-store, private");
    }

    return res.status(200).json({
      data: {
        message: "Protected weather forecast data",
        temperature: 22.5,
        humidity: 65,
        secret: "PAID_CONTENT_" + Date.now(),
      },
    });
  });

  app.get("/stats", (_req, res) => res.json(stats));
  app.get("/received-headers", (_req, res) => res.json(receivedHeaders));
  app.post("/reset", express.json(), (_req, res) => {
    receivedHeaders.length = 0;
    Object.keys(stats).forEach(k => stats[k] = 0);
    res.json({ ok: true });
  });

  return new Promise(resolve => {
    const server = app.listen(port, () => {
      console.log(`[ResourceServer] :${port} (SDK-derived headers; Cache-Control configurable)`);
      resolve({ app, server });
    });
  });
}
