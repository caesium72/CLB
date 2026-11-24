import { buildMerkleRoot, hashEvidenceEvent } from "@clb-acel/evidence-core";
import { verifyMessage, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  verifyTrace,
  type RuleId,
  type TraceBundle,
  type VerifyTraceOutput,
} from "./index";

/**
 * Novelty 5 — Adaptive Evidence Assurance and Risk-Based Verification (AEARV).
 *
 * DESIGN INVARIANT (the whole point of the novelty):
 *   The base `verifyTrace` call is IDENTICAL at V1, V2 and V3. It evaluates every
 *   CLB rule — including the mandatory cryptographic rules — on every path.
 *   Higher levels only ADD checks on top of that unchanged base; they never skip,
 *   relax, or parameterise a mandatory rule. An adaptive decision is
 *   `base PASS AND every additional check PASS`, so it can only ever be stricter
 *   than the fixed V1 verifier.
 *
 * RISK MODEL (deterministic prototype, NOT an externally validated model):
 *   R = wI*(1 - I) + wA*A + wS*S + wD*D + wH*H, weights sum to 1.
 *   I = identity assurance (1 = strong); A/S/D/H = risk signals (1 = high risk).
 *   All five inputs are clamped to [0,1], so R is bounded in [0,1]. The weights
 *   and thresholds are engineering choices for a reproducible prototype. They
 *   are NOT calibrated against external loss data and must not be described as
 *   an empirically validated or defensible risk model. Empirical calibration on
 *   labelled incident/honest traces is future work.
 *
 * TRUST BOUNDARY: risk factors and approval/anchor artefacts are supplied by the
 * CALLER from trusted out-of-band systems. They are never read from the
 * untrusted `TraceBundle` itself.
 */

/** Mandatory cryptographic rules: evaluated at V1, V2 and V3 with no exceptions. */
export const MANDATORY_RULES: readonly RuleId[] = [
  "R1_HASH_CHAIN_INTACT",
  "R2_SIGNATURES_VALID",
  "R5_MANDATE_SIGNATURE_VALID",
  "R6_CLB_COMMITMENT_RECOMPUTES",
  "R8_PAYMENT_NONCE_EQUALS_HASH_C",
  "R9_NONCE_CONSUMED_EXACTLY_ONCE",
  "R10_CHAIN_DOMAIN_MATCHES",
  "R17_PREDICATE_TRUE_FOR_MODE_B",
];

/** Prototype weights (sum = 1). Chosen a priori; not fitted to external data. */
export const RISK_WEIGHTS = {
  identityAssurance: 0.2,
  authorizationRisk: 0.25,
  settlementRisk: 0.2,
  deliveryRisk: 0.2,
  historyRisk: 0.15,
} as const;

/** Deterministic tier cut-points on the bounded score R in [0,1]. */
export const RISK_TIER_THRESHOLDS = { v2: 0.34, v3: 0.67 } as const;

export type RiskFactors = {
  /** I: independently anchored identity assurance, 0..1 (higher is better). */
  identityAssurance: number;
  /** A: authorization/policy risk, 0..1 (higher is worse). */
  authorizationRisk: number;
  /** S: settlement-chain/counterparty risk, 0..1. */
  settlementRisk: number;
  /** D: delivery/provenance risk, 0..1. */
  deliveryRisk: number;
  /** H: prior-history/anomaly risk, 0..1. */
  historyRisk: number;
};

export type VerificationLevel = "V1" | "V2" | "V3";

export const VERIFICATION_LEVELS: readonly VerificationLevel[] = ["V1", "V2", "V3"] as const;

export type AdaptiveCheckId =
  | "IDENTITY_PROVENANCE"
  | "DELIVERY_PROVENANCE"
  | "TRUSTED_ROOT_ANCHOR"
  | "FULL_PROVENANCE"
  | "HUMAN_APPROVAL_GATE";

export type AdaptiveCheckOutcome = {
  id: AdaptiveCheckId;
  ok: boolean;
  detail?: string;
};

export type HumanApproval = {
  /** ECDSA personal-sign signature over the canonical `approvalMessage`. */
  signature: Hex;
  /** When supplied, must equal the canonical message (binds the approval). */
  message?: string;
};

/** Trusted, out-of-band inputs. None of these are fields of the untrusted bundle. */
export type AdaptiveContext = {
  expectedHumanPrincipal: Address;
  /** Independently anchored Merkle root; REQUIRED at V2/V3 (fail closed). */
  expectedMerkleRoot?: Hex;
  /** Signed human approval; REQUIRED at V3 (fail closed). */
  humanApproval?: HumanApproval;
  confidential?: boolean;
};

export type AdaptiveVerifyOutput = {
  /** Untouched base verifier output: certificate, all rule outcomes, plaintext flag. */
  base: VerifyTraceOutput;
  level: VerificationLevel;
  riskScore: number;
  adaptiveChecks: AdaptiveCheckOutcome[];
  /** Final decision: base PASS and ALL executed adaptive checks PASS. */
  decision: "PASS" | "FAIL";
  failedRules: RuleId[];
  failedAdaptiveChecks: AdaptiveCheckId[];
  extraChecksExecuted: number;
  riskFactors?: RiskFactors;
};

