import { describe, expect, test } from "bun:test";
import { TEST_KEYS, buildValidBundle, verifyTrace } from "@clb-acel/attack-core";
import type { EvidenceEvent } from "@clb-acel/schemas";
import { privateKeyToAccount } from "viem/accounts";

const HUMAN = privateKeyToAccount(TEST_KEYS.userKey).address;
import {
  AGENTIC_AUDIT_ANCHOR_ABI,
  computeTraceHash,
  metadataUriForTrace,
  traceIdToBytes32,
} from "../../anchor-core/src/index";
import { recomputeEvidenceIntegrity } from "../../attack-core/src/trace-utils";
import * as evidenceCore from "../src/index";
import {
  ZERO_HASH,
  buildMerkleRoot,
  canonicalJson,
  hashEvidenceEvent,
  linkEvidenceEvents,
} from "../src/index";

/**
 * Adversarial evidence-integrity tests (R3-C2, items 38-43).
 *
 * These tests assert the behaviour that ACTUALLY exists in the code:
 *   - hashEvidenceEvent = keccak256(canonicalJson(event WITHOUT signature))
 *       (packages/evidence-core/src/index.ts:62-66)
 *   - linkEvidenceEvents sets previousEventHash = hash(previous linked event)
 *       (packages/evidence-core/src/index.ts:68-89)
 *   - buildMerkleRoot = binary keccak256(left||right), last leaf duplicated,
 *     no domain/type tag on leaves (packages/evidence-core/src/index.ts:91-121)
 *   - verifier R1 re-checks links + eventHashes + root
 *       (packages/verifier-core/src/index.ts:129-160)
 */

const HEX_A = `0x${"a".repeat(64)}` as const;
const HEX_B = `0x${"b".repeat(64)}` as const;
const HEX_C = `0x${"c".repeat(64)}` as const;
const SIG = `0x${"1".repeat(130)}` as const;

function makeEvent(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    traceId: "trace-adversarial",
    eventId: "evt-1",
    protocol: "USER",
    objectType: "USER_INTENT",
    actor: "attacker",
    timestamp: "2026-05-30T05:00:00.000Z",
    objectHash: HEX_A,
    publicFields: { token: "XYZ", nested: { b: 2, a: 1 } },
    signature: SIG,
    ...overrides,
  };
}

/** Three distinct, schema-valid, hash-linked events. */
function honestChain(): EvidenceEvent[] {
  return linkEvidenceEvents([
    makeEvent({ eventId: "evt-1", objectType: "USER_INTENT", protocol: "USER" }),
    makeEvent({
      eventId: "evt-2",
      objectType: "X402_PAYMENT_PAYLOAD",
      protocol: "X402",
      objectHash: HEX_B,
      publicFields: { amount: "2.00" },
    }),
    makeEvent({
      eventId: "evt-3",
      objectType: "CHAIN_SETTLEMENT",
      protocol: "CHAIN",
      objectHash: HEX_C,
      publicFields: { txHash: "0xdead" },
    }),
  ]);
}

type DeclaredIntegrity = { hashes: string[]; root: string };

function declaredIntegrity(events: EvidenceEvent[]): DeclaredIntegrity {
  const hashes = events.map(hashEvidenceEvent);
  return { hashes, root: buildMerkleRoot(hashes) };
}

/** Mirror of verifier-core R1 `checkHashChain` (index.ts:129-160). */
function r1ChainIntact(events: EvidenceEvent[], declared: DeclaredIntegrity): boolean {
  const computed: string[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (!event) return false;
    const expected = i === 0 ? undefined : computed[i - 1];
    if (event.previousEventHash !== expected) return false;
    computed.push(hashEvidenceEvent(event));
  }
  if (
    declared.hashes.length !== computed.length ||
    declared.hashes.some((hash, index) => hash !== computed[index])
  ) {
    return false;
  }
  return buildMerkleRoot(computed) === declared.root;
}

