import { canonicalJson } from "@clb-acel/evidence-core";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

export const AGENTIC_AUDIT_ANCHOR_ABI = [
  {
    type: "function",
    name: "anchorTrace",
    stateMutability: "nonpayable",
    inputs: [
      { name: "traceId", type: "bytes32" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "traceHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isAnchored",
    stateMutability: "view",
    inputs: [{ name: "traceId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** Map a string trace id to the bytes32 key used by `AgenticAuditAnchor`. */
export function traceIdToBytes32(traceId: string): Hex {
  return keccak256(toBytes(traceId));
}

/** Default trace hash when no verification certificate is available yet. */
export function computeTraceHash(input: {
  traceId: string;
  merkleRoot: Hex;
  eventHashes: Hex[];
}): Hex {
  return keccak256(
    toBytes(
      canonicalJson({
        traceId: input.traceId,
        merkleRoot: input.merkleRoot,
        eventHashes: input.eventHashes,
      }),
    ),
  );
}

export function metadataUriForTrace(traceId: string): string {
  return `acel://traces/${traceId}`;
}

export type AnchorClientConfig = {
  contractAddress: Address;
  rpcUrl: string;
  privateKey: Hex;
  chainId?: number;
};

export type AnchorTraceInput = {
  traceId: string;
  merkleRoot: Hex;
  traceHash: Hex;
  metadataURI?: string;
};

export type AnchorTraceResult = {
  status: "ANCHORED";
  txHash: Hex;
  traceIdBytes32: Hex;
  merkleRoot: Hex;
  traceHash: Hex;
  metadataURI: string;
  contractAddress: Address;
};

export type AnchorClient = {
  isConfigured(): boolean;
  anchorTrace(input: AnchorTraceInput): Promise<AnchorTraceResult>;
};

function resolveChain(chainId: number) {
  if (chainId === baseSepolia.id) {
    return baseSepolia;
  }

  return {
    id: chainId,
    name: "custom",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  } as const;
}

/** Create a viem-backed anchor client. Returns null when env is incomplete. */
export function createAnchorClientFromEnv(): AnchorClient | null {
  const contractAddress = process.env.AUDIT_ANCHOR_ADDRESS?.trim();
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  const rpcUrl =
    process.env.RPC_URL?.trim() ??
    process.env.RPC_URL_BASE_SEPOLIA?.trim() ??
    (process.env.CHAIN_ID === "31337" || !process.env.CHAIN_ID ? "http://127.0.0.1:8545" : undefined);

  if (!contractAddress || !privateKey || !rpcUrl) {
    return null;
  }

  return createAnchorClient({
    contractAddress: contractAddress as Address,
    privateKey: privateKey as Hex,
    rpcUrl,
    chainId: Number(process.env.CHAIN_ID ?? 31337),
  });
}

export function createAnchorClient(config: AnchorClientConfig): AnchorClient {
  const chain = resolveChain(config.chainId ?? 31337);
  const account = privateKeyToAccount(config.privateKey);
  const transport = http(config.rpcUrl);

  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  async function requireAnchorContract(): Promise<void> {
    const bytecode = await publicClient.getBytecode({ address: config.contractAddress });
    if (!bytecode || bytecode === "0x") {
      throw new Error(
        `No contract bytecode at ${config.contractAddress}. Redeploy AgenticAuditAnchor to the current chain (Anvil resets wipe contract state).`,
      );
    }
  }

  return {
    isConfigured() {
      return true;
    },
    async anchorTrace(input) {
      await requireAnchorContract();

      const traceIdBytes32 = traceIdToBytes32(input.traceId);
      const metadataURI = input.metadataURI ?? metadataUriForTrace(input.traceId);

      const alreadyAnchored = await publicClient.readContract({
        address: config.contractAddress,
        abi: AGENTIC_AUDIT_ANCHOR_ABI,
        functionName: "isAnchored",
        args: [traceIdBytes32],
      });

      if (alreadyAnchored) {
        throw new Error(`Trace ${input.traceId} is already anchored on-chain`);
      }

      const txHash = await walletClient.writeContract({
        address: config.contractAddress,
        abi: AGENTIC_AUDIT_ANCHOR_ABI,
        functionName: "anchorTrace",
        args: [traceIdBytes32, input.merkleRoot, input.traceHash, metadataURI],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error(`anchorTrace transaction reverted: ${txHash}`);
      }

      // Public RPCs (e.g. sepolia.base.org) can lag state reads right after mining.
      let anchored = false;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        anchored = await publicClient.readContract({
          address: config.contractAddress,
          abi: AGENTIC_AUDIT_ANCHOR_ABI,
          functionName: "isAnchored",
          args: [traceIdBytes32],
        });
        if (anchored) break;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (!anchored) {
        throw new Error(
          `anchorTrace tx ${txHash} succeeded but isAnchored() is false — check AUDIT_ANCHOR_ADDRESS matches a live deploy`,
        );
      }

      return {
        status: "ANCHORED",
        txHash,
        traceIdBytes32,
        merkleRoot: input.merkleRoot,
        traceHash: input.traceHash,
        metadataURI,
        contractAddress: config.contractAddress,
      };
    },
  };
}
