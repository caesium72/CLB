import { verifyTrace } from "@clb-acel/verifier-core";
import type { TraceBundle } from "@clb-acel/verifier-core";
export { verifyTrace } from "@clb-acel/verifier-core";
import type { Hex } from "viem";
import { checkFakeFeedback, checkPromptInjection } from "./audit-checks";
import { BASELINE_DESCRIPTIONS, BASELINE_LABELS, buildBaselineMatrix, commonOutcomes, liveBaselineOutcomes } from "./baselines";
import type { BaselineOutcome } from "./types";
import {
  appendEvidenceEvent,
  attackerAddress,
  buildValidBundle,
  constraints,
  descriptor,
  markReplayAttempt,
  merchantAddress,
  payerAgent,
} from "./fixtures";
import { estimateStorageBytes } from "./metrics";
import type {
  AttackAnatomyTemplate,
  AttackFixture,
  AttackId,
  AttackRunResult,
  AttackScenario,
  AttackTraceSummary,
} from "./types";

export * from "./audit-checks";
export * from "./baselines";
export * from "./baselines/matrix";
export * from "./fixtures";
export * from "./metrics";
export * from "./mode-b";
export * from "./types";
export { BASELINE_DESCRIPTIONS, BASELINE_LABELS };

const TOKENS = ["XYZ", "AAVE", "UNI", "OP", "LINK", "ARB"] as const;
const AMOUNT_PAIRS = [
  ["1.25", "2.50"],
  ["2.00", "3.00"],
  ["4.50", "7.25"],
  ["8.00", "12.00"],
] as const;
const ASSET_PAIRS = [
  ["USDC", "WETH"],
  ["EURC", "USDC"],
  ["DAI", "WETH"],
  ["PYUSD", "DAI"],
] as const;
const ATTACKER_PAYEES = [
  attackerAddress,
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
] as const;

function pick<T>(values: readonly T[], seed: number): T {
  return values[Math.abs(seed) % values.length]!;
}

function mixSeed(seed: number, salt: number): number {
  return Math.imul(seed ^ salt, 2_654_435_761) >>> 0;
}

function hexFromSeed(seed: number, salt: number): Hex {
  let state = mixSeed(seed, salt);
  let hex = "";
  while (hex.length < 64) {
    state = mixSeed(state, salt + hex.length);
    hex += state.toString(16).padStart(8, "0");
  }
  return `0x${hex.slice(0, 64)}` as Hex;
}

function buildScenario(seed: number): AttackScenario {
  const amountPair = pick(AMOUNT_PAIRS, mixSeed(seed, 11));
  const assetPair = pick(ASSET_PAIRS, mixSeed(seed, 23));

  return {
    seed,
    token: pick(TOKENS, mixSeed(seed, 31)),
    baseAmount: amountPair[0],
    attackAmount: amountPair[1],
    allowedAsset: assetPair[0],
    attackAsset: assetPair[1],
    attackerPayee: pick(ATTACKER_PAYEES, mixSeed(seed, 43)),
    taskHash: hexFromSeed(seed, 53),
    reportInputDataHash: hexFromSeed(seed, 67),
  };
}

function resolveAnatomy(
  template: AttackAnatomyTemplate,
  scenario: AttackScenario,
): Omit<AttackRunResult["anatomy"], "honestTrace" | "attackedTrace"> {
  return typeof template === "function" ? template(scenario) : template;
}

function summarizeTrace(bundle: TraceBundle): AttackTraceSummary {
  const feedbackEventIds = bundle.events
    .filter((event) => event.objectType === "ERC8004_FEEDBACK")
    .map((event) => event.eventId);
  const selection = bundle.events.find((event) => event.objectType === "ERC8004_AGENT_SELECTION");
  const selectedPayee = selection?.publicFields.selectedPayee;

  return {
    settlement: {
      payTo: bundle.settlement.payTo,
      value: bundle.settlement.value,
      asset: bundle.settlement.asset,
      chainId: bundle.settlement.chainId,
      nonce: bundle.settlement.nonce,
    },
    mandate: {
      ...(bundle.mandate.constraints.maxAmount ? { maxAmount: bundle.mandate.constraints.maxAmount } : {}),
      ...(bundle.mandate.constraints.allowedAssets ? { allowedAssets: bundle.mandate.constraints.allowedAssets } : {}),
      ...(bundle.mandate.constraints.allowedPayees ? { allowedPayees: bundle.mandate.constraints.allowedPayees } : {}),
      ...(bundle.mandate.constraints.taskHash ? { taskHash: bundle.mandate.constraints.taskHash } : {}),
    },
    payerAgent: {
      authorizedPaymentKeys: bundle.payerAgent.authorizedPaymentKeys,
    },
    report: {
      inputDataHash: bundle.report.inputDataHash,
      reportHash: bundle.report.reportHash,
    },
    evidence: {
      eventCount: bundle.events.length,
      objectTypes: bundle.events.map((event) => event.objectType),
      feedbackEventIds,
      ...(typeof selectedPayee === "string" ? { selectedPayee } : {}),
    },
    nonceReplayAttempt: bundle.nonceReplayAttempt === true,
  };
}

