import { verifyMandate } from "@clb-acel/ap2-adapter";
import {
  computeCommitment,
  computeMandateDigest,
  checkRevocationAwareAcceptance,
  computeModeBSettlementCommitment,
  deriveNonce,
  deriveSettlementNonce,
  evaluatePredicate,
  settlementParamsFromExact,
  verifyConfidential,
  type ModeBSettlementInput,
} from "@clb-acel/clb-core";
import {
  recoverReportSigner,
  reportHashMatchesContent,
  verifyDeliveryBinding,
} from "@clb-acel/delivery-core";
import { buildMerkleRoot, hashEvidenceEvent } from "@clb-acel/evidence-core";
import { canonicalJson } from "@clb-acel/evidence-core";
import type {
  CLBCommitmentInput,
  SettlementParams,
  SpendingPredicate,
  VerificationCertificate,
} from "@clb-acel/schemas";
import { verifyPaymentPayload } from "@clb-acel/x402-adapter";
import { type Address, type Hex, getAddress, keccak256, parseUnits, toBytes } from "viem";
import type {
  RuleId,
  RuleOutcome,
  TraceBundle,
  VerifyTraceOptions,
  VerifyTraceOutput,
} from "./types";

export * from "./types";

/**
 * `expectedHumanPrincipal` is optional only for source compatibility with
 * existing callers; a sound verdict requires it. It MUST be sourced from a
 * trusted, independent anchor (e.g. a human/owner registry or an
 * out-of-band-established wallet address) — never from
 * `bundle.mandate.humanPrincipal`. When absent, R2/R5 fail closed.
 */
export type VerifyTraceOptionsWithPrincipal = VerifyTraceOptions & {
  expectedHumanPrincipal?: Address;
  /**
   * Trusted Merkle root obtained OUT-OF-BAND (e.g. read from the on-chain
   * AgenticAuditAnchor by the caller, or from a signed attestation). R1 compares
   * it with the root recomputed from the bundle. Without this value R1 proves
   * only internal consistency: recomputeEvidenceIntegrity can re-link and
   * re-root any self-consistent rewrite of an untrusted agent's event set.
   */
  expectedMerkleRoot?: Hex;
  /**
   * Fail closed: refuse an evidence-integrity PASS unless expectedMerkleRoot is
   * supplied. Opt-in to preserve source compatibility; verifiers evaluating
   * untrusted traces should enable it.
   */
  strictEvidenceIntegrity?: boolean;
  /**
   * Object types that MUST be present in the trace. Derived from the human-signed
   * mandate / protocol policy by the CALLER — never from the bundle under test.
   * Enables a structural completeness check in R1 alongside the root comparison.
   */
  requiredEventObjectTypes?: readonly string[];
  /**
   * RCLB opt-in gate. When supplied, an INDEPENDENT revocation-aware binding
   * check runs in addition to R1–R17. The epoch snapshot in `current` must come
   * from the trusted authority at execution time, never from the bundle. If any
   * required state or time is missing the gate FAILS CLOSED. Default paths that
   * omit this option are byte-for-byte unchanged.
   */
  revocationBinding?: RevocationVerifierInput;
};

export const VERIFIER_VERSION = "verifier-1.0.0";

export const RULE_ORDER: RuleId[] = [
  "R1_HASH_CHAIN_INTACT",
  "R2_SIGNATURES_VALID",
  "R3_AGENT_IDENTITY_RESOLVES",
  "R4_AGENT_PAYMENT_KEY_AUTHORIZED",
  "R5_MANDATE_SIGNATURE_VALID",
  "R6_CLB_COMMITMENT_RECOMPUTES",
  "R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR",
  "R8_PAYMENT_NONCE_EQUALS_HASH_C",
  "R9_NONCE_CONSUMED_EXACTLY_ONCE",
  "R10_CHAIN_DOMAIN_MATCHES",
  "R11_AMOUNT_WITHIN_MANDATE",
  "R12_PAYEE_MATCHES_CHECKOUT_OR_TASK",
  "R13_ASSET_ALLOWED",
  "R14_DELIVERY_AFTER_SETTLEMENT",
  "R14b_DELIVERY_BOUND_TO_SETTLEMENT",
  "R15_TASK_HASH_MATCHES",
  "R17_PREDICATE_TRUE_FOR_MODE_B",
];

