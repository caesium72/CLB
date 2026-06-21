import type { TraceBundle } from "@clb-acel/verifier-core";
import { verifyPaymentPayload } from "@clb-acel/x402-adapter";
import { isAddress } from "viem";
import type { BaselineVerdict } from "./types";

/**
 * Vanilla x402 baseline verifier (B0).
 *
 * Checks ONLY x402 settlement well-formedness — NO cross-layer rules:
 * no payee/amount/asset/identity/nonce/mandate cross-checks.
 *
 * Crucially it does NOT compare settlement.payTo against the mandate or
 * allowedPayees. A vanilla x402 stack has no cross-layer view, so it will
 * ACCEPT a payee-substitution attack that the full CLB-ACEL verifier REJECTS.
 */
export async function bVanillaX402(bundle: TraceBundle): Promise<BaselineVerdict> {
  const reasons: string[] = [];

  // 1. Recipient is a valid Ethereum address
  if (!isAddress(bundle.settlement.payTo)) {
    reasons.push("MALFORMED_PAYTO");
  }

  // 2. Settlement value parses to a finite number > 0
  const value = Number(bundle.settlement.value);
  if (!Number.isFinite(value) || value <= 0) {
    reasons.push("MALFORMED_VALUE");
  }

  // 3. Asset is a non-empty string
  if (typeof bundle.settlement.asset !== "string" || bundle.settlement.asset.length === 0) {
    reasons.push("MALFORMED_ASSET");
  }

  // 4. Payment payload signature recovers (structural x402 check only)
  const sigValid = await verifyPaymentPayload(bundle.paymentPayload);
  if (!sigValid) {
    reasons.push("BAD_SIGNATURE");
  }

  return { accepted: reasons.length === 0, reasons };
}
