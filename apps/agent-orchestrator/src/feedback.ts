/**
 * Deterministic, honest ERC-8004 feedback assessment.
 *
 * The score a client leaves for a merchant is NOT a magic number — it is derived
 * from the deterministic verifier outcome (R1–R17) that already ran over the trace:
 * the fraction of binding rules that passed, grouped into human-readable factors.
 * An LLM may later add plain-language prose ON TOP of these fixed factors
 * (decision-layer only), but the score itself is reproducible and grounded.
 */
import type { DeliveryReport, EvidenceGraph, EvidenceGraphNode } from "@clb-acel/schemas";
import type { VerifyTraceOutput } from "@clb-acel/verifier-core";

export type FeedbackFactor = { label: string; ok: boolean; detail: string };

export type FeedbackAssessment = {
  /** 0–100, = round(100 * rulesPassed / rulesChecked). Deterministic. */
  score: number;
  status: "PASS" | "FAIL" | "WARNING";
  /** On-chain tag2 written with the feedback. */
  tag: string;
  rulesPassed: number;
  rulesChecked: number;
  factors: FeedbackFactor[];
};

/** Human-readable groupings of the deterministic rules (R16 is intentionally absent). */
const FACTOR_GROUPS: { label: string; rules: string[] }[] = [
  {
    label: "Evidence integrity (hash chain + signatures)",
    rules: ["R1_HASH_CHAIN_INTACT", "R2_SIGNATURES_VALID"],
  },
  {
    label: "Agent identity & payment key authorized",
    rules: ["R3_AGENT_IDENTITY_RESOLVES", "R4_AGENT_PAYMENT_KEY_AUTHORIZED"],
  },
  {
    label: "Authorization binding recomputes (C)",
    rules: [
      "R5_MANDATE_SIGNATURE_VALID",
      "R6_CLB_COMMITMENT_RECOMPUTES",
      "R8_PAYMENT_NONCE_EQUALS_HASH_C",
      "R9_NONCE_CONSUMED_EXACTLY_ONCE",
      "R10_CHAIN_DOMAIN_MATCHES",
    ],
  },
  {
    label: "Settled within budget, correct payee & asset",
    rules: [
      "R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR",
      "R11_AMOUNT_WITHIN_MANDATE",
      "R12_PAYEE_MATCHES_CHECKOUT_OR_TASK",
      "R13_ASSET_ALLOWED",
    ],
  },
  {
    label: "Delivered after & cryptographically bound to the payment",
    rules: ["R14_DELIVERY_AFTER_SETTLEMENT", "R14b_DELIVERY_BOUND_TO_SETTLEMENT", "R15_TASK_HASH_MATCHES"],
  },
  {
    label: "Spending predicate satisfied (Mode B)",
    rules: ["R17_PREDICATE_TRUE_FOR_MODE_B"],
  },
];

/** Derive a grounded feedback score + factor breakdown from the verifier result. */
export function assessFeedback(verification: VerifyTraceOutput): FeedbackAssessment {
  const certificate = verification.certificate;
  const checked = certificate.rulesChecked;
  const failed = new Set(certificate.failedRules);
  const rulesChecked = checked.length;
  const rulesPassed = checked.filter((rule) => !failed.has(rule)).length;
  const score = rulesChecked > 0 ? Math.round((100 * rulesPassed) / rulesChecked) : 0;

  const checkedSet = new Set(checked);
  const factors: FeedbackFactor[] = FACTOR_GROUPS.flatMap((group) => {
    const present = group.rules.filter((rule) => checkedSet.has(rule));
    if (present.length === 0) return [];
    const failedHere = present.filter((rule) => failed.has(rule));
    const ok = failedHere.length === 0;
    return [
      {
        label: group.label,
        ok,
        detail: ok
          ? `${present.length}/${present.length} checks passed`
          : `failed: ${failedHere.join(", ")}`,
      },
    ];
  });

  const status = verification.result.status;
  return {
    score,
    status,
    tag: status === "PASS" ? "verified" : status === "WARNING" ? "warnings" : "issues",
    rulesPassed,
    rulesChecked,
    factors,
  };
}

