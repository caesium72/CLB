import { describe, expect, it } from "bun:test";
import { runBaselineMatrix } from "../src/baselines/matrix";

describe("runBaselineMatrix", () => {
  it("every baseline misses >=1 attack CLB-ACEL catches", async () => {
    const m = await runBaselineMatrix();
    for (const base of ["vanilla", "ap2x402", "ebay"] as const) {
      const found = Object.keys(m).some((id) => m[id]!.clbacel === "REJECT" && m[id]![base] === "ACCEPT");
      expect(found).toBe(true);
    }
  });

  it("covers all 14 fixtures with a verdict per column", async () => {
    const m = await runBaselineMatrix();
    expect(Object.keys(m).length).toBe(15);
    for (const row of Object.values(m)) {
      for (const c of [row.vanilla, row.ap2x402, row.ebay, row.clbacel]) {
        expect(["ACCEPT", "REJECT"]).toContain(c);
      }
    }
  });
});
