import { issueMandate } from "@clb-acel/ap2-adapter";
import {
  computeMandateDigest,
  computeModeBSettlementCommitment,
  deriveSettlementNonce,
  settlementParamsFromExact,
  type ModeBSettlementInput,
} from "@clb-acel/clb-core";
import { signDeliveryBinding, signReport } from "@clb-acel/delivery-core";
import { buildMerkleRoot, hashEvidenceEvent, linkEvidenceEvents } from "@clb-acel/evidence-core";
import { PredicateViolationError, createPredicateGuard } from "@clb-acel/predicate-adapter";
import type {
  EvidenceEvent,
  PredicateDescriptor,
  SettlementDescriptorExact,
  SpendingPredicate,
} from "@clb-acel/schemas";
import { verifyTrace, type RuleId, type TraceBundle, type VerifyTraceOutput } from "@clb-acel/verifier-core";
import {
  buildPaymentAuthorization,
  createLocalFacilitator,
  signPaymentPayload,
} from "@clb-acel/x402-adapter";
import type { Hex } from "viem";
import {
  TEST_KEYS,
  attackerAddress,
  domain,
  merchantAddress,
  merchantAgent,
  payerAgent,
  payerIdentity,
  shopperAddress,
} from "./fixtures";
import { estimateStorageBytes } from "./metrics";
import { liveBaselineOutcomes } from "./baselines";
import type {
  AttackMutation,
  BaselineId,
  BaselineOutcome,
  PredicateAttackAnatomy,
  PredicateTraceSummary,
} from "./types";

const BASE_TIME = Date.parse("2026-05-30T05:00:00.000Z");

export type PredicateAttackId =
  | "PREDICATE_HAPPY_PATH"
  | "PREDICATE_PAYEE_VIOLATION"
  | "PREDICATE_AMOUNT_VIOLATION"
  | "PREDICATE_ASSET_VIOLATION"
  | "PREDICATE_EXPIRED";

export function defaultPredicate(overrides: Partial<SpendingPredicate> = {}): SpendingPredicate {
  return {
    allowedAssets: ["USDC"],
    allowedPayees: [merchantAddress],
    maxValue: "5.00",
    validUntil: "2026-12-30T06:00:00.000Z",
    allowedChainIds: [84532],
    allowedAgentIds: [payerIdentity.agentId],
    ...overrides,
  };
}

export function defaultConcrete(
  overrides: Partial<SettlementDescriptorExact> = {},
): SettlementDescriptorExact {
  return {
    chainId: 84532,
    network: "base-sepolia",
    asset: "USDC",
    payTo: merchantAddress,
    value: "2.00",
    validBefore: "2026-12-30T06:00:00.000Z",
    x402Scheme: "exact",
    ...overrides,
  };
}

function modeBEvidenceEvents(traceId: string, settledAt: string): EvidenceEvent[] {
  const types: Array<[EvidenceEvent["protocol"], string]> = [
    ["USER", "USER_INTENT"],
    ["ERC8004", "ERC8004_AGENT_IDENTITY"],
    ["AP2", "AP2_INTENT_MANDATE"],
    ["X402", "X402_PAYMENT_REQUIREMENT"],
    ["X402", "X402_PAYMENT_PAYLOAD"],
    ["CHAIN", "CHAIN_SETTLEMENT"],
    ["DELIVERY", "DELIVERY_PROOF"],
  ];

  return linkEvidenceEvents(
    types.map(([protocol, objectType], index) => ({
      traceId,
      eventId: `evt-${index + 1}`,
      protocol,
      objectType,
      actor: "orchestrator",
      timestamp: new Date(Date.parse(settledAt) - (types.length - index) * 1000).toISOString(),
      objectHash: `0x${index.toString(16).padStart(64, "0")}`,
      publicFields: { objectType },
      signature: `0x${"1".repeat(130)}`,
    })),
  );
}

export type ModeBBundleOptions = {
  traceId?: string;
  predicate?: SpendingPredicate;
  concrete?: SettlementDescriptorExact;
  predicateId?: string;
  token?: string;
  baseTimeMs?: number;
  observedTaskHash?: Hex;
};

