import { describe, expect, test } from "bun:test";
import {
  attackerAddress,
  appendEvidenceEvent,
  buildValidBundle,
  checkPromptInjection,
  merchantAddress,
} from "@clb-acel/attack-core";
import type { EvidenceEvent } from "@clb-acel/schemas";
import { auditEvidenceEventSet, linkEvidenceEvents } from "../src/index";

/**
 * Reviewer #4, Comment 2 — trust-model evidence for two claims:
 *  1. A hash chain/Merkle root only binds events to each other; the structural
 *     completeness helper closes the naive omission/duplicate case, not the
 *     self-consistent-rewrite case (that needs a trusted anchor — see the
 *     verifier-core trust-model test).
 *  2. Prompt-injection detection is a constraint-compliance check on the
 *     RECORDED SELECTION EFFECT, not NLP analysis of the prompt text.
 *     NOTE the codebase convention: AuditCheckResult.ok === true means the
 *     injection was DETECTED, not that the trace is safe.
 */

const SIG = `0x${"1".repeat(130)}`;

function event(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    traceId: "trace-trust-model",
    eventId: "evt-1",
    protocol: "USER",
    objectType: "USER_INTENT",
    actor: "orchestrator",
    timestamp: "2026-05-30T05:00:00.000Z",
    objectHash: `0x${"a".repeat(64)}`,
    publicFields: { objectType: "USER_INTENT" },
    signature: SIG,
    ...overrides,
  };
}

function threeEvents(): EvidenceEvent[] {
  return linkEvidenceEvents([
    event({ eventId: "evt-1", objectType: "USER_INTENT", protocol: "USER" }),
    event({
      eventId: "evt-2",
      objectType: "X402_PAYMENT_PAYLOAD",
      protocol: "X402",
      objectHash: `0x${"b".repeat(64)}`,
    }),
    event({
      eventId: "evt-3",
      objectType: "CHAIN_SETTLEMENT",
      protocol: "CHAIN",
      objectHash: `0x${"c".repeat(64)}`,
    }),
  ]);
}

describe("structural event-set completeness (auditEvidenceEventSet)", () => {
  test("accepts a unique, complete event set", () => {
    const result = auditEvidenceEventSet(threeEvents(), [
      "USER_INTENT",
      "CHAIN_SETTLEMENT",
    ]);
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  test("detects an omitted required object type", () => {
    const events = threeEvents().filter((item) => item.objectType !== "CHAIN_SETTLEMENT");
    const result = auditEvidenceEventSet(events, ["USER_INTENT", "CHAIN_SETTLEMENT"]);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("MISSING_REQUIRED_OBJECT_TYPE:CHAIN_SETTLEMENT");
  });

  test("detects duplicate event ids", () => {
    const events = threeEvents();
    events[2] = { ...events[2]!, eventId: "evt-1" };
    const result = auditEvidenceEventSet(events, ["USER_INTENT"]);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("DUPLICATE_EVENT_ID:evt-1");
  });

  test("rejects an empty event set", () => {
    const result = auditEvidenceEventSet([]);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("NO_EVENTS");
  });

  test("LIMIT: fabricated placeholder events satisfy the type check", () => {
    // The helper checks presence, not authenticity. An attacker who controls
    // the event set can insert a bogus event of each required type and pass.
    // Only an externally anchored Merkle root detects that (verifier-core test).
    const events = threeEvents();
    events.push(
      event({
        eventId: "evt-fabricated",
        objectType: "VERIFICATION_CERTIFICATE",
        protocol: "VERIFIER",
        actor: "attacker",
      }),
    );
    expect(auditEvidenceEventSet(events, ["VERIFICATION_CERTIFICATE"]).ok).toBe(true);
  });
});

describe("prompt-injection detection (checkPromptInjection)", () => {
  function selection(selectedPayee: unknown): Omit<EvidenceEvent, "previousEventHash"> {
    return {
      traceId: "trace-trust-model",
      eventId: "evt-selection-1",
      protocol: "ERC8004",
      objectType: "ERC8004_AGENT_SELECTION",
      actor: "shopping-agent-001",
      timestamp: "2026-05-30T04:59:55.000Z",
      objectHash: `0x${"9".repeat(64)}`,
      publicFields: { selectedPayee, reason: "recommended by discovery" },
      signature: SIG,
    };
  }

  test("missing selection event: no finding", async () => {
    const base = await buildValidBundle({ traceId: "pi-missing" });
    expect(base.events.some((e) => e.objectType === "ERC8004_AGENT_SELECTION")).toBe(false);
    const result = checkPromptInjection(base);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("No selectedPayee");
  });

  test("selected payee inside mandate allowlist: no finding", async () => {
    const base = await buildValidBundle({ traceId: "pi-inside" });
    const bundle = appendEvidenceEvent(base, selection(merchantAddress));
    const result = checkPromptInjection(bundle);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("inside allowedPayees");
  });

  test("selected payee outside allowlist: finding (injection effect detected)", async () => {
    const base = await buildValidBundle({ traceId: "pi-outside" });
    const bundle = appendEvidenceEvent(base, selection(attackerAddress));
    const result = checkPromptInjection(bundle);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("outside allowedPayees");
  });

  test("address comparison is checksum-insensitive", async () => {
    const base = await buildValidBundle({ traceId: "pi-case" });
    // Lowercase form of the allowlisted merchant must still be recognised as
    // inside the allowlist: viem.getAddress() checksums both sides.
    const inside = checkPromptInjection(appendEvidenceEvent(base, selection(merchantAddress.toLowerCase())));
    expect(inside.ok).toBe(false);

    const outside = checkPromptInjection(
      appendEvidenceEvent(base, selection(attackerAddress.toLowerCase())),
    );
    expect(outside.ok).toBe(true);
  });

  test("malformed selected address is treated as non-matching and flagged", async () => {
    const base = await buildValidBundle({ traceId: "pi-malformed" });
    const result = checkPromptInjection(appendEvidenceEvent(base, selection("not-an-address")));
    // getAddress() throws for malformed input -> sameAddress() returns false,
    // so no allowlist entry matches and the audit check reports a finding.
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("outside allowedPayees");
  });

  test("malformed allowlist entry does not suppress a valid selection finding", async () => {
    const base = await buildValidBundle({ traceId: "pi-bad-allowlist" });
    const bundle = appendEvidenceEvent(base, selection(merchantAddress));
    bundle.mandate = {
      ...bundle.mandate,
      constraints: { ...bundle.mandate.constraints, allowedPayees: ["not-an-address"] },
    };
    const result = checkPromptInjection(bundle);
    expect(result.ok).toBe(true);
  });
});
