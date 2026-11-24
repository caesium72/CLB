/**
 * Phase 7F — Confidential commit-and-prove (clb-core).
 *
 * On-chain we publish only a Pedersen commitment to the settlement value plus a
 * range proof that `value <= maxValue` — never the cleartext amount or payee.
 * The payee is bound by a hiding digest; its plaintext lives encrypted off-chain
 * (see the evidence-service encrypted-payload path). This answers the on-chain
 * metadata-leakage critique (Five-Attacks / A402) with elegance rather than a
 * heavy TEE vault, and delivers ACEL.md §4 selective disclosure.
 *
 * Construction: commitments are `C = v·G + r·H` over secp256k1, where `H` is a
 * nothing-up-my-sleeve generator with unknown discrete log relative to `G`. The
 * range proof attests `delta = maxValue − value ∈ [0, 2^RANGE_BITS)` via a
 * bit-decomposition with a Fiat–Shamir OR proof per bit (the
 * Confidential-Transactions / Borromean predecessor to Bulletproofs). Soundness:
 * the verifier recomputes `C_delta = maxValue·G − C` and checks `Σ 2^i·C_i =
 * C_delta`; Pedersen binding then forces the committed delta to equal a value in
 * `[0, 2^RANGE_BITS)`. With `maxValue < 2^RANGE_BITS`, an in-range delta implies
 * `value ≤ maxValue` (a negative delta wraps to ≈2^256 and cannot be a 64-bit
 * sum, so the check fails).
 *
 * A SECOND independent 64-bit proof attests `value ∈ [0, 2^64)` against the
 * same commitment. Without it a negative value commits as `value mod n` (a
 * huge unsigned scalar) yet yields a small positive delta `max − value`, so
 * the upper-bound proof alone accepts negative amounts. Verification requires
 * both proofs; generation rejects out-of-domain values explicitly rather than
 * relying on modular arithmetic. The maxValue supplied to the verifier must be
 * derived from the human-signed mandate (see the verifier R11 path) — it is
 * never trusted from a bundle-authored field alone.
 *
 * SWAPPABLE ADAPTER: this is the ONLY file in the codebase that imports a curve
 * library (`@noble/curves`). Replacing it with a Bulletproof/WASM backend means
 * re-implementing `commitConfidential` / `verifyConfidential` here alone.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { type Hex, bytesToHex, keccak256, toBytes } from "viem";

const Point = secp256k1.ProjectivePoint;
type CurvePoint = InstanceType<typeof Point>;

const ORDER = secp256k1.CURVE.n;
/** Bit width of the range proof. Supports maxValue up to 2^64-1 atomic units. */
const RANGE_BITS = 64;
const MAX_RANGE = 1n << BigInt(RANGE_BITS);
const DOMAIN = "CLB-ACEL/confidential/v1";
export const CONFIDENTIAL_VERSION = DOMAIN;

// --- scalar / point helpers ------------------------------------------------

function mod(x: bigint): bigint {
  const r = x % ORDER;
  return r < 0n ? r + ORDER : r;
}

/** Scalar multiply that tolerates a zero scalar (noble throws on 0). */
function mul(point: CurvePoint, scalar: bigint): CurvePoint {
  const s = mod(scalar);
  return s === 0n ? Point.ZERO : point.multiply(s);
}

function pointToHex(point: CurvePoint): Hex {
  return `0x${point.toHex(true)}`;
}

function pointFromHex(hex: Hex): CurvePoint {
  return Point.fromHex(hex.slice(2));
}

function scalarToHex(value: bigint): Hex {
  return `0x${mod(value).toString(16).padStart(64, "0")}`;
}

function scalarFromHex(hex: Hex): bigint {
  return mod(BigInt(hex));
}

/** Extended-Euclidean modular inverse (ORDER is prime, gcd always 1). */
function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [mod(a), m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return mod(oldS);
}

/** Nothing-up-my-sleeve second generator H (unknown dlog wrt G), via try-and-increment. */
function deriveNumsGenerator(label: string): CurvePoint {
  for (let counter = 0; counter < 1024; counter += 1) {
    const x = toBytes(keccak256(toBytes(`${label}:${counter}`))); // 32 bytes
    for (const prefix of [2, 3]) {
      try {
        return Point.fromHex(bytesToHex(new Uint8Array([prefix, ...x])).slice(2));
      } catch {
        // candidate x not on curve; try next prefix/counter
      }
    }
  }
  throw new Error("Failed to derive NUMS generator H");
}

const G: CurvePoint = Point.BASE;
const H: CurvePoint = deriveNumsGenerator(`${DOMAIN}/H`);

export type Rng = () => bigint;

function secureScalar(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return mod(BigInt(bytesToHex(bytes)));
}

function nextScalar(rng: Rng): bigint {
  const s = mod(rng());
  return s === 0n ? 1n : s;
}

/** Fiat–Shamir challenge bound to the domain and a transcript of points. */
function challenge(...points: CurvePoint[]): bigint {
  const transcript = `${DOMAIN}|${points.map(pointToHex).join("|")}`;
  return mod(BigInt(keccak256(toBytes(transcript))));
}

