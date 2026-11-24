import type { AttackRunResult, BaselineId, BaselineMatrix, BaselineOutcome } from "./types";
import type { AttackFixture } from "./types";
import { deriveOutcome } from "./types";
import type { RuleId, TraceBundle } from "@clb-acel/verifier-core";
import { bVanillaX402 } from "./baselines/vanilla-x402";
import { bAp2X402 } from "./baselines/ap2-x402";
import { bEbayMonitor } from "./baselines/ebay-monitor";
import type { BaselineVerdict } from "./baselines/types";

/** Attach the derived 7-category taxonomy to a cell without changing its booleans. */
export function withOutcome(cell: BaselineOutcome): BaselineOutcome {
  return { ...cell, outcome: deriveOutcome(cell) };
}

/**
 * Map a real baseline verifier's ACCEPT/REJECT verdict to a matrix outcome.
 * These three baselines are off-chain *verifiers* (not enforcers): a REJECT means
 * the weaker stack would DETECT the attack; none of them PREVENT it in-protocol.
 * ACCEPT means it missed the attack entirely — the cell the paper's thesis hinges on.
 */
function verdictToOutcome(verdict: BaselineVerdict): BaselineOutcome {
  const cell: BaselineOutcome = verdict.accepted
    ? { detected: false, prevented: false, note: "Accepted the attacked trace — attack missed." }
    : { detected: true, prevented: false, note: `Rejected: ${verdict.reasons[0] ?? "cross-layer check"}` };
  // Verifier verdicts stay ACCEPT/REJECT today; marker is the escape hatch for
  // explicitly out-of-scope / errored runs, and a marker always wins.
  return withOutcome(verdict.marker === undefined ? cell : { ...cell, marker: verdict.marker });
}

/**
 * Compute the B0–B2 baseline cells by ACTUALLY RUNNING the three baseline
 * verifiers against the attacked bundle (no narrative). B3 (full CLB-ACEL) is
 * supplied by the caller from the live verifier/guard result.
 */
export async function liveBaselineOutcomes(
  bundle: TraceBundle,
  b3: BaselineOutcome,
): Promise<Record<BaselineId, BaselineOutcome>> {
  const [vanilla, ap2] = await Promise.all([bVanillaX402(bundle), bAp2X402(bundle)]);
  const ebay = bEbayMonitor(bundle);
  return {
    B0: verdictToOutcome(vanilla),
    B1: verdictToOutcome(ap2),
    B2: verdictToOutcome(ebay),
    // B3 comes from the caller; derive its category here too so every emitted
    // baselineComparison cell carries the taxonomy.
    B3: withOutcome(b3),
  };
}

type BaselineResultInput = Pick<
  AttackRunResult,
  "attackId" | "verification" | "auditCheck" | "preventionLayer" | "baselineComparison"
>;

function b0(note = "Vanilla x402 has no CLB or evidence verifier signal."): BaselineOutcome {
  return withOutcome({ detected: false, prevented: false, note });
}

function b1(note = "AP2 mandate exists, but nonce is not bound to C and payment is not prevented."): BaselineOutcome {
  return withOutcome({ detected: false, prevented: false, note });
}

function b2(note = "ACEL verifier detects post-settlement; no x402 enforcement."): BaselineOutcome {
  return withOutcome({ detected: true, prevented: false, note });
}

export const LOGICAL_BASELINE_OUTCOMES: Record<BaselineId, BaselineOutcome> = {
  B0: b0(),
  B1: b1(),
  B2: b2(),
  B3: withOutcome({ detected: true, prevented: false, note: "Live CLB + ACEL verifier result." }),
};

export const BASELINE_LABELS: Record<BaselineId, string> = {
  B0: "Vanilla x402",
  B1: "AP2 + x402",
  B2: "eBay monitor",
  B3: "Full CLB + ACEL",
};

export const BASELINE_DESCRIPTIONS: Record<BaselineId, string> = {
  B0: "Vanilla x402: settlement well-formedness only, no cross-layer rules.",
  B1: "AP2 mandate + x402, but no ERC-8004 identity binding and no C recompute.",
  B2: "eBay-style off-chain monitor: AP2 context-binding + consume-once, single-protocol.",
  B3: "Full stack: CLB binding, ACEL evidence, deterministic verifier, on-chain prevention.",
};

export function buildBaselineMatrix(
  results: BaselineResultInput[],
  fixtures: readonly AttackFixture[],
): BaselineMatrix {
  const byId = new Map(results.map((result) => [result.attackId, result]));
  const matrix = {} as BaselineMatrix;

  for (const fixture of fixtures) {
    const live = byId.get(fixture.id);
    const failedRules = (live?.verification.result.failedRules ?? []) as RuleId[];
    const detected =
      live !== undefined &&
      (live.verification.result.status === "FAIL" || live.auditCheck?.ok === true);
    const prevented = live?.preventionLayer === "x402";

    const merged = {
      ...fixture.baselineOutcomes,
      // Prefer the live verifier verdicts: the static fixture labels predate the
      // real B0–B2 evaluators and disagree with them on several rows.
      ...(live?.baselineComparison ?? {}),
    };

    matrix[fixture.id] = {
      B0: withOutcome(merged.B0),
      B1: withOutcome(merged.B1),
      B2: withOutcome(merged.B2),
      B3: withOutcome({
        ...merged.B3,
        detected,
        prevented,
        failedRules,
        note: prevented
          ? "Live B3 prevented at x402 replay enforcement and verifier flagged R9."
          : detected
            ? "Live B3 detected by verifier or audit-layer check."
            : "Live B3 did not detect this fixture.",
      }),
    };
  }

  return matrix;
}

export const commonOutcomes = { b0, b1, b2 };
