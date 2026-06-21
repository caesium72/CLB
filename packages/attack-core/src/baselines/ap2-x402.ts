import type { TraceBundle } from "@clb-acel/verifier-core";
import { getAddress } from "viem";
import type { BaselineVerdict } from "./types";
import { bVanillaX402 } from "./vanilla-x402";

/**
 * AP2-mandate + x402 baseline verifier (B1 / bAp2X402).
 *
 * This baseline enforces x402 well-formedness AND AP2 mandate spending
 * constraints (amount / payee / asset) by reading the declared fields from
 * bundle.mandate.constraints — but it does NOT cryptographically re-verify
 * the mandate's CLB-bound signature.
 *
 * WHY NO C-RECOMPUTE:
 * In this codebase the AP2 CART mandate signature is cryptographically
 * entangled with the CLB commitment (produced by signCommitment over C, and
 * verifyMandate with the `clb` option performs the commitment recompute). A
 * pure AP2 monitor has no access to the CLB domain object, so it trusts the
 * mandate token's declared claims rather than recomputing C. Calling
 * verifyMandate with `clb` would cross into full CLB-ACEL territory — and that
 * is exactly the cross-layer binding that makes B1 weaker than full CLB-ACEL.
 * As a result, this verifier CANNOT detect an agent-identity swap (R4), because
 * identity authorization lives in the CLB-bound layers that B1 does not inspect.
 */
export async function bAp2X402(bundle: TraceBundle): Promise<BaselineVerdict> {
  // 1. Fold in x402 well-formedness (B0 checks: address, value, asset, sig)
  const x402 = await bVanillaX402(bundle);
  const reasons: string[] = [...x402.reasons];

  const { constraints } = bundle.mandate;

  // 2. Amount check (R11-style): settlement value must not exceed maxAmount
  if (constraints.maxAmount !== undefined) {
    const settled = Number(bundle.settlement.value);
    const max = Number(constraints.maxAmount);
    if (Number.isFinite(settled) && Number.isFinite(max) && settled > max) {
      reasons.push("AMOUNT_EXCEEDS_MANDATE");
    }
  }

  // 3. Payee check (R12-style): settlement.payTo must be in allowedPayees
  //    Uses checksum-insensitive address equality via viem getAddress.
  if (constraints.allowedPayees !== undefined && constraints.allowedPayees.length > 0) {
    let payToNorm: string | null = null;
    try {
      payToNorm = getAddress(bundle.settlement.payTo);
    } catch {
      // malformed payTo — already flagged by MALFORMED_PAYTO from bVanillaX402
    }

    if (payToNorm !== null) {
      const allowed = constraints.allowedPayees.map((addr) => {
        try {
          return getAddress(addr);
        } catch {
          return addr;
        }
      });
      if (!allowed.includes(payToNorm)) {
        reasons.push("PAYEE_NOT_ALLOWED");
      }
    }
  }

  // 4. Asset check (R13-style): settlement.asset must be in allowedAssets
  if (constraints.allowedAssets !== undefined && constraints.allowedAssets.length > 0) {
    if (!constraints.allowedAssets.includes(bundle.settlement.asset)) {
      reasons.push("ASSET_NOT_ALLOWED");
    }
  }

  return { accepted: reasons.length === 0, reasons };
}