export const ATTACK_FIXTURES: AttackFixture[] = [
  {
    id: "PAYEE_SUBSTITUTION",
    description: "Settlement payee is swapped to an attacker address.",
    expectedResultCode: "PAYEE_MISMATCH",
    expectedFailedRules: ["R12_PAYEE_MATCHES_CHECKOUT_OR_TASK"],
    mutate: (_bundle, scenario) =>
      buildValidBundle({
        settlementDescriptor: descriptor({
          value: scenario.baseAmount,
          asset: scenario.allowedAsset,
          payTo: scenario.attackerPayee as typeof attackerAddress,
        }),
        mandateConstraints: constraints({
          maxAmount: scenario.baseAmount,
          allowedAssets: [scenario.allowedAsset],
        }),
        reportInputDataHash: scenario.reportInputDataHash as Hex,
        token: scenario.token,
      }),
    anatomy: (scenario) => ({
      summary: "The payment recipient is replaced with an attacker wallet while the mandate still expects the approved merchant.",
      steps: ["Honest checkout binds the merchant payee", "Attack swaps settlement.payTo", "Verifier compares payee against allowedPayees and merchant identity"],
      mutations: [
        {
          path: "settlement.payTo",
          before: merchantAddress,
          after: scenario.attackerPayee,
          impact: "Funds would route to an address outside the human-approved merchant constraint.",
        },
      ],
      evidenceFocus: ["AP2_CART_MANDATE", "X402_PAYMENT_PAYLOAD", "CHAIN_SETTLEMENT"],
      detectedBy: ["R12_PAYEE_MATCHES_CHECKOUT_OR_TASK"],
    }),
    baselineOutcomes: {
      B0: commonOutcomes.b0(),
      B1: commonOutcomes.b1(),
      B2: commonOutcomes.b2(),
      B3: { detected: true, prevented: false, note: "Live verifier should fail R12." },
    },
  },
  {
    id: "AMOUNT_ESCALATION",
    description: "Settlement amount exceeds the human mandate max amount.",
    expectedResultCode: "AMOUNT_EXCEEDS_MANDATE",
    expectedFailedRules: ["R11_AMOUNT_WITHIN_MANDATE"],
    mutate: (_bundle, scenario) =>
      buildValidBundle({
        settlementDescriptor: descriptor({
          value: scenario.attackAmount,
          asset: scenario.allowedAsset,
        }),
        mandateConstraints: constraints({
          maxAmount: scenario.baseAmount,
          allowedAssets: [scenario.allowedAsset],
        }),
        reportInputDataHash: scenario.reportInputDataHash as Hex,
        token: scenario.token,
      }),
    anatomy: (scenario) => ({
      summary: "The settlement amount is raised above the user-approved spending limit.",
      steps: [`Honest mandate caps spend at ${scenario.baseAmount}`, `Attack submits a ${scenario.attackAmount} settlement`, "Verifier checks settled value against maxAmount"],
      mutations: [
        {
          path: "settlement.value",
          before: scenario.baseAmount,
          after: scenario.attackAmount,
          impact: "The merchant would collect more than the mandate permits.",
        },
      ],
      evidenceFocus: ["AP2_CART_MANDATE", "X402_PAYMENT_PAYLOAD", "CHAIN_SETTLEMENT"],
      detectedBy: ["R11_AMOUNT_WITHIN_MANDATE"],
    }),
    baselineOutcomes: {
      B0: commonOutcomes.b0(),
      B1: commonOutcomes.b1(),
      B2: commonOutcomes.b2(),
      B3: { detected: true, prevented: false, note: "Live verifier should fail R11." },
    },
  },
  {
    id: "ASSET_SWITCH",
    description: "Settlement asset changes from the allowed USDC asset.",
    expectedResultCode: "ASSET_NOT_ALLOWED",
    expectedFailedRules: ["R13_ASSET_ALLOWED"],
    mutate: (_bundle, scenario) =>
      buildValidBundle({
        settlementDescriptor: descriptor({
          value: scenario.baseAmount,
          asset: scenario.attackAsset,
        }),
        mandateConstraints: constraints({
          maxAmount: scenario.baseAmount,
          allowedAssets: [scenario.allowedAsset],
        }),
        reportInputDataHash: scenario.reportInputDataHash as Hex,
        token: scenario.token,
      }),
    anatomy: (scenario) => ({
      summary: `The payment asset changes from the allowed ${scenario.allowedAsset} asset to ${scenario.attackAsset}.`,
      steps: [`Honest mandate allows ${scenario.allowedAsset}`, `Attack submits a ${scenario.attackAsset} settlement`, "Verifier checks settlement asset against allowedAssets"],
      mutations: [
        {
          path: "settlement.asset",
          before: scenario.allowedAsset,
          after: scenario.attackAsset,
          impact: "The user did not authorize this asset for payment.",
        },
      ],
      evidenceFocus: ["AP2_CART_MANDATE", "CHAIN_SETTLEMENT"],
      detectedBy: ["R13_ASSET_ALLOWED"],
    }),
    baselineOutcomes: {
      B0: commonOutcomes.b0(),
      B1: commonOutcomes.b1(),
      B2: commonOutcomes.b2(),
      B3: { detected: true, prevented: false, note: "Live verifier should fail R13." },
    },
  },
  {
    id: "CHAIN_TRANSPLANT",
    description: "Settlement receipt is transplanted to the wrong chain domain.",
    expectedResultCode: "CHAIN_DOMAIN_MISMATCH",
    expectedFailedRules: ["R10_CHAIN_DOMAIN_MATCHES"],
    mutate: (bundle) => ({ ...bundle, settlement: { ...bundle.settlement, chainId: 1 } }),
    anatomy: {
      summary: "A settlement from another chain domain is presented inside the Base Sepolia trace.",
      steps: ["Honest CLB domain binds chain 84532", "Attack transplants settlement.chainId to 1", "Verifier compares domain, descriptor, identity, and settlement chain"],
      mutations: [
        {
          path: "settlement.chainId",
          before: "84532",
          after: "1",
          impact: "The settlement no longer belongs to the chain domain committed by C.",
        },
      ],
      evidenceFocus: ["CLB_DOMAIN", "CHAIN_SETTLEMENT", "ERC8004_AGENT_IDENTITY"],
      detectedBy: ["R10_CHAIN_DOMAIN_MATCHES"],
    },
    baselineOutcomes: {
      B0: commonOutcomes.b0(),
      B1: commonOutcomes.b1(),
      B2: commonOutcomes.b2(),
      B3: { detected: true, prevented: false, note: "Live verifier should fail R10." },
    },
  },
  {
    id: "AGENT_IDENTITY_SWAP",
    description: "Payer settlement key is not authorized by the bound ERC-8004 agent card.",
    expectedResultCode: "UNAUTHORIZED_PAYMENT_KEY",
    expectedFailedRules: ["R4_AGENT_PAYMENT_KEY_AUTHORIZED"],
    mutate: (bundle) => ({
      ...bundle,
      payerAgent: { ...payerAgent, authorizedPaymentKeys: [merchantAddress] },
    }),
    anatomy: {
      summary: "The payer key used by settlement is no longer authorized by the bound shopping-agent identity.",
      steps: ["Honest agent card authorizes the shopper key", "Attack swaps the authorized payment key set", "Verifier checks settlement payer against the bound agent card"],
      mutations: [
        {
          path: "payerAgent.authorizedPaymentKeys",
          before: payerAgent.authorizedPaymentKeys.join(", "),
          after: merchantAddress,
          impact: "The settlement payer cannot be attributed to the authorized shopping agent.",
        },
      ],
      evidenceFocus: ["ERC8004_AGENT_IDENTITY", "CHAIN_SETTLEMENT"],
      detectedBy: ["R4_AGENT_PAYMENT_KEY_AUTHORIZED"],
    },
    baselineOutcomes: {
      B0: commonOutcomes.b0(),
      B1: commonOutcomes.b1("AP2 identity exists, but key authorization is not enforced in payment."),
      B2: commonOutcomes.b2(),
      B3: { detected: true, prevented: false, note: "Live verifier should fail R4." },
    },
  },
  {
    id: "MANDATE_REPLAY",
    description: "The same CLB-derived x402 nonce is submitted twice.",
    expectedResultCode: "NONCE_REPLAY",
    expectedFailedRules: ["R9_NONCE_CONSUMED_EXACTLY_ONCE"],
    mutate: async (bundle) => (await markReplayAttempt(bundle)).bundle,
    anatomy: {
      summary: "The same CLB-derived x402 nonce is submitted twice to replay an already-consumed mandate payment.",
      steps: ["Honest settlement consumes nonce = H(C)", "Attack resubmits the same payment payload", "x402 rejects the second nonce and verifier records replay evidence"],
      mutations: [
        {
          path: "nonceReplayAttempt",
          before: "false",
          after: "true",
          impact: "The trace records a second settlement attempt against the same nonce.",
        },
      ],
      evidenceFocus: ["X402_PAYMENT_PAYLOAD", "CHAIN_SETTLEMENT", "nonce = H(C)"],
      detectedBy: ["R9_NONCE_CONSUMED_EXACTLY_ONCE", "NonceAlreadyConsumedError"],
    },
    baselineOutcomes: {
      B0: commonOutcomes.b0("Vanilla x402 without CLB replay audit does not expose mandate replay."),
      B1: commonOutcomes.b1("AP2-only does not bind replay freshness to C."),
      B2: commonOutcomes.b2("Audit-only detects replay evidence but cannot prevent settlement."),
      B3: { detected: true, prevented: true, note: "Local x402 facilitator rejects the second nonce." },
    },
  },
  {
    id: "CART_OR_TASK_SWITCH",
    description: "Mandate taskHash and delivered report inputDataHash diverge.",
    expectedResultCode: "TASK_HASH_MISMATCH",
    expectedFailedRules: ["R15_TASK_HASH_MATCHES"],
    mutate: (_bundle, scenario) =>
      buildValidBundle({
        settlementDescriptor: descriptor({
          value: scenario.baseAmount,
          asset: scenario.allowedAsset,
        }),
        mandateConstraints: constraints({
          maxAmount: scenario.baseAmount,
          allowedAssets: [scenario.allowedAsset],
          taskHash: scenario.taskHash as Hex,
        }),
        reportInputDataHash: scenario.reportInputDataHash as Hex,
        token: scenario.token,
      }),
    anatomy: (scenario) => ({
      summary: "The mandate pins one task hash, but the delivered report still describes different input data.",
      steps: ["Honest report input hash is produced", "Attack sets mandate.constraints.taskHash to another hash", "Verifier compares taskHash with report.inputDataHash"],
      mutations: [
        {
          path: "mandate.constraints.taskHash",
          before: "unset",
          after: scenario.taskHash,
          impact: "The delivered report is no longer bound to the task authorized in the mandate.",
        },
        {
          path: "report.inputDataHash",
          before: scenario.reportInputDataHash,
          after: scenario.reportInputDataHash,
          impact: "The report stays on the old input, exposing the mismatch with taskHash.",
        },
      ],
      evidenceFocus: ["AP2_CART_MANDATE", "DELIVERY_PROOF"],
      detectedBy: ["R15_TASK_HASH_MATCHES"],
    }),
    baselineOutcomes: {
      B0: commonOutcomes.b0(),
      B1: commonOutcomes.b1("Mandate task binding is not checked at payment time."),
      B2: commonOutcomes.b2(),
      B3: { detected: true, prevented: false, note: "Live verifier should fail R15." },
    },
  },
  {
    id: "PAYMENT_WITHOUT_DELIVERY",
    description: "Delivery proof is invalid after payment settlement.",
    expectedResultCode: "DELIVERY_MISSING_OR_INVALID",
    expectedFailedRules: ["R2_SIGNATURES_VALID"],
    mutate: (bundle, scenario) => ({
      ...bundle,
      report: { ...bundle.report, reportHash: hexFromSeed(scenario.seed, 79) },
    }),
    anatomy: (scenario) => ({
      summary: "The payment settles, but the delivered report hash is broken so delivery cannot be authenticated.",
      steps: ["Honest merchant signs a report hash", "Attack tampers with report.reportHash", "Verifier recomputes report content and signature binding"],
      mutations: [
        {
          path: "report.reportHash",
          before: "valid report hash",
          after: hexFromSeed(scenario.seed, 79),
          impact: "The delivery proof no longer authenticates the report content.",
        },
      ],
      evidenceFocus: ["CHAIN_SETTLEMENT", "DELIVERY_PROOF"],
      detectedBy: ["R2_SIGNATURES_VALID"],
    }),
    baselineOutcomes: {
      B0: commonOutcomes.b0(),
      B1: commonOutcomes.b1(),
      B2: commonOutcomes.b2("Audit-only detects invalid delivery evidence after settlement."),
      B3: { detected: true, prevented: false, note: "Live verifier should fail R2." },
    },
  },
  {
    id: "FAKE_FEEDBACK",
    description: "ERC-8004 feedback appears without a verifier certificate predecessor.",
    expectedResultCode: "FAKE_FEEDBACK_WITHOUT_VERIFICATION",
    expectedFailedRules: [],
    mutate: (bundle, scenario) =>
      appendEvidenceEvent(bundle, {
        traceId: bundle.traceId,
        eventId: `evt-feedback-${scenario.seed % 10_000}`,
        protocol: "ERC8004",
        objectType: "ERC8004_FEEDBACK",
        actor: "attacker",
        timestamp: new Date(Date.parse(bundle.report.generatedAt) + 1000).toISOString(),
        objectHash: hexFromSeed(scenario.seed, 83),
        publicFields: { rating: (scenario.seed % 5) + 1, targetAgentId: bundle.merchantAgent.agentId },
        signature: `0x${"1".repeat(130)}`,
      }),
    auditCheck: (bundle) => checkFakeFeedback(bundle.events),
    anatomy: {
      summary: "A positive ERC-8004 feedback event is appended without a prior verification certificate.",
      steps: ["Honest evidence trace ends after delivery", "Attack appends ERC8004_FEEDBACK", "Audit check requires feedback to be backed by verifier evidence"],
      mutations: [
        {
          path: "events[]",
          before: "No ERC8004_FEEDBACK event",
          after: "evt-feedback-1 / ERC8004_FEEDBACK",
          impact: "The reputation signal is not backed by a verified trace.",
        },
      ],
      evidenceFocus: ["ERC8004_FEEDBACK", "VERIFICATION_CERTIFICATE"],
      detectedBy: ["audit: checkFakeFeedback"],
    },
    baselineOutcomes: {
      B0: commonOutcomes.b0(),
      B1: commonOutcomes.b1(),
      B2: commonOutcomes.b2("ACEL graph audit catches feedback without certificate evidence."),
      B3: { detected: true, prevented: false, note: "Audit-layer check detects fake feedback." },
    },
  },
  {
    id: "PROMPT_INJECTION_SELECTION",
    description: "Discovery is steered to a merchant outside the mandate allowedPayees constraint.",
    expectedResultCode: "PROMPT_INJECTION_SELECTED_UNAUTHORIZED_MERCHANT",
    expectedFailedRules: [],
    mutate: (bundle, scenario) =>
      appendEvidenceEvent(bundle, {
        traceId: bundle.traceId,
        eventId: `evt-selection-${scenario.seed % 10_000}`,
        protocol: "ERC8004",
        objectType: "ERC8004_AGENT_SELECTION",
        actor: "shopping-agent-001",
        timestamp: new Date(Date.parse(bundle.settlement.settledAt) - 5000).toISOString(),
        objectHash: hexFromSeed(scenario.seed, 97),
        publicFields: { selectedPayee: scenario.attackerPayee, reason: "prompt-injected recommendation" },
        signature: `0x${"1".repeat(130)}`,
      }),
    auditCheck: checkPromptInjection,
    anatomy: (scenario) => ({
      summary: "Discovery evidence shows the agent selected a merchant payee outside the user-approved allowedPayees list.",
      steps: ["Honest mandate constrains allowedPayees", "Attack logs an injected merchant selection", "Audit check compares selectedPayee with mandate constraints"],
      mutations: [
        {
          path: "events[].publicFields.selectedPayee",
          before: merchantAddress,
          after: scenario.attackerPayee,
          impact: "The selected merchant violates the user's payee constraint before payment.",
        },
      ],
      evidenceFocus: ["ERC8004_AGENT_SELECTION", "AP2_CART_MANDATE"],
      detectedBy: ["audit: checkPromptInjection"],
    }),
    baselineOutcomes: {
      B0: commonOutcomes.b0(),
      B1: commonOutcomes.b1(),
      B2: commonOutcomes.b2("ACEL logged constraints expose the unauthorized merchant selection."),
      B3: { detected: true, prevented: false, note: "Audit-layer check detects prompt-injected selection." },
    },
  },
];

