import { describe, expect, test } from "bun:test";
import { issueMandate, verifyMandate } from "@clb-acel/ap2-adapter";
import { computeCommitment, computeMandateDigest, deriveNonce } from "@clb-acel/clb-core";
import type { SettlementDescriptorExact } from "@clb-acel/schemas";
import {
  buildPaymentAuthorization,
  signPaymentPayload,
  verifyPaymentPayload,
} from "@clb-acel/x402-adapter";
import { privateKeyToAccount } from "viem/accounts";
import {
  TEST_KEYS,
  attackerAddress,
  constraints,
  descriptor,
  domain,
  payerIdentity,
  shopperAddress,
} from "../src/fixtures";
import {
  PRE_SETTLEMENT_SCENARIOS,
  classifyOutcome,
  runModeAPreSettlementScenarios,
  runPreSettlementScenarios,
  type PreSettlementResult,
} from "../src/presettlement";

const LEGACY_MODE_B_IDS = [
  "MALICIOUS_MERCHANT_PAYEE_SUBSTITUTION",
  "MALICIOUS_MERCHANT_REVOKED_IDENTITY",
  "COMPROMISED_AGENT_AMOUNT_ESCALATION",
  "COMPROMISED_AGENT_ASSET_SWITCH",
  "COMPROMISED_AGENT_CHAIN_SWITCH",
  "COMPROMISED_AGENT_TASK_SUBSTITUTION",
  "EXPIRED_AUTHORIZATION",
  "MULTI_STEP_SELECTION_THEN_SUBSTITUTION",
  "MULTI_STEP_ESCALATION_THEN_REPLAY",
] as const;

const MODE_A_IDS = [
  "MODE_A_PAYEE_SUBSTITUTION",
  "MODE_A_AMOUNT_ESCALATION",
  "MODE_A_HONEST_AUTHORIZATION",
] as const;

function byId(results: PreSettlementResult[], id: string): PreSettlementResult {
  const found = results.find((result) => result.id === id);
  if (!found) throw new Error(`Missing scenario result: ${id}`);
  return found;
}

