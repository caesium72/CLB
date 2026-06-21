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

/**
 * The two real canonical ERC-8004 agents the shopping agent chooses between.
 * Shown on the Intent page (allowed-agents predicate) BEFORE discovery runs, so
 * the IDs/names here must match the seeded cards (services/identity-service/seed).
 */
export const KNOWN_AGENTS = [
  {
    agentId: "6827",
    name: "Grammar Checker Agent",
    blurb: "Proofreads and corrects written text — grammar, spelling, punctuation.",
    example: {
      task: "Proofread and correct my paragraph",
      input: "i has two dog and they likes to runs very fast",
    },
  },
  {
    agentId: "6823",
    name: "Weather Agent",
    blurb: "Returns a short weather forecast (conditions + temperature) for a city.",
    example: { task: "Get me a weather forecast for my trip", input: "Dhaka" },
  },
] as const;

export const INTENT_COPY = {
  title: "Tell your shopping agent what you need",
  subtitle:
    "Describe the task and set the rules your agent must respect. Next, the agent reads both on-chain agents' cards and decides — with reasoning — which one fits.",
  fields: {
    task: {
      label: "Task",
      help: "What you want done. The agent matches this to an on-chain agent's capabilities.",
    },
    input: {
      label: "What should the agent work on?",
      help: "The text to proofread, or the city to forecast.",
    },
    budget: { label: "Max price", help: "The most you will spend (a decision rule)." },
    asset: { label: "Asset", help: "Currency you will pay in (a decision rule)." },
    network: { label: "Network", help: "Settlement network (a decision rule)." },
    allowedAgents: {
      label: "Allowed agents",
      help: "Optional. Restrict which on-chain agents qualify. Leave all checked to let the agent choose freely.",
    },
  },
  submit: "Send to shopping agent",
  submitting: "Sending…",
} as const;

export const DISCOVERY_COPY = {
  title: "Your shopping agent is choosing",
  subtitle:
    "The agent reads both agents' ERC-8004 cards and decides which one can do the task within your rules. This choice is recorded as evidence — but never trusted by the verifier.",
  noneTitle: "No agent fits your rules",
  noneSubtitle:
    "The shopping agent could not select an on-chain agent for this task under your constraints. Here is its reasoning:",
  decisionLayerBadge: "Decision layer · not a verifier input",
  reasoningLabel: "Agent reasoning",
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
  B0: "Vanilla x402 — settlement well-formedness only, no cross-layer rules.",
  B1: "AP2 mandate + x402, but no ERC-8004 identity binding and no commitment recompute.",
  B2: "eBay-style off-chain monitor — AP2 context-binding + consume-once, single-protocol.",
  B3: "Full stack — binding, evidence, verifier, and in-protocol prevention.",
};
