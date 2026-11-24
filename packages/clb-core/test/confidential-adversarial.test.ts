import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import {
  CONFIDENTIAL_VERSION,
  commitConfidential,
  verifyConfidential,
  verifyPayeeCommitment,
  type ConfidentialCommitment,
  type RangeProof,
} from "../src/confidential";

/**
 * Adversarial tests for the confidential commit-and-prove module (R3-C2,
 * items 29-37). This module is NOT a demo/simulation: it is a real secp256k1
 * Pedersen commitment C = v·G + r·H with a 64-bit Borromean-style per-bit OR
 * range proof (packages/clb-core/src/confidential.ts:1-37, 96-177, 238-328).
 * GAP-1 (negative values verifying) was FIXED: generation now rejects
 * valueAtomic outside [0, 2^64) and verification requires an independent
 * value-domain proof, so negative/oversized values cannot pass.
 */

const MAX = 2_000000n;

/** Deterministic RNG so proofs are reproducible; production uses crypto RNG. */
function seededRng(seed: bigint): () => bigint {
  let state = seed & ((1n << 256n) - 1n);
  return () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 256n) - 1n);
    return state;
  };
}

function commit(value: bigint, max: bigint = MAX, payTo = "0xBEEF"): ConfidentialCommitment {
  return commitConfidential(
    { valueAtomic: value, maxValueAtomic: max, payTo },
    { rng: seededRng(0xc0ffeen) },
  );
}

function verifies(c: ConfidentialCommitment, max: bigint = MAX): boolean {
  return verifyConfidential(c.commitment, c.rangeProof, { maxValueAtomic: max });
}

function scalarPlusOne(hex: Hex): Hex {
  const mask = (1n << 256n) - 1n;
  return `0x${((BigInt(hex) + 1n) & mask).toString(16).padStart(64, "0")}`;
}

describe("scheme and group parameters (items 29-32)", () => {
  test("domain tag, 64-bit width and 64 per-bit OR proofs are pinned", () => {
    const c = commit(5n);
    expect(CONFIDENTIAL_VERSION).toBe("CLB-ACEL/confidential/v1");
    expect(c.rangeProof.version).toBe(CONFIDENTIAL_VERSION);
    expect(c.rangeProof.bitLength).toBe(64);
    expect(c.rangeProof.bits).toHaveLength(64);
    for (const bit of c.rangeProof.bits) {
      // SEC1 compressed points are 33 bytes (0x02/0x03 prefix + 32-byte x).
      expect(bit.C).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
      for (const field of [bit.e0, bit.e1, bit.s0, bit.s1]) {
        expect(field).toMatch(/^0x[0-9a-f]{64}$/);
      }
    }
    // secp256k1 curve/group: ORDER = secp256k1.CURVE.n, G = BASE,
    // H = try-and-increment NUMS generator (confidential.ts:27,30,33,81-97).
  });

  test("NUMS generator and blinding derivation are deterministic given the RNG", () => {
    const a = commit(7n);
    const b = commit(7n);
    expect(a.commitment).toBe(b.commitment);
    expect(a.rangeProof).toEqual(b.rangeProof);
    expect(a.payeeCommitment).toBe(b.payeeCommitment);
    // A different RNG produces a different blinding -> different commitment.
    const other = commitConfidential(
      { valueAtomic: 7n, maxValueAtomic: MAX, payTo: "0xBEEF" },
      { rng: seededRng(0x1234n) },
    );
    expect(other.commitment).not.toBe(a.commitment);
  });

  test("default blinding and payee salt use the CSPRNG (different across calls)", () => {
    const a = commitConfidential({ valueAtomic: 5n, maxValueAtomic: MAX, payTo: "0xBEEF" });
    const b = commitConfidential({ valueAtomic: 5n, maxValueAtomic: MAX, payTo: "0xBEEF" });
    expect(a.opening.blinding).not.toBe(b.opening.blinding);
    expect(a.opening.payeeSalt).not.toBe(b.opening.payeeSalt);
    expect(a.commitment).not.toBe(b.commitment);
    expect(a.opening.blinding).toMatch(/^0x[0-9a-f]{64}$/);
    // nextScalar maps 0 -> 1 (confidential.ts:107-110).
    expect(BigInt(a.opening.blinding)).toBeGreaterThan(0n);
  });
});

