/**
 * Block-explorer + ERC-8004 explorer link helpers. Built from real on-chain
 * values so the demo's "see it for yourself" buttons resolve to the actual
 * settlement tx, Merkle-root anchor, validator entry, and agent identities.
 *
 * Base Sepolia (chain 84532): BaseScan at sepolia.basescan.org; ERC-8004 agent
 * identities on 8004scan testnet.
 */
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Canonical ERC-8004 Identity Registry on Base Sepolia. */
export const CANONICAL_REGISTRY_ADDRESS = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

/**
 * The grammar agent's payout wallet (GRAMMAR_AGENT key address) — used as a
 * concrete "what leaks today" example: its real incoming USDC payments are fully
 * public on BaseScan (amount + sender), in contrast to the confidential path.
 */
export const DEMO_MERCHANT_WALLET = "0x54Db78Db972b6e153d918e49758CB0D0265b5e4E";

const BASESCAN = "https://sepolia.basescan.org";
const SCAN_8004 = "https://testnet.8004scan.io";

export function txUrl(hash: string): string {
  return `${BASESCAN}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${BASESCAN}/address/${address}`;
}

/** ERC-8004 agent identity page on 8004scan testnet (format: /agents/{chain}/{id}). */
export function agentUrl(agentId: string, chain = "base-sepolia"): string {
  return `${SCAN_8004}/agents/${chain}/${agentId}`;
}

/**
 * Canonical ERC-8004 agent ids are numeric (e.g. 6827, 6823) and resolve on
 * 8004scan. Local/demo ids like "shopping-agent-001" (the buyer's own agent) are
 * not marketplace listings — only link the numeric ones.
 */
export function isOnChainAgentId(agentId: string): boolean {
  return /^\d+$/.test(agentId.trim());
}

/** The canonical Identity Registry contract on BaseScan. */
export function registryUrl(): string {
  return addressUrl(CANONICAL_REGISTRY_ADDRESS);
}
