import { verifyTrace } from "@clb-acel/verifier-core";
import { PredicateViolationError, createPredicateGuard } from "@clb-acel/predicate-adapter";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ATTACK_FIXTURES,
  MODE_B_PREDICATE_FIXTURES,
  PREDICATE_ATTACK_LABELS,
  TEST_KEYS,
  attackerAddress,
  buildValidBundle,
  constraints,
  descriptor,
  markReplayAttempt,
} from "../index";
import type { AttackScenario, PredicateAttackId } from "../index";
import { deriveOutcome } from "../types";
import type { OutcomeCategory } from "../types";
import { bVanillaX402 } from "./vanilla-x402";
import { bAp2X402 } from "./ap2-x402";
import { bEbayMonitor } from "./ebay-monitor";
import type { BaselineVerdict } from "./types";

export const GENERATED_AT = "2026-05-30T05:00:00.000Z";

const HONEST_HUMAN_PRINCIPAL = privateKeyToAccount(TEST_KEYS.userKey).address;

const SCENARIO: AttackScenario = {
  seed: 1,
  token: "XYZ",
  baseAmount: "2.00",
  attackAmount: "9.99",
  allowedAsset: "USDC",
  attackAsset: "WETH",
  attackerPayee: attackerAddress,
  taskHash: `0x${"1".repeat(64)}`,
  reportInputDataHash: `0x${"2".repeat(64)}`,
};

export type Cell = "ACCEPT" | "REJECT";

export type BaselineMatrixRow = {
  id: string;
  label: string;
  mode: "A" | "B";
  vanilla: Cell;
  ap2x402: Cell;
  ebay: Cell;
  clbacel: Cell;
  clbDetection: string;
  /** 7-category outcome taxonomy, derived from the actual verdicts. */
  vanillaOutcome?: OutcomeCategory;
  ap2x402Outcome?: OutcomeCategory;
  ebayOutcome?: OutcomeCategory;
  clbacelOutcome?: OutcomeCategory;
};

function verdictToCell(v: BaselineVerdict): Cell {
  return v.accepted ? "ACCEPT" : "REJECT";
}

/** ACCEPT = attack missed (EXPLOITED); REJECT = detected but not prevented. */
function verdictToOutcome(v: BaselineVerdict): OutcomeCategory {
  return deriveOutcome({
    detected: !v.accepted,
    prevented: false,
    ...(v.marker === undefined ? {} : { marker: v.marker }),
  });
}

function clbOutcome(caught: boolean, prevented: boolean): OutcomeCategory {
  return deriveOutcome({ detected: caught, prevented });
}

export async function runBaselineMatrix(): Promise<Record<string, BaselineMatrixRow>> {
  const result: Record<string, BaselineMatrixRow> = {};

  // ── Mode A (binding) fixtures ─────────────────────────────────────────────
  for (const fixture of ATTACK_FIXTURES) {
    const base = await buildValidBundle({
      traceId: `trace-${fixture.id.toLowerCase()}`,
      settlementDescriptor: descriptor({ value: SCENARIO.baseAmount, asset: SCENARIO.allowedAsset }),
      mandateConstraints: constraints({ maxAmount: SCENARIO.baseAmount, allowedAssets: [SCENARIO.allowedAsset] }),
      reportInputDataHash: SCENARIO.reportInputDataHash as Hex,
      token: SCENARIO.token,
    });

    const attacked =
      fixture.id === "MANDATE_REPLAY"
        ? (await markReplayAttempt(base)).bundle
        : await fixture.mutate(base, SCENARIO);

    const verification = await verifyTrace(attacked, { expectedHumanPrincipal: HONEST_HUMAN_PRINCIPAL });
    const audit = fixture.auditCheck?.(attacked);
    const clbCaught = verification.result.status === "FAIL" || audit?.ok === true;

    const vanillaVerdict = await bVanillaX402(attacked);
    const ap2Verdict = await bAp2X402(attacked);
    const ebayVerdict = bEbayMonitor(attacked);
    const vanilla = verdictToCell(vanillaVerdict);
    const ap2x402 = verdictToCell(ap2Verdict);
    const ebay = verdictToCell(ebayVerdict);
    const clbacel: Cell = clbCaught ? "REJECT" : "ACCEPT";

    let clbDetection: string;
    if (verification.result.failedRules.length > 0) {
      clbDetection = verification.result.failedRules.join(", ");
    } else if (audit?.ok) {
      clbDetection = `audit: ${audit.detail ?? fixture.id}`;
    } else {
      clbDetection = "—";
    }

    result[fixture.id] = {
      id: fixture.id,
      label: fixture.description,
      mode: "A",
      vanilla,
      ap2x402,
      ebay,
      clbacel,
      clbDetection,
      vanillaOutcome: verdictToOutcome(vanillaVerdict),
      ap2x402Outcome: verdictToOutcome(ap2Verdict),
      ebayOutcome: verdictToOutcome(ebayVerdict),
      clbacelOutcome: clbOutcome(clbCaught, false),
    };
  }

  // ── Mode B (predicate) fixtures ───────────────────────────────────────────
  for (const fixture of MODE_B_PREDICATE_FIXTURES) {
    const { bundle, guardInput } = await fixture.build();
    const verification = await verifyTrace(bundle, { expectedHumanPrincipal: HONEST_HUMAN_PRINCIPAL });

    let prevented = false;
    try {
      await createPredicateGuard().assertSettlementAllowed(guardInput);
    } catch (e) {
      if (e instanceof PredicateViolationError) {
        prevented = true;
      } else {
        throw e;
      }
    }

    const clbCaught = prevented || verification.result.status === "FAIL";

    const vanillaVerdict = await bVanillaX402(bundle);
    const ap2Verdict = await bAp2X402(bundle);
    const ebayVerdict = bEbayMonitor(bundle);
    const vanilla = verdictToCell(vanillaVerdict);
    const ap2x402 = verdictToCell(ap2Verdict);
    const ebay = verdictToCell(ebayVerdict);
    const clbacel: Cell = clbCaught ? "REJECT" : "ACCEPT";

    const failedRules = verification.result.failedRules;
    let clbDetection: string;
    if (failedRules.length > 0) {
      clbDetection = failedRules.join(", ");
    } else if (prevented) {
      clbDetection = "predicate-guard";
    } else {
      clbDetection = "—";
    }

    result[fixture.id] = {
      id: fixture.id,
      label: PREDICATE_ATTACK_LABELS[fixture.id as PredicateAttackId],
      mode: "B",
      vanilla,
      ap2x402,
      ebay,
      clbacel,
      clbDetection,
      vanillaOutcome: verdictToOutcome(vanillaVerdict),
      ap2x402Outcome: verdictToOutcome(ap2Verdict),
      ebayOutcome: verdictToOutcome(ebayVerdict),
      clbacelOutcome: clbOutcome(clbCaught, prevented),
    };
  }

  return result;
}
