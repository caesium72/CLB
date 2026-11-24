import {
  type RevocationViolationCode,
  checkRevocationAwareAcceptance,
  computeRevocationAwareCommitment,
  consumeRevocationNonce,
  deriveRevocationAwareNonce,
} from "@clb-acel/clb-core";
import { type Hex, keccak256, toBytes } from "viem";

/**
 * RCLB adversarial harness. Deterministic, in-process; no RPC and no wall clock.
 * The fixture authority below is a stand-in for the ERC-8004 epoch registry
 * (`@clb-acel/erc8004-adapter`); the verifier tests exercise that real adapter.
 *
 * Every scenario builds the SAME human-signed base commitment C and then varies
 * only the CURRENT authority state / settlement time at execution. A scenario
 * is PREVENTED when the RCLB gate rejects the settlement attempt.
 */

export type RevocationScenarioId =
  | "SETTLE_AFTER_IDENTITY_REVOCATION"
  | "SETTLE_AFTER_MANDATE_REVOCATION"
  | "KEY_ROTATION_INVALIDATES_OLD_COMMITMENT"
  | "STALE_REGISTRY_READ"
  | "REVOCATION_VS_SETTLEMENT_RACE"
  | "DELAYED_MESSAGE_EXPIRED"
  | "NONCE_REPLAY_AFTER_HONEST_SETTLEMENT"
  | "HONEST_CONTROL";

export type RevocationScenarioResult = {
  id: RevocationScenarioId;
  description: string;
  expectedAccepted: boolean;
  accepted: boolean;
  violations: RevocationViolationCode[];
  /** True when a cached/stale authority read would have accepted this attempt. */
  staleSnapshotWouldAccept?: boolean;
  steps: string[];
};

export const RCLB_BASE_COMMITMENT: Hex = keccak256(toBytes("rclb-demo-base-commitment-v1"));
export const RCLB_APPLICATION_NONCE: Hex = `0x${"11".repeat(32)}`;
export const RCLB_EXPIRY = 1_800_000_000n; // Unix seconds; inclusive
export const RCLB_SETTLEMENT_TIME = 1_700_000_000n; // before expiry
const SIGNING_EPOCH = 1n;

type EpochSnapshot = { identityEpoch: bigint; mandateEpoch: bigint };

class FixtureEpochAuthority {
  identityEpoch = SIGNING_EPOCH;
  mandateEpoch = SIGNING_EPOCH;

  snapshot(): EpochSnapshot {
    return { identityEpoch: this.identityEpoch, mandateEpoch: this.mandateEpoch };
  }

  revokeIdentity(): void {
    this.identityEpoch += 1n;
  }

  revokeMandate(): void {
    this.mandateEpoch += 1n;
  }

  rotateIdentityKey(): void {
    this.identityEpoch += 1n;
  }
}

export type RevocationScenarioContext = {
  baseCommitment: Hex;
  commitment: Hex;
  paymentNonce: Hex;
  fields: {
    baseCommitment: Hex;
    identityEpoch: bigint;
    mandateEpoch: bigint;
    expiry: bigint;
    nonce: Hex;
  };
  authority: FixtureEpochAuthority;
  consumed: Set<string>;
};

/** Build the shared C_t fixture. All scenarios start from this signed binding. */
export function buildRevocationScenarioContext(): RevocationScenarioContext {
  const fields = {
    baseCommitment: RCLB_BASE_COMMITMENT,
    identityEpoch: SIGNING_EPOCH,
    mandateEpoch: SIGNING_EPOCH,
    expiry: RCLB_EXPIRY,
    nonce: RCLB_APPLICATION_NONCE,
  };
  const commitment = computeRevocationAwareCommitment(fields);
  return {
    baseCommitment: RCLB_BASE_COMMITMENT,
    commitment,
    paymentNonce: deriveRevocationAwareNonce(commitment),
    fields,
    authority: new FixtureEpochAuthority(),
    consumed: new Set<string>(),
  };
}

