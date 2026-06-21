/**
 * The buyer-side agent ("CLB-ACEL Agent Orchestrator") — the agent that acts on
 * the human's behalf: it shops, authorizes (AP2 mandate), and settles (x402)
 * within the limits the human signs. Unlike the merchant agents it sells no
 * service, so its ERC-8004 metadata is a self-contained `data:` URI (no hosted
 * card URL).
 *
 * This module is intentionally dependency-free so the registration script
 * (`scripts/register-orchestrator-agent.ts`) can import the same card the UI
 * shows, keeping the on-chain metadata and the displayed identity in sync.
 */
export const ORCHESTRATOR_NAME = "CLB-ACEL Agent Orchestrator";

/** The orchestrator's verified wallet (SHOPPING_AGENT key address). */
export const ORCHESTRATOR_WALLET = "0x59509b7CEFD9d9266CE89fA074f7d9a24E68541C";

/**
 * The canonical ERC-8004 agentId assigned at registration. Set via env so the
 * same build resolves it on Vercel; empty until the mint lands, in which case
 * the UI links to the wallet on BaseScan instead of the 8004scan agent page.
 */
export const ORCHESTRATOR_AGENT_ID =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_AGENT_ID?.trim() || "6861";

export const ORCHESTRATOR_DESCRIPTION =
  "The buyer-side agent that acts on a human's behalf: it discovers a service agent, signs an AP2 " +
  "authorization within the human's limits, and settles the payment over x402 — every step bound " +
  "together by a cross-layer-binding commitment and recorded as on-chain evidence.";

export type OrchestratorCard = {
  type: string;
  name: string;
  description: string;
  image: string;
  services: { name: string; endpoint: string }[];
  x402Support: boolean;
  active: boolean;
  supportedTrust: string[];
};

/** ERC-8004 registration-v1 card for the orchestrator (source of the `data:` URI). */
export function orchestratorCard(): OrchestratorCard {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: ORCHESTRATOR_NAME,
    description: ORCHESTRATOR_DESCRIPTION,
    image: "",
    services: [],
    x402Support: false,
    active: true,
    supportedTrust: ["cross-layer-binding"],
  };
}

/** `data:application/json;base64,…` metadata URI minted as the agent's tokenURI. */
export function orchestratorMetadataDataUri(): string {
  const json = JSON.stringify(orchestratorCard());
  const base64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(json, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(json)));
  return `data:application/json;base64,${base64}`;
}