// --- per-bit OR proof (commitment is to 0 or to 1) -------------------------

/** Proof that the Pedersen commitment `C` opens to a bit (0 or 1). */
export type BitProof = {
  /** Pedersen commitment to this bit: C = bit·G + r·H. */
  C: Hex;
  e0: Hex;
  e1: Hex;
  s0: Hex;
  s1: Hex;
};

function proveBit(bit: 0 | 1, blinding: bigint, rng: Rng): BitProof {
  const commitment = bit === 1 ? G.add(mul(H, blinding)) : mul(H, blinding);
  // A0 = C (true if bit==0: C = r·H); A1 = C − G (true if bit==1: C − G = r·H).
  const A: readonly [CurvePoint, CurvePoint] = [commitment, commitment.subtract(G)];
  const trueIdx = bit;
  const falseIdx = (1 - bit) as 0 | 1;

  // Simulate the false branch.
  const eFalse = nextScalar(rng);
  const sFalse = nextScalar(rng);
  const rFalse = mul(H, sFalse).subtract(mul(A[falseIdx], eFalse));

  // Real commitment for the true branch.
  const k = nextScalar(rng);
  const rTrue = mul(H, k);

  const R0 = trueIdx === 0 ? rTrue : rFalse;
  const R1 = trueIdx === 0 ? rFalse : rTrue;
  const e = challenge(commitment, R0, R1);
  const eTrue = mod(e - eFalse);
  const sTrue = mod(k + eTrue * blinding);

  return {
    C: pointToHex(commitment),
    e0: scalarToHex(trueIdx === 0 ? eTrue : eFalse),
    e1: scalarToHex(trueIdx === 0 ? eFalse : eTrue),
    s0: scalarToHex(trueIdx === 0 ? sTrue : sFalse),
    s1: scalarToHex(trueIdx === 0 ? sFalse : sTrue),
  };
}

function verifyBit(proof: BitProof): boolean {
  let commitment: CurvePoint;
  try {
    commitment = pointFromHex(proof.C);
  } catch {
    return false;
  }
  const A0 = commitment;
  const A1 = commitment.subtract(G);
  const e0 = scalarFromHex(proof.e0);
  const e1 = scalarFromHex(proof.e1);
  const s0 = scalarFromHex(proof.s0);
  const s1 = scalarFromHex(proof.s1);
  const R0 = mul(H, s0).subtract(mul(A0, e0));
  const R1 = mul(H, s1).subtract(mul(A1, e1));
  return mod(e0 + e1) === challenge(commitment, R0, R1);
}

// --- public API ------------------------------------------------------------

export type RangeProof = {
  version: string;
  bitLength: number;
  /** Bit commitments + OR proofs for delta = maxValue − value, LSB first. */
  bits: BitProof[];
  /**
   * Independent bit commitments + OR proofs that the committed value itself is
   * a non-negative 64-bit integer. `Σ 2^i·valueBits[i].C = (2^64−1)·G − C`.
   * This is what excludes negative values, which the upper-bound proof alone
   * cannot distinguish from large unsigned scalars (modular wrap).
   */
  valueBits: BitProof[];
};

export type ConfidentialInput = {
  valueAtomic: bigint | string | number;
  maxValueAtomic: bigint | string | number;
  payTo: string;
};

export type ConfidentialOptions = {
  /** Inject a deterministic RNG (tests/demos). Defaults to a secure CSPRNG. */
  rng?: Rng;
  /** Override the payee blinding salt (defaults to a fresh random scalar). */
  payeeSalt?: Hex;
};

export type ConfidentialCommitment = {
  /** Pedersen commitment to the value: C = value·G + blinding·H. */
  commitment: Hex;
  rangeProof: RangeProof;
  /** Hiding digest binding the payee without revealing it. */
  payeeCommitment: Hex;
  /** Public artifact safe to publish on-chain — reveals neither payee nor amount. */
  onchain: {
    commitment: Hex;
    payeeCommitment: Hex;
    rangeProof: RangeProof;
  };
  /** Secret opening kept off-chain (e.g. inside the encrypted evidence blob). */
  opening: {
    valueAtomic: string;
    blinding: Hex;
    payTo: string;
    payeeSalt: Hex;
  };
};

function toBig(value: bigint | string | number): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

/** keccak256 hiding commitment to the payee (salted so the address is not guessable). */
function commitPayee(payTo: string, payeeSalt: Hex): Hex {
  return keccak256(toBytes(`${DOMAIN}/payee|${payTo}|${payeeSalt}`));
}

/**
 * Prove `value <= upper` by decomposing `upper − value` into 64 bits. The
 * weighted bit blindings are chosen to cancel the value commitment's blinding,
 * so `Σ 2^i·C_i = (upper − value)·G − blinding·H = upper·G − C`.
 */
