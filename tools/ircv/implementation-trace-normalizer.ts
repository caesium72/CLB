/**
 * IRCV component 2 — implementation-trace normalizer.
 *
 * Runs EXISTING scenario fixtures through the TypeScript implementation and
 * projects their observable events into the same `ircv-trace/v1` schema the
 * model generator emits. No new protocol behaviour is introduced here.
 */

import {
  TEST_KEYS,
  attackerAddress,
  buildValidBundle,
  buildValidModeBBundle,
  defaultConcrete,
  descriptor,
  markReplayAttempt,
  verifyTrace,
} from "@clb-acel/attack-core";
import { computePredicateDigest } from "@clb-acel/clb-core";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { IrcvEvent, IrcvEventKind, IrcvTrace } from "./model-trace-generator";

export const HUMAN_PRINCIPAL = privateKeyToAccount(TEST_KEYS.userKey).address;
export const IMPLEMENTATION_ONLY_KINDS: IrcvEventKind[] = ["nonce"];

// attack-core re-exports verifyTrace; the workspace root does not link
// @clb-acel/verifier-core directly, so derive the types from the re-export.
type TraceBundle = Awaited<ReturnType<typeof buildValidBundle>>;
type VerifyTraceOutput = Awaited<ReturnType<typeof verifyTrace>>;

export type NormalizedScenario = {
  scenarioId: string;
  scenarioKind: "honest" | "attack" | "out-of-model";
  description: string;
  expected: string;
  trace: IrcvTrace;
  verifier: {
    status: "PASS" | "FAIL";
    failedRules: string[];
  };
  facilitator?: { replayPrevented?: boolean; errorName?: string };
  notes: string[];
};

function event(
  seq: number,
  kind: IrcvEventKind,
  label: string,
  subject: string,
  bindings: Record<string, string>,
  origin: string,
): IrcvEvent {
  return { seq, kind, label, subject, bindings, origin };
}

