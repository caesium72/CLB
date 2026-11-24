/**
 * Reviewer #2, Comment 2 — "public/production-like network evaluation".
 *
 * Exercises the Solidity guard layer for the pre-settlement (Mode B) scenarios.
 * Default: compile PredicatePaymentGuard, deploy it to a LOCAL Anvil EVM, and
 * run real viem transactions against it. No public network is contacted.
 * Fallback: `COMMENT2_MODE=mock` (or no local Foundry binaries) runs a faithful
 * in-memory model of the same revert semantics — explicitly not on-chain.
 *
 * Usage: bun run scripts/e2e-reviewer2-comment2.ts
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  attackerAddress,
  defaultConcrete,
  defaultPredicate,
  draftModeBPayment,
} from "@clb-acel/attack-core";
import {
  computeModeBSettlementCommitment,
  computePredicateExtrasDigest,
  deriveSettlementNonce,
} from "@clb-acel/clb-core";
import {
  ContractPredicateGuard,
  MockGuardChain,
  MOCK_TX_HASH,
  makeViemGuardReader,
  makeViemGuardWriter,
  mockConfigFromPredicate,
  registerPredicateBound,
} from "@clb-acel/predicate-adapter";
import type {
  ContractGuardReader,
  ContractGuardWriter,
  GuardSettlementInput,
} from "@clb-acel/predicate-adapter";
import type { SettlementDescriptorExact, SpendingPredicate } from "@clb-acel/schemas";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const repoRoot = resolve(import.meta.dir, "..");
const artifactsDir = join(repoRoot, "experiments", "benchmarks", "reviewer2", "comment2");
const contractsDir = join(repoRoot, "contracts");
const foundryBin = join(homedir(), ".foundry", "bin");
const exe = (name: string) => join(foundryBin, process.platform === "win32" ? `${name}.exe` : name);
const forgeBin = process.env.FORGE_BIN ?? exe("forge");
const anvilBin = process.env.ANVIL_BIN ?? exe("anvil");
const genesisSec = Math.floor(Date.parse("2026-05-30T05:00:00.000Z") / 1000);
const SETTLEMENT_CONSUMED_TOPIC = keccak256(stringToHex("SettlementConsumed(bytes32,bytes32,address)"));
const ANVIL_DEV_KEY = `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` as Hex;
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;

const credentialPresent = {
  RPC_URL_BASE_SEPOLIA: Boolean(process.env.RPC_URL_BASE_SEPOLIA?.trim()),
  RPC_URL: Boolean(process.env.RPC_URL?.trim()),
  DEPLOYER_PRIVATE_KEY: Boolean(process.env.DEPLOYER_PRIVATE_KEY?.trim()),
  SHOPPING_AGENT_PRIVATE_KEY: Boolean(process.env.SHOPPING_AGENT_PRIVATE_KEY?.trim()),
  PREDICATE_GUARD_ADDRESS: Boolean(process.env.PREDICATE_GUARD_ADDRESS?.trim()),
};

const BLOCKER =
  "PUBLIC BASE SEPOLIA EVIDENCE IS STILL BLOCKED: none of RPC_URL_BASE_SEPOLIA / RPC_URL, " +
  "a funded DEPLOYER_PRIVATE_KEY (or SHOPPING_AGENT_PRIVATE_KEY), or a deployed " +
  "PREDICATE_GUARD_ADDRESS is available. See scripts/deploy-predicate-guard-sepolia.ts and " +
  "apps/web-demo/src/server/clb/predicate-guard.ts (runLiveOnChainRejection). Supplying those " +
  "credentials re-runs this harness against the public testnet with PUBLIC_NETWORK_EVIDENCE=true.";

export type Plan = {
  id: string;
  traceId: string;
  addresses: string[];
  predicate?: SpendingPredicate;
  concrete?: SettlementDescriptorExact;
  observedTaskHash?: Hex;
  /** null = guard is expected to ALLOW the call. */
  expected: Array<string | null>;
  note: string;
};

