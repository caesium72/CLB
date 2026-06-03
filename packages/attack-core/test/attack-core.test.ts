import { describe, expect, test } from "bun:test";
import { ATTACK_FIXTURES, buildBaselineMatrix, runAllAttacks, runAttack } from "../src/index";

describe("attack-core", () => {
  test("runs each Phase 3 fixture and matches expected detection", async () => {
    for (const fixture of ATTACK_FIXTURES) {
      const result = await runAttack(fixture.id, { nowMs: 1_700_000_000_000 });
      expect(result.matched, fixture.id).toBe(true);
      expect(result.metrics.verifyLatencyMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.eventCount).toBeGreaterThan(0);
      expect(result.metrics.storageBytesEstimate).toBeGreaterThan(0);
      expect(result.anatomy.summary.length, fixture.id).toBeGreaterThan(0);
      expect(result.anatomy.steps.length, fixture.id).toBeGreaterThan(0);
      expect(result.anatomy.mutations.length, fixture.id).toBeGreaterThan(0);
      expect(result.anatomy.detectedBy.length, fixture.id).toBeGreaterThan(0);
      expect(result.anatomy.evidenceFocus.length, fixture.id).toBeGreaterThan(0);
      expect(Object.keys(result.baselineComparison), fixture.id).toEqual(["B0", "B1", "B2", "B3"]);
    }
  });

  test("anatomy summaries expose the mutated surface for non-settlement attacks", async () => {
    const identitySwap = await runAttack("AGENT_IDENTITY_SWAP", { nowMs: 1_700_000_000_000 });
    expect(identitySwap.anatomy.honestTrace.payerAgent.authorizedPaymentKeys).not.toEqual(
      identitySwap.anatomy.attackedTrace.payerAgent.authorizedPaymentKeys,
    );

    const replay = await runAttack("MANDATE_REPLAY", { nowMs: 1_700_000_000_000 });
    expect(replay.anatomy.honestTrace.nonceReplayAttempt).toBe(false);
    expect(replay.anatomy.attackedTrace.nonceReplayAttempt).toBe(true);

    const delivery = await runAttack("PAYMENT_WITHOUT_DELIVERY", { nowMs: 1_700_000_000_000 });
    expect(delivery.anatomy.honestTrace.report.reportHash).not.toBe(
      delivery.anatomy.attackedTrace.report.reportHash,
    );

    const feedback = await runAttack("FAKE_FEEDBACK", { nowMs: 1_700_000_000_000 });
    expect(feedback.anatomy.honestTrace.evidence.eventCount).toBeLessThan(
      feedback.anatomy.attackedTrace.evidence.eventCount,
    );

    const promptInjection = await runAttack("PROMPT_INJECTION_SELECTION", {
      nowMs: 1_700_000_000_000,
    });
    expect(promptInjection.anatomy.attackedTrace.evidence.selectedPayee).toBeTruthy();
  });

  test("different run seeds produce different live-demo scenarios", async () => {
    const first = await runAttack("AMOUNT_ESCALATION", { nowMs: 1_700_000_000_000 });
    const second = await runAttack("AMOUNT_ESCALATION", { nowMs: 1_700_000_123_456 });

    expect(first.matched).toBe(true);
    expect(second.matched).toBe(true);
    expect(first.scenario).not.toEqual(second.scenario);
    expect(first.anatomy.attackedTrace.report.inputDataHash).not.toBe(
      second.anatomy.attackedTrace.report.inputDataHash,
    );
  });

  test("builds a 10 x 4 baseline matrix with live B3 results", async () => {
    const benchmark = await runAllAttacks({ nowMs: 1_700_000_000_000 });
    const matrix = buildBaselineMatrix(benchmark.results, ATTACK_FIXTURES);

    expect(Object.keys(matrix)).toHaveLength(10);
    for (const fixture of ATTACK_FIXTURES) {
      expect(Object.keys(matrix[fixture.id])).toEqual(["B0", "B1", "B2", "B3"]);
      expect(matrix[fixture.id].B3.detected).toBe(true);
    }
    expect(matrix.MANDATE_REPLAY.B3.prevented).toBe(true);
  });
});
