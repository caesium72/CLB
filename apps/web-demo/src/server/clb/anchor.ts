/**
 * In-process audit-anchor helpers (AgenticAuditAnchor.sol on Base Sepolia / Anvil).
 * Anchors the stored trace's Merkle root and reads anchor status, with no
 * evidence-service hop. Returns a PENDING_CONTRACT shape when env is incomplete.
 */
import {
  AGENTIC_AUDIT_ANCHOR_ABI,
  computeTraceHash,
  createAnchorClientFromEnv,
  metadataUriForTrace,
  traceIdToBytes32,
} from "@clb-acel/anchor-core";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { ensureMonorepoEnv } from "./env";
import { getTrace } from "./store";

ensureMonorepoEnv();

function anchorEnv() {
  const contractAddress = process.env.AUDIT_ANCHOR_ADDRESS?.trim();
  const rpcUrl =
    process.env.RPC_URL?.trim() ??
    process.env.RPC_URL_BASE_SEPOLIA?.trim() ??
    (process.env.CHAIN_ID === "31337" || !process.env.CHAIN_ID
      ? "http://127.0.0.1:8545"
      : undefined);
  const chainId = Number(process.env.CHAIN_ID ?? 84532);
  return { contractAddress, rpcUrl, chainId };
}

export async function anchorStored(traceId: string) {
  const trace = await getTrace(traceId);
  if (!trace) return { error: "Trace not found", status: 404 as const };

  const client = createAnchorClientFromEnv();
  const { contractAddress, chainId } = anchorEnv();
  const traceHash = computeTraceHash({
    traceId: trace.traceId,
    merkleRoot: trace.merkleRoot,
    eventHashes: trace.eventHashes,
  });

  if (!client) {
    return {
      status: "PENDING_CONTRACT" as const,
      configured: false,
      traceId,
      merkleRoot: trace.merkleRoot,
      traceHash,
      chainId,
      contractAddress: contractAddress ?? null,
      metadataURI: metadataUriForTrace(traceId),
    };
  }

  const result = await client.anchorTrace({
    traceId: trace.traceId,
    merkleRoot: trace.merkleRoot,
    traceHash,
    metadataURI: metadataUriForTrace(trace.traceId),
  });
  return { ...result, configured: true, chainId };
}

export async function anchorStatus(traceId: string) {
  const trace = await getTrace(traceId);
  if (!trace) return { error: "Trace not found", status: 404 as const };

  const { contractAddress, rpcUrl, chainId } = anchorEnv();
  const traceHash = computeTraceHash({
    traceId: trace.traceId,
    merkleRoot: trace.merkleRoot,
    eventHashes: trace.eventHashes,
  });
  const base = {
    traceId,
    merkleRoot: trace.merkleRoot,
    traceHash,
    chainId,
    contractAddress: contractAddress ?? null,
  };

  if (!contractAddress || !rpcUrl) {
    return { ...base, configured: false, anchored: false };
  }

  try {
    const publicClient = createPublicClient({ transport: http(rpcUrl) });
    const anchored = await publicClient.readContract({
      address: contractAddress as Address,
      abi: AGENTIC_AUDIT_ANCHOR_ABI,
      functionName: "isAnchored",
      args: [traceIdToBytes32(traceId) as Hex],
    });
    return { ...base, configured: true, anchored: Boolean(anchored) };
  } catch (error) {
    return {
      ...base,
      configured: true,
      anchored: false,
      readError: error instanceof Error ? error.message : "read failed",
    };
  }
}