const OTHER_TASK_HASH = `0x${"e".repeat(64)}` as Hex;
const OBSERVED_TASK_HASH = `0x${"a".repeat(64)}` as Hex;
const PAST = "2026-05-30T04:00:00.000Z";

/** Mirrors PRE_SETTLEMENT_SCENARIOS in packages/attack-core/src/presettlement.ts. */
export const PLANS: Plan[] = [
  {
    id: "HAPPY_PATH",
    traceId: "r2c2-onchain-happy",
    addresses: [],
    expected: [null],
    note: "Baseline: within all signed rules; guard allows and consumes the nonce.",
  },
  {
    id: "MALICIOUS_MERCHANT_PAYEE_SUBSTITUTION",
    traceId: "r2c1-pre-payee",
    addresses: ["malicious-merchant"],
    concrete: defaultConcrete({ payTo: attackerAddress }),
    expected: ["PayeeNotAllowed"],
    note: "Payee swapped to an unapproved address after signing.",
  },
  {
    id: "MALICIOUS_MERCHANT_REVOKED_IDENTITY",
    traceId: "r2c1-pre-revoked",
    addresses: ["malicious-merchant"],
    concrete: defaultConcrete({ payTo: attackerAddress }),
    expected: ["PayeeNotAllowed"],
    note: "Revoked merchant routes payment to a fresh unapproved address.",
  },
  {
    id: "COMPROMISED_AGENT_AMOUNT_ESCALATION",
    traceId: "r2c1-pre-amount",
    addresses: ["compromised-agent"],
    concrete: defaultConcrete({ value: "9.99" }),
    expected: ["AmountExceedsMax"],
    note: "9.99 atomic-bound spend above the signed 5.00 cap.",
  },
  {
    id: "COMPROMISED_AGENT_ASSET_SWITCH",
    traceId: "r2c1-pre-asset",
    addresses: ["compromised-agent"],
    concrete: defaultConcrete({ asset: "WETH" }),
    expected: ["AssetNotAllowed"],
    note: "Settlement in an asset the human never allowed.",
  },
  {
    id: "COMPROMISED_AGENT_CHAIN_SWITCH",
    traceId: "r2c1-pre-chain",
    addresses: ["compromised-agent"],
    concrete: defaultConcrete({ chainId: 1, network: "ethereum" }),
    expected: ["ChainNotAllowed"],
    note: "Settlement moved outside the predicate's chain allowlist.",
  },
  {
    id: "COMPROMISED_AGENT_TASK_SUBSTITUTION",
    traceId: "r2c1-pre-task",
    addresses: ["compromised-agent"],
    predicate: defaultPredicate({ taskHash: OTHER_TASK_HASH }),
    observedTaskHash: OBSERVED_TASK_HASH,
    expected: [null],
    note:
      "GAP: PredicatePaymentGuard checks payee/asset/chain/amount/expiry/nonce, NOT taskHash. " +
      "The contract ALLOWS this; only the off-chain evaluatePredicate(observedTaskHash) blocks it.",
  },
  {
    id: "EXPIRED_AUTHORIZATION",
    traceId: "r2c1-pre-expired",
    addresses: ["compromised-agent"],
    predicate: defaultPredicate({ validUntil: PAST }),
    expected: ["PredicateExpired"],
    note: "Authorization window closed before the settlement block.",
  },
  {
    id: "MULTI_STEP_SELECTION_THEN_SUBSTITUTION",
    traceId: "r2c1-pre-multistep-payee",
    addresses: ["multi-step", "malicious-merchant"],
    concrete: defaultConcrete({ payTo: attackerAddress }),
    expected: ["PayeeNotAllowed"],
    note: "Prompt-injected selection is enforced at the on-chain payee rule.",
  },
  {
    id: "MULTI_STEP_ESCALATION_THEN_REPLAY",
    traceId: "r2c1-pre-multistep-replay",
    addresses: ["multi-step", "compromised-agent"],
    expected: [null, "NonceAlreadyConsumed"],
    note: "First settlement consumes the nonce; replay is rejected by the contract.",
  },
];

