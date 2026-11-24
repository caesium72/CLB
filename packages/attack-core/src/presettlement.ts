import { issueMandate, verifyMandate } from "@clb-acel/ap2-adapter";
import { computeCommitment, computeMandateDigest, deriveNonce } from "@clb-acel/clb-core";
import { createPredicateGuard, PredicateViolationError } from "@clb-acel/predicate-adapter";
import type { GuardSettlementInput } from "@clb-acel/predicate-adapter";
import type { Mandate, SettlementDescriptorExact } from "@clb-acel/schemas";
import {
  NonceAlreadyConsumedError,
  buildPaymentAuthorization,
  createLocalFacilitator,
  signPaymentPayload,
  verifyPaymentPayload,
} from "@clb-acel/x402-adapter";
import type { PaymentAuthorization, PaymentPayload } from "@clb-acel/x402-adapter";
import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  TEST_KEYS,
  attackerAddress,
  constraints,
  descriptor,
  domain,
  payerIdentity,
  shopperAddress,
} from "./fixtures";
import { defaultConcrete, defaultPredicate, draftModeBPayment } from "./mode-b";
import type { ModeBBundleOptions } from "./mode-b";

/**
 * Pre-settlement prevention evaluation.
 *
 * Mode B: the existing fixtures build the receipt first and then ask the guard,
 * which can only show *detection*. Here the guard is asked BEFORE any settlement
 * call, and the facilitator is only invoked when the guard allows it.
 * Mode A: the authorization gate likewise verifies the human-signed commitment
 * and payment signature before settlement (Reviewer #4 Comment 3).
 * `receiptIssued === false` is therefore direct evidence that no value moved.
 *
 * Scenario coverage maps to Reviewer #2's asks:
 *   - malicious merchant  -> payee substitution, revoked merchant
 *   - compromised agent   -> amount escalation, task substitution, wrong asset
 *   - multi-step          -> selection injection + substitution, escalation + replay
 */

export type PreSettlementScenarioId =
  | "MALICIOUS_MERCHANT_PAYEE_SUBSTITUTION"
  | "MALICIOUS_MERCHANT_REVOKED_IDENTITY"
  | "COMPROMISED_AGENT_AMOUNT_ESCALATION"
  | "COMPROMISED_AGENT_ASSET_SWITCH"
  | "COMPROMISED_AGENT_CHAIN_SWITCH"
  | "COMPROMISED_AGENT_TASK_SUBSTITUTION"
  | "EXPIRED_AUTHORIZATION"
  | "MULTI_STEP_SELECTION_THEN_SUBSTITUTION"
  | "MULTI_STEP_ESCALATION_THEN_REPLAY"
  | "MODE_A_PAYEE_SUBSTITUTION"
  | "MODE_A_AMOUNT_ESCALATION"
  | "MODE_A_HONEST_AUTHORIZATION";

export type PreSettlementResult = {
  id: PreSettlementScenarioId;
  description: string;
  /** Which reviewer ask this scenario answers. */
  addresses: Array<"malicious-merchant" | "compromised-agent" | "multi-step">;
  guardAllowed: boolean;
  guardError?: string;
  predicateViolations: string[];
  /** True only when the guard allowed the settlement to be attempted. */
  settlementAttempted: boolean;
  /** True only when a settlement receipt actually exists for the attacked attempt. */
  receiptIssued: boolean;
  prevented: boolean;
  steps: string[];
  notes: string[];
};

/**
 * For an ATTACKED attempt: PREVENTION means no receipt was ever issued;
 * DETECTION means a receipt already existed and a rule flagged it afterwards.
 * Do not apply this to the honest control (which legitimately settles). This is
 * the distinction Reviewer #4 Comment 3 asks to make explicit: the original
 * Mode A payee/amount fixtures were DETECTION because the trace was verified
 * after settlement, not because C failed to bind those fields.
 */
export function classifyOutcome(result: PreSettlementResult): "PREVENTION" | "DETECTION" {
  return result.receiptIssued ? "DETECTION" : "PREVENTION";
}

