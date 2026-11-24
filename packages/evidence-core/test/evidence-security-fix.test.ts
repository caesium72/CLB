import { describe, expect, test } from "bun:test";
import type { EvidenceEvent } from "@clb-acel/schemas";
import {
  buildMerkleProof,
  buildMerkleRoot,
  hashEvidenceEvent,
  linkEvidenceEvents,
  verifyMerkleProof,
  ZERO_HASH,
} from "../src/index";

/** GAP-4 / GAP-7 regressions: signed events and Merkle membership proofs. */

function event(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    traceId: "trace-security-fix",
    eventId: "evt-1",
    protocol: "USER",
    objectType: "USER_INTENT",
    actor: "orchestrator",
    timestamp: "2026-05-30T05:00:00.000Z",
    objectHash: `0x${"a".repeat(64)}`,
    publicFields: { amount: "2.00" },
    signature: `0x${"1".repeat(130)}`,
    ...overrides,
  };
}

describe("GAP-4: event signature is bound into the hash and chain", () => {
  test("changing only the signature changes the event hash", () => {
    const first = event();
    const resigned = event({ signature: `0x${"f".repeat(130)}` });
    expect(hashEvidenceEvent(first)).not.toBe(hashEvidenceEvent(resigned));
  });

  test("a signature swap breaks the declared chain link and Merkle root", () => {
    const events = linkEvidenceEvents([
      event({ eventId: "evt-1" }),
      event({ eventId: "evt-2", objectType: "AP2_CART_MANDATE", signature: `0x${"2".repeat(130)}` }),
    ]);
    const hashes = events.map(hashEvidenceEvent);
    const root = buildMerkleRoot(hashes);
    expect(events[1]!.previousEventHash).toBe(hashes[0]);

    const tampered = structuredClone(events);
    tampered[0]!.signature = `0x${"f".repeat(130)}`;
    const tamperedHashes = tampered.map(hashEvidenceEvent);
    expect(tamperedHashes[0]).not.toBe(hashes[0]);
    // The stale link now points at the old hash, and the root changes too.
    expect(tampered[1]!.previousEventHash).not.toBe(tamperedHashes[0]);
    expect(buildMerkleRoot(tamperedHashes)).not.toBe(root);
  });
});

describe("GAP-7: Merkle membership proofs", () => {
  const leaves = [0, 1, 2, 3, 4].map((n) => `0x${n.toString(16).padStart(64, "0")}` as const);

  test("proofs verify against the root for even and odd leaf counts, all indices", () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const subset = leaves.slice(0, count);
      const root = buildMerkleRoot(subset);
      for (let index = 0; index < count; index += 1) {
        const proof = buildMerkleProof(subset, index);
        expect(proof.index).toBe(index);
        expect(proof.leafCount).toBe(count);
        expect(verifyMerkleProof(root, proof)).toBe(true);
      }
    }
  });

  test("proofs reject a wrong root, wrong leaf, wrong index and malformed input", () => {
    const root = buildMerkleRoot(leaves.slice(0, 5));
    const proof = buildMerkleProof(leaves.slice(0, 5), 2);
    expect(verifyMerkleProof(ZERO_HASH, proof)).toBe(false);
    expect(verifyMerkleProof(root, { ...proof, leaf: leaves[3]! })).toBe(false);
    expect(verifyMerkleProof(root, { ...proof, index: 3 })).toBe(false);
    expect(verifyMerkleProof(root, { ...proof, leafCount: 4 })).toBe(false);
    expect(verifyMerkleProof(root, { ...proof, siblings: [] })).toBe(false);
    expect(verifyMerkleProof(root, { ...proof, siblings: [`0x${"00".repeat(16)}`] })).toBe(false);
    expect(() => buildMerkleProof(leaves.slice(0, 5), 5)).toThrow("index out of range");
    expect(() => buildMerkleProof(leaves, -1)).toThrow("index out of range");
  });

  test("proofs use the same duplicate-last encoding as the root builder", () => {
    const odd = leaves.slice(0, 3);
    const duplicated = [...odd, odd[2]!];
    expect(buildMerkleProof(odd, 2).siblings).toEqual(buildMerkleProof(duplicated, 2).siblings);
    const root = buildMerkleRoot(odd);
    expect(verifyMerkleProof(root, buildMerkleProof(duplicated, 2))).toBe(true);
  });
});
