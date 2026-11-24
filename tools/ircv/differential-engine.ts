/**
 * IRCV component 3 — differential test engine.
 *
 * Compares Normalize(tau_impl) with the constraints extracted from the
 * committed Tamarin model. `PASS` means the observed trace matches the
 * expectation recorded for that scenario; `FAIL` means it does not.
 */

import type { NormalizedScenario } from "./implementation-trace-normalizer";
import { IMPLEMENTATION_ONLY_KINDS } from "./implementation-trace-normalizer";
import type { FormalVocabulary, IrcvEvent, IrcvEventKind } from "./model-trace-generator";

export type ConstraintViolation = {
  constraintId: string;
  detail: string;
  expected: string;
  actual: string;
};

export type ScenarioDiff = {
  scenarioId: string;
  scenarioKind: string;
  description: string;
  expectation: string;
  conformance: "CONFORMANT" | "NON-CONFORMANT" | "NOT COMPARABLE";
  violations: ConstraintViolation[];
  verifierStatus: "PASS" | "FAIL";
  failedRules: string[];
  replayPrevented?: boolean;
  result: "PASS" | "FAIL";
  notes: string[];
};

export type DifferentialReport = {
  schema: "ircv-differential/v1";
  modelSource: string;
  constraintsEvaluated: string[];
  modelEventKinds: IrcvEventKind[];
  implementationOnlyKinds: IrcvEventKind[];
  kindCoverage: {
    observedKinds: IrcvEventKind[];
    mappedKinds: IrcvEventKind[];
    unmappedKinds: IrcvEventKind[];
    modelKindsNotObserved: IrcvEventKind[];
  };
  scenarios: ScenarioDiff[];
  summary: {
    totalScenarios: number;
    comparableScenarios: number;
    resultsPass: number;
    resultsFail: number;
    conformantHonestScenarios: number;
    detectedAttackScenarios: number;
  };
};

type Expectation = {
  comparable: boolean;
  expectedViolations: string[];
  expectedVerifierStatus: "PASS" | "FAIL";
};

const EXPECTATIONS: Record<string, Expectation> = {
  MODE_A_HONEST: { comparable: false, expectedViolations: [], expectedVerifierStatus: "PASS" },
  MODE_B_HONEST: { comparable: true, expectedViolations: [], expectedVerifierStatus: "PASS" },
  MODE_B_PAYEE_ATTACK: { comparable: true, expectedViolations: ["MC-P4"], expectedVerifierStatus: "FAIL" },
  MODE_B_AMOUNT_ATTACK: { comparable: true, expectedViolations: ["MC-P4"], expectedVerifierStatus: "FAIL" },
  MODE_B_REPLAY_ATTACK: { comparable: true, expectedViolations: [], expectedVerifierStatus: "FAIL" },
  RCLB_STALE_IDENTITY_EPOCH: { comparable: false, expectedViolations: [], expectedVerifierStatus: "FAIL" },
};

function before(events: IrcvEvent[], settlementSeq: number, kind: IrcvEventKind): IrcvEvent[] {
  return events.filter((candidate) => candidate.kind === kind && candidate.seq < settlementSeq);
}

function evaluateConstraints(events: IrcvEvent[]): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const settlements = events.filter((event) => event.kind === "settlement");

  for (const settlement of settlements) {
    const agentId = settlement.bindings.agentId ?? "";
    const key = settlement.bindings.key ?? "";
    const keys = before(events, settlement.seq, "key_authorization").filter(
      (candidate) => candidate.bindings.agentId === agentId && candidate.bindings.key === key,
    );
    if (keys.length === 0) {
      violations.push({
        constraintId: "MC-P1",
        detail: `No authorized key for agent ${agentId} before settlement ${settlement.seq}`,
        expected: `key_authorization(agentId=${agentId}, key=${key})`,
        actual: "absent",
      });
    }

    const delegations = before(events, settlement.seq, "delegation").filter(
      (candidate) =>
        candidate.bindings.commitment === settlement.bindings.commitment &&
        candidate.bindings.nonce === settlement.bindings.nonce,
    );
    if (delegations.length === 0) {
      violations.push({
        constraintId: "MC-P2",
        detail: `No matching human delegation before settlement ${settlement.seq}`,
        expected: `delegation(commitment=${settlement.bindings.commitment}, nonce=${settlement.bindings.nonce})`,
        actual: "absent",
      });
    } else if (
      settlement.bindings.predicateDigest !== "0x" &&
      delegations.some((candidate) => candidate.bindings.predicateDigest !== settlement.bindings.predicateDigest)
    ) {
      violations.push({
        constraintId: "MC-P5",
        detail: "Delegated predicate digest differs from the settled predicate digest",
        expected: delegations[0]?.bindings.predicateDigest ?? "",
        actual: settlement.bindings.predicateDigest ?? "",
      });
    }

    const admissions = before(events, settlement.seq, "predicate_decision").filter(
      (candidate) =>
        candidate.bindings.decision === "allow" &&
        candidate.bindings.predicateId === settlement.bindings.predicateId,
    );
    if (admissions.length === 0) {
      violations.push({
        constraintId: "MC-P4",
        detail: `No admitting predicate decision before settlement ${settlement.seq}`,
        expected: `predicate_decision(predicateId=${settlement.bindings.predicateId}, decision=allow)`,
        actual:
          before(events, settlement.seq, "predicate_decision")
            .map((candidate) => `${candidate.bindings.predicateId}:${candidate.bindings.decision}`)
            .join(",") || "absent",
      });
    }

    const anchors = before(events, settlement.seq, "principal_anchor").filter(
      (candidate) => candidate.bindings.principal === settlement.bindings.principal,
    );
    if (anchors.length === 0) {
      violations.push({
        constraintId: "MC-P6",
        detail: `No anchored principal before settlement ${settlement.seq}`,
        expected: `principal_anchor(${settlement.bindings.principal})`,
        actual: "absent",
      });
    }
  }

  const counts = new Map<string, number>();
  for (const consumed of events.filter((event) => event.kind === "nonce_consumption")) {
    const nonce = consumed.bindings.nonce ?? "";
    counts.set(nonce, (counts.get(nonce) ?? 0) + 1);
  }
  for (const [nonce, count] of counts) {
    if (count > 1) {
      violations.push({
        constraintId: "MC-P3",
        detail: `Nonce ${nonce} consumed ${count} times`,
        expected: "<= 1 consumption per nonce",
        actual: String(count),
      });
    }
  }

  return violations;
}

