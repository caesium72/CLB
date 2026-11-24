import { describe, expect, it } from "bun:test";
import {
  TEST_KEYS,
  breakReportHash,
  buildValidBundle,
  buildValidModeBBundle,
  defaultConcrete,
} from "@clb-acel/attack-core";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recomputeEvidenceIntegrity } from "../../attack-core/src/trace-utils";
import {
  MANDATORY_RULES,
  VERIFICATION_LEVELS,
  computeRiskScore,
  createHumanApproval,
  selectVerificationLevel,
  verifyAdaptive,
  verifyAtLevel,
  type AdaptiveContext,
  type RiskFactors,
  type RuleId,
  type TraceBundle,
} from "../src/adaptive";

const HUMAN = privateKeyToAccount(TEST_KEYS.userKey).address;
const LOW: RiskFactors = {
  identityAssurance: 1,
  authorizationRisk: 0,
  settlementRisk: 0,
  deliveryRisk: 0,
  historyRisk: 0,
};
const MEDIUM: RiskFactors = {
  identityAssurance: 1,
  authorizationRisk: 1,
  settlementRisk: 0.5,
  deliveryRisk: 0,
  historyRisk: 0,
};
const HIGH: RiskFactors = {
  identityAssurance: 0,
  authorizationRisk: 1,
  settlementRisk: 1,
  deliveryRisk: 1,
  historyRisk: 1,
};

/** Trusted out-of-band context; approval is bound to the bundle's own root. */
async function contextFor(
  bundle: TraceBundle,
  risk: RiskFactors,
  withApproval = true,
): Promise<AdaptiveContext> {
  const score = computeRiskScore(risk);
  return {
    expectedHumanPrincipal: HUMAN,
    expectedMerkleRoot: bundle.merkleRoot,
    ...(withApproval
      ? { humanApproval: await createHumanApproval(bundle, "V3", score, TEST_KEYS.userKey) }
      : {}),
  };
}

describe("AEARV risk model", () => {
  it("is deterministic, bounded and clamps out-of-range inputs", () => {
    expect(computeRiskScore(LOW)).toBe(0);
    expect(computeRiskScore(HIGH)).toBe(1);
    expect(computeRiskScore(LOW)).toBe(computeRiskScore(LOW));

    const clamped = computeRiskScore({
      identityAssurance: -5,
      authorizationRisk: 2,
      settlementRisk: 0.5,
      deliveryRisk: 0,
      historyRisk: 0,
    });
    const explicit = computeRiskScore({
      identityAssurance: 0,
      authorizationRisk: 1,
      settlementRisk: 0.5,
      deliveryRisk: 0,
      historyRisk: 0,
    });
    expect(clamped).toBe(explicit);
    expect(() =>
      computeRiskScore({ ...LOW, identityAssurance: Number.NaN }),
    ).toThrow("must be a finite number");
  });

  it("maps bounded scores to deterministic tiers", () => {
    expect(selectVerificationLevel(0)).toBe("V1");
    expect(selectVerificationLevel(0.339999)).toBe("V1");
    expect(selectVerificationLevel(0.34)).toBe("V2");
    expect(selectVerificationLevel(0.669999)).toBe("V2");
    expect(selectVerificationLevel(0.67)).toBe("V3");
    expect(computeRiskScore(MEDIUM)).toBe(0.35);
    expect(selectVerificationLevel(computeRiskScore(MEDIUM))).toBe("V2");
  });
});

