// Live endpoint settings. The committed artifact keeps URLs and wallets out
// of source; operators provide them through .env.

const {
  ENDPOINT_1_URL,
  ENDPOINT_1_PAY_TO,
  ENDPOINT_1_AMOUNT,
  ENDPOINT_1_METHOD,
  ENDPOINT_1_BODY,
  ENDPOINT_1_HEADER_NAME,
  ENDPOINT_2_URL,
  ENDPOINT_2_PAY_TO,
  ENDPOINT_2_AMOUNT,
  ENDPOINT_2_METHOD,
  ENDPOINT_2_BODY,
  ENDPOINT_2_HEADER_NAME,
  BASE_SEPOLIA_RPC_URL,
} = process.env;

export const TESTNET = {
  RPC_URL: BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
  CHAIN_ID: 84532,
  CHAIN_CAIP2: "eip155:84532",

  USDC_ADDRESS: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  USDC_DECIMALS: 6,
  USDC_NAME: "USDC",
  USDC_VERSION: "2",

  TARGETS: {
    endpoint1: {
      url: ENDPOINT_1_URL || "",
      amount: ENDPOINT_1_AMOUNT || "100",
      payTo: ENDPOINT_1_PAY_TO || "",
      maxTimeoutSeconds: 300,
      method: ENDPOINT_1_METHOD || "GET",
      body: ENDPOINT_1_BODY || null,
      headerName: ENDPOINT_1_HEADER_NAME || "x-payment",
    },
    endpoint2: {
      url: ENDPOINT_2_URL || "",
      amount: ENDPOINT_2_AMOUNT || "1000",
      payTo: ENDPOINT_2_PAY_TO || "",
      maxTimeoutSeconds: 60,
      method: ENDPOINT_2_METHOD || "POST",
      body:
        ENDPOINT_2_BODY ||
        JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_blockNumber",
          params: [],
          id: 1,
        }),
      headerName: ENDPOINT_2_HEADER_NAME || "payment-signature",
    },
  },
};

export function requireEndpoint(key) {
  const ep = TESTNET.TARGETS[key];
  if (!ep || !ep.url || !ep.payTo) {
    const up = key.toUpperCase();
    throw new Error(
      `Endpoint '${key}' is not configured. Set ${up}_URL and ${up}_PAY_TO ` +
        `(plus ${up}_AMOUNT / ${up}_METHOD / ${up}_BODY / ${up}_HEADER_NAME as needed) ` +
        `in your .env. See .env.example.`
    );
  }
  return ep;
}