/** Compact, human-meaningful summary of the delivered report for the evidence node. */
export function deliverySummary(report: DeliveryReport): Record<string, unknown> {
  const raw = report as unknown as Record<string, unknown>;
  return {
    objectType: "DELIVERY_PROOF",
    service: typeof raw.service === "string" ? raw.service : "report",
    task: typeof raw.task === "string" ? raw.task : undefined,
    // The actual paid work product (corrected text / forecast / analysis).
    result: raw.result ?? undefined,
    modelVersion: typeof raw.modelVersion === "string" ? raw.modelVersion : undefined,
    reportHash: typeof raw.reportHash === "string" ? raw.reportHash : undefined,
    signaturePresent: Boolean(raw.merchantAgentSignature),
    boundToSettlement: Boolean(raw.deliveryBinding),
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : undefined,
  };
}

/**
 * Append the verifier verdict and the resulting ERC-8004 feedback as PRESENTATION
 * nodes to the evidence graph. These sit DOWNSTREAM of the anchored trace (the
 * feedback points at the on-chain anchor of the Merkle root, so it cannot live
 * inside that root) — they are marked `presentation: true` and are not hashed.
 */
export function appendProofNodes(
  graph: EvidenceGraph,
  args: { verification: VerifyTraceOutput; assessment: FeedbackAssessment },
): EvidenceGraph {
  const { verification, assessment } = args;
  const delivery = graph.nodes.find((node) => node.nodeType === "DELIVERY_PROOF");
  const certificate = verification.certificate;
  const checkedAt = certificate.createdAt;

  const verificationNode: EvidenceGraphNode = {
    id: "node-verification",
    nodeType: "VERIFICATION_CERTIFICATE",
    label: "VERIFICATION_CERTIFICATE",
    protocol: "VERIFIER",
    objectHash: certificate.certificateHash,
    metadata: {
      actor: "verifier-core",
      timestamp: checkedAt,
      presentation: true,
      publicFields: {
        objectType: "VERIFICATION_CERTIFICATE",
        status: certificate.status,
        rulesPassed: assessment.rulesPassed,
        rulesChecked: assessment.rulesChecked,
        failedRules: certificate.failedRules,
        note: "Verifier verdict — recomputed deterministically over the trace (no LLM).",
      },
    },
  };

  const feedbackNode: EvidenceGraphNode = {
    id: "node-feedback",
    nodeType: "ERC8004_FEEDBACK",
    label: "ERC8004_FEEDBACK",
    protocol: "ERC8004",
    objectHash: certificate.certificateHash,
    metadata: {
      actor: "client-agent",
      timestamp: checkedAt,
      presentation: true,
      publicFields: {
        objectType: "ERC8004_FEEDBACK",
        score: assessment.score,
        status: assessment.status,
        tag: assessment.tag,
        rulesPassed: assessment.rulesPassed,
        rulesChecked: assessment.rulesChecked,
        factors: assessment.factors,
        note: "Reputation written downstream of the anchor — not part of the trace's Merkle root.",
      },
    },
  };

  const nodes = [...graph.nodes, verificationNode, feedbackNode];
  const edges = [...graph.edges];
  if (delivery) {
    edges.push({
      id: `${delivery.id}-sem-${verificationNode.id}`,
      source: delivery.id,
      target: verificationNode.id,
      edgeType: "VALIDATES",
      label: "validates trace",
    });
  }
  edges.push({
    id: `${verificationNode.id}-sem-${feedbackNode.id}`,
    source: verificationNode.id,
    target: feedbackNode.id,
    edgeType: "RATES",
    label: "rates agent",
  });

  return { ...graph, nodes, edges };
}
