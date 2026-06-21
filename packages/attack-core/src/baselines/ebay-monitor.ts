/**
 * bEbayMonitor — faithful re-implementation of the eBay "Zero-Trust Runtime Verification" model.
 *
 * Reference: arXiv:2602.06345 — "Zero-Trust Runtime Verification for Agentic AI Systems"
 *
 * Model scope: OFF-CHAIN, AP2-only monitor.
 *
 * Enforced checks (exactly two):
 *   1. Consume-once   — time-bound nonce; a mandate nonce may settle at most once.
 *   2. Context binding — mandate is bound to the execution context it was approved for:
 *                         a) time-bound: settlement must occur before constraints.validUntil
 *                         b) payee context: settlement.payTo must be in constraints.allowedPayees
 *
 * Intentionally NOT checked (the missed dimension that makes this a baseline):
 *   - Chain domain / chainId (R10)         ← THIS IS THE MISSED DIMENSION vs CLB-ACEL
 *   - ERC-8004 identity / payment keys (R3/R4)
 *   - Commitment recompute (R6)
 *   - Nonce == H(C') (R8)
 *   - Amount (R11)
 *   - Asset (R13)
 *   - Delivery (R14/R14b)
 *   - Task hash (R15)
 *   - x402 signature structure
 *
 * Because bEbayMonitor has no settlement-domain binding it CATCHES mandate replay
 * (consume-once) but MISSES a chain-transplant attack — full CLB-ACEL catches the
 * latter via R10_CHAIN_DOMAIN_MATCHES.
 */

import type { TraceBundle } from "@clb-acel/verifier-core";
import { getAddress } from "viem";
import type { BaselineVerdict } from "./types";

export function bEbayMonitor(bundle: TraceBundle): BaselineVerdict {
  const reasons: string[] = [];

  // ── Check 1: Consume-once (time-bound nonce, single use) ────────────────────
  // A second settlement attempt against the same nonce is flagged via
  // bundle.nonceReplayAttempt === true.
  if (bundle.nonceReplayAttempt === true) {
    reasons.push("NONCE_REPLAYED");
  }

  // ── Check 2: Context binding ─────────────────────────────────────────────────
  const { constraints } = bundle.mandate;

  // 2a. Time-bound: settlement must occur before constraints.validUntil
  if (constraints.validUntil !== undefined) {
    const settledMs = Date.parse(bundle.settlement.settledAt);
    const validUntilMs = Date.parse(constraints.validUntil);
    if (settledMs > validUntilMs) {
      reasons.push("CONTEXT_EXPIRED");
    }
  }

  // 2b. Payee context: settlement.payTo must be in constraints.allowedPayees
  //     Uses checksum-insensitive address comparison via viem getAddress.
  if (constraints.allowedPayees !== undefined && constraints.allowedPayees.length > 0) {
    let payToNorm: string | null = null;
    try {
      payToNorm = getAddress(bundle.settlement.payTo);
    } catch {
      // malformed payTo — cannot normalise, skip payee check
    }

    if (payToNorm !== null) {
      const allowed = constraints.allowedPayees.map((addr) => {
        try {
          return getAddress(addr);
        } catch {
          return addr as string;
        }
      });
      if (!allowed.includes(payToNorm)) {
        reasons.push("PAYEE_OUT_OF_CONTEXT");
      }
    }
  }

  return { accepted: reasons.length === 0, reasons };
}