export type ModeBBundle = {
  bundle: TraceBundle;
  guardInput: {
    predicate: SpendingPredicate;
    params: ReturnType<typeof settlementParamsFromExact>;
    commitment: ModeBSettlementInput;
    now: Date;
    observedTaskHash?: Hex;
  };
};

/**
 * Build a deterministic delegated (Mode B) trace bundle, mirroring
 * `buildValidBundle` for Mode A. C' is recomputed from the concrete params so
 * R6/R8 hold even when the concrete params violate the predicate (so violations
 * surface at R17/R11–R13, not the binding rules).
 */
export async function buildValidModeBBundle(options: ModeBBundleOptions = {}): Promise<ModeBBundle> {
  const traceId = options.traceId ?? "trace-mode-b-001";
  const baseTime = options.baseTimeMs ?? BASE_TIME;
  const predicate = options.predicate ?? defaultPredicate();
  const concrete = options.concrete ?? defaultConcrete();
  const predicateId = options.predicateId ?? "predicate-001";
  const predicateDescriptor: PredicateDescriptor = { predicateId, predicate, x402Scheme: "predicate" };

  const mandate = await issueMandate(TEST_KEYS.userKey, {
    type: "INTENT",
    mandateId: `mandate-intent-${traceId}`,
    authorizedAgent: payerIdentity,
    constraints: {},
    predicate: predicateDescriptor,
  });

  const settlementParams = settlementParamsFromExact(concrete, payerIdentity.agentId);
  const commitment: ModeBSettlementInput = {
    identityRef: payerIdentity,
    mandateDigest: computeMandateDigest(mandate),
    predicateId,
    settlementParams,
    domain,
  };
  const modeBCommitment = computeModeBSettlementCommitment(commitment);
  const nonce = deriveSettlementNonce(modeBCommitment);

  const auth = buildPaymentAuthorization({ from: shopperAddress, descriptor: concrete, nonce });
  const paymentPayload = await signPaymentPayload(TEST_KEYS.shopperKey, auth, "predicate");

  const facilitator = createLocalFacilitator();
  const settledReceipt = await facilitator.settle(paymentPayload);
  const settlement = { ...settledReceipt, settledAt: new Date(baseTime + 5000).toISOString() };

  const signedReport = await signReport(TEST_KEYS.merchantKey, {
    token: options.token ?? "XYZ",
    chain: concrete.network,
    riskScore: 0.42,
    signals: {
      liquidityRisk: 0.4,
      holderConcentrationRisk: 0.5,
      contractRisk: 0.3,
      marketVolatilityRisk: 0.45,
    },
    modelVersion: "heuristic-v1",
    inputDataHash: options.observedTaskHash ?? `0x${"a".repeat(64)}`,
    generatedAt: new Date(baseTime + 6000).toISOString(),
  });
  const deliveryBinding = await signDeliveryBinding({
    settlementTxHash: settlement.txHash,
    reportHash: signedReport.reportHash,
    merchantKey: TEST_KEYS.merchantKey,
  });
  const report = { ...signedReport, deliveryBinding };

  const events = modeBEvidenceEvents(traceId, settlement.settledAt);
  const eventHashes = events.map(hashEvidenceEvent);

  const bundle: TraceBundle = {
    traceId,
    mode: "MODE_B_PREDICATE",
    events,
    eventHashes,
    merkleRoot: buildMerkleRoot(eventHashes),
    payerAgent,
    merchantAgent,
    mandate,
    clb: { identityRef: payerIdentity, settlementDescriptor: predicateDescriptor, domain },
    paymentPayload,
    settlement,
    report,
    concreteSettlement: concrete,
    modeBCommitment,
  };

  return {
    bundle,
    guardInput: {
      predicate,
      params: settlementParams,
      commitment,
      now: new Date(Date.parse(settlement.settledAt)),
      ...(predicate.taskHash ? { observedTaskHash: report.inputDataHash as Hex } : {}),
    },
  };
}