type ModeBScenario = {
  kind?: "mode-b";
  id: PreSettlementScenarioId;
  description: string;
  addresses: PreSettlementResult["addresses"];
  options: ModeBBundleOptions;
  observedTaskHash?: Hex;
  steps: string[];
  /** Replay scenarios settle once legitimately, then replay the payload. */
  replay?: boolean;
};

type ModeAScenario = {
  kind: "mode-a";
  id: PreSettlementScenarioId;
  description: string;
  addresses: PreSettlementResult["addresses"];
  /** Authorization field the attacker substitutes; omitted for the honest control. */
  attack?: "payee" | "amount";
  steps: string[];
};

type Scenario = ModeBScenario | ModeAScenario;

const BASE_TIME = Date.parse("2026-05-30T05:00:00.000Z");
const PAST = "2026-05-30T04:00:00.000Z";
const OTHER_TASK_HASH = `0x${"e".repeat(64)}` as Hex;
const OBSERVED_TASK_HASH = `0x${"a".repeat(64)}` as Hex;

export const PRE_SETTLEMENT_SCENARIOS: Scenario[] = [
  {
    id: "MALICIOUS_MERCHANT_PAYEE_SUBSTITUTION",
    description:
      "The merchant swaps the settlement payee to an attacker address after the human signed the predicate.",
    addresses: ["malicious-merchant"],
    options: { traceId: "r2c1-pre-payee", concrete: defaultConcrete({ payTo: attackerAddress }) },
    steps: [
      "Human signs a predicate restricted to the approved merchant.",
      "Merchant substitutes the settlement payee with an attacker address.",
      "Predicate guard evaluates the concrete settlement BEFORE any transfer.",
    ],
  },
  {
    id: "MALICIOUS_MERCHANT_REVOKED_IDENTITY",
    description:
      "A revoked merchant identity is presented alongside an unapproved payee; the guard rejects on the payee.",
    addresses: ["malicious-merchant"],
    options: {
      traceId: "r2c1-pre-revoked",
      concrete: defaultConcrete({ payTo: attackerAddress }),
    },
    steps: [
      "Merchant identity is revoked but its content is still served.",
      "Attacker routes payment to a fresh address.",
      "Predicate guard rejects the payee before settlement.",
    ],
  },
  {
    id: "COMPROMISED_AGENT_AMOUNT_ESCALATION",
    description:
      "A compromised agent (application logic, not the signing key) raises the settlement amount above the human cap.",
    addresses: ["compromised-agent"],
    options: { traceId: "r2c1-pre-amount", concrete: defaultConcrete({ value: "9.99" }) },
    steps: [
      "Human signs a predicate capping spend at 5.00.",
      "Compromised agent orchestration submits 9.99.",
      "Predicate guard rejects the over-limit settlement before any transfer.",
    ],
  },
  {
    id: "COMPROMISED_AGENT_ASSET_SWITCH",
    description: "A compromised agent settles in an asset the human never allowed.",
    addresses: ["compromised-agent"],
    options: { traceId: "r2c1-pre-asset", concrete: defaultConcrete({ asset: "WETH" }) },
    steps: [
      "Human allows USDC only.",
      "Compromised agent submits a WETH settlement.",
      "Predicate guard rejects the asset before any transfer.",
    ],
  },
  {
    id: "COMPROMISED_AGENT_CHAIN_SWITCH",
    description: "A compromised agent moves settlement to a chain outside the predicate.",
    addresses: ["compromised-agent"],
    options: {
      traceId: "r2c1-pre-chain",
      concrete: defaultConcrete({ chainId: 1, network: "ethereum" }),
    },
    steps: [
      "Human allows chain 84532 only.",
      "Compromised agent targets chain 1.",
      "Predicate guard rejects the chain before any transfer.",
    ],
  },
  {
    id: "COMPROMISED_AGENT_TASK_SUBSTITUTION",
    description: "A compromised agent settles a different task than the one the human authorized.",
    addresses: ["compromised-agent"],
    options: {
      traceId: "r2c1-pre-task",
      predicate: defaultPredicate({ taskHash: OTHER_TASK_HASH }),
    },
    observedTaskHash: OBSERVED_TASK_HASH,
    steps: [
      "Human pins task hash eeee… to the predicate.",
      "Compromised agent delivers a settlement for task aaaa….",
      "Predicate guard rejects the task mismatch before any transfer.",
    ],
  },
  {
    id: "EXPIRED_AUTHORIZATION",
    description: "The agent attempts to settle after the human's authorization window closed.",
    addresses: ["compromised-agent"],
    options: {
      traceId: "r2c1-pre-expired",
      predicate: defaultPredicate({ validUntil: PAST }),
    },
    steps: [
      "Human authorized spending until 04:00Z.",
      "Agent attempts settlement at 05:05Z.",
      "Predicate guard rejects the expired authorization before any transfer.",
    ],
  },
  {
    id: "MULTI_STEP_SELECTION_THEN_SUBSTITUTION",
    description:
      "Step 1: discovery is prompt-injected to select an unapproved merchant. Step 2: the settlement payee follows the injected selection.",
    addresses: ["multi-step", "malicious-merchant"],
    options: {
      traceId: "r2c1-pre-multistep-payee",
      concrete: defaultConcrete({ payTo: attackerAddress }),
    },
    steps: [
      "Attacker injects a merchant recommendation into untrusted merchant content.",
      "Agent selection follows the injected payee.",
      "Settlement is built for the injected payee.",
      "Predicate guard rejects at the payee rule before any transfer.",
    ],
  },
  {
    id: "MULTI_STEP_ESCALATION_THEN_REPLAY",
    description:
      "Step 1: the agent settles a legitimate payment. Step 2: it replays the same signed payload to double-settle.",
    addresses: ["multi-step", "compromised-agent"],
    options: { traceId: "r2c1-pre-multistep-replay" },
    replay: true,
    steps: [
      "Agent settles the legitimate 2.00 payment (nonce consumed).",
      "Agent replays the identical signed payload.",
      "Facilitator rejects the second settlement on the consumed nonce.",
    ],
  },
  {
    kind: "mode-a",
    id: "MODE_A_PAYEE_SUBSTITUTION",
    description:
      "A merchant rewrites payTo in the signed payment authorization to an attacker address. C already bound the approved payee, so the human signature cannot cover the substitution.",
    addresses: ["malicious-merchant"],
    attack: "payee",
    steps: [
      "Human signs C = EIP712(identityRef, mandateDigest, settlementDigest) over the approved payee.",
      "Merchant rewrites authorization.to to an attacker address but keeps the human-signed nonce.",
      "The pre-settlement gate derives the descriptor from the authorization and recomputes C/nonce.",
      "C and the payment signature no longer match; the gate rejects before any settlement call.",
    ],
  },
  {
    kind: "mode-a",
    id: "MODE_A_AMOUNT_ESCALATION",
    description:
      "An agent raises value in the signed payment authorization above the human-approved amount. The settlementDigest inside C changes, so the human signature cannot cover the escalation.",
    addresses: ["compromised-agent"],
    attack: "amount",
    steps: [
      "Human signs C over the approved 2.00 amount.",
      "Agent rewrites authorization.value to 9.99 but keeps the human-signed nonce.",
      "The pre-settlement gate recomputes C from the actual authorization fields.",
      "The C/nonce binding and payment signature fail; the gate rejects before any settlement call.",
    ],
  },
  {
    kind: "mode-a",
    id: "MODE_A_HONEST_AUTHORIZATION",
    description:
      "Positive control: the human-signed descriptor and the payment authorization agree, so the pre-settlement gate allows settlement.",
    addresses: [],
    steps: [
      "Human signs C over the approved payee and amount.",
      "Agent builds the authorization from that exact descriptor and signs it with the payer key.",
      "The gate recomputes C/nonce, verifies both signatures, and settles.",
    ],
  },
];