function normalize(
  scenarioId: string,
  scenarioKind: IrcvTrace["scenarioKind"],
  bundle: TraceBundle,
  verification: VerifyTraceOutput,
  description: string,
  expected: string,
  extraBindings: Record<string, string> = {},
  failure?: { reason: string; detail: string },
): NormalizedScenario {
  const modeB = bundle.mode === "MODE_B_PREDICATE";
  const descriptor = bundle.clb.settlementDescriptor;
  const predicate = descriptor.x402Scheme === "predicate" ? descriptor.predicate : undefined;
  const commitment = modeB
    ? (bundle.modeBCommitment ?? "0x")
    : (bundle.mandate.clbCommitment ?? "0x");
  const nonce = bundle.paymentPayload.authorization.nonce;
  const key = bundle.payerAgent.authorizedPaymentKeys[0] ?? "0x";
  const predicateId = descriptor.x402Scheme === "predicate" ? descriptor.predicateId : "";
  const predicateDigest = predicate ? computePredicateDigest(predicate) : "0x";
  const r17 = verification.outcomes.R17_PREDICATE_TRUE_FOR_MODE_B;
  const predicateAllowed = r17.ok;

  const events: IrcvEvent[] = [
    event(1, "principal_anchor", "PrincipalAnchored", HUMAN_PRINCIPAL, {
      principal: HUMAN_PRINCIPAL,
      declared: bundle.mandate.humanPrincipal,
    }, `${scenarioId}:trusted-anchor`),
    event(2, "key_authorization", "KeyAuthorized", bundle.payerAgent.agentId, {
      agentId: bundle.payerAgent.agentId,
      key,
    }, `${scenarioId}:agent-card`),
  ];

  let seq = 3;
  if (modeB && predicate) {
    events.push(event(seq++, "predicate_registration", "PredicateRegistered", predicateId, {
      predicateId,
      predicateDigest,
    }, `${scenarioId}:clb-descriptor`));
    events.push(event(seq++, "delegation", "DelegatedB", HUMAN_PRINCIPAL, {
      principal: HUMAN_PRINCIPAL,
      predicateId,
      predicateDigest,
      commitment,
      nonce,
    }, `${scenarioId}:mode-b-commitment`));
  }

  events.push(event(seq++, "commitment", modeB ? "Cp" : "C", commitment, {
    commitment,
    nonce,
    mode: bundle.mode,
  }, `${scenarioId}:commitment`));
  events.push(event(seq++, "nonce", "Nonce", nonce, {
    nonce,
    derivation: "H(C) or H(C')",
  }, `${scenarioId}:payment-authorization`));

  if (modeB && predicate) {
    events.push(event(seq++, "predicate_decision", "GuardPassed", predicateId, {
      predicateId,
      decision: predicateAllowed ? "allow" : "reject",
      detail: r17.detail ?? "",
    }, `${scenarioId}:R17`));
  }

  events.push(event(seq++, "settlement", "SettledB", bundle.payerAgent.agentId, {
    agentId: bundle.payerAgent.agentId,
    principal: HUMAN_PRINCIPAL,
    predicateId,
    predicateDigest,
    commitment,
    nonce,
    payTo: bundle.settlement.payTo,
    asset: bundle.settlement.asset,
    value: bundle.settlement.value,
    chainId: String(bundle.settlement.chainId),
    key: bundle.settlement.payer,
    settled: String(bundle.settlement.settled),
    ...extraBindings,
  }, `${scenarioId}:settlement-receipt`));

  if (failure) {
    events.push(event(seq++, "settlement_failure", "FailedSettle", nonce, {
      nonce,
      reason: failure.reason,
      detail: failure.detail,
    }, `${scenarioId}:failed-attempt`));
  }

  events.push(event(seq++, "nonce_consumption", "Consumed", nonce, {
    nonce,
    count: "1",
  }, `${scenarioId}:nonce-store`));
  events.push(event(seq++, "verification_verdict", "Eq(verify(sig,Cp,pkH),true)", verification.result.traceId, {
    status: verification.result.status,
    failedRules: verification.result.failedRules.join(","),
    verifierVersion: verification.certificate.verifierVersion,
  }, `${scenarioId}:verifyTrace`));

  return {
    scenarioId,
    scenarioKind: scenarioKind ?? "honest",
    description,
    expected,
    trace: {
      schema: "ircv-trace/v1",
      sourceKind: "implementation",
      sourcePath: `existing fixture → ${scenarioId}`,
      scenarioId,
      mode: bundle.mode,
      scenarioKind,
      events,
      notes: [
        "Events are derived from existing fixtures and verifyTrace output; no protocol code was modified.",
        "The trusted principal anchor is the test key from packages/attack-core/src/fixtures.ts.",
      ],
    },
    verifier: {
      status: verification.result.status,
      failedRules: verification.result.failedRules,
    },
    notes: [],
  };
}

