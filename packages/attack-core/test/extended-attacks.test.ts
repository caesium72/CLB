import { describe, expect, test } from "bun:test";
import { issueMandate, verifyMandate } from "@clb-acel/ap2-adapter";
import {
  computeCommitment,
  computeMandateDigest,
  computeModeBSettlementCommitment,
  deriveNonce,
  deriveSettlementNonce,
} from "@clb-acel/clb-core";
import { signDeliveryBinding } from "@clb-acel/delivery-core";
import {
  createPredicateGuard,
  PredicateViolationError,
  SettlementNonceMismatchError,
  type GuardSettlementInput,
} from "@clb-acel/predicate-adapter";
import type { Mandate, SettlementDescriptorExact, SpendingPredicate } from "@clb-acel/schemas";
import { verifyTrace, type TraceBundle, type VerifyTraceOutput } from "@clb-acel/verifier-core";
import {
  buildPaymentAuthorization,
  createLocalFacilitator,
  signPaymentPayload,
  type PaymentPayload,
} from "@clb-acel/x402-adapter";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  TEST_KEYS,
  attackerAddress,
  buildValidBundle,
  constraints,
  descriptor,
  domain,
  markReplayAttempt,
  merchantAddress,
  payerIdentity,
  shopperAddress,
} from "../src/fixtures";
import {
  buildValidModeBBundle,
  defaultConcrete,
  defaultPredicate,
  draftModeBPayment,
} from "../src/mode-b";

// --- Outcome classification (inline: no production src touched) ------------
// Words are kept deliberately distinct. DETECTION means a rule/audit flagged
// an already-issued settlement receipt; PREVENTION means no receipt was ever
// issued because a guard or facilitator rejected the attempt first.

type OutcomeClass =
  | "PREVENTION"
  | "DETECTION"
  | "ACCOUNTABILITY"
  | "EXPLOITED"
  | "NOT_APPLICABLE";

type Observed = {
  prevented: boolean;
  detected: boolean;
  /** Certificate binds traceId, settlement tx and evidence root to real signatures. */
  attributable: boolean;
  /** The attacker reached its objective despite the evaluated controls. */
  exploited?: boolean;
};

function classify(observed: Observed): OutcomeClass[] {
  const classes: OutcomeClass[] = [];
  if (observed.exploited === true) classes.push("EXPLOITED");
  if (observed.prevented) classes.push("PREVENTION");
  if (observed.detected) classes.push("DETECTION");
  if (observed.attributable) classes.push("ACCOUNTABILITY");
  return classes.length === 0 ? ["NOT_APPLICABLE"] : classes;
}

function certificateAttribution(bundle: TraceBundle, verification: VerifyTraceOutput): boolean {
  const { certificate } = verification;
  return (
    /^0x[0-9a-fA-F]{64}$/u.test(certificate.certificateHash) &&
    certificate.settlementTxHash === bundle.settlement.txHash &&
    certificate.traceMerkleRoot === bundle.merkleRoot &&
    /^0x[0-9a-fA-F]+$/u.test(bundle.mandate.signature) &&
    /^0x[0-9a-fA-F]+$/u.test(bundle.paymentPayload.signature)
  );
}

async function check(bundle: TraceBundle) {
  const verification = await verifyTrace(bundle, {
    expectedHumanPrincipal: privateKeyToAccount(TEST_KEYS.userKey).address,
  });
  return {
    verification,
    detected: verification.result.status === "FAIL",
    failedRules: verification.result.failedRules,
    attributable: certificateAttribution(bundle, verification),
  };
}

