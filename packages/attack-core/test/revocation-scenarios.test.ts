import { describe, expect, it } from "bun:test";
import { keccak256, toBytes } from "viem";
import {
  RCLB_APPLICATION_NONCE,
  RCLB_BASE_COMMITMENT,
  buildRevocationScenarioContext,
  runRevocationScenarios,
  summarizeRevocationMetrics,
} from "../src/revocation-scenarios";

const results = runRevocationScenarios();
const byId = new Map(results.map((result) => [result.id, result]));

describe("RCLB adversarial scenarios", () => {
  it("covers every required attack plus an honest control", () => {
    expect(results.map((result) => result.id)).toEqual([
      "SETTLE_AFTER_IDENTITY_REVOCATION",
      "SETTLE_AFTER_MANDATE_REVOCATION",
      "KEY_ROTATION_INVALIDATES_OLD_COMMITMENT",
      "STALE_REGISTRY_READ",
      "REVOCATION_VS_SETTLEMENT_RACE",
      "DELAYED_MESSAGE_EXPIRED",
      "NONCE_REPLAY_AFTER_HONEST_SETTLEMENT",
      "HONEST_CONTROL",
    ]);
  });

  it("prevents settlement after identity or mandate revocation", () => {
    expect(byId.get("SETTLE_AFTER_IDENTITY_REVOCATION")?.accepted).toBe(false);
    expect(byId.get("SETTLE_AFTER_IDENTITY_REVOCATION")?.violations).toContain("IDENTITY_EPOCH_STALE");
    expect(byId.get("SETTLE_AFTER_MANDATE_REVOCATION")?.accepted).toBe(false);
    expect(byId.get("SETTLE_AFTER_MANDATE_REVOCATION")?.violations).toContain("MANDATE_EPOCH_STALE");
  });

  it("key rotation invalidates the old commitment", () => {
    const result = byId.get("KEY_ROTATION_INVALIDATES_OLD_COMMITMENT");
    expect(result?.accepted).toBe(false);
    expect(result?.violations).toContain("IDENTITY_EPOCH_STALE");
  });

  it("a stale registry read would accept but the execution-time read rejects", () => {
    const result = byId.get("STALE_REGISTRY_READ");
    expect(result?.staleSnapshotWouldAccept).toBe(true);
    expect(result?.accepted).toBe(false);
    expect(result?.violations).toContain("IDENTITY_EPOCH_STALE");
  });

  it("revocation wins the race against settlement and delayed messages expire", () => {
    const race = byId.get("REVOCATION_VS_SETTLEMENT_RACE");
    expect(race?.accepted).toBe(false);
    expect(race?.violations).toContain("MANDATE_EPOCH_STALE");
    expect(byId.get("DELAYED_MESSAGE_EXPIRED")?.violations).toContain("COMMITMENT_EXPIRED");
  });

  it("a consumed application nonce blocks replay", () => {
    expect(byId.get("NONCE_REPLAY_AFTER_HONEST_SETTLEMENT")?.violations).toContain("NONCE_ALREADY_CONSUMED");
  });

  it("honest control is accepted", () => {
    const honest = byId.get("HONEST_CONTROL");
    expect(honest?.expectedAccepted).toBe(true);
    expect(honest?.accepted).toBe(true);
    expect(honest?.violations).toEqual([]);
  });

  it("derives the shared C_t fixture deterministically", () => {
    const ctx = buildRevocationScenarioContext();
    expect(ctx.baseCommitment).toBe(RCLB_BASE_COMMITMENT);
    expect(ctx.fields.nonce).toBe(RCLB_APPLICATION_NONCE);
    expect(ctx.paymentNonce).toBe(keccak256(ctx.commitment));
    expect(buildRevocationScenarioContext().commitment).toBe(ctx.commitment);
  });

  it("metrics are computed from outcomes, with no stale acceptance or false rejection", () => {
    const metrics = summarizeRevocationMetrics(results);
    expect(metrics.scenarioCount).toBe(8);
    expect(metrics.adversarialCount).toBe(7);
    expect(metrics.preventedCount).toBe(7);
    expect(metrics.staleAcceptanceRate).toBe(0);
    expect(metrics.falseRejectionRate).toBe(0);
    expect(metrics.raceResistance).toBe(1);
  });
});