type AttemptResult = {
  id: string;
  attempt: number;
  addresses: string[];
  expectedReason: string | null;
  commitment: Hex;
  nonce: Hex;
  commitmentParityOk: boolean;
  reverted: boolean;
  reason: string | null;
  /** true only when the revert was captured before any state-changing settlement. */
  revertBeforeTransfer: boolean;
  nonceConsumedBefore: boolean;
  nonceConsumedAfter: boolean;
  settlementConsumedEventEmitted: boolean;
  txHash: string | null;
  localBlockNumber: number | null;
  facilitatorInvoked: false;
  asExpected: boolean;
  note: string;
};

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

export function csv(header: string[], rows: Array<Array<string | number | boolean | null>>): string {
  const cell = (value: string | number | boolean | null) =>
    typeof value === "string" && /[",\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : String(value ?? "");
  return [header.join(","), ...rows.map((row) => row.map(cell).join(","))].join("\n") + "\n";
}

async function main(): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
  const results: AttemptResult[] = [];
  let executionEnv: "local-anvil-evm" | "mock-contract-semantics";
  const chainInfo: Record<string, unknown> = {};
  let anvilProcess: ReturnType<typeof spawn> | undefined;

  const useMock =
    process.env.COMMENT2_MODE === "mock" || !existsSync(forgeBin) || !existsSync(anvilBin);
  executionEnv = useMock ? "mock-contract-semantics" : "local-anvil-evm";

  // Set up by the chosen execution environment below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let publicClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let walletClient: any;
  let writer: ContractGuardWriter;
  let reader: ContractGuardReader;
  let tick: () => Promise<void> = async () => {};
  let guardAddress: Address;
  let register: (draft: Awaited<ReturnType<typeof draftModeBPayment>>) => Promise<void>;
  let describeTx: (hash: Hex) => Promise<{ blockNumber: number | null; settlementConsumed: boolean }>;
  let renderTxHash: (hash: Hex) => string | null;

  try {
    if (!useMock) {
      // 1. Compile the real Solidity contract into the artifacts dir (no repo-source writes).
      const forgeOut = join(artifactsDir, "forge-out");
      const forgeCache = join(artifactsDir, "forge-cache");
      execFileSync(
        forgeBin,
        ["build", "src/PredicatePaymentGuard.sol", "--root", contractsDir, "--out", forgeOut, "--cache-path", forgeCache],
        { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      const artifact = JSON.parse(
        await readFile(join(forgeOut, "PredicatePaymentGuard.sol", "PredicatePaymentGuard.json"), "utf8"),
      ) as { abi: Abi; bytecode: { object: string } };

      // 2. Start an isolated local EVM with a deterministic clock.
      const port = Number(process.env.COMMENT2_ANVIL_PORT ?? 18545);
      const rpcUrl = `http://127.0.0.1:${port}`;
      anvilProcess = spawn(
        anvilBin,
        [
          "--host", "127.0.0.1",
          "--port", String(port),
          "--chain-id", "84532",
          "--timestamp", String(genesisSec),
        ],
        { stdio: "ignore" },
      );
      await waitForRpc(rpcUrl);

      const account = privateKeyToAccount(ANVIL_DEV_KEY);
      const chain = {
        id: 84532,
        name: "Anvil (local)",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      } as const;
      publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
      walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

      // 3. Deploy with the SAME domain chain id used to compute C' off-chain.
      const deployHash = await walletClient.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode.object as Hex,
        args: [84532n],
      });
      const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
      guardAddress = deployReceipt.contractAddress as Address;
      if (!guardAddress) throw new Error("deploy did not return a contract address");

      Object.assign(chainInfo, {
        network: "local-anvil",
        publicNetwork: false,
        rpcUrl,
        chainId: await publicClient.getChainId(),
        anvilVersion: execFileSync(anvilBin, ["--version"], { encoding: "utf8" }).split("\n")[0],
        deployTxHash: deployHash,
        deployBlockNumber: Number(deployReceipt.blockNumber),
        guardAddress,
        constructorDomainChainId: 84532,
      });

      let clock = genesisSec;
      tick = async () => {
        clock += 1;
        await publicClient.request({
          method: "evm_setNextBlockTimestamp",
          params: [clock],
        });
      };
      register = async (draft) => {
        await registerPredicateBound(
          { publicClient, walletClient, account },
          {
            address: guardAddress,
            predicateId: draft.predicateId,
            config: mockConfigFromPredicate(draft.predicate),
            principal: account.address,
            mandateDigest: draft.commitment.mandateDigest,
            taskHash: (draft.predicate.taskHash ?? ZERO_BYTES32) as Hex,
            extraFieldsDigest: computePredicateExtrasDigest(draft.predicate),
          },
        );
      };
      describeTx = async (hash) => {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        return {
          blockNumber: Number(receipt.blockNumber),
          settlementConsumed: receipt.logs.some(
            (log) =>
              log.topics[0] === SETTLEMENT_CONSUMED_TOPIC &&
              log.address.toLowerCase() === guardAddress.toLowerCase(),
          ),
        };
      };
      renderTxHash = (hash) => String(hash);
      writer = makeViemGuardWriter({ publicClient, walletClient, account });
      reader = makeViemGuardReader({ publicClient });
    } else {
      const mock = new MockGuardChain({ nowSec: BigInt(genesisSec + 1) });
      guardAddress = `0x${"00".repeat(20)}` as Address;
      writer = mock.writer;
      reader = mock.reader;
      register = async (draft) =>
        mock.register(draft.predicateId, mockConfigFromPredicate(draft.predicate));
      describeTx = async (hash) => ({
        blockNumber: null,
        settlementConsumed: hash === MOCK_TX_HASH,
      });
      renderTxHash = () => null; // never present a mock hash as chain evidence
      Object.assign(chainInfo, {
        network: "none",
        publicNetwork: false,
        chainId: null,
        guardAddress: null,
        note: "MOCK CONTRACT SEMANTICS — NO CHAIN, NO TRANSACTIONS, NO BLOCKS.",
      });
    }

    const guard = new ContractPredicateGuard({ address: guardAddress, writer, reader });

    for (const plan of PLANS) {
      const draft = await draftModeBPayment({
        traceId: plan.traceId,
        predicateId: plan.traceId,
        ...(plan.predicate ? { predicate: plan.predicate } : {}),
        ...(plan.concrete ? { concrete: plan.concrete } : {}),
      });
      await tick();
      await register(draft);

      const input: GuardSettlementInput = {
        predicate: draft.predicate,
        params: draft.settlementParams,
        commitment: draft.commitment,
        now: new Date(draft.baseTimeMs + 5000),
        ...(plan.observedTaskHash ? { observedTaskHash: plan.observedTaskHash } : {}),
      };

      for (let attempt = 0; attempt < plan.expected.length; attempt += 1) {
        await tick();
        const result = await guard.settleOnChain(input);
        const consumedAfter = (
          await reader({ address: guardAddress, commitment: result.commitment, nonce: result.nonce })
        ).consumed;
        const consumedBefore = attempt > 0;
        const expectedReason = plan.expected[attempt] ?? null;
        const tx = result.txHash ? await describeTx(result.txHash) : { blockNumber: null, settlementConsumed: false };
        const asExpected =
          result.reverted === (expectedReason !== null) &&
          (expectedReason === null || result.reason === expectedReason) &&
          consumedAfter === (expectedReason === null || consumedBefore) &&
          tx.settlementConsumed === (expectedReason === null);

        results.push({
          id: plan.id,
          attempt: attempt + 1,
          addresses: plan.addresses,
          expectedReason,
          commitment: result.commitment,
          nonce: result.nonce,
          commitmentParityOk:
            result.commitment === draft.modeBCommitment && result.nonce === draft.nonce,
          reverted: result.reverted,
          reason: result.reason ?? null,
          revertBeforeTransfer: result.reverted,
          nonceConsumedBefore: consumedBefore,
          nonceConsumedAfter: consumedAfter,
          settlementConsumedEventEmitted: tx.settlementConsumed,
          txHash: result.txHash ? renderTxHash(result.txHash) : null,
          localBlockNumber: tx.blockNumber,
          facilitatorInvoked: false,
          asExpected,
          note: plan.note,
        });
      }
    }
  } finally {
    anvilProcess?.kill();
  }

  const metadata = {
    generatedAt: new Date().toISOString(),
    executionEnvironment: executionEnv,
    PUBLIC_NETWORK_EVIDENCE: false,
    ON_CHAIN_EXECUTION_CLAIM:
      executionEnv === "local-anvil-evm"
        ? "EXECUTED ON A LOCAL ANVIL EVM ONLY. NOT EXECUTED ON BASE SEPOLIA OR ANY PUBLIC NETWORK. NO PUBLIC NETWORK TX HASHES OR BLOCK NUMBERS ARE CLAIMED."
        : "MOCKED CONTRACT SEMANTICS. NOT EXECUTED ON ANY CHAIN. NO REAL TRANSACTIONS, TX HASHES OR BLOCK NUMBERS.",
    publicNetwork: "none",
    credentialsPresent: credentialPresent,
    credentialBlocker: BLOCKER,
    chain: chainInfo,
    contract: "contracts/src/PredicatePaymentGuard.sol::validateAndConsume",
    guardEntrypoint: "ContractPredicateGuard.settleOnChain",
    caveat:
      "Reverted attempts are captured at viem simulation/validation on the local EVM: no reverted tx is broadcast, so no revert tx hash exists. The happy path produces a real local tx hash.",
  };

  await writeFile(
    join(artifactsDir, "onchain-guard-results.json"),
    `${JSON.stringify({ ...metadata, results }, null, 2)}\n`,
  );
  await writeFile(
    join(artifactsDir, "onchain-guard-results.csv"),
    csv(
      [
        "scenario", "attempt", "expected_reason", "reverted", "reason", "commitment", "nonce",
        "commitment_parity_ok", "revert_before_transfer", "nonce_consumed_before",
        "nonce_consumed_after", "settlement_consumed_event", "tx_hash", "local_block_number",
        "facilitator_invoked", "as_expected",
      ],
      results.map((result) => [
        result.id, result.attempt, result.expectedReason, result.reverted, result.reason,
        result.commitment, result.nonce, result.commitmentParityOk, result.revertBeforeTransfer,
        result.nonceConsumedBefore, result.nonceConsumedAfter, result.settlementConsumedEventEmitted,
        result.txHash, result.localBlockNumber, result.facilitatorInvoked, result.asExpected,
      ]),
    ),
  );

  console.log(
    JSON.stringify(
      {
        outputDir: artifactsDir,
        executionEnvironment: executionEnv,
        attempts: results.length,
        reverts: results.filter((result) => result.reverted).length,
        allowed: results.filter((result) => !result.reverted).length,
        asExpected: results.filter((result) => result.asExpected).length,
        asExpectedTotal: results.length,
        publicNetworkEvidence: false,
      },
      null,
      2,
    ),
  );

  if (results.some((result) => !result.asExpected || !result.commitmentParityOk)) {
    throw new Error("on-chain guard evaluation produced unexpected results — see artifacts");
  }
}

// Keep the module importable by the Base Sepolia harness (it reuses PLANS/csv)
// without re-running the local Anvil evaluation on import.
if (import.meta.main) {
  main().catch((error) => {
    console.error(`\n✗ reviewer2 comment2 evaluation failed: ${error instanceof Error ? error.stack : error}`);
    process.exit(1);
  });
}
