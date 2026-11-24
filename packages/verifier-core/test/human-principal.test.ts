import { describe, expect, it } from "bun:test";
import { issueMandate } from "@clb-acel/ap2-adapter";
import { computeCommitment, computeMandateDigest, deriveNonce } from "@clb-acel/clb-core";
import { signDeliveryBinding } from "@clb-acel/delivery-core";
import {
  TEST_KEYS,
  buildValidBundle,
  constraints,
  descriptor,
  domain,
  payerIdentity,
  shopperAddress,
} from "@clb-acel/attack-core";
import {
  buildPaymentAuthorization,
  createLocalFacilitator,
  signPaymentPayload,
} from "@clb-acel/x402-adapter";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTrace } from "../src";

const TRUSTED_PRINCIPAL = privateKeyToAccount(TEST_KEYS.userKey).address as Address;

// A key the verifier has never been told to trust. Hardhat default account #3.
const ATTACKER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;
const ATTACKER_PRINCIPAL = privateKeyToAccount(ATTACKER_KEY).address as Address;

describe("R5 — independently anchored human principal", () => {
  it("PASS: honest mandate signed by the trusted principal", async () => {
    const bundle = await buildValidBundle({ traceId: "hp-honest" });
    expect(bundle.mandate.humanPrincipal.toLowerCase()).toBe(TRUSTED_PRINCIPAL.toLowerCase());

    const { result, outcomes } = await verifyTrace(bundle, {
      expectedHumanPrincipal: TRUSTED_PRINCIPAL,
    });

    expect(outcomes.R5_MANDATE_SIGNATURE_VALID.ok).toBe(true);
    expect(result.status).toBe("PASS");
  });

  it("EXPLOIT: re-signed relaxed mandate with a new self-declared principal is rejected", async () => {
    const base = await buildValidBundle({ traceId: "hp-resign-honest" });

    // The attacker relaxes the cap, signs with their own key, and declares
    // themselves as humanPrincipal. C, nonce and receipt are all recomputed,
    // so every other rule still passes — only the independent anchor stops it.
    const settlementDescriptor = descriptor();
    const clb = { identityRef: payerIdentity, settlementDescriptor, domain };
    const newMandate = await issueMandate(ATTACKER_KEY, {
      type: "CART",
      humanPrincipal: ATTACKER_PRINCIPAL,
      authorizedAgent: payerIdentity,
      constraints: constraints({ maxAmount: "9.99" }),
      clb,
    });
    const nonce = deriveNonce(
      computeCommitment({
        identityRef: payerIdentity,
        mandateDigest: computeMandateDigest(newMandate),
        settlementDescriptor,
        domain,
      }),
    );
    const paymentPayload = await signPaymentPayload(
      TEST_KEYS.shopperKey,
      buildPaymentAuthorization({ from: shopperAddress, descriptor: settlementDescriptor, nonce }),
    );
    const receipt = await createLocalFacilitator().settle(paymentPayload);
    const exploited = {
      ...base,
      mandate: newMandate,
      paymentPayload,
      settlement: { ...receipt, settledAt: base.settlement.settledAt },
      report: {
        ...base.report,
        deliveryBinding: await signDeliveryBinding({
          settlementTxHash: receipt.txHash,
          reportHash: base.report.reportHash,
          merchantKey: TEST_KEYS.merchantKey,
        }),
      },
    };

    const { result, outcomes } = await verifyTrace(exploited, {
      expectedHumanPrincipal: TRUSTED_PRINCIPAL,
    });

    expect(outcomes.R5_MANDATE_SIGNATURE_VALID.ok).toBe(false);
    expect(result.failedRules).toContain("R5_MANDATE_SIGNATURE_VALID");
    expect(result.status).toBe("FAIL");
  });

  it("tampering with a signed mandate constraint fails R5", async () => {
    const bundle = await buildValidBundle({ traceId: "hp-tampered-constraint" });
    // Post-signing edit: digest changes => C mismatch and signature no longer verifies.
    const tampered = {
      ...bundle,
      mandate: {
        ...bundle.mandate,
        constraints: { ...bundle.mandate.constraints, maxAmount: "999.00" },
      },
    };

    const { result, outcomes } = await verifyTrace(tampered, {
      expectedHumanPrincipal: TRUSTED_PRINCIPAL,
    });

    expect(outcomes.R5_MANDATE_SIGNATURE_VALID.ok).toBe(false);
    expect(result.status).toBe("FAIL");
  });

  it("fails closed when no independent anchor is supplied (no permissive default)", async () => {
    const bundle = await buildValidBundle({ traceId: "hp-no-anchor" });

    const { result, outcomes } = await verifyTrace(bundle);

    expect(outcomes.R5_MANDATE_SIGNATURE_VALID.ok).toBe(false);
    expect(result.failedRules).toContain("R5_MANDATE_SIGNATURE_VALID");
    expect(result.status).toBe("FAIL");
  });
});
