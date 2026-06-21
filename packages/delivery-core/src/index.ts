import { canonicalJson } from "@clb-acel/evidence-core";
import type { DeliveryReport, ServiceKind, ServiceReport, TokenRiskReport } from "@clb-acel/schemas";
import { ServiceReportSchema, TokenRiskReportSchema } from "@clb-acel/schemas";
import {
  type Address,
  type Hex,
  keccak256,
  recoverMessageAddress,
  toBytes,
  verifyMessage,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type UnsignedReport = Omit<TokenRiskReport, "reportHash" | "merchantAgentSignature">;

export const RISK_MODEL_VERSION = "heuristic-v1";

type RiskSignals = TokenRiskReport["signals"];

function signalFromByte(byte: number): number {
  return Math.round((byte / 255) * 1000) / 1000;
}

/**
 * Deterministic heuristic token-risk scoring. Signals are derived from a keccak
 * digest of the (token, chain) pair so identical inputs always yield identical
 * reports, keeping evidence hashes and verifier output reproducible. The
 * `experiments/risk-scoring` uv package mirrors this scheme for evaluation.
 */
export function scoreToken(input: { token: string; chain: string }): {
  signals: RiskSignals;
  riskScore: number;
  inputDataHash: Hex;
} {
  const seed = keccak256(toBytes(canonicalJson({ ...input, model: RISK_MODEL_VERSION })));
  const bytes = toBytes(seed);

  const signals: RiskSignals = {
    liquidityRisk: signalFromByte(bytes[0] ?? 0),
    holderConcentrationRisk: signalFromByte(bytes[1] ?? 0),
    contractRisk: signalFromByte(bytes[2] ?? 0),
    marketVolatilityRisk: signalFromByte(bytes[3] ?? 0),
    socialNarrativeRisk: signalFromByte(bytes[4] ?? 0),
  };

  const weighted =
    signals.liquidityRisk * 0.25 +
    signals.holderConcentrationRisk * 0.25 +
    signals.contractRisk * 0.3 +
    signals.marketVolatilityRisk * 0.15 +
    (signals.socialNarrativeRisk ?? 0) * 0.05;

  return {
    signals,
    riskScore: Math.round(weighted * 1000) / 1000,
    inputDataHash: keccak256(toBytes(canonicalJson({ ...input, signals }))),
  };
}

/** reportHash binds the delivered report content to the paid task. */
export function computeReportHash(report: UnsignedReport): Hex {
  return keccak256(toBytes(canonicalJson(report)));
}

function stripSignature(report: TokenRiskReport): UnsignedReport {
  const {
    reportHash: _reportHash,
    merchantAgentSignature: _signature,
    deliveryBinding: _deliveryBinding,
    ...unsigned
  } = report;
  void _reportHash;
  void _signature;
  void _deliveryBinding;
  return unsigned;
}

/** Compute the report hash and sign it with the merchant agent key. */
export async function signReport(
  merchantPrivateKey: Hex,
  unsigned: UnsignedReport,
): Promise<TokenRiskReport> {
  const reportHash = computeReportHash(unsigned);
  const account = privateKeyToAccount(merchantPrivateKey);
  const merchantAgentSignature = await account.signMessage({ message: { raw: reportHash } });
  return TokenRiskReportSchema.parse({ ...unsigned, reportHash, merchantAgentSignature });
}

/** Verify both that the reportHash matches the content and the signature is from `signer`. */
export async function verifyReportSignature(
  report: TokenRiskReport,
  signer: Address,
): Promise<boolean> {
  if (computeReportHash(stripSignature(report)) !== report.reportHash) {
    return false;
  }
  return verifyMessage({
    address: signer,
    message: { raw: report.reportHash as Hex },
    signature: report.merchantAgentSignature as Hex,
  });
}

/** Generic (report-shape-agnostic) signer recovery — works for any DeliveryReport. */
export async function recoverReportSigner(report: DeliveryReport): Promise<Address> {
  return recoverMessageAddress({
    message: { raw: report.reportHash as Hex },
    signature: report.merchantAgentSignature as Hex,
  });
}

export type ScorerResult = {
  signals: RiskSignals;
  riskScore: number;
  inputDataHash: Hex;
};

export type ScorerFn = (input: { token: string; chain: string }) => Promise<ScorerResult> | ScorerResult;

/** Score a token, assemble the report, and sign it with the merchant agent key. */
export async function buildSignedReport(
  merchantPrivateKey: Hex,
  input: { token: string; chain: string; generatedAt?: string },
  options?: { scorer?: ScorerFn; modelVersion?: string },
): Promise<TokenRiskReport> {
  const scorer = options?.scorer ?? scoreToken;
  const scored = await scorer(input);
  return signReport(merchantPrivateKey, {
    token: input.token,
    chain: input.chain,
    riskScore: scored.riskScore,
    signals: scored.signals,
    modelVersion: options?.modelVersion ?? RISK_MODEL_VERSION,
    inputDataHash: scored.inputDataHash,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  });
}

/**
 * Generic content-integrity check: recompute keccak(canonicalJson(content)) over the
 * report minus its signature/hash/binding fields. Works for any DeliveryReport
 * because both shapes derive `reportHash` the same way.
 */
export function reportHashMatchesContent(report: DeliveryReport): boolean {
  const {
    reportHash: _reportHash,
    merchantAgentSignature: _signature,
    deliveryBinding: _deliveryBinding,
    ...content
  } = report as Record<string, unknown> & DeliveryReport;
  void _reportHash;
  void _signature;
  void _deliveryBinding;
  return keccak256(toBytes(canonicalJson(content))) === report.reportHash;
}

/**
 * Digest binding a delivered report to the settlement transaction that paid for it.
 *
 * `settlementTxHash`/`reportHash` accept `Hex | string`: they are hex strings at runtime but are
 * sourced from schema fields typed as plain `string` (the repo's `HexString` infers to `string`,
 * not viem's branded `Hex`). They are only serialized into the digest via `canonicalJson`, never
 * passed to a `Hex`-requiring viem call, so widening the param type is byte-for-byte identical.
 */
export function deliveryBindingDigest(settlementTxHash: Hex | string, reportHash: Hex | string): Hex {
  return keccak256(toBytes(canonicalJson({ settlementTxHash, reportHash })));
}

export async function signDeliveryBinding(input: {
  settlementTxHash: Hex | string;
  reportHash: Hex | string;
  merchantKey: Hex;
}): Promise<Hex> {
  const digest = deliveryBindingDigest(input.settlementTxHash, input.reportHash);
  const account = privateKeyToAccount(input.merchantKey);
  return account.signMessage({ message: { raw: digest } });
}

export async function verifyDeliveryBinding(input: {
  settlementTxHash: Hex | string;
  reportHash: Hex | string;
  signature: Hex | string;
  merchant: Address;
}): Promise<boolean> {
  const digest = deliveryBindingDigest(input.settlementTxHash, input.reportHash);
  return verifyMessage({
    address: input.merchant,
    message: { raw: digest },
    signature: input.signature as Hex,
  });
}

// ---------------------------------------------------------------------------
// Generic signed delivery artifact (any merchant agent: grammar, weather, …).
// Same reportHash / signature / delivery-binding semantics as the token-risk
// report, so a ServiceReport flows through the verifier's binding rules
// unchanged. `signDeliveryBinding`/`verifyDeliveryBinding` above are reused.
// ---------------------------------------------------------------------------

export type UnsignedServiceReport = Omit<
  ServiceReport,
  "reportHash" | "merchantAgentSignature" | "deliveryBinding"
>;

/** keccak over the canonical service input (the text, the city, …). */
export function serviceInputDataHash(input: unknown): Hex {
  return keccak256(toBytes(canonicalJson(input)));
}

/** reportHash binds the delivered service result to the paid task. */
export function computeServiceReportHash(report: UnsignedServiceReport): Hex {
  return keccak256(toBytes(canonicalJson(report)));
}

/** Compute the report hash and sign it with the merchant agent key. */
export async function signServiceReport(
  merchantPrivateKey: Hex,
  unsigned: UnsignedServiceReport,
): Promise<ServiceReport> {
  const reportHash = computeServiceReportHash(unsigned);
  const account = privateKeyToAccount(merchantPrivateKey);
  const merchantAgentSignature = await account.signMessage({ message: { raw: reportHash } });
  return ServiceReportSchema.parse({ ...unsigned, reportHash, merchantAgentSignature });
}

/** Assemble a service report (deriving inputDataHash) and sign it. */
export async function buildSignedServiceReport(
  merchantPrivateKey: Hex,
  input: {
    service: ServiceKind;
    task: string;
    /** Raw service input, hashed into inputDataHash (the text, the city, …). */
    input: unknown;
    result: Record<string, unknown>;
    modelVersion: string;
    generatedAt?: string;
  },
): Promise<ServiceReport> {
  return signServiceReport(merchantPrivateKey, {
    service: input.service,
    task: input.task,
    result: input.result,
    modelVersion: input.modelVersion,
    inputDataHash: serviceInputDataHash(input.input),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  });
}

/** Verify both that the reportHash matches the content and the signature is from `signer`. */
export async function verifyServiceReportSignature(
  report: ServiceReport,
  signer: Address,
): Promise<boolean> {
  const {
    reportHash: _reportHash,
    merchantAgentSignature: _signature,
    deliveryBinding: _deliveryBinding,
    ...unsigned
  } = report;
  void _reportHash;
  void _signature;
  void _deliveryBinding;
  if (computeServiceReportHash(unsigned) !== report.reportHash) {
    return false;
  }
  return verifyMessage({
    address: signer,
    message: { raw: report.reportHash as Hex },
    signature: report.merchantAgentSignature as Hex,
  });
}