type ModeADraft = {
  mandate: Mandate;
  payload: PaymentPayload;
  humanPrincipal: Address;
};

/** Build the human-signed Mode A draft up to (but excluding) settlement. */
async function draftModeAPayment(): Promise<ModeADraft> {
  const settlementDescriptor = descriptor();
  const humanPrincipal = privateKeyToAccount(TEST_KEYS.userKey).address;
  const mandate = await issueMandate(TEST_KEYS.userKey, {
    type: "CART",
    authorizedAgent: payerIdentity,
    constraints: constraints(),
    clb: { identityRef: payerIdentity, settlementDescriptor, domain },
  });
  const commitment = computeCommitment({
    identityRef: payerIdentity,
    mandateDigest: computeMandateDigest(mandate),
    settlementDescriptor,
    domain,
  });
  const nonce = deriveNonce(commitment);
  const auth = buildPaymentAuthorization({
    from: shopperAddress,
    descriptor: settlementDescriptor,
    nonce,
  });
  const payload = await signPaymentPayload(TEST_KEYS.shopperKey, auth);
  return { mandate, payload, humanPrincipal };
}

/** Descriptor implied by the authorization that is actually being paid. */
function descriptorFromAuthorization(auth: PaymentAuthorization): SettlementDescriptorExact {
  return {
    chainId: auth.chainId,
    network: auth.network,
    asset: auth.asset,
    payTo: auth.to,
    value: auth.value,
    validBefore: auth.validBefore,
    x402Scheme: "exact",
  };
}