/** Plain-English titles for each P5 fixture, shared by the UI and matrix. */
export const PREDICATE_ATTACK_LABELS: Record<PredicateAttackId, string> = {
  PREDICATE_HAPPY_PATH: "Agent stays within your limits",
  PREDICATE_PAYEE_VIOLATION: "Pay an unapproved merchant",
  PREDICATE_AMOUNT_VIOLATION: "Spend above your limit",
  PREDICATE_ASSET_VIOLATION: "Pay with the wrong token",
  PREDICATE_EXPIRED: "Settle after your deadline",
};

type PredicateAnatomyContext = {
  authorized: PredicateTraceSummary;
  violated: PredicateTraceSummary;
};

type PredicateAnatomyTemplate = (
  ctx: PredicateAnatomyContext,
) => Omit<PredicateAttackAnatomy, "authorizedTrace" | "violatedTrace">;

const PREDICATE_EVIDENCE_FOCUS = [
  "AP2_INTENT_MANDATE",
  "X402_PAYMENT_PAYLOAD",
  "CHAIN_SETTLEMENT",
] as const;

export type PredicateAttackFixture = {
  id: PredicateAttackId;
  description: string;
  /** Empty for the happy path; the binding rules (R6/R8) always hold. */
  expectedFailedRules: RuleId[];
  build: () => Promise<ModeBBundle>;
  anatomy: PredicateAnatomyTemplate;
  baselineOutcomes: Record<BaselineId, BaselineOutcome>;
};

const violationBaselines = (note: string): Record<BaselineId, BaselineOutcome> => ({
  B0: { detected: false, prevented: false, note: "Vanilla x402 has no predicate enforcement." },
  B1: { detected: false, prevented: false, note: "AP2 INTENT without C' binding or guard." },
  B2: { detected: true, prevented: false, note: `Audit-only detects post-settlement: ${note}` },
  B3: { detected: true, prevented: true, note: `Guard prevents at settlement + R17 audit: ${note}` },
});