export function runDifferential(
  vocabulary: FormalVocabulary,
  scenarios: NormalizedScenario[],
): DifferentialReport {
  const modelKinds = new Set<IrcvEventKind>(vocabulary.modelEventKinds);
  const observedKinds = [
    ...new Set(scenarios.flatMap((scenario) => scenario.trace.events.map((event) => event.kind))),
  ].sort() as IrcvEventKind[];
  const mappedKinds = observedKinds.filter((kind) => modelKinds.has(kind));
  const unmappedKinds = observedKinds.filter((kind) => !modelKinds.has(kind));
  const modelKindsNotObserved = [...modelKinds].filter((kind) => !observedKinds.includes(kind)).sort();

  const diffs: ScenarioDiff[] = scenarios.map((scenario) => {
    const expectation = EXPECTATIONS[scenario.scenarioId] ?? {
      comparable: scenario.scenarioKind === "honest",
      expectedViolations: [],
      expectedVerifierStatus: scenario.scenarioKind === "honest" ? "PASS" : "FAIL",
    };
    const violations = expectation.comparable
      ? evaluateConstraints(scenario.trace.events)
      : [];
    const conformance = !expectation.comparable
      ? "NOT COMPARABLE"
      : violations.length === 0
        ? "CONFORMANT"
        : "NON-CONFORMANT";
    const observedViolationIds = violations.map((violation) => violation.constraintId).sort();
    const expectedIds = [...expectation.expectedViolations].sort();
    const matchesViolations =
      observedViolationIds.length === expectedIds.length &&
      observedViolationIds.every((id, index) => id === expectedIds[index]);
    const result: "PASS" | "FAIL" =
      matchesViolations && scenario.verifier.status === expectation.expectedVerifierStatus ? "PASS" : "FAIL";

    return {
      scenarioId: scenario.scenarioId,
      scenarioKind: scenario.scenarioKind ?? "unknown",
      description: scenario.description,
      expectation: scenario.expected,
      conformance,
      violations,
      verifierStatus: scenario.verifier.status,
      failedRules: scenario.verifier.failedRules,
      ...(scenario.facilitator?.replayPrevented === undefined
        ? {}
        : { replayPrevented: scenario.facilitator.replayPrevented }),
      result,
      notes: scenario.notes,
    };
  });

  return {
    schema: "ircv-differential/v1",
    modelSource: vocabulary.sources.spthy,
    constraintsEvaluated: vocabulary.constraints.map((constraint) => constraint.id),
    modelEventKinds: vocabulary.modelEventKinds,
    implementationOnlyKinds: IMPLEMENTATION_ONLY_KINDS,
    kindCoverage: {
      observedKinds,
      mappedKinds,
      unmappedKinds,
      modelKindsNotObserved,
    },
    scenarios: diffs,
    summary: {
      totalScenarios: diffs.length,
      comparableScenarios: diffs.filter((diff) => diff.conformance !== "NOT COMPARABLE").length,
      resultsPass: diffs.filter((diff) => diff.result === "PASS").length,
      resultsFail: diffs.filter((diff) => diff.result === "FAIL").length,
      conformantHonestScenarios: diffs.filter(
        (diff) => diff.scenarioKind === "honest" && diff.conformance === "CONFORMANT",
      ).length,
      detectedAttackScenarios: diffs.filter(
        (diff) => diff.scenarioKind === "attack" && diff.result === "PASS" && diff.verifierStatus === "FAIL",
      ).length,
    },
  };
}