function eq(a: string, b: string): boolean {
  return a === b;
}

function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

function includesAddress(list: readonly string[], value: string): boolean {
  return list.some((entry) => sameAddress(entry, value));
}

function toAmount(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clbInputFor(bundle: TraceBundle): CLBCommitmentInput {
  return {
    identityRef: bundle.clb.identityRef,
    mandateDigest: computeMandateDigest(bundle.mandate),
    settlementDescriptor: bundle.clb.settlementDescriptor,
    domain: bundle.clb.domain,
  };
}

// --- Mode B (delegated / predicate) helpers ---------------------------------

function isModeB(bundle: TraceBundle): boolean {
  return bundle.mode === "MODE_B_PREDICATE";
}

/** The human-signed spending predicate when the bundle is a Mode B trace. */
function predicateOf(bundle: TraceBundle): SpendingPredicate | null {
  const descriptor = bundle.clb.settlementDescriptor;
  return descriptor.x402Scheme === "predicate" ? descriptor.predicate : null;
}

/** Concrete settlement params (from the agent-declared descriptor) for R17 / C'. */
function settlementParamsOf(bundle: TraceBundle): SettlementParams | null {
  if (!bundle.concreteSettlement) {
    return null;
  }
  return settlementParamsFromExact(bundle.concreteSettlement, bundle.payerAgent.agentId);
}

/** Inputs for recomputing C' from the trace bundle. */
function modeBCommitmentInputOf(bundle: TraceBundle): ModeBSettlementInput | null {
  const descriptor = bundle.clb.settlementDescriptor;
  const params = settlementParamsOf(bundle);
  if (descriptor.x402Scheme !== "predicate" || !params) {
    return null;
  }
  return {
    identityRef: bundle.clb.identityRef,
    mandateDigest: computeMandateDigest(bundle.mandate),
    predicateId: descriptor.predicateId,
    settlementParams: params,
    predicate: descriptor.predicate,
    domain: bundle.clb.domain,
  };
}

function checkHashChain(
  bundle: TraceBundle,
  options: Pick<
    VerifyTraceOptionsWithPrincipal,
    "expectedMerkleRoot" | "strictEvidenceIntegrity" | "requiredEventObjectTypes"
  > = {},
): RuleOutcome {
  const computedHashes: Hex[] = [];
  const seenEventIds = new Set<string>();
  const presentTypes = new Set<string>();

  for (let index = 0; index < bundle.events.length; index += 1) {
    const event = bundle.events[index];
    if (!event) {
      return { ok: false, detail: `Missing event at index ${index}` };
    }
    if (seenEventIds.has(event.eventId)) {
      return { ok: false, detail: `Duplicate event id ${event.eventId}` };
    }
    seenEventIds.add(event.eventId);
    presentTypes.add(event.objectType);

    const expectedPrevious = index === 0 ? undefined : computedHashes[index - 1];
    if (event.previousEventHash !== expectedPrevious) {
      return { ok: false, detail: `Broken hash chain at event ${event.eventId}` };
    }
    // R1 now checks the event signature surface. The signature is part of the
    // event hash, so a swap also breaks the declared hash/Merkle root.
    // Authenticity (ECDSA recovery against an actor key) is NOT claimed here:
    // fixture signatures are placeholders and events carry no signer address.
    if (!/^0x[0-9a-fA-F]{130}$/.test(event.signature)) {
      return { ok: false, detail: `Malformed event signature at ${event.eventId}` };
    }

    computedHashes.push(hashEvidenceEvent(event));
  }

  if (bundle.eventHashes) {
    const matches =
      bundle.eventHashes.length === computedHashes.length &&
      bundle.eventHashes.every((hash, index) => hash === computedHashes[index]);
    if (!matches) {
      return { ok: false, detail: "Provided event hashes do not match recomputed hashes" };
    }
  }

  const recomputedRoot = buildMerkleRoot(computedHashes);
  if (recomputedRoot !== bundle.merkleRoot) {
    return { ok: false, detail: "Merkle root does not match recomputed event hashes" };
  }

  const { expectedMerkleRoot, strictEvidenceIntegrity, requiredEventObjectTypes } = options;

  // Trusted-anchor comparison. Internal consistency alone is not evidence of
  // integrity: recomputeEvidenceIntegrity heals links + hashes + root for any
  // edited event set without a secret. Matching an anchored root is what makes
  // omission/fabrication detectable.
  if (strictEvidenceIntegrity === true && expectedMerkleRoot === undefined) {
    return { ok: false, detail: "STRICT_EVIDENCE_INTEGRITY_REQUIRES_TRUSTED_ROOT" };
  }
  if (
    expectedMerkleRoot !== undefined &&
    recomputedRoot.toLowerCase() !== expectedMerkleRoot.toLowerCase()
  ) {
    return {
      ok: false,
      detail: `Evidence Merkle root does not match trusted expected root (recomputed ${recomputedRoot}, expected ${expectedMerkleRoot})`,
    };
  }

  if (requiredEventObjectTypes) {
    const missing = requiredEventObjectTypes.filter((type) => !presentTypes.has(type));
    if (missing.length > 0) {
      return { ok: false, detail: `Missing required evidence object types: ${missing.join(", ")}` };
    }
  }

  return { ok: true };
}

/**
 * Verify the mandate against an INDEPENDENTLY ANCHORED human principal.
 *
 * WHY: `mandate.humanPrincipal` is a self-declared field inside the signed
 * object. `verifyMandate` defaults its `expectedSigner` to that field, so an
 * attacker can relax a constraint, re-sign with their own key, set
 * `humanPrincipal` to their own address and recompute C/nonce/receipt — every
 * rule then passes. The Tamarin model avoids this by minting `!HumanPk` only in
 * `Register_Human` and checking signatures against that fact, never against a
 * field of the attacker-supplied message. We mirror it here: the expected
 * signer must come from the caller's trusted anchor, and with no anchor we
 * fail closed instead of trusting the declaration.
 */
async function verifyMandateAgainstAnchor(
  bundle: TraceBundle,
  expectedHumanPrincipal: Address | undefined,
): Promise<{ valid: boolean; reasons: string[] }> {
  if (!expectedHumanPrincipal) {
    return { valid: false, reasons: ["HUMAN_PRINCIPAL_NOT_INDEPENDENTLY_ANCHORED"] };
  }
  return verifyMandate(bundle.mandate, {
    clb: bundle.clb,
    expectedSigner: expectedHumanPrincipal,
  });
}

async function checkSignatures(
  bundle: TraceBundle,
  expectedHumanPrincipal: Address | undefined,
): Promise<RuleOutcome> {
  const failures: string[] = [];

  const mandateResult = await verifyMandateAgainstAnchor(bundle, expectedHumanPrincipal);
  if (!mandateResult.valid) {
    failures.push(`mandate(${mandateResult.reasons.join(",")})`);
  }

  if (!(await verifyPaymentPayload(bundle.paymentPayload))) {
    failures.push("payment");
  }

  const reportSigner = await recoverReportSigner(bundle.report);
  if (
    !reportHashMatchesContent(bundle.report) ||
    !includesAddress(bundle.merchantAgent.authorizedSigningKeys, reportSigner)
  ) {
    failures.push("report");
  }

  return failures.length === 0
    ? { ok: true }
    : { ok: false, detail: `Invalid signatures: ${failures.join(", ")}` };
}

function checkIdentityResolves(bundle: TraceBundle): RuleOutcome {
  if (bundle.payerAgent.status !== "ACTIVE") {
    return { ok: false, detail: `Payer agent status is ${bundle.payerAgent.status}` };
  }
  if (!eq(bundle.payerAgent.agentId, bundle.clb.identityRef.agentId)) {
    return { ok: false, detail: "Bound identity agentId mismatch" };
  }
  if (!eq(bundle.payerAgent.agentId, bundle.mandate.authorizedAgent.agentId)) {
    return { ok: false, detail: "Mandate authorizedAgent does not match resolved identity" };
  }
  return { ok: true };
}

function checkPaymentKeyAuthorized(bundle: TraceBundle): RuleOutcome {
  return includesAddress(bundle.payerAgent.authorizedPaymentKeys, bundle.settlement.payer)
    ? { ok: true }
    : { ok: false, detail: `Payer ${bundle.settlement.payer} not authorized by agent card` };
}

async function checkMandateSignature(
  bundle: TraceBundle,
  expectedHumanPrincipal: Address | undefined,
): Promise<RuleOutcome> {
  const result = await verifyMandateAgainstAnchor(bundle, expectedHumanPrincipal);
  return result.valid ? { ok: true } : { ok: false, detail: result.reasons.join(", ") };
}

function checkCommitmentRecomputes(bundle: TraceBundle): RuleOutcome {
  if (isModeB(bundle)) {
    const input = modeBCommitmentInputOf(bundle);
    if (!input) {
      return { ok: false, detail: "Mode B requires a predicate descriptor and concrete settlement" };
    }
    if (!bundle.modeBCommitment) {
      return { ok: false, detail: "Mode B trace is missing modeBCommitment (C')" };
    }
    return computeModeBSettlementCommitment(input) === bundle.modeBCommitment
      ? { ok: true }
      : { ok: false, detail: "Recomputed C' does not equal bundle.modeBCommitment" };
  }
  const recomputed = computeCommitment(clbInputFor(bundle));
  return recomputed === bundle.mandate.clbCommitment
    ? { ok: true }
    : { ok: false, detail: "Recomputed C does not equal mandate.clbCommitment" };
}

function checkSettlementMatchesDescriptor(bundle: TraceBundle): RuleOutcome {
  if (isModeB(bundle)) {
    // The predicate itself is checked in R17; here we bind the concrete
    // settlement the agent declared to the actual settlement receipt.
    const concrete = bundle.concreteSettlement;
    if (!concrete) {
      return { ok: false, detail: "Mode B trace is missing concreteSettlement" };
    }
    const { settlement } = bundle;
    const mismatches: string[] = [];
    if (!sameAddress(settlement.payTo, concrete.payTo)) mismatches.push("payTo");
    if (!eq(settlement.value, concrete.value)) mismatches.push("value");
    if (!eq(settlement.asset, concrete.asset)) mismatches.push("asset");
    if (!eq(settlement.network, concrete.network)) mismatches.push("network");
    if (settlement.chainId !== concrete.chainId) mismatches.push("chainId");
    return mismatches.length === 0
      ? { ok: true }
      : { ok: false, detail: `Settlement mismatches concrete params: ${mismatches.join(", ")}` };
  }

  const descriptor = bundle.clb.settlementDescriptor;
  if (descriptor.x402Scheme !== "exact") {
    return { ok: false, detail: "Mode A requires an exact settlement descriptor" };
  }
  const { settlement } = bundle;
  const mismatches: string[] = [];
  if (!sameAddress(settlement.payTo, descriptor.payTo)) mismatches.push("payTo");
  if (!eq(settlement.value, descriptor.value)) mismatches.push("value");
  if (!eq(settlement.asset, descriptor.asset)) mismatches.push("asset");
  if (!eq(settlement.network, descriptor.network)) mismatches.push("network");
  if (settlement.chainId !== descriptor.chainId) mismatches.push("chainId");

  return mismatches.length === 0
    ? { ok: true }
    : { ok: false, detail: `Settlement mismatches descriptor: ${mismatches.join(", ")}` };
}

function checkNonceEqualsHashC(bundle: TraceBundle): RuleOutcome {
  if (isModeB(bundle)) {
    const input = modeBCommitmentInputOf(bundle);
    if (!input) {
      return { ok: false, detail: "Mode B requires a predicate descriptor and concrete settlement" };
    }
    const expectedNonce = deriveSettlementNonce(computeModeBSettlementCommitment(input));
    if (bundle.paymentPayload.authorization.nonce !== expectedNonce) {
      return { ok: false, detail: "Payment nonce != H(C')" };
    }
    if (bundle.settlement.nonce !== expectedNonce) {
      return { ok: false, detail: "Settlement nonce != H(C')" };
    }
    return { ok: true };
  }
  const expectedNonce = deriveNonce(computeCommitment(clbInputFor(bundle)));
  if (bundle.paymentPayload.authorization.nonce !== expectedNonce) {
    return { ok: false, detail: "Payment nonce != H(C)" };
  }
  if (bundle.settlement.nonce !== expectedNonce) {
    return { ok: false, detail: "Settlement nonce != H(C)" };
  }
  return { ok: true };
}

function checkNonceConsumedOnce(bundle: TraceBundle): RuleOutcome {
  if (bundle.nonceReplayAttempt === true) {
    return { ok: false, detail: "Nonce replay detected" };
  }
  if (!bundle.settlement.settled) {
    return { ok: false, detail: "Settlement is not marked settled" };
  }
  if (bundle.settlement.nonce !== bundle.paymentPayload.authorization.nonce) {
    return { ok: false, detail: "Settlement nonce does not match payment nonce" };
  }
  return { ok: true };
}

function checkChainDomain(bundle: TraceBundle): RuleOutcome {
  if (isModeB(bundle)) {
    const predicate = predicateOf(bundle);
    const concrete = bundle.concreteSettlement;
    if (!predicate || !concrete) {
      return { ok: false, detail: "Mode B requires a predicate descriptor and concrete settlement" };
    }
    if (bundle.settlement.chainId !== concrete.chainId) {
      return { ok: false, detail: "Settlement chainId differs from concrete settlement" };
    }
    if (!predicate.allowedChainIds.includes(concrete.chainId)) {
      return { ok: false, detail: `Settlement chain ${concrete.chainId} not in predicate.allowedChainIds` };
    }
    // G4: the EIP-712 domain chain is the chain C' was signed for. Mode B
    // previously never compared it, allowing a domain-chain transplant.
    const domainChain = bundle.clb.domain.chainId;
    if (
      concrete.chainId !== domainChain ||
      bundle.settlement.chainId !== domainChain ||
      bundle.payerAgent.chainId !== domainChain ||
      bundle.clb.identityRef.chainId !== domainChain
    ) {
      return { ok: false, detail: "chainId differs across domain/concrete/settlement/agent/identity" };
    }
    return { ok: true };
  }
  const descriptor = bundle.clb.settlementDescriptor;
  if (descriptor.x402Scheme !== "exact") {
    return { ok: false, detail: "Mode A requires an exact settlement descriptor" };
  }
  const domainChain = bundle.clb.domain.chainId;
  const values = [
    descriptor.chainId,
    bundle.settlement.chainId,
    bundle.payerAgent.chainId,
    bundle.clb.identityRef.chainId,
  ];
  return values.every((value) => value === domainChain)
    ? { ok: true }
    : { ok: false, detail: "chainId differs across domain/descriptor/settlement/identity" };
}

function checkAmountWithinMandate(bundle: TraceBundle): RuleOutcome {
  const settled = toAmount(bundle.settlement.value);
  // Mode B authorizes against the predicate's maxValue; Mode A uses the mandate.
  const predicate = isModeB(bundle) ? predicateOf(bundle) : null;
  const max = toAmount(predicate ? predicate.maxValue : bundle.mandate.constraints.maxAmount);
  if (settled === null || max === null) {
    return { ok: false, detail: "Missing or non-numeric amount" };
  }
  return settled <= max
    ? { ok: true }
    : { ok: false, detail: `Settled ${settled} exceeds max ${max}` };
}

/**
 * The confidential cap must come from the human-signed mandate, never from a
 * bundle-authored field. `mandateDigest` covers `constraints.maxAmount`, which
 * `issueMandate` populates from the predicate's `maxValue` in Mode B. The
 * 6-decimal conversion matches `settlementParamsFromExact`'s default.
 */
function signedCapAtomic(bundle: TraceBundle): bigint | null {
  const signed = bundle.mandate.constraints.maxAmount;
  if (!signed) return null;
  try {
    const cap = parseUnits(signed, 6);
    return cap >= 0n && cap < (1n << 64n) ? cap : null;
  } catch {
    return null;
  }
}

/**
 * R11 (confidential): discharge the amount-within-mandate predicate via the
 * range proof — `value <= maxValue` — without ever reading a plaintext amount.
 * The declared proof cap may only TIGHTEN the signed cap: a bundle author who
 * inflates `confidential.maxValueAtomic` cannot raise the authorized amount.
 */
function checkAmountConfidential(bundle: TraceBundle): RuleOutcome {
  const confidential = bundle.confidential;
  if (!confidential) {
    return { ok: false, detail: "Confidential mode requires bundle.confidential (commitment + range proof)" };
  }
  const signedCap = signedCapAtomic(bundle);
  if (signedCap === null) {
    return { ok: false, detail: "R11 requires a human-signed mandate.constraints.maxAmount in [0, 2^64)" };
  }
  let declaredCap: bigint;
  try {
    declaredCap = BigInt(confidential.maxValueAtomic);
  } catch {
    return { ok: false, detail: "Malformed confidential.maxValueAtomic" };
  }
  if (declaredCap < 0n) {
    return { ok: false, detail: "Negative confidential.maxValueAtomic" };
  }
  const effectiveCap = declaredCap < signedCap ? declaredCap : signedCap;
  const ok = verifyConfidential(confidential.valueCommitment, confidential.rangeProof, {
    maxValueAtomic: effectiveCap,
  });
  return ok
    ? { ok: true }
    : { ok: false, detail: "Range proof does not attest value <= signed maxValue" };
}

function checkPayeeMatches(bundle: TraceBundle): RuleOutcome {
  const payTo = bundle.settlement.payTo;
  const predicate = isModeB(bundle) ? predicateOf(bundle) : null;
  const allowedPayees = predicate
    ? predicate.allowedPayees
    : bundle.mandate.constraints.allowedPayees ?? [];

  if (bundle.merchantAgent.status !== "ACTIVE") {
    return { ok: false, detail: "Merchant agent is not active" };
  }
  if (!includesAddress(bundle.merchantAgent.authorizedPaymentKeys, payTo)) {
    return { ok: false, detail: "Payee is not a registered merchant receiving address" };
  }
  if (!includesAddress(allowedPayees, payTo)) {
    return { ok: false, detail: `Payee not in ${predicate ? "predicate" : "mandate"} allowedPayees` };
  }
  return { ok: true };
}

function checkAssetAllowed(bundle: TraceBundle): RuleOutcome {
  const predicate = isModeB(bundle) ? predicateOf(bundle) : null;
  const allowed = predicate ? predicate.allowedAssets : bundle.mandate.constraints.allowedAssets ?? [];
  return allowed.includes(bundle.settlement.asset)
    ? { ok: true }
    : { ok: false, detail: `Asset ${bundle.settlement.asset} not allowed` };
}

/** R17: in Mode B the concrete settlement must satisfy the human-signed predicate. */
function checkPredicateTrueForModeB(bundle: TraceBundle): RuleOutcome {
  if (!isModeB(bundle)) {
    return { ok: true };
  }
  const predicate = predicateOf(bundle);
  const params = settlementParamsOf(bundle);
  if (!predicate || !params) {
    return { ok: false, detail: "Mode B requires a predicate descriptor and concrete settlement" };
  }
  // Evaluate expiry against the settlement time (deterministic), not wall-clock:
  // the question is whether settlement occurred within the predicate's window.
  const settledAt = Date.parse(bundle.settlement.settledAt);
  const now = Number.isNaN(settledAt) ? new Date() : new Date(settledAt);
  const evaluation = evaluatePredicate(predicate, params, now, bundle.report.inputDataHash as Hex);
  return evaluation.ok
    ? { ok: true }
    : { ok: false, detail: `Predicate violated: ${evaluation.violations.join(", ")}` };
}

function checkDeliveryAfterSettlement(bundle: TraceBundle): RuleOutcome {
  const settledAt = Date.parse(bundle.settlement.settledAt);
  const generatedAt = Date.parse(bundle.report.generatedAt);
  if (Number.isNaN(settledAt) || Number.isNaN(generatedAt)) {
    return { ok: false, detail: "Invalid settlement or delivery timestamp" };
  }
  return generatedAt >= settledAt
    ? { ok: true }
    : { ok: false, detail: "Delivery occurred before settlement" };
}

async function checkDeliveryBoundToSettlement(bundle: TraceBundle): Promise<RuleOutcome> {
  const binding = bundle.report.deliveryBinding;
  if (!binding) {
    return { ok: false, detail: "Report is missing deliveryBinding signature" };
  }
  const merchantSigner = bundle.merchantAgent.authorizedSigningKeys[0];
  if (!merchantSigner) {
    return { ok: false, detail: "Merchant agent has no authorized signing key" };
  }
  const ok = await verifyDeliveryBinding({
    settlementTxHash: bundle.settlement.txHash,
    reportHash: bundle.report.reportHash,
    signature: binding,
    merchant: merchantSigner,
  });
  return ok
    ? { ok: true }
    : { ok: false, detail: "Delivery binding does not match this settlement txHash" };
}

function checkTaskHashMatches(bundle: TraceBundle): RuleOutcome {
  const taskHash = bundle.mandate.constraints.taskHash;
  if (!taskHash) {
    return { ok: true };
  }
  return bundle.report.inputDataHash === taskHash
    ? { ok: true }
    : { ok: false, detail: "Report inputDataHash does not match mandate taskHash" };
}

function certificateHash(certificate: Omit<VerificationCertificate, "certificateHash">): Hex {
  return keccak256(toBytes(canonicalJson(certificate)));
}

/**
 * Run all deterministic rules and emit a verification certificate. R1–R15 are
 * mode-aware (Mode A exact descriptor vs Mode B predicate/C'); R17 enforces the
 * spending predicate in Mode B and passes vacuously in Mode A.
 */
export async function verifyTrace(
  bundle: TraceBundle,
  options: VerifyTraceOptionsWithPrincipal = {},
): Promise<VerifyTraceOutput> {
  const outcomes = {} as Record<RuleId, RuleOutcome>;
  // Confidential mode discharges R11 via the range proof (no plaintext amount).
  const confidential = options.confidential === true && bundle.confidential !== undefined;
  const { expectedHumanPrincipal } = options;

  outcomes.R1_HASH_CHAIN_INTACT = checkHashChain(bundle, options);
  outcomes.R2_SIGNATURES_VALID = await checkSignatures(bundle, expectedHumanPrincipal);
  outcomes.R3_AGENT_IDENTITY_RESOLVES = checkIdentityResolves(bundle);
  outcomes.R4_AGENT_PAYMENT_KEY_AUTHORIZED = checkPaymentKeyAuthorized(bundle);
  outcomes.R5_MANDATE_SIGNATURE_VALID = await checkMandateSignature(bundle, expectedHumanPrincipal);
  outcomes.R6_CLB_COMMITMENT_RECOMPUTES = checkCommitmentRecomputes(bundle);
  outcomes.R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR = checkSettlementMatchesDescriptor(bundle);
  outcomes.R8_PAYMENT_NONCE_EQUALS_HASH_C = checkNonceEqualsHashC(bundle);
  outcomes.R9_NONCE_CONSUMED_EXACTLY_ONCE = checkNonceConsumedOnce(bundle);
  outcomes.R10_CHAIN_DOMAIN_MATCHES = checkChainDomain(bundle);
  outcomes.R11_AMOUNT_WITHIN_MANDATE = confidential
    ? checkAmountConfidential(bundle)
    : checkAmountWithinMandate(bundle);
  outcomes.R12_PAYEE_MATCHES_CHECKOUT_OR_TASK = checkPayeeMatches(bundle);
  outcomes.R13_ASSET_ALLOWED = checkAssetAllowed(bundle);
  outcomes.R14_DELIVERY_AFTER_SETTLEMENT = checkDeliveryAfterSettlement(bundle);
  outcomes.R14b_DELIVERY_BOUND_TO_SETTLEMENT = await checkDeliveryBoundToSettlement(bundle);
  outcomes.R15_TASK_HASH_MATCHES = checkTaskHashMatches(bundle);
  outcomes.R17_PREDICATE_TRUE_FOR_MODE_B = checkPredicateTrueForModeB(bundle);

  // RCLB gate: additive and opt-in. It does not alter any R1–R17 outcome; it
  // only adds a new failure code when the CURRENT authority state rejects C_t.
  const revocationGate = options.revocationBinding;
  const revocationOutcome =
    revocationGate === undefined
      ? null
      : verifyRevocationBinding({
          ...revocationGate,
          now: revocationGate.now ?? settlementTimeSeconds(bundle),
        });
  if (revocationOutcome !== null) {
    // Exposed for callers that want the failure reason; not part of RuleId (which
    // is owned by ./types and left untouched for the default path).
    (outcomes as unknown as Record<string, RuleOutcome>)[R18_REVOCATION_AWARE_BINDING] = revocationOutcome;
  }
  const failedRules = RULE_ORDER.filter((rule) => !outcomes[rule].ok);
  if (revocationOutcome !== null && !revocationOutcome.ok) {
    failedRules.push(R18_REVOCATION_AWARE_BINDING as unknown as RuleId);
  }
  const status = failedRules.length === 0 ? "PASS" : "FAIL";
  const checkedAt = new Date().toISOString();
  const modeBInput = isModeB(bundle) ? modeBCommitmentInputOf(bundle) : null;
  const zeroHash = `0x${"0".repeat(64)}` as Hex;
  const clbCommitment = (isModeB(bundle)
    ? bundle.modeBCommitment ??
      (modeBInput ? computeModeBSettlementCommitment(modeBInput) : zeroHash)
    : bundle.mandate.clbCommitment ?? computeCommitment(clbInputFor(bundle))) as Hex;

  const unsignedCertificate: Omit<VerificationCertificate, "certificateHash"> = {
    traceId: bundle.traceId,
    mode: bundle.mode,
    status,
    rulesChecked:
      revocationGate === undefined
        ? RULE_ORDER
        : [...RULE_ORDER, R18_REVOCATION_AWARE_BINDING as unknown as RuleId],
    failedRules,
    clbCommitment,
    settlementTxHash: bundle.settlement.txHash,
    traceMerkleRoot: bundle.merkleRoot,
    verifierVersion: VERIFIER_VERSION,
    createdAt: checkedAt,
  };
  const hash = certificateHash(unsignedCertificate);

  return {
    outcomes,
    certificate: { ...unsignedCertificate, certificateHash: hash },
    result: {
      traceId: bundle.traceId,
      status,
      failedRules,
      warnings: [],
      certificateHash: hash,
      checkedAt,
      mode: bundle.mode,
    },
    // Undefined on the confidential (proof-only) path; true when a plaintext
    // amount was read for R11.
    ...(confidential ? {} : { readPlaintextAmount: true }),
  };
}

// ---------------------------------------------------------------------------
// RCLB — NEW dedicated region: optional R18 revocation-aware binding rule
// ---------------------------------------------------------------------------

/**
 * Trusted CURRENT authority state plus the revocation-aware commitment carried
 * by the settlement message. `current` is deliberately optional at the type
 * level so a failed registry read cannot be silently treated as "still valid".
 */
export type RevocationVerifierInput = {
  current?: { identityEpoch?: bigint; mandateEpoch?: bigint };
  /** C_t presented by the settlement message. */
  commitment: Hex;
  /** C or C' recomputed from the trace bundle (the base commitment). */
  baseCommitment: Hex;
  /** E_I bound into C_t. */
  identityEpoch: bigint;
  /** E_M bound into C_t. */
  mandateEpoch: bigint;
  /** T_expiry bound into C_t (Unix seconds, inclusive). */
  expiry: bigint;
  /** N bound into C_t (single-use application nonce). */
  nonce: Hex;
  /** Settlement time in Unix seconds; defaults to `settlement.settledAt`. */
  now?: bigint | null;
  /** N values already consumed by the authority. */
  consumedNonces?: readonly Hex[];
};

/** New rule id, additive to RULE_ORDER (which lives in `./types`). */
export const R18_REVOCATION_AWARE_BINDING = "R18_REVOCATION_AWARE_BINDING" as const;

/** Deterministic settlement time in Unix seconds; null when unparseable. */
function settlementTimeSeconds(bundle: TraceBundle): bigint | null {
  const parsed = Date.parse(bundle.settlement.settledAt);
  return Number.isNaN(parsed) ? null : BigInt(Math.floor(parsed / 1000));
}

/**
 * R18. Pure re-check of C_t against CURRENT authority state. Returns a normal
 * RuleOutcome; verifyTrace adds the failure code only when this option is used.
 * A missing epoch snapshot, missing time or malformed nonce fails closed.
 */
export function verifyRevocationBinding(input: RevocationVerifierInput): RuleOutcome {
  const now = input.now ?? null;
  if (now === null) {
    return { ok: false, detail: "REVOCATION_SETTLEMENT_TIME_UNAVAILABLE" };
  }
  const consumed = new Set(
    (input.consumedNonces ?? []).map((nonce) => nonce.toLowerCase()),
  );
  const acceptance = checkRevocationAwareAcceptance({
    fields: {
      baseCommitment: input.baseCommitment,
      identityEpoch: input.identityEpoch,
      mandateEpoch: input.mandateEpoch,
      expiry: input.expiry,
      nonce: input.nonce,
    },
    commitment: input.commitment,
    currentIdentityEpoch: input.current?.identityEpoch,
    currentMandateEpoch: input.current?.mandateEpoch,
    now,
    consumedNonces: consumed,
  });
  return acceptance.ok ? { ok: true } : { ok: false, detail: acceptance.detail };
}
