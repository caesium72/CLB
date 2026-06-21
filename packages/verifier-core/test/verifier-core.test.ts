import { describe, expect, test } from "bun:test";
import {
  attackerAddress,
  buildValidBundle,
  constraints,
  descriptor,
  merchantAddress,
  payerAgent,
} from "@clb-acel/attack-core";
import { verifyTrace } from "../src/index";

describe("verifyTrace (Mode A)", () => {
  test("a normal trace passes all rules R1-R17", async () => {
    const { result, certificate, outcomes } = await verifyTrace(await buildValidBundle());

    expect(result.status).toBe("PASS");
    expect(result.failedRules).toEqual([]);
    expect(certificate.certificateHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(certificate.rulesChecked).toHaveLength(17);
    // R17 passes vacuously in Mode A.
    expect(outcomes.R17_PREDICATE_TRUE_FOR_MODE_B.ok).toBe(true);
  });

  test("AMOUNT_ESCALATION fails R11 while commitment still recomputes", async () => {
    const bundle = await buildValidBundle({
      settlementDescriptor: descriptor({ value: "3.00" }),
      mandateConstraints: constraints({ maxAmount: "2.00" }),
    });

    const { result } = await verifyTrace(bundle);
    expect(result.status).toBe("FAIL");
    expect(result.failedRules).toContain("R11_AMOUNT_WITHIN_MANDATE");
    expect(result.failedRules).not.toContain("R6_CLB_COMMITMENT_RECOMPUTES");
  });

  test("PAYEE_SUBSTITUTION fails R12", async () => {
    const bundle = await buildValidBundle({
      settlementDescriptor: descriptor({ payTo: attackerAddress }),
    });

    const { result } = await verifyTrace(bundle);
    expect(result.status).toBe("FAIL");
    expect(result.failedRules).toContain("R12_PAYEE_MATCHES_CHECKOUT_OR_TASK");
  });

  test("CHAIN_TRANSPLANT fails R10 when settlement chain differs", async () => {
    const bundle = await buildValidBundle();
    bundle.settlement = { ...bundle.settlement, chainId: 1 };

    const { result } = await verifyTrace(bundle);
    expect(result.status).toBe("FAIL");
    expect(result.failedRules).toContain("R10_CHAIN_DOMAIN_MATCHES");
  });

  test("AGENT_IDENTITY_SWAP fails R4 when payer key is unauthorized", async () => {
    const bundle = await buildValidBundle();
    bundle.payerAgent = { ...payerAgent, authorizedPaymentKeys: [merchantAddress] };

    const { result } = await verifyTrace(bundle);
    expect(result.status).toBe("FAIL");
    expect(result.failedRules).toContain("R4_AGENT_PAYMENT_KEY_AUTHORIZED");
  });

  test("TAMPERED_EVIDENCE fails R1 when the hash chain is broken", async () => {
    const bundle = await buildValidBundle();
    const [first, second, ...rest] = bundle.events;
    bundle.events = [
      first!,
      { ...second!, publicFields: { tampered: true } },
      ...rest,
    ];

    const { result } = await verifyTrace(bundle);
    expect(result.status).toBe("FAIL");
    expect(result.failedRules).toContain("R1_HASH_CHAIN_INTACT");
  });

  test("MANDATE_REPLAY fails R9 when replay flag is present", async () => {
    const bundle = await buildValidBundle();
    bundle.nonceReplayAttempt = true;

    const { result, outcomes } = await verifyTrace(bundle);
    expect(result.status).toBe("FAIL");
    expect(result.failedRules).toContain("R9_NONCE_CONSUMED_EXACTLY_ONCE");
    expect(outcomes.R9_NONCE_CONSUMED_EXACTLY_ONCE.detail).toBe("Nonce replay detected");
  });

  test("CART_OR_TASK_SWITCH fails R15 when taskHash differs from report input", async () => {
    const bundle = await buildValidBundle({
      mandateConstraints: constraints({ taskHash: `0x${"b".repeat(64)}` }),
    });

    const { result } = await verifyTrace(bundle);
    expect(result.status).toBe("FAIL");
    expect(result.failedRules).toContain("R15_TASK_HASH_MATCHES");
  });
});
