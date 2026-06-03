/** Shared demo session types for Phase 5b agent narrative UX. */

export type AgentActivityEvent = {
  id: string;
  label: string;
  detail?: string;
  delayMs: number;
  tone?: "info" | "success" | "reject";
};

export type DiscoveryResult = {
  selectedMerchantId: string;
  rationale: string;
  activity: AgentActivityEvent[];
  payerAgent: {
    agentId: string;
    card: { name: string };
  };
  candidates: Array<{
    agentId: string;
    card: { name: string; description?: string };
    selected: boolean;
    rejectedReason?: string;
  }>;
};

export type CartQuote = {
  kind: "cart";
  product: string;
  merchantName: string;
  merchantAgentId: string;
  price: string;
  asset: string;
  payee: string;
  network: string;
  settlementDescriptor: Record<string, unknown>;
};

export type DelegationQuote = {
  kind: "delegation";
  product: string;
  merchantName: string;
  merchantAgentId: string;
  maxValue: string;
  asset: string;
  allowedPayees: string[];
  validUntil: string;
  note: string;
  predicateDescriptor: Record<string, unknown>;
};

export type DemoQuote = CartQuote | DelegationQuote;

export type CheckoutStage = "idle" | "probing_402" | "settling" | "complete" | "error";
