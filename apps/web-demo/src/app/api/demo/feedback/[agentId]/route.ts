import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseAbi, zeroHash } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ensureMonorepoEnv } from "@/server/clb/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

ensureMonorepoEnv();

/** Canonical ERC-8004 ReputationRegistry (Base Sepolia, behind an ERC1967 proxy). */
const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;
const GIVE_FEEDBACK_ABI = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash) external",
]);

type RawFeedback = {
  score?: number;
  comment?: string | null;
  user_id?: string;
  user_address?: string;
  created_at?: string;
  transaction_hash?: string;
  feedback_uri?: string;
  tag1?: string;
  tag2?: string;
  agent?: { token_id?: string };
};

/**
 * Live ERC-8004 reputation for an agent, read from the 8004scan testnet Feedbacks
 * API. The X-API-Key is server-side only (root .env, never shipped to the client).
 * Read-only: this proves real on-chain feedback exists for the paid agent.
 */
export async function GET(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  // Only canonical numeric ids resolve on 8004scan.
  if (!/^\d+$/.test(agentId)) {
    return NextResponse.json({ agentId, count: 0, averageScore: null, items: [] });
  }

  const key = process.env.SCAN_8004_API_KEY?.trim();
  const url = `https://testnet.8004scan.io/api/v1/public/feedbacks?chainId=84532&tokenId=${agentId}&limit=50`;
  try {
    const response = await fetch(url, {
      headers: key ? { "X-API-Key": key } : {},
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({
        agentId,
        count: 0,
        averageScore: null,
        items: [],
        error: `8004scan responded ${response.status}`,
      });
    }
    const payload = await response.json();
    const raw: RawFeedback[] = Array.isArray(payload)
      ? payload
      : (payload?.data ?? payload?.feedbacks ?? []);
    // The public API does not reliably narrow by tokenId, so filter to THIS agent's
    // feedback ourselves — otherwise every agent shows the same global reviews.
    const mine = raw.filter((feedback) => !feedback.agent?.token_id || feedback.agent.token_id === agentId);
    const items = mine.map((feedback) => ({
      score: typeof feedback.score === "number" ? feedback.score : null,
      comment: feedback.comment ?? "",
      user: feedback.user_address ?? feedback.user_id ?? "",
      createdAt: feedback.created_at ?? "",
      tags: [feedback.tag1, feedback.tag2].filter((tag): tag is string => Boolean(tag)),
      txHash: feedback.transaction_hash ?? "",
      proofUri: feedback.feedback_uri ?? "",
    }));
    const scores = items
      .map((item) => item.score)
      .filter((score): score is number => typeof score === "number");
    const averageScore = scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : null;

    return NextResponse.json({ agentId, count: items.length, averageScore, items: items.slice(0, 5) });
  } catch (error) {
    return NextResponse.json({
      agentId,
      count: 0,
      averageScore: null,
      items: [],
      error: error instanceof Error ? error.message : "feedback fetch failed",
    });
  }
}

/**
 * Submit REAL on-chain ERC-8004 feedback for the paid agent via giveFeedback on the
 * canonical ReputationRegistry. The client is a funded non-owner key (the shopping
 * agent), since the contract rejects self-feedback. Simulate-first so a bad call
 * never spends gas. The cleartext key stays server-side (root .env).
 */
export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  if (!/^\d+$/.test(agentId)) {
    return NextResponse.json({ error: "Only canonical numeric agents accept feedback" }, { status: 400 });
  }

  let body: { score?: unknown; feedbackURI?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const rawScore = Number(body.score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 90;
  // feedbackURI is OPTIONAL and must be a real resolvable URL — point it at the
  // settlement transaction (the on-chain proof of the interaction), else leave empty.
  const rawUri = typeof body.feedbackURI === "string" ? body.feedbackURI.trim() : "";
  const feedbackURI = /^https?:\/\//.test(rawUri) ? rawUri : "";

  const rpc = process.env.RPC_URL_BASE_SEPOLIA?.trim() || process.env.RPC_URL?.trim();
  const clientKey = (
    process.env.FEEDBACK_CLIENT_PRIVATE_KEY?.trim() || process.env.SHOPPING_AGENT_PRIVATE_KEY?.trim()
  ) as `0x${string}` | undefined;
  if (!rpc || !clientKey) {
    return NextResponse.json(
      { error: "Feedback signer not configured (RPC_URL_BASE_SEPOLIA + a non-owner client key)" },
      { status: 503 },
    );
  }

  try {
    const account = privateKeyToAccount(clientKey);
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
    const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
    const args = [
      BigInt(agentId),
      BigInt(score),
      0,
      "clb-acel",
      "verified",
      "",
      feedbackURI,
      zeroHash,
    ] as const;

    const { request: simulated } = await publicClient.simulateContract({
      address: REPUTATION_REGISTRY,
      abi: GIVE_FEEDBACK_ABI,
      functionName: "giveFeedback",
      args,
      account,
    });
    const txHash = await walletClient.writeContract(simulated);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return NextResponse.json({
      agentId,
      score,
      txHash,
      status: receipt.status,
      url: `https://sepolia.basescan.org/tx/${txHash}`,
      feedbackURI: feedbackURI || null,
      client: account.address,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Feedback submission failed";
    const friendly = message.includes("Self-feedback")
      ? "This wallet owns the agent — feedback must come from a different (client) wallet."
      : message.includes("insufficient funds")
        ? "The feedback client wallet needs a little Base Sepolia ETH for gas."
        : message.split("\n")[0];
    return NextResponse.json({ error: friendly }, { status: 400 });
  }
}