describe("integer-domain bounds (items 33-35)", () => {
  test("maxValueAtomic is bounded to [0, 2^64) at generation", () => {
    expect(() => commit(1n, -1n)).toThrow("maxValueAtomic must be in [0, 2^64)");
    expect(() => commit(1n, 1n << 64n)).toThrow("maxValueAtomic must be in [0, 2^64)");
    expect(() => commit(1n, 0n)).not.toThrow();
    expect(() => commit(0n, (1n << 64n) - 1n)).not.toThrow();
  });

  test(
    "in-range and below-cap values verify (expected behaviour)",
    () => {
      expect(verifies(commit(0n))).toBe(true);
      expect(verifies(commit(1n))).toBe(true);
      expect(verifies(commit(MAX))).toBe(true);
      expect(verifies(commit(1_500000n))).toBe(true);
    },
    30_000,
  );

  test("over-cap values are rejected by verification, though generation succeeds", () => {
    const c = commit(3_000000n, MAX);
    expect(verifies(c)).toBe(false);
    // Generation deliberately still returns a structurally valid object.
    expect(c.rangeProof.bits).toHaveLength(64);
    // A tighter maxValue supplied at verify time also fails.
    expect(verifies(commit(2_000000n), 1_000000n)).toBe(false);
  });

  test("oversized values >= 2^64 are rejected at generation (FIXED)", () => {
    for (const oversized of [1n << 64n, (1n << 64n) + 5n, 1n << 200n]) {
      expect(() => commit(oversized)).toThrow();
    }
  });

  test("FIXED (HIGH): NEGATIVE values are rejected — no modular-arithmetic range violation", () => {
    // Previously delta = max - value wrapped mod 2^64 and negative values
    // produced VERIFYING proofs. Generation now rejects valueAtomic < 0 and
    // verification additionally requires an independent value-domain proof.
    for (const negative of [-1n, -1000n, -(1n << 32n)]) {
      expect(() => commit(negative)).toThrow();
    }
    // Forged commitments to negative values are rejected at verification by
    // the independent value-domain proof (see confidential-security-fix.test.ts).
  });

  test("malformed numeric inputs throw at generation (not silently coerced)", () => {
    for (const bad of [1.5, "abc", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        commitConfidential({ valueAtomic: bad, maxValueAtomic: MAX, payTo: "0xBEEF" }),
      ).toThrow();
    }
    // Numeric strings and numbers that are integers are accepted.
    const c = commitConfidential({ valueAtomic: "5", maxValueAtomic: 2000000, payTo: "0xBEEF" });
    expect(verifies(c, MAX)).toBe(true);
  });
});