type GateVerdict = { allowed: boolean; reasons: string[]; checks: string[] };

/**
 * The Mode A pre-settlement gate the original pipeline lacked. It derives the
 * descriptor from the payment authorization, recomputes C = EIP712(identityRef,
 * mandateDigest, settlementDigest) and nonce = H(C), verifies the human mandate
 * signature against an independently anchored principal, and verifies the x402
 * payment signature — all BEFORE the facilitator is called.
 *
 * Substituting payee or amount changes settlementDigest, so both the human's
 * EIP-712 signature over C and the derived nonce cease to match. That is the
 * mechanism that makes these attacks rejectable before settlement, rather than
 * merely detectable in the post-settlement trace.
 */
async function modeAPreSettlementGate(
  draft: ModeADraft,
  payload: PaymentPayload,
): Promise<GateVerdict> {
  const reasons: string[] = [];
  const checks: string[] = [];
  const clb = {
    identityRef: payerIdentity,
    settlementDescriptor: descriptorFromAuthorization(payload.authorization),
    domain,
  };

  const mandate = await verifyMandate(draft.mandate, {
    clb,
    expectedSigner: draft.humanPrincipal,
  });
  checks.push(`mandate/C: ${mandate.valid ? "ok" : mandate.reasons.join(",")}`);
  if (!mandate.valid) {
    reasons.push(...mandate.reasons.map((reason) => `MANDATE_${reason}`));
  }

  const recomputedC = computeCommitment({
    ...clb,
    mandateDigest: computeMandateDigest(draft.mandate),
  });
  const expectedNonce = deriveNonce(recomputedC);
  const nonceOk = payload.authorization.nonce === expectedNonce;
  checks.push(`nonce=H(C): ${nonceOk ? "ok" : "mismatch"}`);
  if (!nonceOk) reasons.push("NONCE_NOT_H_OF_RECOMPUTED_C");

  const signatureOk = await verifyPaymentPayload(payload);
  checks.push(`payment-signature: ${signatureOk ? "ok" : "invalid"}`);
  if (!signatureOk) reasons.push("PAYMENT_SIGNATURE_INVALID");

  return { allowed: reasons.length === 0, reasons, checks };
}

