/**
 * Local proxy for duplicate-header trials.
 *
 * It forwards the client's payment header plus an injected X-PAYMENT value
 * so the origin can record how its HTTP stack resolves duplicates.
 */

import http from "http";

const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = 3800;
const PROXY_PORT = 8082;

let mode = "passthrough"; // passthrough | multi-header

const server = http.createServer((clientReq, clientRes) => {
  if (clientReq.url === "/configure" && clientReq.method === "POST") {
    let body = "";
    clientReq.on("data", d => body += d);
    clientReq.on("end", () => {
      const cfg = JSON.parse(body);
      if (cfg.mode) mode = cfg.mode;
      clientRes.writeHead(200, { "Content-Type": "application/json" });
      clientRes.end(JSON.stringify({ mode }));
    });
    return;
  }

  const originalXPayment = clientReq.headers["x-payment"];

  const proxyHeaders = {};

  for (const [key, val] of Object.entries(clientReq.headers)) {
    if (key.toLowerCase() === "x-payment") continue;
    if (key.toLowerCase() === "host") continue;
    proxyHeaders[key] = val;
  }

  if (originalXPayment) {
    if (mode === "multi-header") {
      proxyHeaders["x-payment"] = [originalXPayment, "INJECTED_FAKE_VALUE_" + Date.now()];
    } else {
      proxyHeaders["x-payment"] = originalXPayment;
    }
  }

  const proxyReq = http.request({
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: proxyHeaders,
  }, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });

  clientReq.pipe(proxyReq);

  proxyReq.on("error", (err) => {
    clientRes.writeHead(502);
    clientRes.end(JSON.stringify({ error: err.message }));
  });
});

server.listen(PROXY_PORT, () => {
  console.log(`[MitM Proxy] :${PROXY_PORT} | mode=${mode}`);
});

export default server;
