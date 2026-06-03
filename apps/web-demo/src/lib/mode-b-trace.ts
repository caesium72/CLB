import { cache } from "react";
import { runDelegated, type Intent, type ModeBTraceResult } from "@clb-acel/agent-orchestrator/flow";

/**
 * Fixed demo intent + clock so every screen renders the exact same, fully
 * reproducible Mode B (delegated/predicate) trace: stable predicate, C',
 * nonce = H(C'), Merkle root, and R17 verification across page loads. The
 * orchestrator's `runDelegated` runs in-process so the demo works without
 * standing up backend services.
 */
const DEMO_CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);

const DEMO_INTENT: Intent = {
  intentId: "demo-mode-b",
  task: "Buy a token-risk report for token XYZ (delegated)",
  token: "XYZ",
  budget: "2.00",
  asset: "USDC",
  network:
    DEMO_CHAIN_ID === 31337
      ? "anvil-local"
      : DEMO_CHAIN_ID === 84532
        ? "base-sepolia"
        : `chain-${DEMO_CHAIN_ID}`,
  createdAt: "2026-05-30T05:00:00.000Z",
};

const DEMO_NOW_MS = Date.parse("2026-05-30T05:00:00.000Z");

export type { ModeBTraceResult };

export const getModeBTrace = cache((): Promise<ModeBTraceResult> => {
  return runDelegated(DEMO_INTENT, { nowMs: DEMO_NOW_MS, chainId: DEMO_CHAIN_ID });
});
