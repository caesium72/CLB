/**
 * Plain-language explanation for each deterministic verifier rule (R1–R17).
 * The verifier never uses an LLM — these are human-readable glosses of the exact
 * checks, shown beside the rule IDs on the audit-result page.
 */
export const RULE_COPY: Record<string, string> = {
  R1_HASH_CHAIN_INTACT: "Every event links to the one before it — the trace wasn't edited after the fact.",
  R2_SIGNATURES_VALID: "Every signature attached to the trace checks out.",
  R3_AGENT_IDENTITY_RESOLVES: "The agent's on-chain identity (ERC-8004) actually exists.",
  R4_AGENT_PAYMENT_KEY_AUTHORIZED: "The key that paid is one the agent's card authorizes.",
  R5_MANDATE_SIGNATURE_VALID: "The human's authorization signature is genuine.",
  R6_CLB_COMMITMENT_RECOMPUTES: "Re-deriving the commitment C from its parts gives the same value.",
  R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR: "What was paid matches what was authorized, field for field.",
  R8_PAYMENT_NONCE_EQUALS_HASH_C: "The payment nonce equals H(C) — bound to this exact commitment.",
  R9_NONCE_CONSUMED_EXACTLY_ONCE: "The nonce was spent once and only once — no replay.",
  R10_CHAIN_DOMAIN_MATCHES: "Settlement happened on the agreed chain, not a transplanted one.",
  R11_AMOUNT_WITHIN_MANDATE: "The amount paid is within the human's authorized limit.",
  R12_PAYEE_MATCHES_CHECKOUT_OR_TASK: "The money went to the agreed merchant, not a swapped address.",
  R13_ASSET_ALLOWED: "Payment used an allowed asset (e.g. USDC), not a switched token.",
  R14_DELIVERY_AFTER_SETTLEMENT: "Delivery came after payment and is bound to it.",
  R15_TASK_HASH_MATCHES: "The delivered work matches the task that was ordered.",
  R17_PREDICATE_TRUE_FOR_MODE_B: "The agent's chosen settlement satisfies the spending predicate you signed.",
};

export function ruleCopy(rule: string): string {
  return RULE_COPY[rule] ?? rule;
}
