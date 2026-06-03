import { describe, expect, test } from "bun:test";
import { deriveSettlementNonce, settlementParamsFromExact } from "@clb-acel/clb-core";
import { PredicateViolationError, createPredicateGuard } from "@clb-acel/predicate-adapter";
import { keccak256 } from "viem";
import { createIntent, runDelegated } from "../src/flow";

const NOW_MS = Date.parse("2026-05-30T05:00:00.000Z");

describe("runDelegated (Mode B)", () => {
  test("produces a delegated trace that passes all rules including R17", async () => {
    const intent = createIntent({ token: "XYZ", intentId: "demo-mode-b" });
    const trace = await runDelegated(intent, { nowMs: NOW_MS });

    expect(trace.mode).toBe("MODE_B_PREDICATE");
    expect(trace.verification.result.status).toBe("PASS");
    expect(trace.verification.result.failedRules).toEqual([]);
    expect(trace.verification.outcomes.R17_PREDICATE_TRUE_FOR_MODE_B.ok).toBe(true);
  });

  test("uses an INTENT mandate linked to the predicate (no CART/PAYMENT)", async () => {
    const intent = createIntent({ token: "XYZ", intentId: "demo-mode-b" });
    const trace = await runDelegated(intent, { nowMs: NOW_MS });

    expect(trace.mandate.type).toBe("INTENT");
    expect(trace.mandate.clbCommitment).toBeUndefined();
    expect(trace.mandate.constraints.predicateRef?.predicateId).toBe(trace.predicateDescriptor.predicateId);

    const objectTypes = trace.events.map((event) => event.objectType);
    expect(objectTypes).toContain("AP2_INTENT_MANDATE");
    expect(objectTypes).not.toContain("AP2_CART_MANDATE");
  });

  test("binds the nonce to C' and records guard authorization", async () => {
    const intent = createIntent({ token: "XYZ", intentId: "demo-mode-b" });
    const trace = await runDelegated(intent, { nowMs: NOW_MS });

    expect(trace.nonce).toBe(deriveSettlementNonce(trace.modeBCommitment));
    expect(trace.nonce).toBe(keccak256(trace.modeBCommitment));
    expect(trace.settlement.nonce).toBe(trace.nonce);
    expect(trace.guardResult.allowed).toBe(true);
    expect(trace.guardResult.commitment).toBe(trace.modeBCommitment);
  });

  test("is deterministic for a pinned clock", async () => {
    const intent = createIntent({ token: "XYZ", intentId: "demo-mode-b" });
    const first = await runDelegated(intent, { nowMs: NOW_MS });
    const second = await runDelegated(intent, { nowMs: NOW_MS });

    expect(first.modeBCommitment).toBe(second.modeBCommitment);
    expect(first.nonce).toBe(second.nonce);
    expect(first.merkleRoot).toBe(second.merkleRoot);
    // certificateHash intentionally embeds the verifier wall-clock `createdAt`,
    // so compare the deterministic bound commitment instead.
    expect(first.verification.certificate.clbCommitment).toBe(
      second.verification.certificate.clbCommitment,
    );
  });
});

describe("predicate guard prevention (P5)", () => {
  test("blocks an over-budget settlement before it can settle", async () => {
    const intent = createIntent({ token: "XYZ", intentId: "demo-mode-b" });
    const trace = await runDelegated(intent, { nowMs: NOW_MS });
    const guard = createPredicateGuard();

    const overBudget = { ...trace.concreteSettlement, value: "999.00" };
    const params = settlementParamsFromExact(overBudget, trace.payerAgent.agentId);

    await expect(
      guard.assertSettlementAllowed({
        predicate: trace.predicateDescriptor.predicate,
        params,
        commitment: {
          identityRef: {
            chainId: trace.payerAgent.chainId,
            registryAddr: trace.payerAgent.registryAddr,
            agentId: trace.payerAgent.agentId,
          },
          mandateDigest: trace.modeBCommitment,
          predicateId: trace.predicateDescriptor.predicateId,
          settlementParams: params,
          domain: { name: "CLB-ACEL", version: "0.1", chainId: trace.payerAgent.chainId },
        },
        now: new Date(NOW_MS),
      }),
    ).rejects.toBeInstanceOf(PredicateViolationError);
  });
});
