import { describe, expect, it } from "bun:test";
import { commitConfidential, verifyConfidential } from "../src/confidential";

/**
 * Deterministic PRNG so the "hides the value/payee" substring assertions are
 * stable across runs. Production callers use the secure default (crypto RNG);
 * the injected RNG only makes the demonstration reproducible.
 */
function seededRng(seed: bigint): () => bigint {
  let state = seed & ((1n << 256n) - 1n);
  return () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 256n) - 1n);
    return state;
  };
}

describe("confidential commit + range proof", () => {
  it("range proof verifies for value <= maxValue and hides the value", () => {
    const c = commitConfidential(
      { valueAtomic: 2_000000n, maxValueAtomic: 2_000000n, payTo: "0xBEEF" },
      { rng: seededRng(0xc0ffeen) },
    );
    expect(verifyConfidential(c.commitment, c.rangeProof, { maxValueAtomic: 2_000000n })).toBe(true);
    expect(JSON.stringify(c.onchain)).not.toContain("2000000"); // exact value hidden
    expect(JSON.stringify(c.onchain).toLowerCase()).not.toContain("beef"); // payee hidden
  });

  it("range proof fails for value > maxValue", () => {
    const c = commitConfidential(
      { valueAtomic: 3_000000n, maxValueAtomic: 2_000000n, payTo: "0xBEEF" },
      { rng: seededRng(0xbadn) },
    );
    expect(verifyConfidential(c.commitment, c.rangeProof, { maxValueAtomic: 2_000000n })).toBe(false);
  });

  it("verify rejects a tampered range proof", () => {
    const c = commitConfidential({ valueAtomic: 1_000000n, maxValueAtomic: 2_000000n, payTo: "0xBEEF" });
    const tampered = structuredClone(c.rangeProof);
    tampered.bits[0]!.s0 = `0x${"0".repeat(64)}`;
    expect(verifyConfidential(c.commitment, tampered, { maxValueAtomic: 2_000000n })).toBe(false);
  });

  it("verify rejects a maxValue different from the one the proof was built for", () => {
    const c = commitConfidential({ valueAtomic: 2_000000n, maxValueAtomic: 2_000000n, payTo: "0xBEEF" });
    // Proof attests value <= 2_000000; checking against a tighter cap must fail.
    expect(verifyConfidential(c.commitment, c.rangeProof, { maxValueAtomic: 1_000000n })).toBe(false);
  });

  it("accepts a value strictly below the cap and remains opaque", () => {
    const c = commitConfidential({ valueAtomic: 1_500000n, maxValueAtomic: 5_000000n, payTo: "0xBEEF" });
    expect(verifyConfidential(c.commitment, c.rangeProof, { maxValueAtomic: 5_000000n })).toBe(true);
    expect(JSON.stringify(c.onchain)).not.toContain("1500000");
  });
});