export function listAttacks() {
  return ATTACK_FIXTURES.map(({ id, description, expectedResultCode, expectedFailedRules }) => ({
    id,
    description,
    expectedResultCode,
    expectedFailedRules,
  }));
}

export async function runAttack(id: AttackId, options: { nowMs?: number } = {}): Promise<AttackRunResult> {
  const fixture = ATTACK_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Unknown attack fixture: ${id}`);
  }

  const seed = options.nowMs ?? Date.now();
  const scenario = buildScenario(seed);
  const base = await buildValidBundle({
    traceId: `trace-${id.toLowerCase()}-${seed}`,
    settlementDescriptor: descriptor({
      value: scenario.baseAmount,
      asset: scenario.allowedAsset,
    }),
    mandateConstraints: constraints({
      maxAmount: scenario.baseAmount,
      allowedAssets: [scenario.allowedAsset],
    }),
    reportInputDataHash: scenario.reportInputDataHash as Hex,
    token: scenario.token,
  });
  let settlementLatencyMs: number | undefined;
  let replayPrevented = false;
  let bundle: TraceBundle;

  if (id === "MANDATE_REPLAY") {
    const replay = await markReplayAttempt(base);
    bundle = replay.bundle;
    settlementLatencyMs = replay.settlementLatencyMs;
    replayPrevented = replay.prevented;
  } else {
    bundle = await fixture.mutate(base, scenario);
  }

  const verifyStart = performance.now();
  const verification = await verifyTrace(bundle);
  const verifyLatencyMs = performance.now() - verifyStart;
  const auditCheck = fixture.auditCheck?.(bundle);
  const failedRules = verification.result.failedRules;
  const verifierMatched =
    fixture.expectedFailedRules.length > 0 &&
    fixture.expectedFailedRules.some((rule) => failedRules.includes(rule));
  const auditMatched = fixture.expectedFailedRules.length === 0 && auditCheck?.ok === true;
  const matched = verifierMatched || auditMatched;
  const preventionLayer = replayPrevented
    ? "x402"
    : auditMatched
      ? "audit"
      : verification.result.status === "FAIL"
        ? "verifier"
        : "none";
  const partialResult = {
    attackId: id,
    traceId: bundle.traceId,
    verification,
    expectedResultCode: fixture.expectedResultCode,
    expectedFailedRules: fixture.expectedFailedRules,
    ...(auditCheck ? { auditCheck } : {}),
    scenario,
    anatomy: {
      ...resolveAnatomy(fixture.anatomy, scenario),
      honestTrace: summarizeTrace(base),
      attackedTrace: summarizeTrace(bundle),
    },
    matched,
    preventionLayer,
    metrics: {
      verifyLatencyMs,
      ...(settlementLatencyMs !== undefined ? { settlementLatencyMs } : {}),
      eventCount: bundle.events.length,
      storageBytesEstimate: estimateStorageBytes(bundle),
    },
  } satisfies Omit<AttackRunResult, "baselineComparison">;

  // B0–B2 are computed by ACTUALLY running the three baseline verifiers against
  // the attacked bundle; B3 is the live CLB-ACEL result. No narrative cells.
  const b3: BaselineOutcome = {
    detected: verification.result.status === "FAIL" || auditCheck?.ok === true,
    prevented: preventionLayer === "x402",
    failedRules: failedRules as BaselineOutcome["failedRules"],
    note:
      preventionLayer === "x402"
        ? "Prevented at x402 replay enforcement; verifier also flagged it."
        : verification.result.status === "FAIL"
          ? `Rejected by the deterministic verifier (${failedRules.join(", ") || "rule"}).`
          : auditCheck?.ok
            ? "Caught by the evidence-graph audit check."
            : "Did not detect this fixture.",
  };

  return {
    ...partialResult,
    baselineComparison: await liveBaselineOutcomes(bundle, b3),
  };
}

export async function runAllAttacks(options: { nowMs?: number } = {}) {
  const results: AttackRunResult[] = [];
  for (const fixture of ATTACK_FIXTURES) {
    results.push(await runAttack(fixture.id, options));
  }
  return {
    generatedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    results,
    matrix: buildBaselineMatrix(results, ATTACK_FIXTURES),
  };
}