function proveUpperBound(value: bigint, upper: bigint, blinding: bigint, rng: Rng): BitProof[] {
  const delta = upper - value;
  const deltaBits = ((delta % MAX_RANGE) + MAX_RANGE) % MAX_RANGE;

  // Per-bit blindings r_i must satisfy Σ 2^i·r_i ≡ −blinding (mod n).
  const blindings: bigint[] = [];
  let acc = 0n;
  for (let i = 0; i < RANGE_BITS - 1; i += 1) {
    const ri = nextScalar(rng);
    blindings.push(ri);
    acc = mod(acc + (1n << BigInt(i)) * ri);
  }
  const topWeight = 1n << BigInt(RANGE_BITS - 1);
  const target = mod(-blinding - acc);
  blindings.push(mod(target * modInverse(topWeight, ORDER)));

  const bits: BitProof[] = [];
  for (let i = 0; i < RANGE_BITS; i += 1) {
    const bit = Number((deltaBits >> BigInt(i)) & 1n) as 0 | 1;
    bits.push(proveBit(bit, blindings[i]!, rng));
  }
  return bits;
}

/** Check `Σ 2^i·C_i == target` for one 64-bit decomposition. */
function aggregateMatches(bits: BitProof[], target: CurvePoint): boolean {
  let weighted = Point.ZERO;
  for (let i = 0; i < RANGE_BITS; i += 1) {
    weighted = weighted.add(mul(pointFromHex(bits[i]!.C), 1n << BigInt(i)));
  }
  return weighted.equals(target);
}

/**
 * Produce a confidential commitment to `valueAtomic` together with two range
 * proofs: `value <= maxValue` and `value ∈ [0, 2^64)`. Out-of-domain values
 * (`value < 0 || value >= 2^64`) are rejected explicitly — an over-cap but
 * in-domain value still produces a structurally valid object whose proof fails
 * verification, so callers can exercise the same path for honest settlements.
 */
export function commitConfidential(
  input: ConfidentialInput,
  options: ConfidentialOptions = {},
): ConfidentialCommitment {
  const value = toBig(input.valueAtomic);
  const max = toBig(input.maxValueAtomic);
  if (max < 0n || max >= MAX_RANGE) {
    throw new Error(`maxValueAtomic must be in [0, 2^${RANGE_BITS})`);
  }
  if (value < 0n || value >= MAX_RANGE) {
    throw new Error(`valueAtomic must be in [0, 2^${RANGE_BITS})`);
  }
  const rng: Rng = options.rng ?? secureScalar;

  const blinding = nextScalar(rng);
  const commitmentPoint = mul(G, value).add(mul(H, blinding));

  const bits = proveUpperBound(value, max, blinding, rng);
  const valueBits = proveUpperBound(value, MAX_RANGE - 1n, blinding, rng);

  const payeeSalt = options.payeeSalt ?? scalarToHex(nextScalar(rng));
  const payeeCommitment = commitPayee(input.payTo, payeeSalt);
  const commitment = pointToHex(commitmentPoint);
  const rangeProof: RangeProof = { version: DOMAIN, bitLength: RANGE_BITS, bits, valueBits };

  return {
    commitment,
    rangeProof,
    payeeCommitment,
    onchain: { commitment, payeeCommitment, rangeProof },
    opening: {
      valueAtomic: value.toString(),
      blinding: scalarToHex(blinding),
      payTo: input.payTo,
      payeeSalt,
    },
  };
}

/**
 * Verify a confidential commitment + range proof against the (public) maxValue.
 * Returns true iff the committed value is provably `<= maxValue` without ever
 * learning the value. Any malformed input returns false rather than throwing.
 */
export function verifyConfidential(
  commitment: Hex,
  rangeProof: RangeProof,
  options: { maxValueAtomic: bigint | string | number },
): boolean {
  try {
    if (
      rangeProof.bitLength !== RANGE_BITS ||
      !Array.isArray(rangeProof.bits) ||
      rangeProof.bits.length !== RANGE_BITS ||
      !Array.isArray(rangeProof.valueBits) ||
      rangeProof.valueBits.length !== RANGE_BITS
    ) {
      return false;
    }
    const max = toBig(options.maxValueAtomic);
    if (max < 0n || max >= MAX_RANGE) {
      return false;
    }
    const C = pointFromHex(commitment);

    // Statement 1: value <= max, via delta = max − value ∈ [0, 2^64).
    if (!aggregateMatches(rangeProof.bits, mul(G, max).subtract(C))) {
      return false;
    }
    // Statement 2: value ∈ [0, 2^64). Without this, value mod n (negative
    // values) is indistinguishable from a large unsigned scalar and passes 1.
    if (!aggregateMatches(rangeProof.valueBits, mul(G, MAX_RANGE - 1n).subtract(C))) {
      return false;
    }

    // Every bit commitment must open to a single bit.
    return rangeProof.bits.every(verifyBit) && rangeProof.valueBits.every(verifyBit);
  } catch {
    return false;
  }
}

/** Re-derive the payee hiding digest from an opening (binding check). */
export function verifyPayeeCommitment(
  payeeCommitment: Hex,
  payTo: string,
  payeeSalt: Hex,
): boolean {
  return commitPayee(payTo, payeeSalt) === payeeCommitment;
}