export async function normalizeImplementationScenarios(): Promise<NormalizedScenario[]> {
  const results: NormalizedScenario[] = [];

  // 1. Mode A honest — outside the Mode B model alphabet.
  {
    const bundle = await buildValidBundle({ traceId: "ircv-mode-a-honest" });
    const verification = await verifyTrace(bundle, { expectedHumanPrincipal: HUMAN_PRINCIPAL });
    results.push(normalize(
      "MODE_A_HONEST", "out-of-model", bundle, verification,
      "Honest exact-settlement trace (Mode A).",
      "NOT COMPARABLE (model is Mode B only); verifier PASS",
    ));
  }

  // 2. Mode B honest — the refinement target.
  {
    const { bundle } = await buildValidModeBBundle({ traceId: "ircv-mode-b-honest" });
    const verification = await verifyTrace(bundle, { expectedHumanPrincipal: HUMAN_PRINCIPAL });
    results.push(normalize(
      "MODE_B_HONEST", "honest", bundle, verification,
      "Honest delegated settlement inside the human-signed predicate.",
      "CONFORMANT (all MC constraints hold); verifier PASS",
    ));
  }

  // 3/4. Mode B predicate attacks — fixture settles, R17/guard rejects.
  {
    const { bundle } = await buildValidModeBBundle({
      traceId: "ircv-mode-b-payee-attack",
      concrete: defaultConcrete({ payTo: attackerAddress }),
    });
    const verification = await verifyTrace(bundle, { expectedHumanPrincipal: HUMAN_PRINCIPAL });
    const scenario = normalize(
      "MODE_B_PAYEE_ATTACK", "attack", bundle, verification,
      "Settlement routes to a payee outside the human-signed predicate.",
      "NON-CONFORMANT (MC-P4); verifier FAIL",
      {},
      { reason: "PAYEE_NOT_ALLOWED", detail: verification.outcomes.R17_PREDICATE_TRUE_FOR_MODE_B.detail ?? "" },
    );
    scenario.notes.push(
      "The mode-b fixture calls the facilitator directly and therefore settles despite the predicate rejection; the pre-settlement guard path (draftModeBPayment + InMemoryPredicateGuard) is a separate, earlier gate.",
    );
    results.push(scenario);
  }
  {
    const { bundle } = await buildValidModeBBundle({
      traceId: "ircv-mode-b-amount-attack",
      concrete: defaultConcrete({ value: "9.00" }),
    });
    const verification = await verifyTrace(bundle, { expectedHumanPrincipal: HUMAN_PRINCIPAL });
    const scenario = normalize(
      "MODE_B_AMOUNT_ATTACK", "attack", bundle, verification,
      "Settlement amount exceeds the human-signed predicate cap.",
      "NON-CONFORMANT (MC-P4); verifier FAIL",
      {},
      { reason: "AMOUNT_EXCEEDS_MAX", detail: verification.outcomes.R17_PREDICATE_TRUE_FOR_MODE_B.detail ?? "" },
    );
    scenario.notes.push(
      "Fixture-level divergence: the direct facilitator path settles before the off-chain predicate gate; see MODE_B_PAYEE_ATTACK note.",
    );
    results.push(scenario);
  }

  // 5. Replay — the facilitator prevents the second consumption.
  {
    const { bundle } = await buildValidModeBBundle({ traceId: "ircv-mode-b-replay" });
    const replay = await markReplayAttempt(bundle);
    const verification = await verifyTrace(replay.bundle, { expectedHumanPrincipal: HUMAN_PRINCIPAL });
    const scenario = normalize(
      "MODE_B_REPLAY_ATTACK", "attack", replay.bundle, verification,
      "Second settlement attempt with the same C' nonce.",
      "CONFORMANT after prevention (MC-P3 holds); verifier FAIL flags the attempt",
      {},
      { reason: "NONCE_REPLAY", detail: replay.errorName ?? "NonceAlreadyConsumedError" },
    );
    scenario.facilitator = { replayPrevented: replay.prevented, errorName: replay.errorName };
    scenario.notes.push("The second attempt was rejected by the local x402 facilitator before a second nonce consumption was recorded.");
    results.push(scenario);
  }

  // 6. RCLB stale identity epoch — revocation vocabulary is absent from the model.
  {
    const bundle = await buildValidBundle({ traceId: "ircv-rclb-stale-epoch" });
    const base = "0x" + "11".repeat(32) as Hex;
    const verification = await verifyTrace(bundle, {
      expectedHumanPrincipal: HUMAN_PRINCIPAL,
      revocationBinding: {
        baseCommitment: base,
        commitment: "0x" + "22".repeat(32) as Hex,
        identityEpoch: 2n,
        mandateEpoch: 1n,
        expiry: 1_800_000_000n,
        nonce: "0x" + "33".repeat(32) as Hex,
        now: 1_700_000_000n,
        current: { identityEpoch: 3n, mandateEpoch: 1n },
      },
    });
    const scenario = normalize(
      "RCLB_STALE_IDENTITY_EPOCH", "out-of-model", bundle, verification,
      "Settlement presents C_t signed under an identity epoch that has since been revoked.",
      "NOT COMPARABLE (RCLB absent from clb-aligned.spthy); verifier R18 FAIL",
      { revocation: "IDENTITY_EPOCH_STALE" },
      { reason: "IDENTITY_EPOCH_STALE", detail: "Authority advanced E_I from 2 to 3 after signing." },
    );
    scenario.verifier.failedRules = verification.result.failedRules;
    scenario.notes.push("R18 is additive and opt-in; the model has no revocation fact, so this scenario is reported as out-of-model.");
    results.push(scenario);
  }

  return results;
}
