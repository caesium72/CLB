/**
 * Reviewer #3, Comment 1 — deterministic latency + gas benchmark harness (R3-C1 items 15–25).
 *
 * Records RAW observations (experiments/benchmarks/performance-raw.json), summary
 * statistics (performance-results.json) and a human-readable report
 * (performance-report.md). Every timed span is documented at the call site: only
 * the named operation is inside `performance.now()` — input preparation, fixture
 * construction and I/O are outside it.
 *
 * Gas is EXCLUSIVELY a LOCAL ANVIL / DEMO measurement of the Solidity demo guard
 * plus the demo on-chain settlement transfer. No mainnet or public-testnet claim
 * is made. If Foundry is unavailable the gas section is labelled NOT RUN.
 *
 * Usage: bun run scripts/e2e-performance.ts   (PERF_SAMPLES=100 default)
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import {
  TEST_KEYS,
  attackerAddress,
  buildValidBundle,
  buildValidModeBBundle,
  defaultConcrete,
  draftModeBPayment,
  evidenceEvents,
  merchantAddress,
  type ModeBPaymentDraft,
} from "@clb-acel/attack-core";
import {
  commitConfidential,
  computeCommitment,
  computeMandateDigest,
  computeModeBSettlementCommitment,
  computePredicateExtrasDigest,
  deriveNonce,
  evaluatePredicate,
  signCommitment,
  verifyCommitmentSignature,
} from "@clb-acel/clb-core";
// evidence-core/verifier-core are not linked at the workspace ROOT node_modules
// (they are transitive deps), so import their source directly rather than editing package.json.
import { buildMerkleRoot, hashEvidenceEvent, linkEvidenceEvents } from "../packages/evidence-core/src/index";
import {
  InMemoryPredicateGuard,
  PREDICATE_GUARD_ABI,
  ContractPredicateGuard,
  makeViemGuardReader,
  makeViemGuardWriter,
  mockConfigFromPredicate,
  registerPredicateBound,
  type GuardSettlementInput,
} from "@clb-acel/predicate-adapter";
import { verifyTrace } from "../packages/verifier-core/src/index";
import {
  createLocalFacilitator,
  createOnChainFacilitator,
  verifyPaymentPayload,
} from "@clb-acel/x402-adapter";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const repoRoot = resolve(import.meta.dir, "..");
const artifactsDir = join(repoRoot, "experiments", "benchmarks");
const rawPath = join(artifactsDir, "performance-raw.json");
const resultsPath = join(artifactsDir, "performance-results.json");
const reportPath = join(artifactsDir, "performance-report.md");
const contractsDir = join(repoRoot, "contracts");
// NEW output dirs: do not touch reviewer2's forge artifacts (other agents may use them).
const forgeOutDir = join(artifactsDir, "performance-forge-out");
const forgeCacheDir = join(artifactsDir, "performance-forge-cache");

const foundryBin = join(homedir(), ".foundry", "bin");
const exe = (name: string) => join(foundryBin, process.platform === "win32" ? `${name}.exe` : name);
const forgeBin = process.env.FORGE_BIN ?? exe("forge");
const anvilBin = process.env.ANVIL_BIN ?? exe("anvil");
const ANVIL_DEV_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const BASE_TIME = Date.parse("2026-05-30T05:00:00.000Z");
const GAS_LABEL = "LOCAL ANVIL / DEMO — NOT MAINNET AND NOT A PUBLIC TESTNET";
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;

function sampleCount(): number {
  const raw = Number(process.env.PERF_SAMPLES ?? "100");
  return Number.isInteger(raw) && raw > 0 ? raw : 100;
}
const N = sampleCount();
const WARMUP = 2; // JIT/pipeline warmup outside the recorded span; not written to raw.

// --- statistics (item 24) ---------------------------------------------------
type Summary = {
  mean: number;
  median: number;
  p50: number;
  p95: number;
  stddev: number; // sample standard deviation (n-1)
  sampleCount: number;
  min: number;
  max: number;
};

function summarize(values: number[]): Summary {
  const n = values.length;
  if (n === 0) {
    return { mean: 0, median: 0, p50: 0, p95: 0, stddev: 0, sampleCount: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const variance =
    n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : 0;
  return {
    mean,
    median,
    p50: median,
    p95: sorted[Math.max(0, Math.ceil(0.95 * n) - 1)]!,
    stddev: Math.sqrt(variance),
    sampleCount: n,
    min: sorted[0]!,
    max: sorted[n - 1]!,
  };
}

// --- raw series registry (item 25) -----------------------------------------
type Unit = "ms" | "gas";
type Series = { metricId: string; unit: Unit; boundary: string; samples: number[] };
const series: Record<string, Series> = {};

function putSeries(key: string, metricId: string, unit: Unit, boundary: string, samples: number[]): void {
  series[key] = { metricId, unit, boundary, samples };
}

/** Run `op` N times with fresh inputs prepared OUTSIDE the timed span. */
async function timeSeries<T>(
  prepare: () => T | Promise<T>,
  op: (input: T) => unknown | Promise<unknown>,
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < WARMUP; i += 1) {
    await op(await prepare());
  }
  for (let i = 0; i < N; i += 1) {
    const input = await prepare();
    const start = performance.now();
    await op(input);
    out.push(performance.now() - start);
  }
  return out;
}

