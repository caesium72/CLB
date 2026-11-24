import { describe, expect, it } from "bun:test";
import { TEST_KEYS, buildValidBundle } from "@clb-acel/attack-core";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recomputeEvidenceIntegrity } from "../../attack-core/src/trace-utils";
import { verifyTrace } from "../src";

/**
 * Reviewer #4, Comment 2 — R1 trust controls.
 *
 * Honest baseline: the hash chain + Merkle root only bind events to each other.
 * recomputeEvidenceIntegrity() re-links/re-roots ANY edited event set without a
 * secret, so an untrusted agent can produce a self-consistent rewrite that R1
 * accepts unless the verifier compares against a trusted, externally anchored
 * root. The trusted-root check and strict fail-closed mode below close that case
 * WHEN the caller supplies an independently obtained root; they do not read the
 * on-chain anchor themselves, and without it integrity cannot be asserted.
 */

const HUMAN = privateKeyToAccount(TEST_KEYS.userKey).address;

describe("R1 — trusted expected Merkle root", () => {
  it("passes when the recomputed root equals the trusted root", async () => {
    const base = await buildValidBundle({ traceId: "tm-honest" });
    const result = await verifyTrace(base, {
      expectedHumanPrincipal: HUMAN,
      expectedMerkleRoot: base.merkleRoot,
    });
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(true);
    expect(result.result.status).toBe("PASS");
  });

  it("fails when the trusted root differs from the bundle's root", async () => {
    const base = await buildValidBundle({ traceId: "tm-wrong-root" });
    const result = await verifyTrace(base, {
      expectedHumanPrincipal: HUMAN,
      expectedMerkleRoot: `0x${"0".repeat(64)}` as Hex,
    });
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(false);
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.detail).toContain("trusted expected root");
    expect(result.result.status).toBe("FAIL");
  });

  it("compares roots case-insensitively", async () => {
    const base = await buildValidBundle({ traceId: "tm-case" });
    const result = await verifyTrace(base, {
      expectedHumanPrincipal: HUMAN,
      expectedMerkleRoot: base.merkleRoot.toUpperCase() as Hex,
    });
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(true);
  });

  it("strict mode fails closed without a trusted root, even on an honest bundle", async () => {
    const base = await buildValidBundle({ traceId: "tm-strict-noroot" });
    const result = await verifyTrace(base, {
      expectedHumanPrincipal: HUMAN,
      strictEvidenceIntegrity: true,
    });
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(false);
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.detail).toContain(
      "STRICT_EVIDENCE_INTEGRITY_REQUIRES_TRUSTED_ROOT",
    );
    expect(result.result.status).toBe("FAIL");
  });

  it("strict mode passes with a trusted root", async () => {
    const base = await buildValidBundle({ traceId: "tm-strict-root" });
    const result = await verifyTrace(base, {
      expectedHumanPrincipal: HUMAN,
      strictEvidenceIntegrity: true,
      expectedMerkleRoot: base.merkleRoot,
    });
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(true);
    expect(result.result.status).toBe("PASS");
  });

  it("a self-consistent rewrite heals R1 without a trusted root but is rejected with one", async () => {
    const base = await buildValidBundle({ traceId: "tm-rewrite" });
    const tampered = structuredClone(base);
    tampered.events[1]!.publicFields = { injected: "attacker-value" };
    expect(
      (await verifyTrace(tampered, { expectedHumanPrincipal: HUMAN })).outcomes.R1_HASH_CHAIN_INTACT.ok,
    ).toBe(false);

    // recomputeEvidenceIntegrity strips previousEventHash, re-links and rebuilds
    // hashes + root for the edited set. No secret is needed (GAP-5).
    const healed = recomputeEvidenceIntegrity(tampered);
    expect(healed.merkleRoot).not.toBe(base.merkleRoot);
    expect(
      (await verifyTrace(healed, { expectedHumanPrincipal: HUMAN })).outcomes.R1_HASH_CHAIN_INTACT.ok,
    ).toBe(true);

    // The trusted anchored root exposes the rewrite.
    const anchored = await verifyTrace(healed, {
      expectedHumanPrincipal: HUMAN,
      expectedMerkleRoot: base.merkleRoot,
    });
    expect(anchored.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(false);
    expect(anchored.outcomes.R1_HASH_CHAIN_INTACT.detail).toContain("trusted expected root");
    expect(anchored.result.status).toBe("FAIL");
  });
});

describe("R1 — event-set completeness and signature surface", () => {
  it("accepts a bundle containing all caller-required object types", async () => {
    const base = await buildValidBundle({ traceId: "tm-types-ok" });
    const result = await verifyTrace(base, {
      expectedHumanPrincipal: HUMAN,
      requiredEventObjectTypes: ["USER_INTENT", "ERC8004_AGENT_IDENTITY", "CHAIN_SETTLEMENT"],
    });
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(true);
  });

  it("detects an omitted required event even after integrity recomputation", async () => {
    const base = await buildValidBundle({ traceId: "tm-omitted" });
    const removed = structuredClone(base);
    removed.events = removed.events.filter((event) => event.objectType !== "CHAIN_SETTLEMENT");
    const healed = recomputeEvidenceIntegrity(removed);

    // Internally consistent: without a completeness policy R1 cannot see the
    // omission at all.
    const withoutPolicy = await verifyTrace(healed, { expectedHumanPrincipal: HUMAN });
    expect(withoutPolicy.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(true);

    const withPolicy = await verifyTrace(healed, {
      expectedHumanPrincipal: HUMAN,
      requiredEventObjectTypes: ["USER_INTENT", "CHAIN_SETTLEMENT"],
    });
    expect(withPolicy.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(false);
    expect(withPolicy.outcomes.R1_HASH_CHAIN_INTACT.detail).toContain("CHAIN_SETTLEMENT");
  });

  it("rejects duplicate event ids after integrity recomputation", async () => {
    const base = await buildValidBundle({ traceId: "tm-duplicate" });
    const duplicated = structuredClone(base);
    duplicated.events[2] = { ...duplicated.events[2]!, eventId: duplicated.events[1]!.eventId };
    const healed = recomputeEvidenceIntegrity(duplicated);
    const result = await verifyTrace(healed, { expectedHumanPrincipal: HUMAN });
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(false);
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.detail).toContain("Duplicate event id");
  });

  it("rejects a malformed event signature (already-enforced control)", async () => {
    const base = await buildValidBundle({ traceId: "tm-signature" });
    const bad = structuredClone(base);
    bad.events[1]!.signature = "0x1234";
    const result = await verifyTrace(bad, { expectedHumanPrincipal: HUMAN });
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(false);
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.detail).toContain("Malformed event signature");
  });
});
