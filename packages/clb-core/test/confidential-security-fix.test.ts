import { describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1";
import type { Hex } from "viem";
import { commitConfidential, verifyConfidential, type ConfidentialCommitment } from "../src/confidential";

/**
 * GAP-1 / item 35 regression: a negative value used to produce a VERIFYING
 * range proof because delta = max − value wrapped into a small 64-bit integer.
 * The fix rejects out-of-domain values at generation AND adds an independent
 * proof that the committed value is a non-negative 64-bit integer.
 */

const MAX = 2_000000n;
const Point = secp256k1.ProjectivePoint;

function seededRng(seed: bigint): () => bigint {
  let state = seed & ((1n << 256n) - 1n);
  return () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 256n) - 1n);
    return state;
  };
}

function commit(value: bigint, max: bigint = MAX): ConfidentialCommitment {
  return commitConfidential(
    { valueAtomic: value, maxValueAtomic: max, payTo: "0xBEEF" },
    { rng: seededRng(0xc0ffeen) },
  );
}

function verifies(c: ConfidentialCommitment, max: bigint = MAX): boolean {
  return verifyConfidential(c.commitment, c.rangeProof, { maxValueAtomic: max });
}

function point(hex: Hex) {
  return Point.fromHex(hex.slice(2));
}

function hex(pointValue: InstanceType<typeof Point>): Hex {
  return `0x${pointValue.toHex(true)}`;
}

function weightedBits(bits: { C: Hex }[]): InstanceType<typeof Point> {
  let sum = Point.ZERO;
  bits.forEach((bit, i) => {
    sum = sum.add(point(bit.C).multiply(1n << BigInt(i)));
  });
  return sum;
}

describe("GAP-1: explicit integer-domain bounds at generation", () => {
  test("negative values throw instead of producing a verifying proof", () => {
    for (const negative of [-1n, -1000n, -(1n << 32n)]) {
      expect(() => commit(negative)).toThrow("valueAtomic must be in [0, 2^64)");
    }
  });

  test("values >= 2^64 also throw explicitly", () => {
    for (const oversized of [1n << 64n, (1n << 64n) + 5n, 1n << 200n]) {
      expect(() => commit(oversized)).toThrow("valueAtomic must be in [0, 2^64)");
    }
  });

  test("in-domain values still generate and verify", () => {
    expect(verifies(commit(0n))).toBe(true);
    expect(verifies(commit(1n))).toBe(true);
  });

  test("an over-cap but in-domain value yields a non-verifying proof", () => {
    expect(verifies(commit(3_000000n, MAX))).toBe(false);
    expect(verifies(commit(MAX))).toBe(true);
  });

  test("the largest in-domain value still generates and verifies", () => {
    expect(verifies(commit((1n << 64n) - 1n, (1n << 64n) - 1n), (1n << 64n) - 1n)).toBe(true);
  });
});

describe("GAP-1: verification rejects forged negative-value proofs", () => {
  for (const magnitude of [1n, 1000n, 1n << 32n]) {
    test(`forged commitment to -${magnitude} fails the value-domain proof`, () => {
      // Build an honest proof for value 0 with cap MAX+magnitude. Its delta
      // proof is exactly the delta a prover would submit for value
      // −magnitude against cap MAX: (MAX+magnitude) − 0 = MAX − (−magnitude).
      const honest = commit(0n, MAX + magnitude);
      const forged = hex(point(honest.commitment).subtract(Point.BASE.multiply(magnitude)));

      // The old upper-bound statement alone still holds (the attack surface).
      expect(
        weightedBits(honest.rangeProof.bits).equals(
          Point.BASE.multiply(MAX).subtract(point(forged)),
        ),
      ).toBe(true);
      // The new value-domain statement fails, so full verification rejects it.
      expect(verifyConfidential(forged, honest.rangeProof, { maxValueAtomic: MAX })).toBe(false);
    });
  }

  test("tampering with the value-domain bits is rejected", () => {
    const c = commit(5n);
    const tampered = structuredClone(c.rangeProof);
    tampered.valueBits[63]!.C = tampered.valueBits[0]!.C;
    expect(verifyConfidential(c.commitment, tampered, { maxValueAtomic: MAX })).toBe(false);
  });

  test("a proof missing the value-domain statement is rejected", () => {
    const c = commit(5n);
    const legacy = { ...c.rangeProof } as unknown as Record<string, unknown>;
    delete legacy.valueBits;
    expect(
      verifyConfidential(c.commitment, legacy as never, { maxValueAtomic: MAX }),
    ).toBe(false);
  });
});