async function waitForRpc(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (response.ok) return;
    } catch {
      // anvil not listening yet
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`anvil RPC at ${url} did not become ready`);
}

/** Mirrors the encode step in packages/predicate-adapter/src/onchain.ts. */
function validateArgs(draft: ModeBPaymentDraft) {
  const c = draft.commitment;
  const p = c.settlementParams;
  return [
    {
      chainId: BigInt(c.identityRef.chainId),
      registryAddr: c.identityRef.registryAddr as Hex,
      agentId: c.identityRef.agentId,
    },
    c.mandateDigest,
    c.predicateId,
    // The 7-arg validateAndConsume binds the human-signed predicate extras
    // (agent ids + task hash) into C'; the legacy 6-arg overload uses zero.
    computePredicateExtrasDigest(draft.predicate),
    {
      chainId: BigInt(p.chainId),
      network: p.network,
      asset: p.asset,
      payTo: p.payTo as Hex,
      value: p.value,
      valueAtomic: BigInt(p.valueAtomic),
      validBefore: p.validBefore,
      payerAgentId: p.payerAgentId,
    },
    draft.modeBCommitment,
    draft.nonce,
  ] as const;
}

// Deterministic RNG for confidential evidence generation (no CSPRNG in timed span).
function deterministicRng(): () => bigint {
  let state = 0x1234_5678_9abc_def0n;
  return () => {
    state = (state * 6_364_136_223_846_793_005n + 1n) & ((1n << 256n) - 1n);
    return state || 1n;
  };
}