async function guardAllows(input: GuardSettlementInput): Promise<boolean> {
  try {
    await createPredicateGuard().assertSettlementAllowed(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * PRE-SETTLEMENT GATE 1 — mandate signature against an independently anchored
 * human principal. Mirrors the verifier's R2/R5 but runs BEFORE settlement, so a
 * rejection means no receipt was ever issued (PREVENTION, not DETECTION).
 */
async function anchoredMandateGate(
  mandate: Mandate,
  settlementDescriptor: SettlementDescriptorExact,
): Promise<string[]> {
  const result = await verifyMandate(mandate, {
    expectedSigner: privateKeyToAccount(TEST_KEYS.userKey).address,
    clb: {
      identityRef: payerIdentity,
      settlementDescriptor,
      domain,
    },
  });
  return result.valid ? [] : result.reasons;
}

/**
 * PRE-SETTLEMENT GATE 2 — predicate guard with the nonce derived from the
 * HUMAN-SIGNED predicate. A swapped predicate changes C'/nonce, so the guard's
 * expectedNonce check rejects before the facilitator settles.
 */
async function predicateContentGate(input: {
  signedPredicate: SpendingPredicate;
  params: GuardSettlementInput["params"];
  /** The commitment the attacker submits (may carry swapped predicate content). */
  commitment: Parameters<typeof computeModeBSettlementCommitment>[0];
  /** The commitment derived from the HUMAN-SIGNED predicate; pins the expected nonce. */
  signedCommitment: Parameters<typeof computeModeBSettlementCommitment>[0];
}): Promise<{ rejected: boolean; reason?: string; receiptIssued: boolean }> {
  const signedNonce = deriveSettlementNonce(computeModeBSettlementCommitment(input.signedCommitment));
  try {
    await createPredicateGuard().assertSettlementAllowed({
      predicate: input.signedPredicate,
      params: input.params,
      commitment: input.commitment,
      now: new Date(Date.parse("2026-05-30T05:05:00.000Z")),
      expectedNonce: signedNonce,
    });
    // Guard allowed: only NOW would the caller settle. We do not settle in this
    // gate, so a reject below is genuine prevention.
    return { rejected: false, receiptIssued: false };
  } catch (error) {
    return {
      rejected: true,
      reason: error instanceof Error ? `${error.name}: ${error.message}` : "UnknownError",
      receiptIssued: false,
    };
  }
}

const valid = (traceId: string) => buildValidBundle({ traceId });

/** A valid bundle must pass every rule; this is the positive half of every test pair. */
async function expectHappyPath(bundle: TraceBundle) {
  const observed = await check(bundle);
  expect(observed.detected, "unmodified valid bundle must pass the verifier").toBe(false);
  expect(observed.failedRules).toEqual([]);
  // No attack occurred, so there is nothing to attribute: accountability is
  // only a response to an incident, not a property of a clean transaction.
  expect(classify({ ...observed, attributable: false })).toEqual(["NOT_APPLICABLE"]);
}

describe("R3-C1 extended attack scenarios — classification (not collapsed layers)", () => {
  describe("1. mandate modification", () => {
    test("POSITIVE: unmodified mandate passes", async () => {
      await expectHappyPath(await valid("ext-mandate-positive"));
    });

    test("ATTACK: mandate edited after the human signed it", async () => {
      const base = await valid("ext-mandate-tamper");
      const mutated: TraceBundle = {
        ...base,
        mandate: {
          ...base.mandate,
          constraints: { ...base.mandate.constraints, maxAmount: "9.99" },
        },
      };
      const observed = await check(mutated);

      expect(observed.detected).toBe(true);
      expect(observed.failedRules).toContain("R5_MANDATE_SIGNATURE_VALID");
      expect(observed.failedRules).toContain("R6_CLB_COMMITMENT_RECOMPUTES");
      expect(observed.failedRules).toContain("R8_PAYMENT_NONCE_EQUALS_HASH_C");
      // Detection is post-settlement: the receipt already exists in the trace.
      expect(classify({ ...observed, prevented: false })).toEqual([
        "DETECTION",
        "ACCOUNTABILITY",
      ]);
    });

    test("PREVENTION — attacker re-signed mandate is rejected before settlement", async () => {
      // The human-signed mandate is anchored independently of the trace. An
      // attacker who re-signs a relaxed mandate with a different key changes the
      // signer; the anchored gate rejects BEFORE the facilitator is called, so
      // no settlement receipt is issued.
      const base = await valid("ext-mandate-resign-honest");
      await expectHappyPath(base);
      const honestReasons = await anchoredMandateGate(base.mandate, base.clb.settlementDescriptor);
      expect(honestReasons).toEqual([]); // positive control: honest mandate passes the gate

      const attackerKey = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;
      const settlementDescriptor = descriptor();
      const attackerMandate = await issueMandate(attackerKey, {
        type: "CART",
        humanPrincipal: attackerAddress,
        authorizedAgent: payerIdentity,
        constraints: constraints({ maxAmount: "9.99" }),
        clb: { identityRef: payerIdentity, settlementDescriptor, domain },
      });

      // Pre-settlement gate runs FIRST. If it rejects, settlement is never attempted.
      const reasons = await anchoredMandateGate(attackerMandate, settlementDescriptor);
      expect(reasons).toContain("MANDATE_SIGNATURE_INVALID");

      // Prove no receipt was issued: a settlement only happens when the gate allows.
      let receiptIssued = false;
      if (reasons.length === 0) {
        const nonce = deriveNonce(
          computeCommitment({
            identityRef: payerIdentity,
            mandateDigest: computeMandateDigest(attackerMandate),
            settlementDescriptor,
            domain,
          }),
        );
        const payload = await signPaymentPayload(
          TEST_KEYS.shopperKey,
          buildPaymentAuthorization({ from: shopperAddress, descriptor: settlementDescriptor, nonce }),
        );
        await createLocalFacilitator().settle(payload);
        receiptIssued = true;
      }
      expect(receiptIssued).toBe(false);
      expect(classify({ prevented: true, detected: false, attributable: false })).toEqual([
        "PREVENTION",
      ]);
    });
  });

  describe("2 & 3. predicate registration and predicate substitution (Mode B)", () => {
    const permissivePredicate = (): SpendingPredicate =>
      defaultPredicate({
        maxValue: "100.00",
        allowedAssets: ["USDC", "WETH"],
      });
    const overLimitConcrete = (): SettlementDescriptorExact => ({
      ...defaultConcrete(),
      value: "9.99",
    });

    test("POSITIVE: honest predicate + in-limit settlement passes", async () => {
      const honest = await buildValidModeBBundle({ traceId: "ext-predicate-positive" });
      expect(await guardAllows(honest.guardInput)).toBe(true);
      await expectHappyPath(honest.bundle);
    });

    test("PREVENTION — predicate CONTENT substitution rejected before settlement", async () => {
      // The human signs a predicate whose content is bound into C'/nonce. The
      // attacker swaps the predicate CONTENT (not just the ID) at settlement.
      // The pre-settlement guard checks the payload nonce against H(C') of the
      // HUMAN-SIGNED predicate; the swapped predicate yields a different nonce
      // and is rejected BEFORE the facilitator settles.
      const honest = await buildValidModeBBundle({ traceId: "ext-predicate-honest" });
      await expectHappyPath(honest.bundle);

      // Positive control: the honest payload passes the pre-settlement gate.
      const honestGate = await predicateContentGate({
        signedPredicate: honest.guardInput.predicate,
        params: honest.guardInput.params,
        commitment: honest.guardInput.commitment,
        signedCommitment: honest.guardInput.commitment,
      });
      expect(honestGate.rejected, `honest gate reason: ${honestGate.reason}`).toBe(false);

      // Attacker swaps predicate content but reuses the human-signed C'/nonce.
      // Swapped predicate content, but an amount WITHIN the human's signed cap.
      // Evaluation passes; the only thing that can reject it is the C'/nonce
      // binding to the human-signed predicate digest.
      const swapped = await buildValidModeBBundle({
        traceId: "ext-predicate-content-substitution",
        predicate: permissivePredicate(),
      });
      const attackGate = await predicateContentGate({
        signedPredicate: honest.guardInput.predicate, // the human-approved content
        params: swapped.guardInput.params, // attacker's settlement params
        commitment: swapped.guardInput.commitment, // attacker's swapped predicate content
        signedCommitment: honest.guardInput.commitment, // nonce pinned by the human-signed C'
      });
      expect(attackGate.rejected).toBe(true);
      expect(attackGate.reason).toContain("SettlementNonceMismatchError");
      expect(attackGate.receiptIssued).toBe(false);
      expect(classify({ prevented: true, detected: false, attributable: false })).toEqual([
        "PREVENTION",
      ]);
    });

    test("ATTACK: predicate ID substitution (swap the reference after signing)", async () => {
      const honest = await buildValidModeBBundle({ traceId: "ext-predicate-id-positive" });
      await expectHappyPath(honest.bundle);

      // Swapping the predicateId breaks C'/nonce binding even though the predicate
      // content is unchanged: this path IS detected (unlike content substitution).
      const mutated: TraceBundle = {
        ...honest.bundle,
        clb: {
          ...honest.bundle.clb,
          settlementDescriptor: {
            ...honest.bundle.clb.settlementDescriptor,
            predicateId: "predicate-attacker",
          } as typeof honest.bundle.clb.settlementDescriptor,
        },
      };
      const observed = await check(mutated);
      expect(observed.detected).toBe(true);
      expect(observed.failedRules).toContain("R6_CLB_COMMITMENT_RECOMPUTES");
      expect(observed.failedRules).toContain("R8_PAYMENT_NONCE_EQUALS_HASH_C");
      expect(classify({ ...observed, prevented: false })).toEqual([
        "DETECTION",
        "ACCOUNTABILITY",
      ]);
    });
  });

  describe("4. expired authorization (existing EXPIRED_AUTHORIZATION / PREDICATE_EXPIRED)", () => {
    test("POSITIVE: in-window authorization is allowed and settles", async () => {
      const draft = await draftModeBPayment({ traceId: "ext-expiry-positive" });
      const allowed = await guardAllows({
        predicate: draft.predicate,
        params: draft.settlementParams,
        commitment: draft.commitment,
        now: new Date(draft.baseTimeMs + 5000),
      });
      expect(allowed).toBe(true);
      const receipt = await createLocalFacilitator().settle(draft.paymentPayload);
      expect(receipt.settled).toBe(true);
      await expectHappyPath(
        (await buildValidModeBBundle({ traceId: "ext-expiry-positive-trace" })).bundle,
      );
    });

    test("ATTACK: authorization window already closed", async () => {
      const expired = defaultPredicate({ validUntil: "2026-05-30T04:00:00.000Z" });
      const draft = await draftModeBPayment({ traceId: "ext-expiry-draft", predicate: expired });
      let guardDenied = false;
      let guardError: string | undefined;
      try {
        await createPredicateGuard().assertSettlementAllowed({
          predicate: draft.predicate,
          params: draft.settlementParams,
          commitment: draft.commitment,
          now: new Date(draft.baseTimeMs + 5000),
        });
      } catch (error) {
        guardDenied = true;
        expect(error).toBeInstanceOf(PredicateViolationError);
        guardError = error instanceof Error ? error.name : "UnknownError";
      }
      // Guard runs on the DRAFT, before any facilitator call: no receipt exists.
      expect(guardDenied).toBe(true);
      expect(guardError).toBe("PredicateViolationError");
      expect(createLocalFacilitator().isConsumed(draft.nonce)).toBe(false);

      // Forced trace shows the independent post-hoc verifier signal (R17).
      const forced = await buildValidModeBBundle({
        traceId: "ext-expiry-forced-trace",
        predicate: expired,
      });
      const observed = await check(forced.bundle);
      expect(observed.failedRules).toContain("R17_PREDICATE_TRUE_FOR_MODE_B");
      expect(classify({ ...observed, prevented: guardDenied })).toEqual([
        "PREVENTION",
        "DETECTION",
        "ACCOUNTABILITY",
      ]);
    });
  });

  describe("5. cross-chain replay (extends CHAIN_TRANSPLANT + MANDATE_REPLAY)", () => {
    test("POSITIVE: distinct nonces settle independently and verify", async () => {
      const base = await valid("ext-crosschain-positive");
      await expectHappyPath(base);
      const otherDraft = await draftModeBPayment({ traceId: "ext-crosschain-positive-b" });
      const receipt = await createLocalFacilitator().settle(otherDraft.paymentPayload);
      expect(receipt.settled).toBe(true);
      expect(receipt.nonce).not.toBe(base.paymentPayload.authorization.nonce);
    });

    test("EXPLOITED at payment layer + DETECTION at trace layer: replay on another chain", async () => {
      const base = await valid("ext-crosschain-replay");
      // A second chain's facilitator owns a separate nonce store: the identical
      // signed payload settles again. This is a real cross-chain replay gap.
      const otherChainFacilitator = createLocalFacilitator();
      const replayReceipt = await otherChainFacilitator.settle(base.paymentPayload);
      expect(replayReceipt.settled).toBe(true);
      expect(replayReceipt.nonce).toBe(base.paymentPayload.authorization.nonce);

      const transplanted: TraceBundle = {
        ...base,
        settlement: { ...base.settlement, chainId: 1, network: "ethereum" },
      };
      const observed = await check(transplanted);
      expect(observed.failedRules).toContain("R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR");
      expect(observed.failedRules).toContain("R10_CHAIN_DOMAIN_MATCHES");
      // Both layers are recorded: the replay itself succeeded, the trace flags it.
      expect(classify({ ...observed, prevented: false, exploited: true })).toEqual([
        "EXPLOITED",
        "DETECTION",
        "ACCOUNTABILITY",
      ]);
    });
  });

  describe("6. nonce reuse (existing MANDATE_REPLAY)", () => {
    test("POSITIVE: a fresh nonce settles once", async () => {
      const base = await valid("ext-nonce-positive");
      await expectHappyPath(base);
      const receipt = await createLocalFacilitator().settle(base.paymentPayload);
      expect(receipt.settled).toBe(true);
    });

    test("ATTACK: resubmit the same signed nonce", async () => {
      const base = await valid("ext-nonce-reuse");
      const replay = await markReplayAttempt(base);
      expect(replay.prevented).toBe(true);
      expect(replay.errorName).toBe("NonceAlreadyConsumedError");
      const observed = await check(replay.bundle);
      expect(observed.failedRules).toContain("R9_NONCE_CONSUMED_EXACTLY_ONCE");
      expect(classify({ ...observed, prevented: replay.prevented })).toEqual([
        "PREVENTION",
        "DETECTION",
        "ACCOUNTABILITY",
      ]);
    });
  });

  describe("7. amount representation inconsistency", () => {
    test("POSITIVE: canonical decimal representation passes", async () => {
      const base = await valid("ext-amount-positive");
      expect(base.settlement.value).toBe("2.00");
      await expectHappyPath(base);
    });

    test("ATTACK: value rewritten in atomic base-unit representation", async () => {
      const base = await valid("ext-amount-atomic");
      const mutated: TraceBundle = {
        ...base,
        settlement: { ...base.settlement, value: "2000000" },
      };
      const observed = await check(mutated);
      expect(observed.detected).toBe(true);
      expect(observed.failedRules).toContain("R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR");
      expect(observed.failedRules).toContain("R11_AMOUNT_WITHIN_MANDATE");
      expect(classify({ ...observed, prevented: false })).toEqual([
        "DETECTION",
        "ACCOUNTABILITY",
      ]);
    });

    test("ATTACK: harmless-looking decimal drift (2.00 -> 2.0) is still detected", async () => {
      const base = await valid("ext-amount-drift");
      const mutated: TraceBundle = {
        ...base,
        settlement: { ...base.settlement, value: "2.0" },
      };
      const observed = await check(mutated);
      expect(observed.failedRules).toEqual(["R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR"]);
      expect(classify({ ...observed, prevented: false })).toEqual([
        "DETECTION",
        "ACCOUNTABILITY",
      ]);
    });
  });

  describe("8. settlement descriptor modification", () => {
    test("POSITIVE: untouched descriptor passes", async () => {
      await expectHappyPath(await valid("ext-descriptor-positive"));
    });

    test("ATTACK: descriptor payee swapped after the mandate was signed", async () => {
      const base = await valid("ext-descriptor-modified");
      const mutated: TraceBundle = {
        ...base,
        clb: {
          ...base.clb,
          settlementDescriptor: descriptor({ value: "2.00", asset: "USDC", payTo: attackerAddress }),
        },
      };
      const observed = await check(mutated);
      expect(observed.detected).toBe(true);
      for (const rule of [
        "R2_SIGNATURES_VALID",
        "R5_MANDATE_SIGNATURE_VALID",
        "R6_CLB_COMMITMENT_RECOMPUTES",
        "R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR",
        "R8_PAYMENT_NONCE_EQUALS_HASH_C",
      ]) {
        expect(observed.failedRules).toContain(rule);
      }
      expect(classify({ ...observed, prevented: false })).toEqual([
        "DETECTION",
        "ACCOUNTABILITY",
      ]);
    });
  });

  describe("9. evidence tampering", () => {
    test("POSITIVE: intact hash chain and Merkle root pass", async () => {
      await expectHappyPath(await valid("ext-evidence-positive"));
    });

    test("ATTACK: edit an evidence event without rebuilding the chain", async () => {
      const base = await valid("ext-evidence-tamper");
      const mutated: TraceBundle = {
        ...base,
        events: base.events.map((event, index) =>
          index === 2
            ? { ...event, publicFields: { ...event.publicFields, tampered: true } }
            : event,
        ),
      };
      const observed = await check(mutated);
      expect(observed.detected).toBe(true);
      expect(observed.failedRules).toContain("R1_HASH_CHAIN_INTACT");
      expect(observed.verification.outcomes.R1_HASH_CHAIN_INTACT.ok).toBe(false);
      expect(classify({ ...observed, prevented: false })).toEqual([
        "DETECTION",
        "ACCOUNTABILITY",
      ]);
    });
  });

  describe("10. delivery evidence substitution (extends PAYMENT_WITHOUT_DELIVERY)", () => {
    test("POSITIVE: binding matches this settlement tx hash", async () => {
      const base = await valid("ext-delivery-positive");
      await expectHappyPath(base);
      expect(base.report.deliveryBinding).toBeTruthy();
    });

    test("ATTACK: substitute a delivery binding signed for another settlement", async () => {
      const base = await valid("ext-delivery-substitution");
      const other = await valid("ext-delivery-substitution-donor");
      expect(other.settlement.txHash).not.toBe(base.settlement.txHash);
      const mutated: TraceBundle = {
        ...base,
        report: { ...base.report, deliveryBinding: other.report.deliveryBinding },
      };
      const observed = await check(mutated);
      expect(observed.detected).toBe(true);
      expect(observed.failedRules).toContain("R14b_DELIVERY_BOUND_TO_SETTLEMENT");
      expect(observed.failedRules).not.toContain("R2_SIGNATURES_VALID");
      expect(classify({ ...observed, prevented: false })).toEqual([
        "DETECTION",
        "ACCOUNTABILITY",
      ]);
    });
  });
});
