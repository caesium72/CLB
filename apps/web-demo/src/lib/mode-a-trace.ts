import { cache } from "react";
import { runHumanPresent, type Intent, type TraceResult } from "@clb-acel/agent-orchestrator/flow";

/**
 * Fixed demo intent + clock so every screen renders the exact same, fully
 * reproducible Mode A trace (stable commitment, nonce, Merkle root, and
 * verification certificate across page loads). The orchestrator flow runs
 * in-process so the demo works without standing up all backend services.
 */
const DEMO_CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);

const DEMO_INTENT: Intent = {
  intentId: "demo-mode-a",
  task: "Proofread and correct my paragraph",
  token: "XYZ",
  input: "i has two dog and they likes to runs very fast",
  budget: "2.00",
  asset: "USDC",
  network: DEMO_CHAIN_ID === 31337 ? "anvil-local" : DEMO_CHAIN_ID === 84532 ? "base-sepolia" : `chain-${DEMO_CHAIN_ID}`,
  createdAt: "2026-05-30T05:00:00.000Z",
};

const DEMO_NOW_MS = Date.parse("2026-05-30T05:00:00.000Z");

export type { TraceResult };

export const getModeATrace = cache((): Promise<TraceResult> => {
  return runHumanPresent(DEMO_INTENT, { nowMs: DEMO_NOW_MS, chainId: DEMO_CHAIN_ID });
});