describe("Reviewer #4 Comment 3 — Mode A pre-settlement authorization gate", () => {
  test("catalogue adds Mode A scenarios without changing the nine Mode B scenarios", () => {
    expect(PRE_SETTLEMENT_SCENARIOS).toHaveLength(12);
    expect(PRE_SETTLEMENT_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      ...LEGACY_MODE_B_IDS,
      ...MODE_A_IDS,
    ]);
    // Existing Mode B scenarios stay Mode B; the new ones are explicitly tagged.
    for (const scenario of PRE_SETTLEMENT_SCENARIOS.slice(0, 9)) {
      expect(scenario.kind === "mode-a", scenario.id).toBe(false);
    }
    for (const scenario of PRE_SETTLEMENT_SCENARIOS.slice(9)) {
      expect(scenario.kind, scenario.id).toBe("mode-a");
    }
  });

  test("Mode A payee substitution is PREVENTED before settlement, with no receipt", async () => {
    const result = byId(await runModeAPreSettlementScenarios(), "MODE_A_PAYEE_SUBSTITUTION");

    expect(result.guardAllowed).toBe(false);
    expect(result.settlementAttempted).toBe(false);
    expect(result.receiptIssued).toBe(false);
    expect(result.prevented).toBe(true);
    expect(classifyOutcome(result)).toBe("PREVENTION");
    expect(result.guardError).toBeTruthy();
    // The gate fails on the commitment binding AND the payment signature, not
    // on a post-settlement verifier rule.
    expect(result.predicateViolations).toContain("MANDATE_CLB_COMMITMENT_MISMATCH");
    expect(result.predicateViolations).toContain("NONCE_NOT_H_OF_RECOMPUTED_C");
    expect(result.predicateViolations).toContain("PAYMENT_SIGNATURE_INVALID");
    expect(result.notes.join(" ")).toContain("before any settlement call");
  });

  test("Mode A amount escalation is PREVENTED before settlement, with no receipt", async () => {
    const result = byId(await runModeAPreSettlementScenarios(), "MODE_A_AMOUNT_ESCALATION");

    expect(result.guardAllowed).toBe(false);
    expect(result.settlementAttempted).toBe(false);
    expect(result.receiptIssued).toBe(false);
    expect(result.prevented).toBe(true);
    expect(classifyOutcome(result)).toBe("PREVENTION");
    expect(result.guardError).toBeTruthy();
    expect(result.predicateViolations).toContain("MANDATE_CLB_COMMITMENT_MISMATCH");
    expect(result.predicateViolations).toContain("NONCE_NOT_H_OF_RECOMPUTED_C");
    expect(result.predicateViolations).toContain("PAYMENT_SIGNATURE_INVALID");
    expect(result.notes.join(" ")).toContain("before any settlement call");
  });

  test("C cryptographically binds payee and amount: substitution breaks the human signature and nonce", async () => {
    const approved = descriptor();
    const humanPrincipal = privateKeyToAccount(TEST_KEYS.userKey).address;
    const mandate = await issueMandate(TEST_KEYS.userKey, {
      type: "CART",
      authorizedAgent: payerIdentity,
      constraints: constraints(),
      clb: { identityRef: payerIdentity, settlementDescriptor: approved, domain },
    });

    const clbInput = (settlementDescriptor: SettlementDescriptorExact) => ({
      identityRef: payerIdentity,
      mandateDigest: computeMandateDigest(mandate),
      settlementDescriptor,
      domain,
    });
    const honestC = computeCommitment(clbInput(approved));
    const honestNonce = deriveNonce(honestC);

    const attackedDescriptors: Array<[string, SettlementDescriptorExact]> = [
      ["payee substitution", { ...approved, payTo: attackerAddress }],
      ["amount escalation", { ...approved, value: "9.99" }],
    ];

    for (const [label, attacked] of attackedDescriptors) {
      const attackedC = computeCommitment(clbInput(attacked));
      expect(attackedC, label).not.toBe(honestC);
      expect(deriveNonce(attackedC), label).not.toBe(honestNonce);

      // The human signed C over the approved descriptor; recomputing C from the
      // substituted fields breaks both the commitment and the EIP-712 signature.
      const verification = await verifyMandate(mandate, {
        clb: { identityRef: payerIdentity, settlementDescriptor: attacked, domain },
        expectedSigner: humanPrincipal,
      });
      expect(verification.valid, label).toBe(false);
      expect(verification.reasons, label).toContain("CLB_COMMITMENT_MISMATCH");
      expect(verification.reasons, label).toContain("MANDATE_SIGNATURE_INVALID");
    }

    const honestVerification = await verifyMandate(mandate, {
      clb: { identityRef: payerIdentity, settlementDescriptor: approved, domain },
      expectedSigner: humanPrincipal,
    });
    expect(honestVerification.valid).toBe(true);
    expect(honestVerification.clbCommitment).toBe(honestC);

    // Mutating only the authorization fields preserves the stale nonce and
    // invalidates the payer's EIP-712 signature over that authorization.
    const auth = buildPaymentAuthorization({
      from: shopperAddress,
      descriptor: approved,
      nonce: honestNonce,
    });
    const payload = await signPaymentPayload(TEST_KEYS.shopperKey, auth);
    expect(await verifyPaymentPayload(payload)).toBe(true);
    expect(
      await verifyPaymentPayload({
        ...payload,
        authorization: { ...payload.authorization, to: attackerAddress },
      }),
    ).toBe(false);
    expect(
      await verifyPaymentPayload({
        ...payload,
        authorization: { ...payload.authorization, value: "9.99" },
      }),
    ).toBe(false);
  });

  test("honest authorization passes the gate and settles", async () => {
    const result = byId(
      await runModeAPreSettlementScenarios(),
      "MODE_A_HONEST_AUTHORIZATION",
    );

    expect(result.guardAllowed).toBe(true);
    expect(result.settlementAttempted).toBe(true);
    expect(result.receiptIssued).toBe(true);
    expect(result.prevented).toBe(false);
    expect(result.predicateViolations).toEqual([]);
    expect(result.notes.join(" ")).toContain("settlement completed");
  });

  test("replay remains prevented and the legacy nine-scenario runner is unchanged", async () => {
    const legacy = await runPreSettlementScenarios();
    expect(legacy).toHaveLength(9);
    for (const result of legacy) {
      expect(result.prevented, result.id).toBe(true);
      expect(result.receiptIssued, result.id).toBe(false);
    }

    const replay = byId(legacy, "MULTI_STEP_ESCALATION_THEN_REPLAY");
    expect(replay.guardAllowed).toBe(true);
    expect(replay.receiptIssued).toBe(false);
    expect(replay.prevented).toBe(true);
    expect(classifyOutcome(replay)).toBe("PREVENTION");
    expect(replay.predicateViolations).toContain("NONCE_ALREADY_CONSUMED");
  });

  test("every attacked Mode A result classifies as PREVENTION, never DETECTION", async () => {
    const results = await runModeAPreSettlementScenarios();
    for (const id of MODE_A_IDS.slice(0, 2)) {
      const result = byId(results, id);
      expect(classifyOutcome(result), id).toBe("PREVENTION");
      expect(classifyOutcome(result), id).not.toBe("DETECTION");
    }
  });
});