function accept(
  ctx: RevocationScenarioContext,
  current: EpochSnapshot,
  now: bigint,
  consumed: ReadonlySet<string> = ctx.consumed,
) {
  return checkRevocationAwareAcceptance({
    fields: ctx.fields,
    commitment: ctx.commitment,
    currentIdentityEpoch: current.identityEpoch,
    currentMandateEpoch: current.mandateEpoch,
    now,
    consumedNonces: consumed,
  });
}

function scenarioResult(
  id: RevocationScenarioId,
  description: string,
  expectedAccepted: boolean,
  outcome: ReturnType<typeof accept>,
  steps: string[],
  staleSnapshotWouldAccept?: boolean,
): RevocationScenarioResult {
  return {
    id,
    description,
    expectedAccepted,
    accepted: outcome.ok,
    violations: outcome.violations,
    steps,
    ...(staleSnapshotWouldAccept === undefined ? {} : { staleSnapshotWouldAccept }),
  };
}

/** Run all RCLB adversarial scenarios plus one honest control. */
export function runRevocationScenarios(): RevocationScenarioResult[] {
  const results: RevocationScenarioResult[] = [];

  {
    const ctx = buildRevocationScenarioContext();
    ctx.authority.revokeIdentity();
    const outcome = accept(ctx, ctx.authority.snapshot(), RCLB_SETTLEMENT_TIME);
    results.push(
      scenarioResult(
        "SETTLE_AFTER_IDENTITY_REVOCATION",
        "Settle with a cryptographically valid C_t after the identity key was revoked.",
        false,
        outcome,
        [
          "Human signs C_t with E_I=1, E_M=1.",
          "Authority revokes the identity key, advancing E_I to 2.",
          "Settlement presents the unchanged C_t; the guard reads E_I=2 and rejects.",
        ],
      ),
    );
  }

  {
    const ctx = buildRevocationScenarioContext();
    ctx.authority.revokeMandate();
    const outcome = accept(ctx, ctx.authority.snapshot(), RCLB_SETTLEMENT_TIME);
    results.push(
      scenarioResult(
        "SETTLE_AFTER_MANDATE_REVOCATION",
        "Settle after the human mandate was revoked while the identity key is unchanged.",
        false,
        outcome,
        [
          "Human signs C_t with E_I=1, E_M=1.",
          "Authority revokes the mandate, advancing E_M to 2.",
          "Settlement presents the unchanged C_t; the guard reads E_M=2 and rejects.",
        ],
      ),
    );
  }

  {
    const ctx = buildRevocationScenarioContext();
    ctx.authority.rotateIdentityKey();
    const outcome = accept(ctx, ctx.authority.snapshot(), RCLB_SETTLEMENT_TIME);
    results.push(
      scenarioResult(
        "KEY_ROTATION_INVALIDATES_OLD_COMMITMENT",
        "Rotating the identity key invalidates a C_t signed under the old key.",
        false,
        outcome,
        [
          "Human signs C_t under identity key K1 (E_I=1).",
          "Authority rotates to K2 and advances E_I to 2 atomically.",
          "The old C_t carries E_I=1 and can no longer satisfy the current-epoch guard.",
        ],
      ),
    );
  }

  {
    const ctx = buildRevocationScenarioContext();
    const cached = ctx.authority.snapshot(); // stale read taken before revocation
    ctx.authority.revokeIdentity();
    const fresh = ctx.authority.snapshot();
    const wouldAcceptIfStale = accept(ctx, cached, RCLB_SETTLEMENT_TIME);
    const outcome = accept(ctx, fresh, RCLB_SETTLEMENT_TIME);
    results.push(
      scenarioResult(
        "STALE_REGISTRY_READ",
        "A cached epoch snapshot would accept; the execution-time read rejects.",
        false,
        outcome,
        [
          "Guard caches {E_I=1, E_M=1} before the revocation.",
          "Authority revokes the identity key (E_I=2).",
          "Naive cached check would accept; the execution-time read rejects.",
        ],
        wouldAcceptIfStale.ok,
      ),
    );
  }

  {
    const ctx = buildRevocationScenarioContext();
    const precheck = accept(ctx, ctx.authority.snapshot(), RCLB_SETTLEMENT_TIME - 100n);
    ctx.authority.revokeMandate();
    const outcome = accept(ctx, ctx.authority.snapshot(), RCLB_SETTLEMENT_TIME);
    results.push(
      scenarioResult(
        "REVOCATION_VS_SETTLEMENT_RACE",
        "Revocation lands between a passing pre-check and the settlement call.",
        false,
        outcome,
        [
          `Pre-check passed (E_M=1, accepted=${precheck.ok}).`,
          "Revocation is committed before settlement executes (E_M=2).",
          "Execution-time check rejects; the rejected attempt does not consume N.",
        ],
      ),
    );
  }

  {
    const ctx = buildRevocationScenarioContext();
    const outcome = accept(ctx, ctx.authority.snapshot(), RCLB_EXPIRY + 1n);
    results.push(
      scenarioResult(
        "DELAYED_MESSAGE_EXPIRED",
        "A delayed message arrives after T_expiry even though no revocation occurred.",
        false,
        outcome,
        [
          "Human signs C_t with T_expiry = 1_800_000_000.",
          "Message is delivered at T_expiry + 1 second.",
          "The inclusive expiry check rejects the delayed settlement.",
        ],
      ),
    );
  }

  {
    const ctx = buildRevocationScenarioContext();
    const first = accept(ctx, ctx.authority.snapshot(), RCLB_SETTLEMENT_TIME);
    ctx.consumed = consumeRevocationNonce(ctx.consumed, ctx.fields.nonce);
    const outcome = accept(ctx, ctx.authority.snapshot(), RCLB_SETTLEMENT_TIME);
    results.push(
      scenarioResult(
        "NONCE_REPLAY_AFTER_HONEST_SETTLEMENT",
        "Replay of the same C_t after N was consumed by the honest settlement.",
        false,
        outcome,
        [
          `First settlement accepted (accepted=${first.ok}) and consumed N.`,
          "Attacker replays the identical C_t and payment nonce.",
          "The single-use application nonce check rejects the replay.",
        ],
      ),
    );
  }

  {
    const ctx = buildRevocationScenarioContext();
    const outcome = accept(ctx, ctx.authority.snapshot(), RCLB_SETTLEMENT_TIME);
    results.push(
      scenarioResult(
        "HONEST_CONTROL",
        "Positive control: current epochs, in-window time and unconsumed N.",
        true,
        outcome,
        [
          "Human signs C_t with current E_I=1, E_M=1.",
          "Settlement executes inside the validity window.",
          "Guard accepts; the honest control is not falsely rejected.",
        ],
      ),
    );
  }

  return results;
}

