// Shared configuration for x402 Attack II experiment
export const CONFIG = {
  RESOURCE_SERVER_PORT: 3400,
  FACILITATOR_PORT: 3401,

  // Hardhat local chain
  RPC_URL: "http://127.0.0.1:8545",
  CHAIN_ID: 31337,  // Hardhat default

  // Resource settings
  RESOURCE_PRICE_USDC: 10000,   // 0.01 USDC (6 decimals)
  RESOURCE_ID: "/api/data",

  // Experiment parameters (Table 4)
  REPLAY_COUNTS: [1, 5, 10, 50],

  // Mint amount for payer
  PAYER_MINT_AMOUNT: 1000000000, // 1000 USDC
};