describe("adversarial evidence hash-chain integrity (items 38-40, 43)", () => {
  test("honest chain is intact under the R1 rules", () => {
    const events = honestChain();
    expect(r1ChainIntact(events, declaredIntegrity(events))).toBe(true);
    expect(hashEvidenceEvent(events[1]!)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(events[2]!.previousEventHash).toBe(hashEvidenceEvent(events[1]!));
  });

  test("modifying ANY event's publicFields breaks the chain (each index)", () => {
    const original = honestChain();
    const declared = declaredIntegrity(original);

    for (let index = 0; index < original.length; index += 1) {
      const tampered = structuredClone(original);
      const target = tampered[index]!;
      target.publicFields = { ...target.publicFields, injected: "attacker-value" };

      // The edited event's own hash changes, so declared hashes and root no
      // longer match; for all but the last event the next link also breaks.
      expect(hashEvidenceEvent(target)).not.toBe(declared.hashes[index]);
      expect(buildMerkleRoot(tampered.map(hashEvidenceEvent))).not.toBe(declared.root);
      expect(r1ChainIntact(tampered, declared)).toBe(false);
      if (index < original.length - 1) {
        expect(tampered[index + 1]!.previousEventHash).not.toBe(hashEvidenceEvent(target));
      }
    }
  });

  test("deleting an event breaks the chain", () => {
    const original = honestChain();
    const declared = declaredIntegrity(original);
    const deleted = original.filter((_, index) => index !== 1);
    expect(deleted).toHaveLength(2);
    expect(r1ChainIntact(deleted, declared)).toBe(false);
    // The survivor still claims to follow the deleted event's hash.
    expect(deleted[1]!.previousEventHash).toBe(declared.hashes[1]);
    expect(buildMerkleRoot(deleted.map(hashEvidenceEvent))).not.toBe(declared.root);
  });

  test("reordering events breaks the chain", () => {
    const original = honestChain();
    const declared = declaredIntegrity(original);
    const reordered = [original[1]!, original[0]!, original[2]!];
    expect(r1ChainIntact(reordered, declared)).toBe(false);
    expect(buildMerkleRoot(reordered.map(hashEvidenceEvent))).not.toBe(declared.root);
    expect(buildMerkleRoot([declared.hashes[1]!, declared.hashes[0]!, declared.hashes[2]!])).not.toBe(
      declared.root,
    );
  });

  test("substituting a valid-shaped event breaks the chain", () => {
    const original = honestChain();
    const declared = declaredIntegrity(original);
    const substitute = makeEvent({
      eventId: "evt-2",
      objectType: "X402_PAYMENT_PAYLOAD",
      protocol: "X402",
      objectHash: HEX_A, // same schema shape, different content
      publicFields: { amount: "9999.00" },
      signature: `0x${"2".repeat(130)}`,
    });
    const substituted = linkEvidenceEvents([original[0]!, substitute, original[2]!]);
    expect(hashEvidenceEvent(substitute)).not.toBe(declared.hashes[1]);
    expect(r1ChainIntact(substituted, declared)).toBe(false);
    expect(buildMerkleRoot(substituted.map(hashEvidenceEvent))).not.toBe(declared.root);
  });

  test("FIXED: changing an event signature breaks the hash chain", () => {
    const original = honestChain();
    const declared = declaredIntegrity(original);
    const resigned = structuredClone(original);
    resigned[0]!.signature = `0x${"f".repeat(130)}`;
    // The signature is now bound into the event hash, so a re-signed event
    // changes its hash, breaks the chain, and changes the Merkle root.
    expect(hashEvidenceEvent(resigned[0]!)).not.toBe(declared.hashes[0]);
    expect(r1ChainIntact(resigned, declared)).toBe(false);
  });

  test("GAP-DOC: an attacker who can rewrite the bundle can recompute hashes and root to heal R1", () => {
    const original = honestChain();
    const declared = declaredIntegrity(original);
    const tampered = structuredClone(original);
    tampered[1]!.publicFields = { amount: "9999999.00" };
    expect(r1ChainIntact(tampered, declared)).toBe(false);

    // recomputeEvidenceIntegrity (attack-core/src/trace-utils.ts:4-14) strips
    // previousEventHash, re-links and rebuilds hashes + root. No secret needed.
    const healed = recomputeEvidenceIntegrity({
      events: tampered,
      eventHashes: declared.hashes,
      merkleRoot: declared.root as `0x${string}`,
    } as never);
    expect(r1ChainIntact(healed.events, declaredIntegrity(healed.events))).toBe(true);
    // Detecting this requires comparing against the on-chain anchor, which the
    // verifier does not do (verifier-core does not import anchor-core).
  });
});

describe("Merkle root and membership-proof surface (item 41)", () => {
  test("root recomputation is deterministic, order-sensitive, and empty-safe", () => {
    const events = honestChain();
    const hashes = events.map(hashEvidenceEvent);

    expect(buildMerkleRoot(hashes)).toBe(buildMerkleRoot(hashes));
    expect(buildMerkleRoot(hashes)).toBe(declaredIntegrity(events).root);
    expect(buildMerkleRoot([])).toBe(ZERO_HASH);
    expect(buildMerkleRoot([hashes[0]!])).toBe(hashes[0]); // single leaf = leaf
    expect(buildMerkleRoot([hashes[0]!, hashes[1]!])).not.toBe(
      buildMerkleRoot([hashes[1]!, hashes[0]!]),
    );
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  test("odd leaf count duplicates the last leaf (no 0x00 padding, no sorted pairs)", () => {
    const [a, b, c] = [HEX_A, HEX_B, HEX_C];
    expect(buildMerkleRoot([a, b, c])).toBe(buildMerkleRoot([a, b, c, c]));
    expect(buildMerkleRoot([a, b])).not.toBe(buildMerkleRoot([b, a]));
  });

  test("membership-proof API now exists (FIXED)", () => {
    // evidence-core now exports the Merkle proof surface (item 41 fix).
    const exported = Object.keys(evidenceCore).sort();
    for (const symbol of [
      "ZERO_HASH",
      "buildEvidenceGraph",
      "buildMerkleRoot",
      "canonicalJson",
      "hashEvidenceEvent",
      "linkEvidenceEvents",
      "buildMerkleProof",
      "verifyMerkleProof",
    ]) {
      expect(exported).toContain(symbol);
    }
  });
});

describe("on-chain anchoring shape (item 42)", () => {
  test("the contract stores only root/hash/URI/sender/time — not raw evidence, events, or proofs", () => {
    const anchorFn = AGENTIC_AUDIT_ANCHOR_ABI.find((item) => item.name === "anchorTrace");
    expect(anchorFn?.inputs.map((input) => input.name)).toEqual([
      "traceId",
      "merkleRoot",
      "traceHash",
      "metadataURI",
    ]);
    expect(anchorFn?.inputs.map((input) => input.type)).toEqual([
      "bytes32",
      "bytes32",
      "bytes32",
      "string",
    ]);
    // NOT anchored: individual event hashes, event payloads/publicFields,
    // signatures, confidential commitments/range proofs, certificate hash.
    const names = anchorFn?.inputs.map((input) => input.name).join(",") ?? "";
    expect(names).not.toContain("event");
    expect(names).not.toContain("proof");
    expect(names).not.toContain("signature");
    expect(names).not.toContain("payload");
  });

  test("traceHash binds traceId + merkleRoot + the full ordered eventHashes", () => {
    const events = honestChain();
    const hashes = events.map(hashEvidenceEvent);
    const input = { traceId: "trace-adversarial", merkleRoot: buildMerkleRoot(hashes), eventHashes: hashes };

    expect(computeTraceHash(input)).toBe(computeTraceHash(input));
    expect(computeTraceHash(input)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(computeTraceHash({ ...input, eventHashes: [hashes[0]!, hashes[1]!, HEX_A] })).not.toBe(
      computeTraceHash(input),
    );
    expect(computeTraceHash({ ...input, merkleRoot: HEX_A })).not.toBe(computeTraceHash(input));
    expect(computeTraceHash({ ...input, traceId: "other" })).not.toBe(computeTraceHash(input));
    expect(traceIdToBytes32("trace-adversarial")).toBe(traceIdToBytes32("trace-adversarial"));
    expect(metadataUriForTrace("trace-adversarial")).toBe("acel://traces/trace-adversarial");
  });
});

describe("end-to-end verifier R1 (item 43)", () => {
  test("R1 passes on an honest bundle and fails on each tamper class", async () => {
    const base = await buildValidBundle();
    const honest = await verifyTrace(base, { expectedHumanPrincipal: HUMAN });
    expect(honest.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(true);

    const modify = structuredClone(base);
    modify.events[1]!.publicFields = { tampered: true };
    expect((await verifyTrace(modify, { expectedHumanPrincipal: HUMAN })).outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(false);

    const deleted = structuredClone(base);
    deleted.events = deleted.events.filter((_, i) => i !== 2);
    expect((await verifyTrace(deleted, { expectedHumanPrincipal: HUMAN })).outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(false);

    const reordered = structuredClone(base);
    reordered.events = [reordered.events[1]!, reordered.events[0]!, ...reordered.events.slice(2)];
    expect((await verifyTrace(reordered, { expectedHumanPrincipal: HUMAN })).outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(false);

    const substituted = structuredClone(base);
    substituted.events[0] = {
      ...substituted.events[0]!,
      objectHash: HEX_A,
      publicFields: { objectType: "USER_INTENT", injected: "x" },
    };
    expect((await verifyTrace(substituted, { expectedHumanPrincipal: HUMAN })).outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(false);
  });

  test("GAP-DOC: R1 passes again after recomputing integrity — no on-chain anchor check", async () => {
    const base = await buildValidBundle();
    const tampered = structuredClone(base);
    tampered.events[1]!.publicFields = { tampered: true };
    expect((await verifyTrace(tampered, { expectedHumanPrincipal: HUMAN })).outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(false);

    const healed = recomputeEvidenceIntegrity(tampered);
    const result = await verifyTrace(healed, { expectedHumanPrincipal: HUMAN });
    expect(result.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(true);
    // The certificate carries traceMerkleRoot but no on-chain anchor
    // transaction / anchored-root field (verifier-core/src/index.ts:504-515).
    expect(result.certificate).not.toHaveProperty("anchorTxHash");
    expect(result.certificate).not.toHaveProperty("onchainRoot");
  });
});