async function main(): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });

  // Shared deterministic fixtures. Built ONCE, outside every timed span.
  const seedBundle = await buildValidBundle({ traceId: "perf-seed" });
  const clbInput = {
    identityRef: seedBundle.clb.identityRef,
    mandateDigest: computeMandateDigest(seedBundle.mandate),
    settlementDescriptor: seedBundle.clb.settlementDescriptor,
    domain: seedBundle.clb.domain,
  };
  const commitment = computeCommitment(clbInput);
  const commitmentSignature = await signCommitment(TEST_KEYS.userKey, clbInput);
  const commitmentSigner = privateKeyToAccount(TEST_KEYS.userKey).address;
  const modeBDraft = await draftModeBPayment({ traceId: "perf-mode-b-seed" });
  const modeBBundle = await buildValidModeBBundle({ traceId: "perf-mode-b-guard-seed" });
  const guardInput: GuardSettlementInput = {
    ...modeBBundle.guardInput,
    expectedNonce: modeBBundle.bundle.paymentPayload.authorization.nonce,
  };
  const guard = new InMemoryPredicateGuard();
  const evidenceInput = evidenceEvents("perf-evidence-seed", seedBundle.settlement.settledAt);

  // M15 — commitment generation.
  // Boundary: exactly one hashTypedData computation; input is precomputed.
  putSeries(
    "computeCommitment",
    "M15",
    "ms",
    "computeCommitment(clbInput) — Mode A C = keccak256(EIP712(identityRef, mandateDigest, settlementDigest)); input prepared outside timer.",
    await timeSeries(() => clbInput, (input) => computeCommitment(input)),
  );
  // Boundary: exactly one hashTypedData computation for Mode B C'.
  putSeries(
    "computeModeBSettlementCommitment",
    "M15",
    "ms",
    "computeModeBSettlementCommitment(input) — Mode B C' = keccak256(EIP712(identityRef, mandateDigest, predicateId, settlementParamsDigest)).",
    await timeSeries(
      () => modeBDraft.commitment,
      (input) => computeModeBSettlementCommitment(input),
    ),
  );

  // M16 — signature verification.
  // Boundary: one viem verifyTypedData call on the x402 payment authorization.
  putSeries(
    "verifyPaymentPayload",
    "M16",
    "ms",
    "await verifyPaymentPayload(payload) — EIP-712 recovery + expected-signer equality for the x402 authorization.",
    await timeSeries(
      () => seedBundle.paymentPayload,
      (payload) => verifyPaymentPayload(payload),
    ),
  );
  // Boundary: one viem verifyTypedData call for the CLB commitment signature.
  putSeries(
    "verifyCommitmentSignature",
    "M16",
    "ms",
    "await verifyCommitmentSignature(clbInput, signature, expectedSigner) — CLB EIP-712 signature recovery.",
    await timeSeries(
      () => ({ clbInput, commitmentSignature, commitmentSigner }),
      (input) =>
        verifyCommitmentSignature(input.clbInput, input.commitmentSignature, input.commitmentSigner),
    ),
  );

  // M17 — authorization verification (guard allow/deny decision).
  // Boundary: one guard.authorize call: predicate eval + C'/nonce recompute + decision.
  putSeries(
    "guardAssertSettlementAllowed",
    "M17",
    "ms",
    "await InMemoryPredicateGuard.assertSettlementAllowed(guardInput) — predicate eval + C' recompute + expectedNonce binding + allow/deny decision.",
    await timeSeries(() => guardInput, (input) => guard.assertSettlementAllowed(input)),
  );
  // M18 — predicate evaluation.
  // Boundary: one pure evaluatePredicate call (no commitment, no guard, no I/O).
  putSeries(
    "evaluatePredicate",
    "M18",
    "ms",
    "evaluatePredicate(predicate, params, now, observedTaskHash) — pure rule evaluation only.",
    await timeSeries(
      () => guardInput,
      (input) =>
        evaluatePredicate(input.predicate, input.params, input.now, input.observedTaskHash),
    ),
  );
  // Boundary: one guard.evaluateOffChain delegation (same pure evaluator via adapter).
  putSeries(
    "guardEvaluateOffChain",
    "M18",
    "ms",
    "guard.evaluateOffChain(predicate, params, now, observedTaskHash) — adapter entry point, same pure evaluator.",
    await timeSeries(
      () => guardInput,
      (input) =>
        guard.evaluateOffChain(input.predicate, input.params, input.now, input.observedTaskHash),
    ),
  );

  // M19 — evidence generation.
  // Boundary: linkEvidenceEvents -> map(hashEvidenceEvent) -> buildMerkleRoot.
  putSeries(
    "evidenceChainGeneration",
    "M19",
    "ms",
    "linkEvidenceEvents(events) + events.map(hashEvidenceEvent) + buildMerkleRoot(hashes) — hash-chained evidence plus Merkle root; input events prepared outside timer.",
    await timeSeries(
      () => evidenceInput,
      (events) => {
        const linked = linkEvidenceEvents(events);
        const hashes = linked.map(hashEvidenceEvent);
        buildMerkleRoot(hashes);
      },
    ),
  );
  // Boundary: confidential commit-and-prove evidence (Pedersen commitment + 64-bit range proof).
  putSeries(
    "confidentialRangeProofEvidence",
    "M19",
    "ms",
    "commitConfidential({valueAtomic, maxValueAtomic, payTo}, {rng}) — Pedersen commitment + 64-bit per-bit range proof evidence (deterministic RNG).",
    await timeSeries(
      () => deterministicRng(),
      (rng) =>
        commitConfidential(
          { valueAtomic: 2_000_000n, maxValueAtomic: 5_000_000n, payTo: merchantAddress },
          { rng },
        ),
    ),
  );

  // M20 — verifier.
  // Boundary: one complete verifyTrace(bundle) call (all R1–R17 rules + certificate).
  putSeries(
    "verifyTrace",
    "M20",
    "ms",
    "await verifyTrace(validModeABundle) — all deterministic rules R1–R17 and certificate hash; bundle prebuilt outside timer.",
    await timeSeries(() => seedBundle, (bundle) =>
      verifyTrace(bundle, { expectedHumanPrincipal: privateKeyToAccount(TEST_KEYS.userKey).address }),
    ),
  );

  // M21 — complete end-to-end transaction (Mode A).
  // Boundary: from the start of buildValidBundle(...) (mandate issue -> C/nonce ->
  // payment signing -> local-facilitator settlement -> evidence + delivery signing)
  // through verifyTrace(bundle) completion. A fresh trace/facilitator per sample.
  putSeries(
    "e2eModeATransaction",
    "M21",
    "ms",
    "buildValidBundle({traceId}) + verifyTrace(bundle) — full Mode A: mandate issue, C/nonce, x402 signing, local facilitator settle, evidence chain, report/delivery signatures, verification.",
    await timeSeries(
      (): number => Date.now(),
      async (seed) => {
        const bundle = await buildValidBundle({ traceId: `perf-e2e-${seed}` });
        await verifyTrace(bundle, {
          expectedHumanPrincipal: privateKeyToAccount(TEST_KEYS.userKey).address,
        });
      },
    ),
  );

  // --- Reviewer #4 Comment 4: OVERHEAD vs plain x402 -----------------------
  // Same boundary discipline as M15–M21: inputs (including a fresh facilitator
  // with a fresh nonce store) prepared OUTSIDE the timer; only the named
  // operations are timed. Both spans end in a local-facilitator settlement, so
  // the CLB-ACEL span is a strict superset of the plain-x402 span.
  const humanPrincipal = privateKeyToAccount(TEST_KEYS.userKey).address;

  putSeries(
    "plainX402Accept",
    "M26",
    "ms",
    "await verifyPaymentPayload(payload) + await facilitator.settle(payload) on a fresh local facilitator — plain x402 authorization + settlement. Payload and fresh facilitator prepared outside timer.",
    await timeSeries(
      () => ({ payload: seedBundle.paymentPayload, facilitator: createLocalFacilitator() }),
      async ({ payload, facilitator }) => {
        await verifyPaymentPayload(payload);
        await facilitator.settle(payload);
      },
    ),
  );
  // The five CLB-ACEL components are the same fixtures already measured as
  // M15/M16/M17/M19/M20. verifyTrace internally re-verifies the x402 payment
  // signature, so the only shared operation with the plain span is settlement.
  putSeries(
    "clbAcelAcceptAndVerify",
    "M26",
    "ms",
    "computeCommitment + verifyCommitmentSignature + guard.assertSettlementAllowed + (link/hash/Merkle over 7 events) + verifyTrace(bundle) + facilitator.settle(payload) — full CLB-ACEL acceptance/verification pipeline. All inputs, including a fresh facilitator, prepared outside timer.",
    await timeSeries(
      () => ({
        facilitator: createLocalFacilitator(),
        payload: seedBundle.paymentPayload,
        clbInput,
        commitmentSignature,
        commitmentSigner,
        guardInput,
        events: evidenceInput,
        bundle: seedBundle,
        humanPrincipal,
      }),
      async (input) => {
        computeCommitment(input.clbInput);
        await verifyCommitmentSignature(
          input.clbInput,
          input.commitmentSignature,
          input.commitmentSigner,
        );
        await guard.assertSettlementAllowed(input.guardInput);
        const linked = linkEvidenceEvents(input.events);
        buildMerkleRoot(linked.map(hashEvidenceEvent));
        await verifyTrace(input.bundle, { expectedHumanPrincipal: input.humanPrincipal });
        await input.facilitator.settle(input.payload);
      },
    ),
  );

  // --- Gas (items 22–23) ----------------------------------------------------
  let gasStatus: "RUN" | "NOT RUN" = "NOT RUN";
  let gasReason = "not attempted";
  const gasChain: Record<string, unknown> = { label: GAS_LABEL, publicNetwork: "none" };
  let anvilProcess: ReturnType<typeof spawn> | undefined;

  try {
    if (!existsSync(forgeBin) || !existsSync(anvilBin)) {
      throw new Error(`Foundry binaries not found (forge=${forgeBin}, anvil=${anvilBin})`);
    }
    execFileSync(
      forgeBin,
      [
        "build",
        "src/PredicatePaymentGuard.sol",
        "--root",
        contractsDir,
        "--out",
        forgeOutDir,
        "--cache-path",
        forgeCacheDir,
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const artifact = JSON.parse(
      await readFile(join(forgeOutDir, "PredicatePaymentGuard.sol", "PredicatePaymentGuard.json"), "utf8"),
    ) as { abi: Abi; bytecode: { object: string } };

    const port = Number(process.env.PERF_ANVIL_PORT ?? "18547");
    const rpcUrl = `http://127.0.0.1:${port}`;
    anvilProcess = spawn(
      anvilBin,
      [
        "--host", "127.0.0.1",
        "--port", String(port),
        "--chain-id", "84532",
        "--timestamp", String(Math.floor(BASE_TIME / 1000)),
      ],
      { stdio: "ignore" },
    );
    await waitForRpc(rpcUrl);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const publicClient: any = createPublicClient({ chain: {
      id: 84532,
      name: "Anvil (local)",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    } as const, transport: http(rpcUrl) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walletClient: any = createWalletClient({
      account: privateKeyToAccount(ANVIL_DEV_KEY),
      chain: publicClient.chain,
      transport: http(rpcUrl),
    });

    const deployHash = await walletClient.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object as Hex,
      args: [84532n],
    });
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    const guardAddress = deployReceipt.contractAddress as Address | null;
    if (!guardAddress) throw new Error("guard deployment did not return a contract address");

    Object.assign(gasChain, {
      network: "local-anvil",
      publicNetwork: false,
      rpcUrl,
      chainId: await publicClient.getChainId(),
      guardAddress,
      deployTxHash: deployHash,
      contract: "contracts/src/PredicatePaymentGuard.sol::validateAndConsume",
    });

    const contractGuard = new ContractPredicateGuard({
      address: guardAddress,
      writer: makeViemGuardWriter({ publicClient, walletClient, account: walletClient.account }),
      reader: makeViemGuardReader({ publicClient }),
    });
    // Demo on-chain settlement transfer (same adapter the x402 chain mode uses).
    const facilitator = createOnChainFacilitator({ rpcUrl, privateKey: ANVIL_DEV_KEY, chainId: 84532 });

    const guardOnlyGas: number[] = [];
    const settlementTxGas: number[] = [];
    const completePaymentGas: number[] = [];
    const successfulGuardGas: number[] = [];
    const revertedGuardGas: number[] = [];

    for (let i = 0; i < N; i += 1) {
      const id = `perf-gas-ok-${i}`;
      const draft = await draftModeBPayment({ traceId: id, predicateId: id, baseTimeMs: BASE_TIME });
      await registerPredicateBound(
        { publicClient, walletClient, account: walletClient.account },
        {
          address: guardAddress,
          predicateId: id,
          config: mockConfigFromPredicate(draft.predicate),
          principal: walletClient.account.address,
          mandateDigest: draft.commitment.mandateDigest,
          taskHash: (draft.predicate.taskHash ?? ZERO_BYTES32) as Hex,
          extraFieldsDigest: computePredicateExtrasDigest(draft.predicate),
        },
      );

      // SUCCESS: real guard tx, then the demo on-chain settlement transfer.
      const result = await contractGuard.settleOnChain({
        predicate: draft.predicate,
        params: draft.settlementParams,
        commitment: draft.commitment,
        now: new Date(BASE_TIME + 5000),
      });
      if (result.reverted || !result.txHash) {
        throw new Error(`happy-path guard tx unexpectedly reverted: ${result.reason ?? "unknown"}`);
      }
      const guardReceipt = await publicClient.waitForTransactionReceipt({ hash: result.txHash });
      const settlement = await facilitator.settle(draft.paymentPayload);
      const settlementReceipt = await publicClient.waitForTransactionReceipt({ hash: settlement.txHash });

      const guardGas = Number(guardReceipt.gasUsed);
      const settleGas = Number(settlementReceipt.gasUsed);
      guardOnlyGas.push(guardGas);
      settlementTxGas.push(settleGas);
      completePaymentGas.push(guardGas + settleGas);
      successfulGuardGas.push(guardGas);

      // REVERT: fresh predicate+nonce, payee substituted. Broadcast with an explicit
      // gas limit so Anvil MINES the revert (viem simulation would stop it, yielding
      // no receipt and therefore no measurable gasUsed).
      const badId = `perf-gas-revert-${i}`;
      const badDraft = await draftModeBPayment({
        traceId: badId,
        predicateId: badId,
        baseTimeMs: BASE_TIME,
        concrete: defaultConcrete({ payTo: attackerAddress }),
      });
      await registerPredicateBound(
        { publicClient, walletClient, account: walletClient.account },
        {
          address: guardAddress,
          predicateId: badId,
          config: mockConfigFromPredicate(badDraft.predicate),
          principal: walletClient.account.address,
          mandateDigest: badDraft.commitment.mandateDigest,
          taskHash: (badDraft.predicate.taskHash ?? ZERO_BYTES32) as Hex,
          extraFieldsDigest: computePredicateExtrasDigest(badDraft.predicate),
        },
      );
      const revertData = encodeFunctionData({
        abi: PREDICATE_GUARD_ABI,
        functionName: "validateAndConsume",
        args: validateArgs(badDraft),
      });
      const revertHash = await walletClient.sendTransaction({
        to: guardAddress,
        data: revertData,
        gas: 2_000_000n,
      });
      const revertReceipt = await publicClient.waitForTransactionReceipt({ hash: revertHash });
      if (revertReceipt.status !== "reverted") {
        throw new Error("expected reverted guard tx but Anvil reported success");
      }
      revertedGuardGas.push(Number(revertReceipt.gasUsed));
    }

    putSeries(
      "guardOnlyGas",
      "M22",
      "gas",
      `${GAS_LABEL}: gasUsed of the successful PredicatePaymentGuard.validateAndConsume receipt (C' recompute + predicate checks + nonce consume); deployment/registration excluded.`,
      guardOnlyGas,
    );
    putSeries(
      "completePaymentGas",
      "M22",
      "gas",
      `${GAS_LABEL}: gasUsed(validateAndConsume success) + gasUsed(on-chain settlement transfer from createOnChainFacilitator), summed per iteration; deployment/registration excluded.`,
      completePaymentGas,
    );
    putSeries(
      "successfulGuardGas",
      "M23",
      "gas",
      `${GAS_LABEL}: gasUsed of the successful validateAndConsume receipt (same observations as guardOnlyGas, reported under the success/revert split).`,
      successfulGuardGas,
    );
    putSeries(
      "revertedGuardGas",
      "M23",
      "gas",
      `${GAS_LABEL}: gasUsed of a MINED reverted validateAndConsume tx (PayeeNotAllowed). The guard aborts before the settlement transfer, so no settlement tx exists for the reverted path.`,
      revertedGuardGas,
    );
    putSeries(
      "successfulSettlementTxGas",
      "M23",
      "gas",
      `${GAS_LABEL}: gasUsed of the demo on-chain settlement transfer receipt on the successful path.`,
      settlementTxGas,
    );
    gasStatus = "RUN";
    gasReason = "Foundry available; real transactions executed on a local Anvil EVM.";
  } catch (error) {
    gasReason = error instanceof Error ? error.message : String(error);
    console.warn(`gas section NOT RUN: ${gasReason}`);
  } finally {
    anvilProcess?.kill();
  }

  // --- persist raw observations first (item 25) -----------------------------
  const cpuInfo = cpus();
  const environment = {
    runtime: "bun",
    bunVersion: process.versions.bun ?? "unknown",
    nodeVersion: process.version,
    platform: platform(),
    arch: arch(),
    cpuModel: cpuInfo[0]?.model ?? "unknown",
    logicalCores: cpuInfo.length,
    machineCount: 1,
  };
  const rawDocument = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    configuration: {
      requestedSamples: N,
      warmupIterationsExcluded: WARMUP,
      envOverrides: {
        PERF_SAMPLES: process.env.PERF_SAMPLES ?? null,
        PERF_ANVIL_PORT: process.env.PERF_ANVIL_PORT ?? null,
      },
    },
    environment,
    labeling: { gas: GAS_LABEL, publicNetworkEvidence: false },
    gas: { status: gasStatus, reason: gasReason, chain: gasChain },
    series,
  };
  await writeFile(rawPath, `${JSON.stringify(rawDocument, null, 2)}\n`);
  const rawSha256 = createHash("sha256").update(await readFile(rawPath)).digest("hex");

  // --- summary document -----------------------------------------------------
  const metricTitles: Record<string, string> = {
    M15: "Commitment-generation latency",
    M16: "Signature-verification latency",
    M17: "Authorization-verification latency",
    M18: "Predicate-evaluation latency",
    M19: "Evidence-generation latency",
    M20: "Verification latency",
    M21: "Complete end-to-end transaction latency",
    M22: "Complete payment-related gas consumption",
    M23: "Successful and reverted transaction costs",
    M24: "Mean, median, standard deviation, sample count",
    M25: "Preserve raw benchmark results",
    M26: "Overhead of the full CLB-ACEL path vs plain x402",
  };
  const metrics: Record<string, unknown> = {};
  for (const [id, title] of Object.entries(metricTitles)) {
    if (id === "M24") {
      metrics[id] = {
        title,
        status: "MEASURED",
        definition: "mean = arithmetic mean; median = middle order statistic; p50 = median; p95 = 95th order statistic; stddev = sample (n-1) standard deviation; sampleCount = raw observations; min/max included.",
        computedFor: Object.keys(series).filter((key) => series[key]!.metricId !== "M23" || gasStatus === "RUN"),
      };
      continue;
    }
    if (id === "M25") {
      metrics[id] = {
        title,
        status: "MEASURED",
        path: "experiments/benchmarks/performance-raw.json",
        sha256: rawSha256,
        totalSamples: Object.values(series).reduce((sum, value) => sum + value.samples.length, 0),
        seriesCount: Object.keys(series).length,
      };
      continue;
    }
    const members = Object.entries(series).filter(([, value]) => value.metricId === id);
    const measured = members.length > 0;
    metrics[id] = {
      title,
      status: measured ? "MEASURED" : "NOT MEASURED",
      ...(measured ? {} : { reason: gasReason }),
      ...(id === "M22" || id === "M23"
        ? {
            gasStatus,
            label: GAS_LABEL,
            publicNetworkEvidence: false,
            ...(id === "M22" || id === "M23" ? { chain: gasChain } : {}),
          }
        : {}),
      series: Object.fromEntries(
        members.map(([key, value]) => [key, { unit: value.unit, boundary: value.boundary, summary: summarize(value.samples) }]),
      ),
    };
  }

  const plainSamples = series.plainX402Accept!.samples;
  const clbSamples = series.clbAcelAcceptAndVerify!.samples;
  const pairedDelta = clbSamples.map((value, index) => value - (plainSamples[index] ?? 0));
  const overhead = {
    metricId: "M26",
    unit: "ms" as Unit,
    n: N,
    boundaryNote:
      "Both spans end in a local-facilitator settlement. The CLB-ACEL span additionally performs commitment recomputation, CLB signature verification, the predicate guard decision, evidence chain/Merkle construction and full verifyTrace (which internally re-verifies the x402 authorization). Components use the prebuilt M15/M16/M17/M19/M20 fixtures; the summed span is a cost model, not one coherent end-to-end trace.",
    plainX402: summarize(plainSamples),
    clbAcel: summarize(clbSamples),
    pairedDeltaMs: summarize(pairedDelta),
    ratioOfMeans: summarize(clbSamples).mean / summarize(plainSamples).mean,
  };

  const resultsDocument = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    configuration: { requestedSamples: N, warmupIterationsExcluded: WARMUP },
    environment,
    oneMachineLimitation: "ONE MACHINE ONLY — no multi-machine, multi-OS or cloud claim is made.",
    baseSepolia:
      "NOT MEASURED HERE — public-network results are recorded separately at experiments/benchmarks/reviewer2/comment2/public/onchain-guard-results.public.json. No public-network timing or gas is claimed in this file.",
    overheadVsPlainX402: overhead,
    labeling: {
      gas: GAS_LABEL,
      publicNetworkEvidence: false,
      mainnetGasClaims: false,
    },
    gas: { status: gasStatus, reason: gasReason },
    rawResults: { path: "experiments/benchmarks/performance-raw.json", sha256: rawSha256 },
    metrics,
  };
  await writeFile(resultsPath, `${JSON.stringify(resultsDocument, null, 2)}\n`);

  // --- human-readable report ------------------------------------------------
  const fmt = (value: number, unit: Unit) => (unit === "ms" ? value.toFixed(4) : value.toFixed(0));
  const lines: string[] = [
    "# R3-C1 Performance Benchmark (latency + gas)",
    "",
    `- Samples per operation: **${N}** (warmup ${WARMUP}, excluded).`,
    `- Gas label: **${GAS_LABEL}**.`,
    `- Gas status: **${gasStatus}** — ${gasReason}`,
    `- Raw observations: \`experiments/benchmarks/performance-raw.json\` (sha256 \`${rawSha256}\`).`,
    `- Machine: **${environment.cpuModel}** · ${environment.logicalCores} logical cores · ${environment.platform}/${environment.arch}. **ONE MACHINE ONLY** — no multi-machine, multi-OS or cloud claim.`,
    `- Base Sepolia: **NOT MEASURED HERE — public-network results are recorded at \`experiments/benchmarks/reviewer2/comment2/public/onchain-guard-results.public.json\`.**`,
    "",
    "| Metric | Series | Unit | Mean | Median | p95 | Stddev | Count | Min | Max |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [id, title] of Object.entries(metricTitles)) {
    if (id === "M24" || id === "M25") continue;
    const members = Object.entries(series).filter(([, value]) => value.metricId === id);
    if (members.length === 0) {
      lines.push(`| ${id} ${title} | — | — | NOT MEASURED | — | — | 0 | — | — |`);
      continue;
    }
    for (const [key, value] of members) {
      const s = summarize(value.samples);
      lines.push(
        `| ${id} ${title} | \`${key}\` | ${value.unit} | ${fmt(s.mean, value.unit)} | ${fmt(s.median, value.unit)} | ${fmt(s.p95, value.unit)} | ${fmt(s.stddev, value.unit)} | ${s.sampleCount} | ${fmt(s.min, value.unit)} | ${fmt(s.max, value.unit)} |`,
      );
    }
  }
  lines.push(
    "",
    "## Reviewer #4 Comment 4 — overhead vs plain x402",
    "",
    `- Plain x402 (verify + local settle): mean **${fmt(overhead.plainX402.mean, "ms")} ms**, median ${fmt(overhead.plainX402.median, "ms")} ms, p95 ${fmt(overhead.plainX402.p95, "ms")} ms, stddev ${fmt(overhead.plainX402.stddev, "ms")} ms, n=${overhead.plainX402.sampleCount}.`,
    `- Full CLB-ACEL (commitment + signature + guard + evidence + verifyTrace + settle): mean **${fmt(overhead.clbAcel.mean, "ms")} ms**, median ${fmt(overhead.clbAcel.median, "ms")} ms, p95 ${fmt(overhead.clbAcel.p95, "ms")} ms, stddev ${fmt(overhead.clbAcel.stddev, "ms")} ms, n=${overhead.clbAcel.sampleCount}.`,
    `- Paired absolute overhead (CLB − plain, same iteration): mean **${fmt(overhead.pairedDeltaMs.mean, "ms")} ms**, median ${fmt(overhead.pairedDeltaMs.median, "ms")} ms, p95 ${fmt(overhead.pairedDeltaMs.p95, "ms")} ms, stddev ${fmt(overhead.pairedDeltaMs.stddev, "ms")} ms.`,
    `- Ratio of means: **${overhead.ratioOfMeans.toFixed(2)}×**. ${overhead.boundaryNote}`,
    "",
    "## Exact timing / measurement boundaries",
    "",
  );
  for (const [key, value] of Object.entries(series)) {
    lines.push(`- \`${key}\` (${value.metricId}, ${value.unit}): ${value.boundary}`);
  }
  lines.push(
    "",
    "Items 24 and 25 are the summary-statistics and raw-preservation deliverables, reported in `performance-results.json` and `performance-raw.json` respectively.",
    "",
  );
  await writeFile(reportPath, lines.join("\n"));

  console.log(
    JSON.stringify(
      {
        outputDir: artifactsDir,
        samples: N,
        series: Object.keys(series).length,
        gasStatus,
        measuredMetrics: Object.entries(metrics)
          .filter(([, value]) => (value as { status: string }).status === "MEASURED")
          .map(([id]) => id),
        rawSha256,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`\n✗ performance benchmark failed: ${error instanceof Error ? error.stack : error}`);
  process.exit(1);
});
