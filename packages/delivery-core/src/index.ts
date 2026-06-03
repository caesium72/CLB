import { canonicalJson } from "@clb-acel/evidence-core";
import type { TokenRiskReport } from "@clb-acel/schemas";
import { TokenRiskReportSchema } from "@clb-acel/schemas";
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
  const { reportHash: _reportHash, merchantAgentSignature: _signature, ...unsigned } = report;
  void _reportHash;
  void _signature;
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

export async function recoverReportSigner(report: TokenRiskReport): Promise<Address> {
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

export function reportHashMatchesContent(report: TokenRiskReport): boolean {
  return computeReportHash(stripSignature(report)) === report.reportHash;
}
