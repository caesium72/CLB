import { describe, expect, test } from "bun:test";
import type { EvidenceEvent } from "@clb-acel/schemas";
import {
  buildEvidenceGraph,
  buildMerkleRoot,
  canonicalJson,
  hashEvidenceEvent,
  linkEvidenceEvents,
} from "../src/index";

const hexA = `0x${"a".repeat(64)}` as const;
const hexB = `0x${"b".repeat(64)}` as const;
const sigA = `0x${"1".repeat(130)}` as const;
const sigB = `0x${"2".repeat(130)}` as const;

function event(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    traceId: "trace-phase-1",
    eventId: "evt-1",
    protocol: "USER",
    objectType: "USER_INTENT",
    actor: "user:0xabc",
    timestamp: "2026-05-30T05:00:00.000Z",
    objectHash: hexA,
    publicFields: { token: "XYZ", budget: "2.00", nested: { b: 2, a: 1 } },
    signature: sigA,
    ...overrides,
  };
}

describe("canonicalJson", () => {
  test("sorts object keys recursively while preserving array order", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 }, z: [3, { y: 2, x: 1 }] })).toBe(
      '{"a":{"c":3,"d":4},"b":2,"z":[3,{"x":1,"y":2}]}',
    );
  });
});

describe("hashEvidenceEvent", () => {
  test("hashes event_without_signature deterministically", () => {
    const first = event({ publicFields: { b: 2, a: 1 }, signature: sigA });
    const second = event({ publicFields: { a: 1, b: 2 }, signature: sigB });

    expect(hashEvidenceEvent(first)).toBe(hashEvidenceEvent(second));
    expect(hashEvidenceEvent(first)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("linkEvidenceEvents", () => {
  test("fills previousEventHash from the prior event hash", () => {
    const linked = linkEvidenceEvents([
      event({ eventId: "evt-1" }),
      event({ eventId: "evt-2", objectHash: hexB }),
    ]);

    expect(linked[0]?.previousEventHash).toBeUndefined();
    expect(linked[1]?.previousEventHash).toBe(hashEvidenceEvent(linked[0]!));
  });

  test("chains each event to the hash of the stored linked predecessor", () => {
    const linked = linkEvidenceEvents([
      event({ eventId: "evt-1" }),
      event({ eventId: "evt-2", objectHash: hexB }),
      event({ eventId: "evt-3" }),
    ]);

    expect(linked[2]?.previousEventHash).toBe(hashEvidenceEvent(linked[1]!));
  });
});

describe("buildMerkleRoot", () => {
  test("returns zero root for empty traces and the leaf for a single event", () => {
    const leaf = hashEvidenceEvent(event());

    expect(buildMerkleRoot([])).toBe(`0x${"0".repeat(64)}`);
    expect(buildMerkleRoot([leaf])).toBe(leaf);
  });

  test("is order-sensitive for multi-event traces", () => {
    const first = hashEvidenceEvent(event({ eventId: "evt-1", objectHash: hexA }));
    const second = hashEvidenceEvent(event({ eventId: "evt-2", objectHash: hexB }));

    expect(buildMerkleRoot([first, second])).not.toBe(buildMerkleRoot([second, first]));
  });
});

describe("buildEvidenceGraph", () => {
  test("maps stored events into graph nodes with hash chain and semantic edges", () => {
    const graph = buildEvidenceGraph(
      linkEvidenceEvents([
        event({ eventId: "evt-1", objectType: "USER_INTENT", protocol: "USER" }),
        event({ eventId: "evt-2", objectType: "ERC8004_AGENT_IDENTITY", protocol: "ERC8004" }),
        event({ eventId: "evt-3", objectType: "AP2_CART_MANDATE", protocol: "AP2" }),
        event({ eventId: "evt-4", objectType: "X402_PAYMENT_REQUIREMENT", protocol: "X402" }),
        event({ eventId: "evt-5", objectType: "X402_PAYMENT_PAYLOAD", protocol: "X402" }),
        event({ eventId: "evt-6", objectType: "CHAIN_SETTLEMENT", protocol: "CHAIN" }),
        event({ eventId: "evt-7", objectType: "DELIVERY_PROOF", protocol: "DELIVERY" }),
      ]),
    );

    expect(graph.traceId).toBe("trace-phase-1");
    expect(graph.nodes).toHaveLength(7);
    expect(graph.edges.filter((edge) => edge.edgeType === "BINDS_TO")).toHaveLength(6);
    expect(graph.edges.some((edge) => edge.edgeType === "AUTHORIZES")).toBe(true);
    expect(graph.edges.some((edge) => edge.edgeType === "PAYS_FOR")).toBe(true);
    expect(graph.edges.some((edge) => edge.edgeType === "SETTLES")).toBe(true);
    expect(graph.edges.some((edge) => edge.edgeType === "DELIVERS")).toBe(true);
  });
});