export type RevocationMetrics = {
  scenarioCount: number;
  adversarialCount: number;
  preventedCount: number;
  /** Fraction of stale-snapshot attempts that the RCLB gate wrongly accepts. */
  staleAcceptanceRate: number;
  /** Fraction of honest controls wrongly rejected. */
  falseRejectionRate: number;
  /** Fraction of revocation-vs-settlement races that the gate prevents. */
  raceResistance: number;
};

/** Rates computed from actual scenario outcomes; no hand-written claims. */
export function summarizeRevocationMetrics(results: RevocationScenarioResult[]): RevocationMetrics {
  const adversarial = results.filter((result) => !result.expectedAccepted);
  const stale = results.filter((result) => result.staleSnapshotWouldAccept === true);
  const honest = results.filter((result) => result.expectedAccepted);
  const races = results.filter((result) => result.id === "REVOCATION_VS_SETTLEMENT_RACE");
  return {
    scenarioCount: results.length,
    adversarialCount: adversarial.length,
    preventedCount: adversarial.filter((result) => !result.accepted).length,
    staleAcceptanceRate: stale.length === 0 ? 0 : stale.filter((result) => result.accepted).length / stale.length,
    falseRejectionRate: honest.length === 0 ? 0 : honest.filter((result) => !result.accepted).length / honest.length,
    raceResistance: races.length === 0 ? 0 : races.filter((result) => !result.accepted).length / races.length,
  };
}