describe("adversarial proof and commitment tampering (item 36)", () => {
  test("tampering with the Pedersen commitment is always rejected", () => {
    const c = commit(5n);
    expect(verifyConfidential(`0x${"00".repeat(32)}` as Hex, c.rangeProof, { maxValueAtomic: MAX })).toBe(false);
    const different = commit(6n);
    expect(verifyConfidential(different.commitment, c.rangeProof, { maxValueAtomic: MAX })).toBe(false);
    // Flip a byte of the real commitment point.
    const bytes = c.commitment.slice(2).split("");
    bytes[0] = bytes[0] === "0" ? "1" : "0";
    expect(verifyConfidential(`0x${bytes.join("")}` as Hex, c.rangeProof, { maxValueAtomic: MAX })).toBe(false);
  });

  // Split by field to stay under the 5 s per-test budget (each verify walks
  // all 64 bit proofs). Bit positions cover first, middle and last bits.
  const tamperBits = [0, 1, 31, 62, 63];
  for (const field of ["e0", "e1", "s0", "s1"] as const) {
    test(`tampering with bit-proof scalar ${field} is rejected`, () => {
      const c = commit(5n);
      for (const i of tamperBits) {
        const tampered = structuredClone(c.rangeProof);
        tampered.bits[i]![field] = scalarPlusOne(tampered.bits[i]![field] as Hex);
        expect(verifyConfidential(c.commitment, tampered, { maxValueAtomic: MAX })).toBe(false);
      }
    });
  }

  test("tampering with bit commitments (off-curve, wrong point, swapped, removed) is rejected", () => {
    const c = commit(5n);

    const offCurve = structuredClone(c.rangeProof);
    offCurve.bits[0]!.C = `0x${"00".repeat(32)}`;
    expect(verifyConfidential(c.commitment, offCurve, { maxValueAtomic: MAX })).toBe(false);

    const wrongPoint = structuredClone(c.rangeProof);
    wrongPoint.bits[0]!.C = c.rangeProof.bits[1]!.C;
    expect(verifyConfidential(c.commitment, wrongPoint, { maxValueAtomic: MAX })).toBe(false);

    const swapped = structuredClone(c.rangeProof);
    [swapped.bits[0], swapped.bits[1]] = [swapped.bits[1]!, swapped.bits[0]!];
    expect(verifyConfidential(c.commitment, swapped, { maxValueAtomic: MAX })).toBe(false);

    const truncated = structuredClone(c.rangeProof);
    truncated.bits.pop();
    expect(verifyConfidential(c.commitment, truncated, { maxValueAtomic: MAX })).toBe(false);
  });

  test("payee hiding digest is binding and hides the address", () => {
    const c = commit(5n, MAX, "0xCAFEBABE");
    expect(verifyPayeeCommitment(c.payeeCommitment, c.opening.payTo, c.opening.payeeSalt)).toBe(true);
    expect(verifyPayeeCommitment(c.payeeCommitment, "0xBEEF", c.opening.payeeSalt)).toBe(false);
    expect(verifyPayeeCommitment(c.payeeCommitment, c.opening.payTo, `0x${"11".repeat(32)}`)).toBe(false);
    expect(c.payeeCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(c.payeeCommitment).not.toContain("CAFEBABE");
    expect(JSON.stringify(c.onchain).toLowerCase()).not.toContain("cafebabe");
  });

  test("GAP-DOC: the opening is NOT bound to the on-chain artifact by verifyConfidential", () => {
    // verifyConfidential takes only (commitment, rangeProof, maxValue).
    // It never checks the opening or the payee digest. A verifier that does
    // not separately call verifyPayeeCommitment cannot detect payee swapping.
    const c = commit(5n, MAX, "0xBEEF");
    const wrongPayee = "0xATTACKER";
    expect(
      verifyConfidential(c.commitment, c.rangeProof, { maxValueAtomic: MAX }),
    ).toBe(true);
    expect(verifyPayeeCommitment(c.payeeCommitment, wrongPayee, c.opening.payeeSalt)).toBe(false);
  });
});

describe("verification failure handling (item 37)", () => {
  test("malformed proofs return false rather than throwing", () => {
    const c = commit(5n);
    const malformed: Array<Partial<RangeProof>> = [
      { bitLength: 63 },
      { bits: [] },
    ];
    for (const patch of malformed) {
      const candidate = { ...c.rangeProof, ...patch } as RangeProof;
      expect(() =>
        verifyConfidential(c.commitment, candidate, { maxValueAtomic: MAX }),
      ).not.toThrow();
      expect(verifyConfidential(c.commitment, candidate, { maxValueAtomic: MAX })).toBe(false);
    }

    // GAP-3 (LOW): `rangeProof.version` is declared but never checked by
    // verifyConfidential (confidential.ts:304-324), so a proof relabelled with
    // any version string still verifies. This is the REAL behaviour.
    const relabelled = { ...c.rangeProof, version: "CLB-ACEL/confidential/v999" } as RangeProof;
    expect(verifyConfidential(c.commitment, relabelled, { maxValueAtomic: MAX })).toBe(true);

    const badScalars = structuredClone(c.rangeProof);
    badScalars.bits[0]!.e0 = "0xzzzz";
    expect(() => verifyConfidential(c.commitment, badScalars, { maxValueAtomic: MAX })).not.toThrow();
    expect(verifyConfidential(c.commitment, badScalars, { maxValueAtomic: MAX })).toBe(false);
  });

  test("invalid maxValue at verify time returns false rather than throwing", () => {
    const c = commit(5n);
    for (const badMax of [-1n, 1n << 64n]) {
      expect(verifyConfidential(c.commitment, c.rangeProof, { maxValueAtomic: badMax })).toBe(false);
    }
  });
});
