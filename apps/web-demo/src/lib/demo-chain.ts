import type { Chain } from "viem";
import { baseSepolia, mainnet } from "viem/chains";

export function chainLabel(chainId: number): string {
  if (chainId === 31337) return "Anvil Local";
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 1) return "Ethereum Mainnet";
  return `Chain ${chainId}`;
}

/** Browser-visible RPC for wallet add/switch (Vercel + remote Anvil). */
export function demoRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_ANVIL_RPC_URL?.trim() ||
    "http://127.0.0.1:8545"
  );
}

export function chainForId(chainId: number): Chain {
  if (chainId === baseSepolia.id) return baseSepolia;
  if (chainId === mainnet.id) return mainnet;
  const rpc = demoRpcUrl();
  return {
    id: chainId,
    name: chainLabel(chainId),
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  };
}
