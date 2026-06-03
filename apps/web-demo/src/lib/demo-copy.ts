/**
 * Single source of truth for visitor-facing demo copy.
 *
 * The protocol uses internal terms ("Mode A", "Mode B", rule IDs like R17).
 * General visitors do not share that vocabulary, so the primary UI uses
 * commerce language (human-present checkout vs agent-delegated spending) and
 * the internal identifiers only surface in research mode.
 */

export const FLOW_LABELS = {
  modeA: {
    /** Short scenario name for headings. */
    short: "Human-present checkout",
    /** Tab label — what the user does in this scenario. */
    tab: "You approve each payment",
    /** Research-mode subtitle exposing protocol terms. */
    research: "Cross-layer binding · Mode A · P1–P4",
  },
  modeB: {
    short: "Agent-delegated spending",
    tab: "You set limits, agent pays",
    research: "Predicate soundness · Mode B · P5",
  },
} as const;

/**
 * Plain-English label for each prevention layer returned by the attack
 * simulator. Keeps "what stopped the attack" readable for visitors.
 */
export const PREVENTION_LAYER_COPY: Record<string, { label: string; detail: string }> = {
  x402: {
    label: "Blocked at payment",
    detail: "The payment rail rejected the replayed nonce before settlement.",
  },
  "predicate-guard": {
    label: "Blocked before settlement",
    detail: "The predicate guard refused to settle outside the signed spending rules.",
  },
  verifier: {
    label: "Caught in evidence audit",
    detail: "The deterministic verifier flagged the trace after settlement.",
  },
  audit: {
    label: "Caught in evidence audit",
    detail: "The decision-layer audit check flagged the evidence after the fact.",
  },
  none: {
    label: "Allowed",
    detail: "No layer stopped this — shown to contrast weaker baselines.",
  },
};

export function preventionLayerCopy(layer: string) {
  return PREVENTION_LAYER_COPY[layer] ?? PREVENTION_LAYER_COPY.none;
}

export const AGENT_ACTIVITY_COPY = {
  searching: "Searching ERC-8004 identity registry…",
  comparing: "Comparing merchant agents for x402 support…",
  rejected: "Skipped — missing verified x402 support",
  selected: "Selected for token-risk reports over x402",
  quoteRequest: "Requesting merchant quote…",
} as const;

export const QUOTE_COPY = {
  modeA: {
    title: "Your cart",
    subtitle: "The agent fetched a live quote from the merchant. You will sign this exact amount.",
  },
  modeB: {
    title: "Spending limits preview",
    subtitle: "You have not paid yet — you are setting rules your agent must follow at checkout.",
    note: "The agent will choose the exact amount within these limits when it pays.",
  },
} as const;

export const CHECKOUT_COPY = {
  agentPersona: "Shopping Research Agent",
  intro: "is purchasing on your behalf",
  probe402: "Merchant returned 402 Payment Required",
  settling: "Agent authorizing and settling payment…",
  complete: "Payment settled — view receipt",
  agentPays: "Agent pays",
  modeBSettlement: "Agent chose a concrete settlement within your signed limits.",
} as const;

/** Full binding formulas shown on the mandate page (visitor + research). */
export const MANDATE_FORMULAS = {
  modeA: {
    title: "Mode A — exact cart binding",
    steps: [
      "mandateDigest = keccak256(canonical AP2 mandate fields)",
      "C = keccak256(EIP712(identityRef, mandateDigest, settlementDescriptor))",
      "Human signs C with EIP-712 typed data (Cart mandate)",
      "nonce = keccak256(C) = H(C) — pins one settlement to one commitment",
    ],
    signature: "signature = signTypedData(domain, CLBCommitment, { identityRef, mandateDigest, settlementDescriptor })",
  },
  modeB: {
    title: "Mode B — predicate delegation",
    steps: [
      "mandateDigest = keccak256(canonical AP2 mandate fields)",
      "Human signs INTENT with personal_sign(mandateDigest) — authorizes spending predicate π once",
      "At settlement the agent picks concrete params; settlementParamsDigest = keccak256(abi.encode(...))",
      "C′ = keccak256(EIP712(identityRef, mandateDigest, predicateId, settlementParamsDigest))",
      "nonce = keccak256(C′) = H(C′) — verifier rule R17 checks π against concrete settlement",
    ],
    signature: "signature = personal_sign(mandateDigest) — no auth-time C or C′",
  },
} as const;

/** Baseline (B0–B3) one-line explanations shared by both attack matrices. */
export const BASELINE_EXPLAINER: Record<string, string> = {
  B0: "Vanilla x402 — no cross-layer binding, no verifier, no evidence layer.",
  B1: "AP2 mandate exists, but the payment nonce is not bound to the commitment.",
  B2: "Evidence + verifier detect attacks after settlement, but cannot prevent them.",
  B3: "Full stack — binding, evidence, verifier, and in-protocol prevention.",
};