function clampUnit(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`AEARV: ${name} must be a finite number`);
  }
  return Math.min(1, Math.max(0, value));
}

/** R = f(I, A, S, D, H). Rounded to 6 decimals for reproducible reporting. */
export function computeRiskScore(factors: RiskFactors): number {
  const identityRisk = 1 - clampUnit(factors.identityAssurance, "identityAssurance");
  const authorizationRisk = clampUnit(factors.authorizationRisk, "authorizationRisk");
  const settlementRisk = clampUnit(factors.settlementRisk, "settlementRisk");
  const deliveryRisk = clampUnit(factors.deliveryRisk, "deliveryRisk");
  const historyRisk = clampUnit(factors.historyRisk, "historyRisk");
  const raw =
    RISK_WEIGHTS.identityAssurance * identityRisk +
    RISK_WEIGHTS.authorizationRisk * authorizationRisk +
    RISK_WEIGHTS.settlementRisk * settlementRisk +
    RISK_WEIGHTS.deliveryRisk * deliveryRisk +
    RISK_WEIGHTS.historyRisk * historyRisk;
  return Math.round(raw * 1_000_000) / 1_000_000;
}

/** Deterministic mapping from the bounded score to a verification level. */
export function selectVerificationLevel(score: number): VerificationLevel {
  const bounded = clampUnit(score, "riskScore");
  if (bounded < RISK_TIER_THRESHOLDS.v2) return "V1";
  if (bounded < RISK_TIER_THRESHOLDS.v3) return "V2";
  return "V3";
}

/** Checks added at each level. V1 adds nothing; V2/V3 are strictly cumulative. */
export function checksForLevel(level: VerificationLevel): readonly AdaptiveCheckId[] {
  if (level === "V1") return [];
  if (level === "V2") {
    return ["IDENTITY_PROVENANCE", "DELIVERY_PROVENANCE", "TRUSTED_ROOT_ANCHOR"];
  }
  return [
    "IDENTITY_PROVENANCE",
    "DELIVERY_PROVENANCE",
    "TRUSTED_ROOT_ANCHOR",
    "FULL_PROVENANCE",
    "HUMAN_APPROVAL_GATE",
  ];
}

/**
 * Canonical string a human signs at the V3 gate. It binds the approval to this
 * trace, its anchored evidence root, the tier and the computed score.
 */
export function approvalMessage(
  bundle: TraceBundle,
  level: VerificationLevel,
  score: number,
): string {
  return (
    `AEARV approval | traceId=${bundle.traceId} | merkleRoot=${bundle.merkleRoot.toLowerCase()} ` +
    `| tier=${level} | riskScore=${score.toFixed(6)}`
  );
}

/** Convenience signer for callers/tests holding a local key. */
export async function createHumanApproval(
  bundle: TraceBundle,
  level: VerificationLevel,
  score: number,
  privateKey: Hex,
): Promise<HumanApproval> {
  const message = approvalMessage(bundle, level, score);
  const signature = await privateKeyToAccount(privateKey).signMessage({ message });
  return { signature, message };
}

function result(id: AdaptiveCheckId, ok: boolean, detail?: string): AdaptiveCheckOutcome {
  return ok ? { id, ok } : { id, ok, detail: detail ?? id };
}

function identityProvenance(bundle: TraceBundle): AdaptiveCheckOutcome {
  const scoped = bundle.events.filter((event) => event.traceId === bundle.traceId);
  const identity = scoped.some(
    (event) => event.protocol === "ERC8004" && event.objectType === "ERC8004_AGENT_IDENTITY",
  );
  const mandate = scoped.some(
    (event) => event.protocol === "AP2" && event.objectType.startsWith("AP2_"),
  );
  const missing: string[] = [];
  if (!identity) missing.push("ERC8004_AGENT_IDENTITY");
  if (!mandate) missing.push("AP2 mandate");
  return result(
    "IDENTITY_PROVENANCE",
    missing.length === 0,
    missing.length === 0 ? undefined : `Missing bound identity/mandate evidence: ${missing.join(", ")}`,
  );
}

function deliveryProvenance(bundle: TraceBundle): AdaptiveCheckOutcome {
  const scoped = bundle.events.filter((event) => event.traceId === bundle.traceId);
  const deliveries = scoped.filter(
    (event) => event.protocol === "DELIVERY" && event.objectType === "DELIVERY_PROOF",
  );
  const last = bundle.events.at(-1);
  const boundToRoot = buildMerkleRoot(bundle.events.map(hashEvidenceEvent)) === bundle.merkleRoot;
  const ok =
    deliveries.length === 1 &&
    last?.objectType === "DELIVERY_PROOF" &&
    last.traceId === bundle.traceId &&
    boundToRoot;
  return result(
    "DELIVERY_PROVENANCE",
    ok,
    ok ? undefined : `Delivery proof must appear once as the final trace leaf and be bound to the root (found=${deliveries.length})`,
  );
}

