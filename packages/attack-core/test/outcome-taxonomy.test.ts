import { describe, expect, it } from "bun:test";
import {
  OUTCOME_CATEGORIES,
  deriveOutcome,
  isOutcomeCategory,
  type OutcomeCategory,
  type OutcomeMarker,
} from "../src/types";
import { LOGICAL_BASELINE_OUTCOMES, liveBaselineOutcomes, withOutcome } from "../src/baselines";
import { runBaselineMatrix } from "../src/baselines/matrix";
import { buildValidBundle } from "../src/index";

describe("7-category outcome taxonomy", () => {
  it("derives all seven valid categories", () => {
    expect([...OUTCOME_CATEGORIES]).toEqual([
      "PREVENTED",
      "DETECTED",
      "EXPLOITED",
      "PARTIALLY_MITIGATED",
      "NOT_APPLICABLE",
      "ERROR",
      "SKIPPED",
    ]);
    expect(deriveOutcome({ detected: false, prevented: false })).toBe("EXPLOITED");
    expect(deriveOutcome({ detected: true, prevented: false })).toBe("DETECTED");
    expect(deriveOutcome({ detected: false, prevented: true })).toBe("PREVENTED");
    expect(deriveOutcome({ detected: true, prevented: true })).toBe("PREVENTED");
    for (const marker of ["PARTIALLY_MITIGATED", "NOT_APPLICABLE", "ERROR", "SKIPPED"] as const) {
      expect(deriveOutcome({ detected: false, prevented: false, marker })).toBe(marker);
    }
  });

  it("never reports DETECTED as PREVENTED", () => {
    const detected = withOutcome({ detected: true, prevented: false, note: "verifier rejected" });
    expect(detected.outcome).toBe("DETECTED");
    expect(detected.outcome).not.toBe("PREVENTED");
    expect(detected.prevented).toBe(false);
    expect(() =>
      deriveOutcome({ detected: true, prevented: false, outcome: "PREVENTED" }),
    ).toThrow(/PREVENTED requires prevented:true/);
    const both = withOutcome({ detected: true, prevented: true, note: "guard blocked" });
    expect(both.outcome).toBe("PREVENTED");
  });

  it("rejects unknown or invalid categories", () => {
    expect(isOutcomeCategory("SUCCESSFUL")).toBe(false);
    expect(isOutcomeCategory("DETECTED")).toBe(true);
    expect(() =>
      deriveOutcome({ detected: true, prevented: false, outcome: "SUCCESSFUL" as OutcomeCategory }),
    ).toThrow(/Unknown outcome category/);
    expect(() =>
      deriveOutcome({ detected: false, prevented: false, marker: "BOGUS" as OutcomeMarker }),
    ).toThrow(/Unknown outcome marker/);
  });

  it("never labels an ERROR or SKIPPED run as successful", () => {
    for (const marker of ["ERROR", "SKIPPED"] as const) {
      const cell = withOutcome({ detected: true, prevented: true, note: "not a real run", marker });
      expect(cell.outcome).toBe(marker);
      expect(["PREVENTED", "DETECTED", "EXPLOITED"] as OutcomeCategory[]).not.toContain(cell.outcome);
    }
  });

  it("emits the taxonomy on live and logical baseline cells", async () => {
    for (const cell of Object.values(LOGICAL_BASELINE_OUTCOMES)) {
      expect(OUTCOME_CATEGORIES).toContain(cell.outcome!);
    }
    const bundle = await buildValidBundle();
    const cells = await liveBaselineOutcomes(bundle, {
      detected: true,
      prevented: false,
      note: "B3 supplied by caller",
    });
    for (const id of ["B0", "B1", "B2", "B3"] as const) {
      expect(OUTCOME_CATEGORIES).toContain(cells[id].outcome!);
    }
  });

  it("emits the taxonomy on every baseline-comparison matrix row", async () => {
    const matrix = await runBaselineMatrix();
    for (const row of Object.values(matrix)) {
      for (const outcome of [row.vanillaOutcome, row.ap2x402Outcome, row.ebayOutcome, row.clbacelOutcome]) {
        expect(outcome).toBeDefined();
        expect(OUTCOME_CATEGORIES).toContain(outcome!);
      }
    }
  });
});