describe("AEARV mandatory-rule invariant", () => {
  it("evaluates every mandatory cryptographic rule at every level", async () => {
    const bundle = await buildValidBundle({ traceId: "aearv-mandatory-present" });
    for (const level of VERIFICATION_LEVELS) {
      const out = await verifyAtLevel(bundle, level, await contextFor(bundle, LOW), LOW);
      for (const rule of MANDATORY_RULES) {
        expect(out.base.outcomes[rule]).toBeDefined();
        expect(out.base.certificate.rulesChecked).toContain(rule);
      }
      expect(out.base.result.status).toBe("PASS");
      expect(out.decision).toBe("PASS");
      expect(out.extraChecksExecuted).toBe(level === "V1" ? 0 : level === "V2" ? 3 : 5);
    }
  });

  it("rejects a bundle failing any mandatory rule at ALL levels", async () => {
    const base = await buildValidBundle({ traceId: "aearv-mandatory-fail" });
    const modeB = await buildValidModeBBundle({
      traceId: "aearv-mandatory-mode-b",
      concrete: defaultConcrete({ value: "9.00" }),
    });

    const tampered: Array<[RuleId, TraceBundle]> = [
      [
        "R1_HASH_CHAIN_INTACT",
        (() => {
          const b = structuredClone(base);
          b.events[0]!.signature = "0x1234";
          return b;
        })(),
      ],
      ["R2_SIGNATURES_VALID", breakReportHash(base)],
      [
        "R5_MANDATE_SIGNATURE_VALID",
        (() => {
          const b = structuredClone(base);
          b.mandate.constraints.maxAmount = "999.00";
          return b;
        })(),
      ],
      [
        "R6_CLB_COMMITMENT_RECOMPUTES",
        (() => {
          const b = structuredClone(base);
          b.mandate.clbCommitment = `0x${"b".repeat(64)}` as Hex;
          return b;
        })(),
      ],
      [
        "R8_PAYMENT_NONCE_EQUALS_HASH_C",
        (() => {
          const b = structuredClone(base);
          b.paymentPayload.authorization.nonce = `0x${"b".repeat(64)}` as Hex;
          return b;
        })(),
      ],
      ["R9_NONCE_CONSUMED_EXACTLY_ONCE", { ...base, nonceReplayAttempt: true }],
      [
        "R10_CHAIN_DOMAIN_MATCHES",
        (() => {
          const b = structuredClone(base);
          b.settlement.chainId = 1;
          return b;
        })(),
      ],
      ["R17_PREDICATE_TRUE_FOR_MODE_B", modeB.bundle],
    ];

    for (const [rule, bundle] of tampered) {
      for (const level of VERIFICATION_LEVELS) {
        const out = await verifyAtLevel(bundle, level, await contextFor(bundle, HIGH), HIGH);
        expect(out.base.outcomes[rule]?.ok, `${rule} @ ${level}`).toBe(false);
        expect(out.failedRules, `${rule} @ ${level}`).toContain(rule);
        expect(out.decision, `${rule} @ ${level}`).toBe("FAIL");
      }
    }
  });
});

type GapCase = {
  id: string;
  bundle: TraceBundle;
  risk: RiskFactors;
  failAt: "V2" | "V3";
  trustedRoot?: Hex;
  withApproval: boolean;
};

async function seededGaps(seeds: readonly number[]): Promise<GapCase[]> {
  const gaps: GapCase[] = [];
  for (const seed of seeds) {
    const base = await buildValidBundle({ traceId: `aearv-gap-${seed}` });

    const noIdentity = structuredClone(base);
    noIdentity.events = noIdentity.events.filter(
      (event) => event.objectType !== "ERC8004_AGENT_IDENTITY",
    );
    gaps.push({
      id: `${seed}-identity-omission`,
      bundle: recomputeEvidenceIntegrity(noIdentity),
      risk: HIGH,
      failAt: "V2",
      withApproval: true,
    });

    const noDelivery = structuredClone(base);
    noDelivery.events = noDelivery.events.filter((event) => event.objectType !== "DELIVERY_PROOF");
    gaps.push({
      id: `${seed}-delivery-omission`,
      bundle: recomputeEvidenceIntegrity(noDelivery),
      risk: HIGH,
      failAt: "V2",
      withApproval: true,
    });

    const rewritten = structuredClone(base);
    rewritten.events[1]!.publicFields = { injected: "attacker-value" };
    gaps.push({
      id: `${seed}-unanchored-rewrite`,
      bundle: recomputeEvidenceIntegrity(rewritten),
      risk: HIGH,
      failAt: "V2",
      trustedRoot: base.merkleRoot,
      withApproval: true,
    });

    gaps.push({
      id: `${seed}-approval-gate`,
      bundle: base,
      risk: HIGH,
      failAt: "V3",
      withApproval: false,
    });

    const noUserIntent = structuredClone(base);
    noUserIntent.events = noUserIntent.events.filter(
      (event) => event.objectType !== "USER_INTENT",
    );
    gaps.push({
      id: `${seed}-full-provenance`,
      bundle: recomputeEvidenceIntegrity(noUserIntent),
      risk: HIGH,
      failAt: "V3",
      withApproval: true,
    });
  }
  return gaps;
}

