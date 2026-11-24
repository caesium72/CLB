import { describe, expect, it } from "bun:test";
import { buildValidBundle, TEST_KEYS } from "@clb-acel/attack-core";
import {
  computeCommitment,
  computeMandateDigest,
  computeRevocationAwareCommitment,
  deriveRevocationAwareNonce,
} from "@clb-acel/clb-core";
import { createInMemoryEpochRegistry } from "@clb-acel/erc8004-adapter";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  R18_REVOCATION_AWARE_BINDING,
  verifyRevocationBinding,
  verifyTrace,
} from "../src";

const TRUSTED_PRINCIPAL = privateKeyToAccount(TEST_KEYS.userKey).address as Address;
const AGENT_ID = "shopping-agent-001";
const NONCE = `0x${"44".repeat(32)}` as Hex;

async function fixture() {
  const bundle = await buildValidBundle({ traceId: "rclb-verifier" });
  const baseCommitment = computeCommitment({
    identityRef: bundle.clb.identityRef,
    mandateDigest: computeMandateDigest(bundle.mandate),
    settlementDescriptor: bundle.clb.settlementDescriptor,
    domain: bundle.clb.domain,
  });
  const now = BigInt(Math.floor(Date.parse(bundle.settlement.settledAt) / 1000));
  const fields = {
    baseCommitment,
    identityEpoch: 1n,
    mandateEpoch: 1n,
    expiry: now + 1000n,
    nonce: NONCE,
  };
  const commitment = computeRevocationAwareCommitment(fields);
  return {
    bundle,
    baseCommitment,
    now,
    paymentNonce: deriveRevocationAwareNonce(commitment),
    gate: {
      commitment,
      baseCommitment,
      identityEpoch: fields.identityEpoch,
      mandateEpoch: fields.mandateEpoch,
      expiry: fields.expiry,
      nonce: fields.nonce,
      now,
      current: { identityEpoch: 1n, mandateEpoch: 1n },
    },
  };
}

