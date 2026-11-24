import { describe, expect, test } from "bun:test";
import {
  CAUSAL_SCENARIOS,
  buildHonestCausalInput,
  certificateById,
  runCausalScenarios,
} from "../src/causal-delegation";
import { computeCausalExecution, verifyCausalExecution } from "@clb-acel/evidence-core";
import { attackerAddress, merchantAddress } from "../src/fixtures";

describe("CDEP attack fixtures", () => {
  test("honest DAG passes with no findings and binds every certificate", () => {
    const input = buildHonestCausalInput();
    const result = verifyCausalExecution(input);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.pathExecCommitments).toHaveLength(3);
    for (const certificate of input.certificates) {
      expect(certificate.cExec).toBe(computeCausalExecution(certificate));
    }
  });

  test("each attack fails with its specific expected reason code(s)", () => {
    for (const scenario of CAUSAL_SCENARIOS.filter(({ id }) => id !== "HONEST_DAG")) {
      const result = verifyCausalExecution(scenario.input);
      const codes = result.findings.map((finding) => finding.code);
      expect(result.ok, `${scenario.id} must fail`).toBe(false);
      for (const expected of scenario.expectedFindingCodes) {
        expect(codes, `${scenario.id} must report ${expected}`).toContain(expected);
      }
    }
  });

  test("intermediate-agent substitution is detected on the authority edge, not by a false hash claim", () => {
    const attack = CAUSAL_SCENARIOS.find(({ id }) => id === "SUBSTITUTED_INTERMEDIATE_AGENT")!;
    const codes = verifyCausalExecution(attack.input).findings.map((finding) => finding.code);
    expect(codes).toContain("PARENT_CHILD_AUTHORITY_MISMATCH");
    expect(codes).not.toContain("CAUSAL_COMMITMENT_MISMATCH");
  });

  test("branch substitution is detected and settlement payee lineage is enforced", () => {
    const branch = CAUSAL_SCENARIOS.find(({ id }) => id === "SUBSTITUTED_BRANCH")!;
    const branchCodes = verifyCausalExecution(branch.input).findings.map((finding) => finding.code);
    expect(branchCodes).toContain("BRANCH_SUBSTITUTION_DETECTED");
    expect(branchCodes).toContain("CROSS_AGENT_ATTRIBUTION_FAILED");

    const payee = CAUSAL_SCENARIOS.find(({ id }) => id === "SUBSTITUTED_PAYEE")!;
    const result = verifyCausalExecution(payee.input);
    expect(
      result.findings.some(
        (finding) =>
          finding.code === "PAYMENT_EXECUTION_LINEAGE_BROKEN" && finding.detail.includes("payTo"),
      ),
    ).toBe(true);
    expect(certificateById(payee.input, "cert-terminal")!.child.authorizedPaymentKeys).toContain(merchantAddress);
    expect(payee.input.settlement.payTo).toBe(attackerAddress);
  });

  test("deterministic summary: 1 honest pass, 6 attacks detected, no false result", () => {
    const results = runCausalScenarios();
    const honest = results.filter(({ id }) => id === "HONEST_DAG");
    const attacks = results.filter(({ id }) => id !== "HONEST_DAG");
    expect(honest).toHaveLength(1);
    expect(honest[0]!.ok).toBe(true);
    expect(honest[0]!.detected).toBe(true);
    expect(attacks).toHaveLength(6);
    expect(attacks.every(({ ok, detected }) => !ok && detected)).toBe(true);
  });
});