export const MODE_B_PREDICATE_FIXTURES: PredicateAttackFixture[] = [
  {
    id: "PREDICATE_HAPPY_PATH",
    description: "Concrete settlement satisfies the human-signed predicate.",
    expectedFailedRules: [],
    build: () => buildValidModeBBundle({ traceId: "trace-predicate-happy" }),
    anatomy: ({ violated }) => ({
      summary:
        "The human signed spending rules once; the agent then settled a concrete payment that stays inside every rule, so it is allowed.",
      steps: [
        "Human signs a predicate: allowed merchants, a spending cap, allowed tokens, and a deadline.",
        "Agent later picks a concrete payee, amount, and token within those rules.",
        "The predicate guard allows the settlement and the verifier confirms it (R17 passes).",
      ],
      mutations: [],
      evidenceFocus: [...PREDICATE_EVIDENCE_FOCUS],
      detectedBy: [],
    }),
    baselineOutcomes: {
      B0: { detected: false, prevented: false, note: "Valid settlement; nothing to detect." },
      B1: { detected: false, prevented: false, note: "Valid settlement; nothing to detect." },
      B2: { detected: false, prevented: false, note: "Valid settlement; R17 passes." },
      B3: { detected: false, prevented: false, note: "Valid settlement; guard allows, R17 passes." },
    },
  },
  {
    id: "PREDICATE_PAYEE_VIOLATION",
    description: "Agent settles to a payee outside the predicate allowedPayees.",
    expectedFailedRules: ["R17_PREDICATE_TRUE_FOR_MODE_B", "R12_PAYEE_MATCHES_CHECKOUT_OR_TASK"],
    build: () =>
      buildValidModeBBundle({
        traceId: "trace-predicate-payee",
        concrete: defaultConcrete({ payTo: attackerAddress }),
      }),
    anatomy: ({ authorized, violated }) => ({
      summary:
        "The agent tries to send the payment to a merchant the human never approved. The predicate guard blocks it before settlement and the verifier flags it.",
      steps: [
        "Human approved a specific set of merchants in the predicate.",
        "Agent attempts to settle to a different, unapproved address.",
        "Guard refuses the settlement; R17 and R12 fail in the audit.",
      ],
      mutations: [
        {
          path: "settlement.payTo",
          before: authorized.concreteSettlement.payTo,
          after: violated.concreteSettlement.payTo,
          impact: "Funds would route to a merchant outside the human-approved allowlist.",
        },
      ],
      evidenceFocus: [...PREDICATE_EVIDENCE_FOCUS],
      detectedBy: ["predicate-guard", "R17_PREDICATE_TRUE_FOR_MODE_B", "R12_PAYEE_MATCHES_CHECKOUT_OR_TASK"],
    }),
    baselineOutcomes: violationBaselines("payee outside allowedPayees"),
  },
  {
    id: "PREDICATE_AMOUNT_VIOLATION",
    description: "Agent settles for more than the predicate maxValue.",
    expectedFailedRules: ["R17_PREDICATE_TRUE_FOR_MODE_B", "R11_AMOUNT_WITHIN_MANDATE"],
    build: () =>
      buildValidModeBBundle({
        traceId: "trace-predicate-amount",
        concrete: defaultConcrete({ value: "9.99" }),
      }),
    anatomy: ({ authorized, violated }) => ({
      summary:
        "The agent tries to spend more than the human's signed cap. The predicate guard blocks the over-limit settlement and the verifier flags it.",
      steps: [
        `Human capped spending at ${authorized.predicate.maxValue} in the predicate.`,
        `Agent attempts to settle ${violated.concreteSettlement.value} — above the cap.`,
        "Guard refuses the settlement; R17 and R11 fail in the audit.",
      ],
      mutations: [
        {
          path: "settlement.value",
          before: authorized.concreteSettlement.value,
          after: violated.concreteSettlement.value,
          impact: `Exceeds the signed maxValue of ${authorized.predicate.maxValue}; more than the human authorized.`,
        },
      ],
      evidenceFocus: [...PREDICATE_EVIDENCE_FOCUS],
      detectedBy: ["predicate-guard", "R17_PREDICATE_TRUE_FOR_MODE_B", "R11_AMOUNT_WITHIN_MANDATE"],
    }),
    baselineOutcomes: violationBaselines("value exceeds maxValue"),
  },
  {
    id: "PREDICATE_ASSET_VIOLATION",
    description: "Agent settles in an asset outside the predicate allowedAssets.",
    expectedFailedRules: ["R17_PREDICATE_TRUE_FOR_MODE_B", "R13_ASSET_ALLOWED"],
    build: () =>
      buildValidModeBBundle({
        traceId: "trace-predicate-asset",
        concrete: defaultConcrete({ asset: "WETH" }),
      }),
    anatomy: ({ authorized, violated }) => ({
      summary:
        "The agent tries to pay with a token the human never allowed. The predicate guard blocks the settlement and the verifier flags it.",
      steps: [
        `Human allowed only ${authorized.predicate.allowedAssets.join(", ")} in the predicate.`,
        `Agent attempts to settle in ${violated.concreteSettlement.asset}.`,
        "Guard refuses the settlement; R17 and R13 fail in the audit.",
      ],
      mutations: [
        {
          path: "settlement.asset",
          before: authorized.concreteSettlement.asset,
          after: violated.concreteSettlement.asset,
          impact: "Settles in a token outside the human-approved allowedAssets list.",
        },
      ],
      evidenceFocus: [...PREDICATE_EVIDENCE_FOCUS],
      detectedBy: ["predicate-guard", "R17_PREDICATE_TRUE_FOR_MODE_B", "R13_ASSET_ALLOWED"],
    }),
    baselineOutcomes: violationBaselines("asset not in allowedAssets"),
  },
  {
    id: "PREDICATE_EXPIRED",
    description: "Settlement occurs after the predicate validUntil window.",
    expectedFailedRules: ["R17_PREDICATE_TRUE_FOR_MODE_B"],
    build: () =>
      buildValidModeBBundle({
        traceId: "trace-predicate-expired",
        predicate: defaultPredicate({ validUntil: "2026-05-30T04:00:00.000Z" }),
      }),
    anatomy: ({ authorized, violated }) => ({
      summary:
        "The agent settles after the human's authorization window has closed. The predicate guard blocks the late settlement and the verifier flags it.",
      steps: [
        `Human authorized spending only until ${authorized.predicate.validUntil}.`,
        `Settlement occurs at ${violated.settledAt}, after the deadline.`,
        "Guard refuses the expired settlement; R17 fails in the audit.",
      ],
      mutations: [
        {
          path: "predicate.validUntil",
          before: authorized.predicate.validUntil,
          after: violated.predicate.validUntil,
          impact: `Settlement at ${violated.settledAt} falls outside the signed validity window.`,
        },
      ],
      evidenceFocus: [...PREDICATE_EVIDENCE_FOCUS],
      detectedBy: ["predicate-guard", "R17_PREDICATE_TRUE_FOR_MODE_B"],
    }),
    baselineOutcomes: violationBaselines("settlement after validUntil"),
  },
];