describe("AEARV level monotonicity", () => {
  it("V2 and V3 reject strictly more seeded bundles than V1, V3 more than V2", async () => {
    const seeds = [1_800_000_000_000, 1_800_000_000_017, 1_800_000_000_042] as const;
    const gaps = await seededGaps(seeds);
    let rejected = { V1: 0, V2: 0, V3: 0 };

    for (const gap of gaps) {
      const context = await contextFor(gap.bundle, gap.risk, gap.withApproval);
      if (gap.trustedRoot) context.expectedMerkleRoot = gap.trustedRoot;
      const decisions = {
        V1: (await verifyAtLevel(gap.bundle, "V1", context, gap.risk)).decision,
        V2: (await verifyAtLevel(gap.bundle, "V2", context, gap.risk)).decision,
        V3: (await verifyAtLevel(gap.bundle, "V3", context, gap.risk)).decision,
      };
      expect(decisions.V1, gap.id).toBe("PASS");
      expect(decisions.V2, gap.id).toBe(gap.failAt === "V2" ? "FAIL" : "PASS");
      expect(decisions.V3, gap.id).toBe("FAIL");
      for (const level of VERIFICATION_LEVELS) {
        if (decisions[level] === "FAIL") rejected[level] += 1;
      }
    }

    expect(rejected.V1).toBe(0);
    expect(rejected.V2).toBe(seeds.length * 3);
    expect(rejected.V3).toBe(seeds.length * 5);
    expect(rejected.V2).toBeGreaterThan(rejected.V1);
    expect(rejected.V3).toBeGreaterThan(rejected.V2);
  });

  it("adaptive picks the risk tier and only adds checks, never weakens the base", async () => {
    const bundle = await buildValidBundle({ traceId: "aearv-adaptive" });

    const low = await verifyAdaptive(bundle, LOW, await contextFor(bundle, LOW));
    expect(low.level).toBe("V1");
    expect(low.extraChecksExecuted).toBe(0);
    expect(low.decision).toBe("PASS");

    const medium = await verifyAdaptive(bundle, MEDIUM, await contextFor(bundle, MEDIUM));
    expect(medium.level).toBe("V2");
    expect(medium.extraChecksExecuted).toBe(3);
    expect(medium.decision).toBe("PASS");

    const high = await verifyAdaptive(bundle, HIGH, await contextFor(bundle, HIGH));
    expect(high.level).toBe("V3");
    expect(high.extraChecksExecuted).toBe(5);
    expect(high.decision).toBe("PASS");

    // With the approval withheld, only the V3 gate rejects; lower tiers still pass.
    const noApproval = await verifyAdaptive(bundle, HIGH, await contextFor(bundle, HIGH, false));
    expect(noApproval.level).toBe("V3");
    expect(noApproval.failedAdaptiveChecks).toEqual(["HUMAN_APPROVAL_GATE"]);
    expect(noApproval.decision).toBe("FAIL");
    expect(noApproval.base.result.status).toBe("PASS");
  });
});
