import { describe, expect, test } from "bun:test";
import { computeTraceHash, traceIdToBytes32 } from "../src/index";

describe("anchor-core", () => {
  test("maps string trace ids to bytes32 keys", () => {
    const traceId = "trace-intent-123";
    expect(traceIdToBytes32(traceId)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(traceIdToBytes32(traceId)).toBe(traceIdToBytes32(traceId));
  });

  test("computes a deterministic trace hash from merkle metadata", () => {
    const merkleRoot = `0x${"a".repeat(64)}` as const;
    const eventHashes = [`0x${"b".repeat(64)}`, `0x${"c".repeat(64)}`] as const;

    const first = computeTraceHash({ traceId: "trace-1", merkleRoot, eventHashes: [...eventHashes] });
    const second = computeTraceHash({ traceId: "trace-1", merkleRoot, eventHashes: [...eventHashes] });

    expect(first).toBe(second);
    expect(first).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