export type PredicateAttackRunResult = {
  attackId: PredicateAttackId;
  label: string;
  traceId: string;
  description: string;
  verification: VerifyTraceOutput;
  expectedFailedRules: RuleId[];
  matched: boolean;
  /** "predicate-guard" when the guard blocks at settlement; else "verifier"/"none". */
  preventionLayer: "predicate-guard" | "verifier" | "none";
  guardPrevented: boolean;
  anatomy: PredicateAttackAnatomy;
  baselineComparison: Record<BaselineId, BaselineOutcome>;
  metrics: { verifyLatencyMs: number; eventCount: number; storageBytesEstimate: number };
};

/** Would the predicate guard allow this settlement before it completes? */
async function guardAllowsSettlement(guardInput: ModeBBundle["guardInput"]): Promise<boolean> {
  try {
    await createPredicateGuard().assertSettlementAllowed(guardInput);
    return true;
  } catch (error) {
    if (error instanceof PredicateViolationError) {
      return false;
    }
    throw error;
  }
}

async function buildPredicateTraceSummary({ bundle, guardInput }: ModeBBundle): Promise<PredicateTraceSummary> {
  const concrete = bundle.concreteSettlement!;
  const commitment = bundle.modeBCommitment!;
  return {
    mandateType: "INTENT",
    predicate: {
      allowedPayees: guardInput.predicate.allowedPayees,
      maxValue: guardInput.predicate.maxValue,
      allowedAssets: guardInput.predicate.allowedAssets,
      validUntil: guardInput.predicate.validUntil,
      allowedChainIds: guardInput.predicate.allowedChainIds,
    },
    concreteSettlement: {
      payTo: concrete.payTo,
      value: concrete.value,
      asset: concrete.asset,
      chainId: concrete.chainId,
      validBefore: concrete.validBefore,
    },
    settledAt: bundle.settlement.settledAt,
    commitmentCprime: commitment,
    nonce: deriveSettlementNonce(commitment),
    guardWouldAllow: await guardAllowsSettlement(guardInput),
  };
}

