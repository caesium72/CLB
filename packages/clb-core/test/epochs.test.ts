import { describe, expect, it } from "bun:test";
import { keccak256, toBytes, type Hex } from "viem";
import {
  REVOCATION_AWARE_COMMITMENT_SCHEMA,
  checkRevocationAwareAcceptance,
  computeRevocationAwareCommitment,
  consumeRevocationNonce,
  deriveRevocationAwareNonce,
  revocationNonceKey,
} from "../src/epochs";

const BASE = keccak256(toBytes("clb-core-rclb-test-base"));
const NONCE = `0x${"22".repeat(32)}` as Hex;
const FIELDS = {
  baseCommitment: BASE,
  identityEpoch: 1n,
  mandateEpoch: 1n,
  expiry: 100n,
  nonce: NONCE,
};

function acceptance(overrides: Partial<Parameters<typeof checkRevocationAwareAcceptance>[0]> = {}) {
  return checkRevocationAwareAcceptance({
    fields: FIELDS,
    commitment: computeRevocationAwareCommitment(FIELDS),
    currentIdentityEpoch: 1n,
    currentMandateEpoch: 1n,
    now: 100n,
    ...overrides,
  });
}

describe("RCLB — revocation-aware commitment construction", () => {
  it("is deterministic and documents the exact abi.encode construction", () => {
    expect(REVOCATION_AWARE_COMMITMENT_SCHEMA).toBe(
      "RevocationAwareCommitment(bytes32 baseCommitment,uint256 identityEpoch,uint256 mandateEpoch,uint64 expiry,bytes32 nonce)",
    );
    expect(computeRevocationAwareCommitment(FIELDS)).toBe(computeRevocationAwareCommitment(FIELDS));
  });

  it("every field changes C_t (no field is ignored)", () => {
    const base = computeRevocationAwareCommitment(FIELDS);
    expect(computeRevocationAwareCommitment({ ...FIELDS, identityEpoch: 2n })).not.toBe(base);
    expect(computeRevocationAwareCommitment({ ...FIELDS, mandateEpoch: 2n })).not.toBe(base);
    expect(computeRevocationAwareCommitment({ ...FIELDS, expiry: 101n })).not.toBe(base);
    expect(computeRevocationAwareCommitment({ ...FIELDS, nonce: `0x${"33".repeat(32)}` })).not.toBe(base);
    expect(computeRevocationAwareCommitment({ ...FIELDS, baseCommitment: keccak256(toBytes("other")) })).not.toBe(
      base,
    );
  });

  it("payment nonce is H(C_t), not the base commitment", () => {
    const commitment = computeRevocationAwareCommitment(FIELDS);
    expect(deriveRevocationAwareNonce(commitment)).toBe(keccak256(commitment));
    expect(deriveRevocationAwareNonce(commitment)).not.toBe(keccak256(BASE));
  });

  it("rejects malformed 32-byte inputs instead of silently hashing them", () => {
    expect(() =>
      computeRevocationAwareCommitment({ ...FIELDS, nonce: "0x1234" as Hex }),
    ).toThrow(/32-byte hex/);
  });
});

describe("RCLB — guard acceptance", () => {
  it("accepts only when both epochs are current, time is in-window and N is fresh", () => {
    const outcome = acceptance();
    expect(outcome.ok).toBe(true);
    expect(outcome.violations).toEqual([]);
  });

  it("rejects a stale identity epoch (settlement after identity revocation)", () => {
    const outcome = acceptance({ currentIdentityEpoch: 2n });
    expect(outcome.ok).toBe(false);
    expect(outcome.violations).toContain("IDENTITY_EPOCH_STALE");
  });

  it("rejects a stale mandate epoch (settlement after mandate revocation)", () => {
    const outcome = acceptance({ currentMandateEpoch: 2n });
    expect(outcome.ok).toBe(false);
    expect(outcome.violations).toContain("MANDATE_EPOCH_STALE");
  });

  it("fails closed when authority state is unavailable", () => {
    expect(acceptance({ currentIdentityEpoch: undefined, currentMandateEpoch: 1n }).violations).toContain(
      "REVOCATION_STATE_UNAVAILABLE",
    );
    expect(acceptance({ currentIdentityEpoch: 1n, currentMandateEpoch: null }).violations).toContain(
      "REVOCATION_STATE_UNAVAILABLE",
    );
    // A missing snapshot must not be treated as "epochs match".
    expect(acceptance({ currentIdentityEpoch: undefined }).violations).not.toContain("IDENTITY_EPOCH_STALE");
  });

  it("treats T_expiry as inclusive and rejects t > T_expiry", () => {
    expect(acceptance({ now: 100n }).ok).toBe(true);
    expect(acceptance({ now: 101n }).violations).toContain("COMMITMENT_EXPIRED");
  });

  it("rejects a consumed N and rejects a substituted C_t", () => {
    const consumed = consumeRevocationNonce(new Set<string>(), NONCE);
    expect(consumed.has(revocationNonceKey(NONCE))).toBe(true);
    expect(acceptance({ consumedNonces: consumed }).violations).toContain("NONCE_ALREADY_CONSUMED");
    expect(acceptance({ commitment: keccak256(toBytes("substituted")) }).violations).toContain(
      "COMMITMENT_MISMATCH",
    );
  });

  it("accumulates independent violations instead of short-circuiting", () => {
    const outcome = acceptance({
      currentIdentityEpoch: 2n,
      currentMandateEpoch: 3n,
      now: 999n,
      commitment: keccak256(toBytes("bad")),
    });
    expect(outcome.violations).toEqual([
      "IDENTITY_EPOCH_STALE",
      "MANDATE_EPOCH_STALE",
      "COMMITMENT_EXPIRED",
      "COMMITMENT_MISMATCH",
    ]);
  });
});
