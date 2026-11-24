import type { EvidenceEvent } from "@clb-acel/schemas";
import { verifyTrace, type RuleId, type TraceBundle } from "@clb-acel/verifier-core";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkPromptInjection } from "./audit-checks";
import { liveBaselineOutcomes } from "./baselines";
import { TEST_KEYS, appendEvidenceEvent, attackerAddress, buildValidBundle } from "./fixtures";
import type { BaselineOutcome } from "./types";

export type AdversarialSequenceId =
  | "MERCHANT_SUBSTITUTION_WITH_SELECTION_MANIPULATION"
  | "COMPROMISED_AGENT_WITH_AMOUNT_ESCALATION"
  | "MALICIOUS_MERCHANT_WITH_FORGED_DELIVERY";

export type AdversarialSequenceResult = {
  id: AdversarialSequenceId;
  attackerCapabilities: string[];
  steps: string[];
  detected: boolean;
  prevented: boolean;
  detectionStage: "pre-settlement" | "post-settlement" | "not-detected";
  failedRules: string[];
  auditCheck?: { ok: boolean; detail?: string };
  eventCount: number;
  baselineComparison: Record<"B0" | "B1" | "B2" | "B3", BaselineOutcome>;
};

const TEST_SIGNATURE = `0x${"1".repeat(130)}` as Hex;
const HONEST_HUMAN_PRINCIPAL = privateKeyToAccount(TEST_KEYS.userKey).address;

function appendAttackEvent(
  bundle: TraceBundle,
  eventId: string,
  objectType: string,
  publicFields: Record<string, unknown>,
): TraceBundle {
  const event: Omit<EvidenceEvent, "previousEventHash"> = {
    traceId: bundle.traceId,
    eventId,
    protocol: "ERC8004",
    objectType,
    actor: "adversarial-test-harness",
    timestamp: new Date(Date.parse(bundle.settlement.settledAt) + 1000).toISOString(),
    objectHash: `0x${"b".repeat(64)}`,
    publicFields,
    signature: TEST_SIGNATURE,
  };
  return appendEvidenceEvent(bundle, event);
}

async function finish(
  id: AdversarialSequenceId,
  attackerCapabilities: string[],
  steps: string[],
  bundle: TraceBundle,
  auditCheck?: { ok: boolean; detail?: string },
): Promise<AdversarialSequenceResult> {
  const verification = await verifyTrace(bundle, { expectedHumanPrincipal: HONEST_HUMAN_PRINCIPAL });
  const detected = verification.result.status === "FAIL" || auditCheck?.ok === true;
  const b3: BaselineOutcome = {
    detected,
    // These fixtures start from an already-issued local settlement receipt.
    // They evaluate detection, not pre-settlement prevention.
    prevented: false,
    failedRules: verification.result.failedRules as RuleId[],
    note: detected
      ? "Detected by the verifier or the explicit selection-audit check after a settlement receipt exists."
      : "The composed attack was not detected by the evaluated checks.",
  };
  return {
    id,
    attackerCapabilities,
    steps,
    detected,
    prevented: false,
    detectionStage: detected ? "post-settlement" : "not-detected",
    failedRules: verification.result.failedRules,
    ...(auditCheck ? { auditCheck } : {}),
    eventCount: bundle.events.length,
    baselineComparison: await liveBaselineOutcomes(bundle, b3),
  };
}

/**
 * Execute composed adversarial traces against the existing deterministic
 * verifier. These are post-settlement detection experiments: the base fixture
 * creates a local facilitator receipt before adversarial mutations are applied.
 */
export async function runComposedAdversarialSequences(
  seed = 1_800_000_000_000,
): Promise<AdversarialSequenceResult[]> {
  const results: AdversarialSequenceResult[] = [];

  // Sequence 1: manipulate merchant selection, redirect the receipt, and
  // revoke the merchant after the selection event has been recorded.
  {
    let bundle = await buildValidBundle({ traceId: `r2-merchant-chain-${seed}` });
    bundle = appendAttackEvent(bundle, "evt-attack-selection", "ERC8004_AGENT_SELECTION", {
      selectedPayee: attackerAddress,
      selectionSource: "untrusted-merchant-content",
      injectedInstructionObserved: true,
    });
    bundle = {
      ...bundle,
      settlement: { ...bundle.settlement, payTo: attackerAddress },
      merchantAgent: { ...bundle.merchantAgent, status: "REVOKED" },
    };
    const audit = checkPromptInjection(bundle);
    results.push(
      await finish(
        "MERCHANT_SUBSTITUTION_WITH_SELECTION_MANIPULATION",
        ["Control of merchant-provided content", "Ability to influence agent merchant selection", "Ability to alter submitted settlement receipt"],
        [
          "Present an unauthorized merchant-selection instruction.",
          "Record the unauthorized selectedPayee in the evidence trace.",
          "Substitute the settlement payee with the attacker's address.",
          "Mark the merchant identity as revoked before verification.",
          "Run selection auditing and deterministic settlement verification.",
        ],
        bundle,
        audit,
      ),
    );
  }

  // Sequence 2: compromise agent orchestration (not the signing key), remove
  // its payment-key authorization, and raise the amount after authorization.
  {
    let bundle = await buildValidBundle({ traceId: `r2-agent-chain-${seed}` });
    bundle = appendAttackEvent(bundle, "evt-attack-agent-override", "AGENT_EXECUTION_OVERRIDE", {
      originalAmount: bundle.settlement.value,
      attemptedAmount: "9.99",
      signingKeyCompromised: false,
    });
    bundle = {
      ...bundle,
      payerAgent: { ...bundle.payerAgent, authorizedPaymentKeys: [] },
      settlement: { ...bundle.settlement, value: "9.99" },
    };
    results.push(
      await finish(
        "COMPROMISED_AGENT_WITH_AMOUNT_ESCALATION",
        ["Control of agent application/orchestration logic", "Ability to submit altered settlement metadata", "No possession of the user's signing key"],
        [
          "Start from a valid user-signed mandate and payment authorization.",
          "Compromise agent orchestration without assuming signing-key theft.",
          "Attempt to raise the settlement amount above the mandate limit.",
          "Remove the payment key from the resolved agent authorization view.",
          "Run deterministic verification against the modified trace.",
        ],
        bundle,
      ),
    );
  }

  // Sequence 3: a merchant changes its signed delivery artifact after payment
  // and also redirects the receipt. This tests report signature/binding checks.
  {
    let bundle = await buildValidBundle({ traceId: `r2-forged-delivery-${seed}` });
    bundle = appendAttackEvent(bundle, "evt-attack-forged-delivery", "DELIVERY_PROOF", {
      claimedReportHash: `0x${"f".repeat(64)}`,
      claimedSettlementTxHash: bundle.settlement.txHash,
      merchantClaim: "delivery completed",
    });
    bundle = {
      ...bundle,
      settlement: { ...bundle.settlement, payTo: attackerAddress },
      report: { ...bundle.report, reportHash: `0x${"f".repeat(64)}` as Hex },
    };
    results.push(
      await finish(
        "MALICIOUS_MERCHANT_WITH_FORGED_DELIVERY",
        ["Control of merchant delivery response", "Ability to submit a forged report artifact", "Ability to attempt settlement redirection"],
        [
          "Complete a valid local payment fixture.",
          "Submit a delivery event claiming a forged report hash.",
          "Replace the report hash without a corresponding merchant signature.",
          "Attempt to redirect the settlement payee.",
          "Verify report authenticity, delivery binding, and settlement consistency.",
        ],
        bundle,
      ),
    );
  }

  return results;
}