export async function runPredicateAttack(id: PredicateAttackId): Promise<PredicateAttackRunResult> {
  const fixture = MODE_B_PREDICATE_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Unknown predicate attack fixture: ${id}`);
  }

  const violatedBundle = await fixture.build();
  const { bundle, guardInput } = violatedBundle;

  const guardPrevented = !(await guardAllowsSettlement(guardInput));

  // Reference "honest" delegated settlement to contrast against the violation.
  const authorizedBundle = await buildValidModeBBundle({ traceId: `${bundle.traceId}-authorized` });
  const authorizedTrace = await buildPredicateTraceSummary(authorizedBundle);
  const violatedTrace = await buildPredicateTraceSummary(violatedBundle);
  const anatomy: PredicateAttackAnatomy = {
    ...fixture.anatomy({ authorized: authorizedTrace, violated: violatedTrace }),
    authorizedTrace,
    violatedTrace,
  };

  const verifyStart = performance.now();
  const verification = await verifyTrace(bundle);
  const verifyLatencyMs = performance.now() - verifyStart;

  const failedRules = verification.result.failedRules;
  const matched =
    fixture.expectedFailedRules.length === 0
      ? verification.result.status === "PASS"
      : fixture.expectedFailedRules.every((rule) => failedRules.includes(rule));

  const preventionLayer = guardPrevented
    ? "predicate-guard"
    : verification.result.status === "FAIL"
      ? "verifier"
      : "none";

  // B0–B2 from the real baseline verifiers; B3 = live guard + verifier result.
  const b3: BaselineOutcome = {
    detected: guardPrevented || verification.result.status === "FAIL",
    prevented: guardPrevented,
    failedRules: failedRules as BaselineOutcome["failedRules"],
    note: guardPrevented
      ? "Prevented by the predicate guard before any transfer (R17)."
      : verification.result.status === "FAIL"
        ? `Rejected by the deterministic verifier (${failedRules.join(", ") || "R17"}).`
        : "Valid delegated settlement — nothing to detect.",
  };

  return {
    attackId: id,
    label: PREDICATE_ATTACK_LABELS[id],
    traceId: bundle.traceId,
    description: fixture.description,
    verification,
    expectedFailedRules: fixture.expectedFailedRules,
    matched,
    preventionLayer,
    guardPrevented,
    anatomy,
    baselineComparison: await liveBaselineOutcomes(bundle, b3),
    metrics: {
      verifyLatencyMs,
      eventCount: bundle.events.length,
      storageBytesEstimate: estimateStorageBytes(bundle),
    },
  };
}

export async function runAllPredicateAttacks(): Promise<{
  generatedAt: string;
  results: PredicateAttackRunResult[];
  matrix: Record<PredicateAttackId, Record<BaselineId, BaselineOutcome>>;
}> {
  const results: PredicateAttackRunResult[] = [];
  for (const fixture of MODE_B_PREDICATE_FIXTURES) {
    results.push(await runPredicateAttack(fixture.id));
  }
  return {
    generatedAt: new Date(BASE_TIME).toISOString(),
    results,
    matrix: buildP5Matrix(
      results.map((r) => ({ attackId: r.attackId, guardPrevented: r.guardPrevented, verification: r.verification })),
      MODE_B_PREDICATE_FIXTURES,
    ),
  };
}

export function listPredicateAttacks() {
  return MODE_B_PREDICATE_FIXTURES.map(({ id, description, expectedFailedRules }) => ({
    id,
    label: PREDICATE_ATTACK_LABELS[id],
    description,
    expectedFailedRules,
  }));
}

type P5LiveInput = {
  attackId: PredicateAttackId;
  guardPrevented: boolean;
  verification: VerifyTraceOutput;
};

export function buildP5Matrix(
  results: P5LiveInput[],
  fixtures: readonly PredicateAttackFixture[],
): Record<PredicateAttackId, Record<BaselineId, BaselineOutcome>> {
  const byId = new Map(results.map((r) => [r.attackId, r]));
  const matrix = {} as Record<PredicateAttackId, Record<BaselineId, BaselineOutcome>>;

  for (const fixture of fixtures) {
    const live = byId.get(fixture.id);
    const failedRules = (live?.verification.result.failedRules ?? []) as RuleId[];
    const detected = live !== undefined && live.verification.result.status === "FAIL";
    const prevented = live?.guardPrevented === true;
    matrix[fixture.id] = {
      ...fixture.baselineOutcomes,
      B3: {
        detected,
        prevented,
        failedRules,
        note: prevented
          ? "Live B3 prevented at predicate guard; R17 audits the trace."
          : detected
            ? "Live B3 detected by verifier R17."
            : "Live B3: valid settlement (happy path).",
      },
    };
  }

  return matrix;
}