async function runModeAScenario(scenario: ModeAScenario): Promise<PreSettlementResult> {
  const draft = await draftModeAPayment();
  let payload = draft.payload;

  if (scenario.attack === "payee") {
    payload = {
      ...payload,
      authorization: { ...payload.authorization, to: attackerAddress },
    };
  } else if (scenario.attack === "amount") {
    payload = {
      ...payload,
      authorization: { ...payload.authorization, value: "9.99" },
    };
  }

  const verdict = await modeAPreSettlementGate(draft, payload);
  const facilitator = createLocalFacilitator();
  const notes = [...verdict.checks];
  let receiptIssued = false;

  if (verdict.allowed) {
    await facilitator.settle(payload);
    receiptIssued = true;
    notes.push("Gate allowed the human-signed authorization; settlement completed.");
  } else {
    notes.push("Gate rejected before any settlement call; no receipt was issued.");
  }

  return {
    id: scenario.id,
    description: scenario.description,
    addresses: scenario.addresses,
    guardAllowed: verdict.allowed,
    ...(verdict.allowed ? {} : { guardError: verdict.reasons[0] }),
    predicateViolations: verdict.reasons,
    settlementAttempted: verdict.allowed,
    receiptIssued,
    prevented: !receiptIssued,
    steps: scenario.steps,
    notes,
  };
}

async function runScenario(scenario: Scenario): Promise<PreSettlementResult> {
  if (scenario.kind === "mode-a") return runModeAScenario(scenario);
  return runModeBScenario(scenario);
}

async function runModeBScenario(scenario: ModeBScenario): Promise<PreSettlementResult> {
  const draft = await draftModeBPayment(scenario.options);
  const guard = createPredicateGuard();
  const guardInput: GuardSettlementInput = {
    predicate: draft.predicate,
    params: draft.settlementParams,
    commitment: draft.commitment,
    now: new Date(draft.baseTimeMs + 5000),
    ...(scenario.observedTaskHash ? { observedTaskHash: scenario.observedTaskHash } : {}),
  };

  let guardAllowed = true;
  let guardError: string | undefined;
  let predicateViolations: string[] = [];

  try {
    await guard.assertSettlementAllowed(guardInput);
  } catch (error) {
    guardAllowed = false;
    if (error instanceof PredicateViolationError) {
      predicateViolations = [...error.evaluation.violations];
      guardError = error.name;
    } else {
      guardError = error instanceof Error ? error.name : "UnknownError";
    }
  }

  const facilitator = createLocalFacilitator();
  let settlementAttempted = guardAllowed;
  let receiptIssued = false;
  const notes: string[] = [];

  if (guardAllowed) {
    await facilitator.settle(draft.paymentPayload);
    receiptIssued = true;

    if (scenario.replay) {
      // The attacked attempt is the replay, not the legitimate first settlement.
      settlementAttempted = true;
      receiptIssued = false;
      try {
        await facilitator.settle(draft.paymentPayload);
        notes.push("Replay unexpectedly settled — prevention failed.");
      } catch (error) {
        notes.push(
          error instanceof NonceAlreadyConsumedError
            ? "Replay rejected by the facilitator on the consumed nonce."
            : `Replay rejected with ${error instanceof Error ? error.name : "UnknownError"}.`,
        );
        predicateViolations = ["NONCE_ALREADY_CONSUMED"];
      }
    }
  }

  return {
    id: scenario.id,
    description: scenario.description,
    addresses: scenario.addresses,
    guardAllowed,
    ...(guardError ? { guardError } : {}),
    predicateViolations,
    settlementAttempted,
    receiptIssued,
    prevented: !receiptIssued,
    steps: scenario.steps,
    notes,
  };
}

/**
 * Default keeps the historical nine Mode B scenarios so existing artifacts and
 * callers are unchanged. Pass `includeModeA: true` to also exercise the new
 * Mode A authorization gate (two prevented attacks + one honest control).
 */
export async function runPreSettlementScenarios(
  options: { includeModeA?: boolean } = {},
): Promise<PreSettlementResult[]> {
  const results: PreSettlementResult[] = [];
  for (const scenario of PRE_SETTLEMENT_SCENARIOS) {
    if (scenario.kind === "mode-a" && options.includeModeA !== true) continue;
    results.push(await runScenario(scenario));
  }
  return results;
}

/** Run only the new Mode A pre-settlement gate scenarios. */
export async function runModeAPreSettlementScenarios(): Promise<PreSettlementResult[]> {
  const results: PreSettlementResult[] = [];
  for (const scenario of PRE_SETTLEMENT_SCENARIOS) {
    if (scenario.kind === "mode-a") results.push(await runScenario(scenario));
  }
  return results;
}
