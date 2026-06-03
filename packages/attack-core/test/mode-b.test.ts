import { describe, expect, test } from "bun:test";
import { verifyTrace } from "@clb-acel/verifier-core";
import {
  MODE_B_PREDICATE_FIXTURES,
  buildValidModeBBundle,
  runAllPredicateAttacks,
  runPredicateAttack,
  type PredicateAttackId,
} from "../src/mode-b";

describe("buildValidModeBBundle", () => {
  test("produces a PASS Mode B trace with R17 ok", async () => {
    const { bundle } = await buildValidModeBBundle();
    const { result, outcomes } = await verifyTrace(bundle);
    expect(result.status).toBe("PASS");
    expect(outcomes.R17_PREDICATE_TRUE_FOR_MODE_B.ok).toBe(true);
  });
});

describe("predicate attack fixtures (P5)", () => {
  test("happy path passes with no guard prevention", async () => {
    const run = await runPredicateAttack("PREDICATE_HAPPY_PATH");
    expect(run.matched).toBe(true);
    expect(run.verification.result.status).toBe("PASS");
    expect(run.guardPrevented).toBe(false);
    expect(run.preventionLayer).toBe("none");
  });

  test("anatomy contrasts the signed predicate with the agent attempt", async () => {
    const happy = await runPredicateAttack("PREDICATE_HAPPY_PATH");
    expect(happy.label).toBe("Agent stays within your limits");
    expect(happy.anatomy.summary.length).toBeGreaterThan(0);
    expect(happy.anatomy.steps.length).toBeGreaterThan(0);
    // Happy path is within the rules, so nothing changed.
    expect(happy.anatomy.mutations).toHaveLength(0);
    expect(happy.anatomy.authorizedTrace.guardWouldAllow).toBe(true);
    expect(happy.anatomy.violatedTrace.guardWouldAllow).toBe(true);

    const amount = await runPredicateAttack("PREDICATE_AMOUNT_VIOLATION");
    expect(amount.anatomy.mutations.length).toBeGreaterThan(0);
    expect(amount.anatomy.mutations[0]!.path).toBe("settlement.value");
    expect(amount.anatomy.authorizedTrace.guardWouldAllow).toBe(true);
    expect(amount.anatomy.violatedTrace.guardWouldAllow).toBe(false);
    expect(amount.anatomy.detectedBy).toContain("predicate-guard");
  });

  const violations: Array<[PredicateAttackId, string]> = [
    ["PREDICATE_PAYEE_VIOLATION", "R12_PAYEE_MATCHES_CHECKOUT_OR_TASK"],
    ["PREDICATE_AMOUNT_VIOLATION", "R11_AMOUNT_WITHIN_MANDATE"],
    ["PREDICATE_ASSET_VIOLATION", "R13_ASSET_ALLOWED"],
    ["PREDICATE_EXPIRED", "R17_PREDICATE_TRUE_FOR_MODE_B"],
  ];

  for (const [id, redundantRule] of violations) {
    test(`${id} fails R17 and is prevented at the guard`, async () => {
      const run = await runPredicateAttack(id);
      expect(run.matched).toBe(true);
      expect(run.verification.result.status).toBe("FAIL");
      expect(run.verification.result.failedRules).toContain("R17_PREDICATE_TRUE_FOR_MODE_B");
      expect(run.verification.result.failedRules).toContain(redundantRule);
      expect(run.guardPrevented).toBe(true);
      expect(run.preventionLayer).toBe("predicate-guard");
      // R6/R8 binding rules still hold even though the concrete params break π.
      expect(run.verification.result.failedRules).not.toContain("R6_CLB_COMMITMENT_RECOMPUTES");
      expect(run.verification.result.failedRules).not.toContain("R8_PAYMENT_NONCE_EQUALS_HASH_C");
    });
  }

  test("runAllPredicateAttacks builds a 5-row P5 matrix", async () => {
    const benchmark = await runAllPredicateAttacks();
    expect(benchmark.results).toHaveLength(MODE_B_PREDICATE_FIXTURES.length);
    expect(Object.keys(benchmark.matrix)).toHaveLength(5);
    expect(benchmark.results.every((r) => r.matched)).toBe(true);
    // B0/B1 allow every violation; B3 prevents them.
    const payee = benchmark.matrix.PREDICATE_PAYEE_VIOLATION;
    expect(payee.B0.prevented).toBe(false);
    expect(payee.B3.prevented).toBe(true);
  });
});
