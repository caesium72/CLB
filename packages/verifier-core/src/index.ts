import { verifyMandate } from "@clb-acel/ap2-adapter";
import {
  computeCommitment,
  computeMandateDigest,
  computeModeBSettlementCommitment,
  deriveNonce,
  deriveSettlementNonce,
  evaluatePredicate,
  settlementParamsFromExact,
  type ModeBSettlementInput,
} from "@clb-acel/clb-core";
import { recoverReportSigner, reportHashMatchesContent } from "@clb-acel/delivery-core";
import { buildMerkleRoot, hashEvidenceEvent } from "@clb-acel/evidence-core";
import { canonicalJson } from "@clb-acel/evidence-core";
import type {
  CLBCommitmentInput,
  SettlementParams,
  SpendingPredicate,
  VerificationCertificate,
} from "@clb-acel/schemas";
import { verifyPaymentPayload } from "@clb-acel/x402-adapter";
import { type Hex, getAddress, keccak256, toBytes } from "viem";
import type { RuleId, RuleOutcome, TraceBundle, VerifyTraceOutput } from "./types";

export * from "./types";

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
    domain: bundle.clb.domain,
  };
}

function checkHashChain(bundle: TraceBundle): RuleOutcome {
  const computedHashes: Hex[] = [];

  for (let index = 0; index < bundle.events.length; index += 1) {
    const event = bundle.events[index];
    if (!event) {
      return { ok: false, detail: `Missing event at index ${index}` };
    }

    const expectedPrevious = index === 0 ? undefined : computedHashes[index - 1];
    if (event.previousEventHash !== expectedPrevious) {
      return { ok: false, detail: `Broken hash chain at event ${event.eventId}` };
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

  if (buildMerkleRoot(computedHashes) !== bundle.merkleRoot) {
    return { ok: false, detail: "Merkle root does not match recomputed event hashes" };
  }

  return { ok: true };
}

async function checkSignatures(bundle: TraceBundle): Promise<RuleOutcome> {
  const failures: string[] = [];

  const mandateResult = await verifyMandate(bundle.mandate, { clb: bundle.clb });
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

async function checkMandateSignature(bundle: TraceBundle): Promise<RuleOutcome> {
  const result = await verifyMandate(bundle.mandate, { clb: bundle.clb });
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
    if (bundle.payerAgent.chainId !== bundle.clb.identityRef.chainId) {
      return { ok: false, detail: "Payer agent chainId differs from bound identity" };
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
export async function verifyTrace(bundle: TraceBundle): Promise<VerifyTraceOutput> {
  const outcomes = {} as Record<RuleId, RuleOutcome>;

  outcomes.R1_HASH_CHAIN_INTACT = checkHashChain(bundle);
  outcomes.R2_SIGNATURES_VALID = await checkSignatures(bundle);
  outcomes.R3_AGENT_IDENTITY_RESOLVES = checkIdentityResolves(bundle);
  outcomes.R4_AGENT_PAYMENT_KEY_AUTHORIZED = checkPaymentKeyAuthorized(bundle);
  outcomes.R5_MANDATE_SIGNATURE_VALID = await checkMandateSignature(bundle);
  outcomes.R6_CLB_COMMITMENT_RECOMPUTES = checkCommitmentRecomputes(bundle);
  outcomes.R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR = checkSettlementMatchesDescriptor(bundle);
  outcomes.R8_PAYMENT_NONCE_EQUALS_HASH_C = checkNonceEqualsHashC(bundle);
  outcomes.R9_NONCE_CONSUMED_EXACTLY_ONCE = checkNonceConsumedOnce(bundle);
  outcomes.R10_CHAIN_DOMAIN_MATCHES = checkChainDomain(bundle);
  outcomes.R11_AMOUNT_WITHIN_MANDATE = checkAmountWithinMandate(bundle);
  outcomes.R12_PAYEE_MATCHES_CHECKOUT_OR_TASK = checkPayeeMatches(bundle);
  outcomes.R13_ASSET_ALLOWED = checkAssetAllowed(bundle);
  outcomes.R14_DELIVERY_AFTER_SETTLEMENT = checkDeliveryAfterSettlement(bundle);
  outcomes.R15_TASK_HASH_MATCHES = checkTaskHashMatches(bundle);
  outcomes.R17_PREDICATE_TRUE_FOR_MODE_B = checkPredicateTrueForModeB(bundle);

  const failedRules = RULE_ORDER.filter((rule) => !outcomes[rule].ok);
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
    rulesChecked: RULE_ORDER,
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
  };
}