describe("R18 — optional revocation-aware verifier gate", () => {
  it("PASS on current authority state; no existing rule is weakened", async () => {
    const { bundle, gate } = await fixture();
    const { result, certificate, outcomes } = await verifyTrace(bundle, {
      expectedHumanPrincipal: TRUSTED_PRINCIPAL,
      revocationBinding: gate,
    });
    expect(result.status).toBe("PASS");
    expect(result.failedRules).toEqual([]);
    expect(certificate.rulesChecked).toContain(R18_REVOCATION_AWARE_BINDING);
    expect(outcomes.R6_CLB_COMMITMENT_RECOMPUTES.ok).toBe(true);
    expect(outcomes.R9_NONCE_CONSUMED_EXACTLY_ONCE.ok).toBe(true);
    expect(outcomes.R10_CHAIN_DOMAIN_MATCHES.ok).toBe(true);
  });

  it("rejects settlement after identity revocation", async () => {
    const { bundle, gate } = await fixture();
    const { result, outcomes } = await verifyTrace(bundle, {
      expectedHumanPrincipal: TRUSTED_PRINCIPAL,
      revocationBinding: { ...gate, current: { identityEpoch: 2n, mandateEpoch: 1n } },
    });
    expect(result.status).toBe("FAIL");
    expect(result.failedRules).toContain(R18_REVOCATION_AWARE_BINDING);
    // Only the new rule fails: R1-R17 outputs stay untouched.
    expect(outcomes.R6_CLB_COMMITMENT_RECOMPUTES.ok).toBe(true);
    expect(outcomes.R5_MANDATE_SIGNATURE_VALID.ok).toBe(true);
  });

  it("rejects settlement after mandate revocation", async () => {
    const { bundle, gate } = await fixture();
    const { result } = await verifyTrace(bundle, {
      expectedHumanPrincipal: TRUSTED_PRINCIPAL,
      revocationBinding: { ...gate, current: { identityEpoch: 1n, mandateEpoch: 2n } },
    });
    expect(result.status).toBe("FAIL");
    expect(result.failedRules).toContain(R18_REVOCATION_AWARE_BINDING);
  });

  it("fails closed when the trusted epoch snapshot is missing", async () => {
    const { bundle, gate } = await fixture();
    const { result, outcomes } = await verifyTrace(bundle, {
      expectedHumanPrincipal: TRUSTED_PRINCIPAL,
      revocationBinding: { ...gate, current: undefined },
    });
    expect(result.status).toBe("FAIL");
    expect(result.failedRules).toContain(R18_REVOCATION_AWARE_BINDING);
    expect((outcomes as Record<string, { detail?: string }>)[R18_REVOCATION_AWARE_BINDING]?.detail).toBe(
      "REVOCATION_STATE_UNAVAILABLE",
    );
    const standalone = verifyRevocationBinding({ ...gate, current: undefined });
    expect(standalone.ok).toBe(false);
    expect(standalone.detail).toBe("REVOCATION_STATE_UNAVAILABLE");
  });

  it("rejects a stale registry read that would otherwise pass", async () => {
    const { bundle, gate } = await fixture();
    const staleAccepted = verifyRevocationBinding({ ...gate, current: { identityEpoch: 1n, mandateEpoch: 1n } });
    expect(staleAccepted.ok).toBe(true);
    const { result } = await verifyTrace(bundle, {
      expectedHumanPrincipal: TRUSTED_PRINCIPAL,
      revocationBinding: { ...gate, current: { identityEpoch: 2n, mandateEpoch: 1n } },
    });
    expect(result.status).toBe("FAIL");
  });

  it("rejects a delayed settlement and a consumed application nonce", async () => {
    const { bundle, gate } = await fixture();
    const expired = await verifyTrace(bundle, {
      expectedHumanPrincipal: TRUSTED_PRINCIPAL,
      revocationBinding: { ...gate, now: gate.expiry + 1n },
    });
    expect(expired.result.failedRules).toContain(R18_REVOCATION_AWARE_BINDING);

    const replayed = await verifyTrace(bundle, {
      expectedHumanPrincipal: TRUSTED_PRINCIPAL,
      revocationBinding: { ...gate, consumedNonces: [gate.nonce] },
    });
    expect(replayed.result.failedRules).toContain(R18_REVOCATION_AWARE_BINDING);
  });

  it("omitting the option preserves the pre-RCLB verdict exactly", async () => {
    const { bundle } = await fixture();
    const { result, certificate } = await verifyTrace(bundle, { expectedHumanPrincipal: TRUSTED_PRINCIPAL });
    expect(result.status).toBe("PASS");
    expect(result.failedRules).toEqual([]);
    expect(certificate.rulesChecked).not.toContain(R18_REVOCATION_AWARE_BINDING);
  });
});

describe("ERC-8004 epoch registry state", () => {
  it("revoke / rotate advance epochs and unknown agents fail closed", async () => {
    const epochs = createInMemoryEpochRegistry({ [AGENT_ID]: { identityEpoch: 1n, mandateEpoch: 1n } });
    expect(await epochs.currentEpochs(AGENT_ID)).toEqual({ identityEpoch: 1n, mandateEpoch: 1n });
    expect(await epochs.currentEpochs("unknown")).toBeNull();

    expect(await epochs.revokeMandate(AGENT_ID)).toEqual({ identityEpoch: 1n, mandateEpoch: 2n });
    expect(await epochs.rotateIdentityKey(AGENT_ID, privateKeyToAccount(TEST_KEYS.shopperKey).address)).toEqual({
      identityEpoch: 2n,
      mandateEpoch: 2n,
    });
    expect(await epochs.currentSigningKey(AGENT_ID)).toBe(
      privateKeyToAccount(TEST_KEYS.shopperKey).address,
    );
    expect(await epochs.revokeIdentity(AGENT_ID)).toEqual({ identityEpoch: 3n, mandateEpoch: 2n });
    await expect(epochs.revokeMandate("unknown")).rejects.toThrow(/not registered/);
  });
});
