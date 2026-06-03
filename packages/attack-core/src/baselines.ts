import type { AttackRunResult, BaselineId, BaselineMatrix, BaselineOutcome } from "./types";
import type { AttackFixture } from "./types";
import type { RuleId } from "@clb-acel/verifier-core";

type BaselineResultInput = Pick<
  AttackRunResult,
  "attackId" | "verification" | "auditCheck" | "preventionLayer"
>;

function b0(note = "Vanilla x402 has no CLB or evidence verifier signal."): BaselineOutcome {
  return { detected: false, prevented: false, note };
}

function b1(note = "AP2 mandate exists, but nonce is not bound to C and payment is not prevented."): BaselineOutcome {
  return { detected: false, prevented: false, note };
}

function b2(note = "ACEL verifier detects post-settlement; no x402 enforcement."): BaselineOutcome {
  return { detected: true, prevented: false, note };
}

export const LOGICAL_BASELINE_OUTCOMES: Record<BaselineId, BaselineOutcome> = {
  B0: b0(),
  B1: b1(),
  B2: b2(),
  B3: { detected: true, prevented: false, note: "Live CLB + ACEL verifier result." },
};

export const BASELINE_LABELS: Record<BaselineId, string> = {
  B0: "Vanilla x402",
  B1: "AP2 + x402",
  B2: "ACEL audit-only",
  B3: "Full CLB + ACEL",
};

export const BASELINE_DESCRIPTIONS: Record<BaselineId, string> = {
  B0: "No CLB binding, no verifier, no evidence layer enforcement.",
  B1: "AP2 mandate exists, but nonce is not bound to C.",
  B2: "Evidence + verifier detect attacks after settlement, but do not prevent them in-protocol.",
  B3: "Current full stack: CLB, ACEL evidence, verifier, and x402 replay prevention.",
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

    matrix[fixture.id] = {
      ...fixture.baselineOutcomes,
      B3: {
        detected,
        prevented,
        failedRules,
        note: prevented
          ? "Live B3 prevented at x402 replay enforcement and verifier flagged R9."
          : detected
            ? "Live B3 detected by verifier or audit-layer check."
            : "Live B3 did not detect this fixture.",
      },
    };
  }

  return matrix;
}

export const commonOutcomes = { b0, b1, b2 };
