import type { Hex } from "viem";
import {
  NonceAlreadyConsumedError,
  buildPaymentAuthorization,
  createInMemoryNonceStore,
  createLocalFacilitator,
  signPaymentPayload,
  type PaymentPayload,
} from "./index";

/**
 * Concurrent-settlement evaluation.
 *
 * Reviewer #2 asked for concurrent transactions, not just sequential replay. The
 * local facilitator keeps an in-flight nonce reservation so two concurrent
 * requests cannot both pass the consumed check. These trials exercise that
 * reservation at several concurrency levels, over repeated trials, in three
 * shapes:
 *
 *   same-nonce     N concurrent attempts on one nonce  -> exactly 1 must settle
 *   distinct-nonce N concurrent attempts, N nonces     -> all N must settle
 *   mixed          duplicated nonce + distinct nonces  -> 1 + floor(N/2) settle
 *
 * `instances` runs the same trials across several facilitator processes that
 * share one nonce store, which is the deployment shape where an in-process lock
 * alone would not be enough.
 */

export type ConcurrencyMode = "same-nonce" | "distinct-nonce" | "mixed";

export type ConcurrencyTrialResult = {
  level: number;
  mode: ConcurrencyMode;
  trial: number;
  /** Facilitator instances sharing one nonce store. */
  instances: number;
  attempted: number;
  settled: number;
  rejected: number;
  otherErrors: number;
  expectedSettled: number;
  ok: boolean;
};

export type ConcurrencyRun = {
  levels: number[];
  trialsPerLevel: number;
  instances: number;
  results: ConcurrencyTrialResult[];
  anomalies: ConcurrencyTrialResult[];
  summary: {
    trialCount: number;
    totalAttempts: number;
    totalSettled: number;
    totalRejected: number;
    totalOtherErrors: number;
    anomalyCount: number;
  };
};

const PAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const PAY_TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;

function nonceFor(seed: number): Hex {
  const hex = Math.abs(Math.imul(seed, 2_654_435_761)).toString(16).padStart(8, "0");
  return `0x${hex.repeat(8).slice(0, 64)}` as Hex;
}

async function payloadFor(nonce: Hex): Promise<PaymentPayload> {
  const auth = buildPaymentAuthorization({
    from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    descriptor: {
      chainId: 84532,
      network: "base-sepolia",
      asset: "USDC",
      payTo: PAY_TO,
      value: "2.00",
      validBefore: "2026-12-30T06:00:00.000Z",
      x402Scheme: "exact",
    },
    nonce,
  });
  return signPaymentPayload(PAYER_KEY, auth);
}

function expectedSettled(mode: ConcurrencyMode, level: number): number {
  if (mode === "same-nonce") return 1;
  if (mode === "distinct-nonce") return level;
  return 1 + Math.floor(level / 2);
}

async function runTrial(
  level: number,
  mode: ConcurrencyMode,
  trial: number,
  instances: number,
): Promise<ConcurrencyTrialResult> {
  const store = instances > 1 ? createInMemoryNonceStore() : undefined;
  const facilitators = Array.from({ length: instances }, () =>
    store ? createLocalFacilitator(store) : createLocalFacilitator(),
  );

  let payloads: PaymentPayload[];
  if (mode === "same-nonce") {
    const shared = await payloadFor(nonceFor(trial + 1));
    payloads = Array.from({ length: level }, () => shared);
  } else if (mode === "distinct-nonce") {
    payloads = [];
    for (let index = 0; index < level; index += 1) {
      payloads.push(await payloadFor(nonceFor((trial + 1) * 1_000 + index)));
    }
  } else {
    const duplicated = await payloadFor(nonceFor((trial + 1) * 7_000));
    const shared = Math.floor(level / 2);
    payloads = [];
    for (let index = 0; index < shared; index += 1) {
      payloads.push(duplicated);
    }
    for (let index = 0; index < level - shared; index += 1) {
      payloads.push(await payloadFor(nonceFor((trial + 1) * 9_000 + index)));
    }
  }

  const settled = await Promise.allSettled(
    payloads.map((payload, index) => facilitators[index % facilitators.length]!.settle(payload)),
  );
  let settledCount = 0;
  let rejected = 0;
  let otherErrors = 0;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      settledCount += 1;
    } else if (outcome.reason instanceof NonceAlreadyConsumedError) {
      rejected += 1;
    } else {
      otherErrors += 1;
    }
  }

  const expected = expectedSettled(mode, level);
  return {
    level,
    mode,
    trial,
    instances,
    attempted: payloads.length,
    settled: settledCount,
    rejected,
    otherErrors,
    expectedSettled: expected,
    ok: settledCount === expected && otherErrors === 0,
  };
}

export async function runConcurrencyTrials(
  options: { levels?: number[]; trialsPerLevel?: number; instances?: number } = {},
): Promise<ConcurrencyRun> {
  const levels = options.levels ?? [2, 4, 8, 16, 32];
  const trialsPerLevel = options.trialsPerLevel ?? 20;
  const instances = options.instances ?? 1;
  const modes: ConcurrencyMode[] = ["same-nonce", "distinct-nonce", "mixed"];
  const results: ConcurrencyTrialResult[] = [];

  for (const level of levels) {
    for (const mode of modes) {
      for (let trial = 0; trial < trialsPerLevel; trial += 1) {
        results.push(await runTrial(level, mode, trial, instances));
      }
    }
  }

  const anomalies = results.filter((result) => !result.ok);
  return {
    levels,
    trialsPerLevel,
    instances,
    results,
    anomalies,
    summary: {
      trialCount: results.length,
      totalAttempts: results.reduce((sum, result) => sum + result.attempted, 0),
      totalSettled: results.reduce((sum, result) => sum + result.settled, 0),
      totalRejected: results.reduce((sum, result) => sum + result.rejected, 0),
      totalOtherErrors: results.reduce((sum, result) => sum + result.otherErrors, 0),
      anomalyCount: anomalies.length,
    },
  };
}