function trustedRootAnchor(bundle: TraceBundle, expected?: Hex): AdaptiveCheckOutcome {
  if (expected === undefined) {
    return result("TRUSTED_ROOT_ANCHOR", false, "TRUSTED_ROOT_NOT_SUPPLIED");
  }
  const ok = bundle.merkleRoot.toLowerCase() === expected.toLowerCase();
  return result(
    "TRUSTED_ROOT_ANCHOR",
    ok,
    ok ? undefined : `Evidence root ${bundle.merkleRoot} != trusted root ${expected}`,
  );
}

function fullProvenance(bundle: TraceBundle): AdaptiveCheckOutcome {
  const types = new Set(
    bundle.events.filter((event) => event.traceId === bundle.traceId).map((event) => event.objectType),
  );
  const required = [
    "USER_INTENT",
    "ERC8004_AGENT_IDENTITY",
    "X402_PAYMENT_REQUIREMENT",
    "X402_PAYMENT_PAYLOAD",
    "CHAIN_SETTLEMENT",
    "DELIVERY_PROOF",
  ];
  const hasMandate = bundle.events.some(
    (event) => event.protocol === "AP2" && event.objectType.startsWith("AP2_"),
  );
  const missing = required.filter((type) => !types.has(type));
  if (!hasMandate) missing.push("AP2 mandate");
  return result(
    "FULL_PROVENANCE",
    missing.length === 0,
    missing.length === 0 ? undefined : `Missing high-assurance evidence: ${missing.join(", ")}`,
  );
}

async function humanApprovalGate(
  bundle: TraceBundle,
  level: VerificationLevel,
  score: number,
  context: AdaptiveContext,
): Promise<AdaptiveCheckOutcome> {
  const approval = context.humanApproval;
  if (!approval) return result("HUMAN_APPROVAL_GATE", false, "HUMAN_APPROVAL_MISSING");
  const expected = approvalMessage(bundle, level, score);
  if (approval.message !== undefined && approval.message !== expected) {
    return result("HUMAN_APPROVAL_GATE", false, "HUMAN_APPROVAL_BINDING_MISMATCH");
  }
  try {
    const ok = await verifyMessage({
      address: context.expectedHumanPrincipal,
      message: expected,
      signature: approval.signature,
    });
    return result("HUMAN_APPROVAL_GATE", ok, ok ? undefined : "HUMAN_APPROVAL_SIGNATURE_INVALID");
  } catch {
    return result("HUMAN_APPROVAL_GATE", false, "HUMAN_APPROVAL_SIGNATURE_MALFORMED");
  }
}

/**
 * Run the unchanged base verifier plus the additive checks for a fixed level.
 * `risk` is only recorded/reporting metadata at fixed levels; only
 * `verifyAdaptive` uses it to choose the level.
 */
export async function verifyAtLevel(
  bundle: TraceBundle,
  level: VerificationLevel,
  context: AdaptiveContext,
  risk?: RiskFactors,
): Promise<AdaptiveVerifyOutput> {
  // IDENTICAL at every level — the mandatory cryptographic core cannot be weakened.
  const base = await verifyTrace(bundle, {
    expectedHumanPrincipal: context.expectedHumanPrincipal,
    ...(context.confidential === true ? { confidential: true } : {}),
  });

  const score = risk === undefined ? 0 : computeRiskScore(risk);
  const adaptiveChecks: AdaptiveCheckOutcome[] = [];
  if (level === "V2" || level === "V3") {
    adaptiveChecks.push(identityProvenance(bundle));
    adaptiveChecks.push(deliveryProvenance(bundle));
    adaptiveChecks.push(trustedRootAnchor(bundle, context.expectedMerkleRoot));
  }
  if (level === "V3") {
    adaptiveChecks.push(fullProvenance(bundle));
    adaptiveChecks.push(await humanApprovalGate(bundle, level, score, context));
  }

  const failedAdaptiveChecks = adaptiveChecks
    .filter((check) => !check.ok)
    .map((check) => check.id);
  const failedRules = base.result.failedRules as RuleId[];
  const decision: "PASS" | "FAIL" =
    base.result.status === "PASS" && failedAdaptiveChecks.length === 0 ? "PASS" : "FAIL";

  return {
    base,
    level,
    riskScore: score,
    adaptiveChecks,
    decision,
    failedRules,
    failedAdaptiveChecks,
    extraChecksExecuted: adaptiveChecks.length,
    ...(risk === undefined ? {} : { riskFactors: risk }),
  };
}

/** Risk-driven verification: choose the level, then run that level unchanged. */
export async function verifyAdaptive(
  bundle: TraceBundle,
  risk: RiskFactors,
  context: AdaptiveContext,
): Promise<AdaptiveVerifyOutput> {
  const score = computeRiskScore(risk);
  return verifyAtLevel(bundle, selectVerificationLevel(score), context, risk);
}
