import { describe, expect, test } from "bun:test";
import type { EvidenceEvent } from "@clb-acel/schemas";
import { hashEvidenceEvent } from "@clb-acel/evidence-core";
import { buildEvidenceServer, createInMemoryEvidenceRepository } from "../src/server";

const objectHash = `0x${"a".repeat(64)}` as const;
const signature = `0x${"1".repeat(130)}` as const;

function event(eventId: string, overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    traceId: "trace-api-1",
    eventId,
    protocol: "USER",
    objectType: eventId === "evt-1" ? "USER_INTENT" : "ERC8004_AGENT_IDENTITY",
    actor: "user:0xabc",
    timestamp: "2026-05-30T05:00:00.000Z",
    objectHash,
    publicFields: { token: "XYZ" },
    signature,
    ...overrides,
  };
}

describe("evidence-service", () => {
  test("stores events and automatically links them by previousEventHash", async () => {
    const app = await buildEvidenceServer({
      repository: createInMemoryEvidenceRepository(),
      logger: false,
    });

    const first = await app.inject({ method: "POST", url: "/events", payload: event("evt-1") });
    const second = await app.inject({ method: "POST", url: "/events", payload: event("evt-2") });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const firstBody = first.json<{ event: EvidenceEvent; eventHash: string }>();
    const secondBody = second.json<{ event: EvidenceEvent; eventHash: string }>();
    expect(firstBody.eventHash).toBe(hashEvidenceEvent(firstBody.event));
    expect(secondBody.event.previousEventHash).toBe(firstBody.eventHash);

    await app.close();
  });

  test("overrides caller supplied previousEventHash to enforce append-order hash chain", async () => {
    const app = await buildEvidenceServer({
      repository: createInMemoryEvidenceRepository(),
      logger: false,
    });
    const bogusPreviousHash = `0x${"f".repeat(64)}` as const;

    const first = await app.inject({
      method: "POST",
      url: "/events",
      payload: event("evt-1", { previousEventHash: bogusPreviousHash }),
    });
    const second = await app.inject({
      method: "POST",
      url: "/events",
      payload: event("evt-2", {
        previousEventHash: bogusPreviousHash,
        timestamp: "2026-05-30T04:59:59.000Z",
      }),
    });
    const third = await app.inject({
      method: "POST",
      url: "/events",
      payload: event("evt-3", {
        previousEventHash: bogusPreviousHash,
        timestamp: "2026-05-30T05:00:03.000Z",
      }),
    });

    const firstBody = first.json<{ event: EvidenceEvent; eventHash: string }>();
    const secondBody = second.json<{ event: EvidenceEvent; eventHash: string }>();
    const thirdBody = third.json<{ event: EvidenceEvent; eventHash: string }>();

    expect(firstBody.event.previousEventHash).toBeUndefined();
    expect(secondBody.event.previousEventHash).toBe(firstBody.eventHash);
    expect(thirdBody.event.previousEventHash).toBe(secondBody.eventHash);

    const trace = await app.inject({ method: "GET", url: "/traces/trace-api-1" });
    expect(trace.json<{ events: EvidenceEvent[] }>().events.map((item) => item.eventId)).toEqual([
      "evt-1",
      "evt-2",
      "evt-3",
    ]);

    await app.close();
  });

  test("returns trace events, graph, merkle root, and pending anchor response", async () => {
    const app = await buildEvidenceServer({
      repository: createInMemoryEvidenceRepository(),
      anchorClient: null,
      logger: false,
    });

    await app.inject({ method: "POST", url: "/events", payload: event("evt-1") });
    await app.inject({ method: "POST", url: "/events", payload: event("evt-2") });

    const trace = await app.inject({ method: "GET", url: "/traces/trace-api-1" });
    const graph = await app.inject({ method: "GET", url: "/traces/trace-api-1/graph" });
    const merkle = await app.inject({ method: "POST", url: "/traces/trace-api-1/merkle" });
    const anchor = await app.inject({ method: "POST", url: "/traces/trace-api-1/anchor" });

    expect(trace.statusCode).toBe(200);
    expect(trace.json<{ events: EvidenceEvent[] }>().events).toHaveLength(2);
    expect(graph.json<{ nodes: unknown[]; edges: unknown[] }>().nodes).toHaveLength(2);
    expect(graph.json<{ nodes: unknown[]; edges: unknown[] }>().edges).toHaveLength(1);
    expect(merkle.json<{ merkleRoot: string }>().merkleRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(anchor.statusCode).toBe(202);
    expect(anchor.json<{ status: string }>().status).toBe("PENDING_CONTRACT");

    await app.close();
  });
});
