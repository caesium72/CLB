/**
 * Reviewer #2, Comment 2 — REAL Base Sepolia (public testnet) evaluation path.
 *
 * Same ten pre-settlement PLANS as the local Anvil harness, but against the real
 * `PredicatePaymentGuard` on Base Sepolia. Violations are force-broadcast with an
 * explicit gas limit, so a failed attempt is a REAL mined-and-reverted public tx
 * with a BaseScan-verifiable hash — not a caught simulation.
 *
 * Usage: bun run e2e:reviewer2:comment2:public
 *
 * Without credentials/funds this writes a clearly-labelled `NOT RUN` artifact and
 * exits 0. It NEVER fabricates a tx hash, block number, or funded balance.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPredicate, draftModeBPayment } from "@clb-acel/attack-core";
import { computePredicateExtrasDigest } from "@clb-acel/clb-core";
import {
  ContractPredicateGuard,
  PREDICATE_GUARD_ABI,
  PredicateOnChainRevertError,
  extractRevertName,
  makeViemGuardReader,
  mockConfigFromPredicate,
  registerPredicateBound,
} from "@clb-acel/predicate-adapter";
import type { ContractGuardWriter, GuardSettlementInput } from "@clb-acel/predicate-adapter";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { PLANS, csv } from "./e2e-reviewer2-comment2";

const repoRoot = resolve(import.meta.dir, "..");
const artifactsDir = join(repoRoot, "experiments", "benchmarks", "reviewer2", "comment2", "public");
const contractsDir = join(repoRoot, "contracts");
const forgeCandidate = join(
  homedir(),
  ".foundry",
  "bin",
  process.platform === "win32" ? "forge.exe" : "forge",
);
const forgeBin = process.env.FORGE_BIN ?? (existsSync(forgeCandidate) ? forgeCandidate : "forge");
const chainId = 84532;
const explorerBase = "https://sepolia.basescan.org/tx/";
const settlementConsumedTopic = keccak256(
  stringToHex("SettlementConsumed(bytes32,bytes32,address)"),
);
/** Same manual-gas path as apps/web-demo/.../runLiveOnChainRejection: skip estimation, mine the revert. */
const settleGas = 400_000n;
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
const startedAt = new Date().toISOString();

const CSV_HEADER = [
  "scenario",
  "attempt",
  "expected_reason",
  "reverted",
  "reason",
  "commitment",
  "nonce",
  "commitment_parity_ok",
  "nonce_consumed_before",
  "nonce_consumed_after",
  "settlement_consumed_event",
  "tx_hash",
  "block_number",
  "explorer_url",
  "gas_used",
  "facilitator_invoked",
  "as_expected",
  "note",
];

type PublicResult = {
  id: string;
  attempt: number;
  addresses: string[];
  expectedReason: string | null;
  commitment: Hex;
  nonce: Hex;
  commitmentParityOk: boolean;
  reverted: boolean;
  reason: string | null;
  revertBeforeTransfer: boolean;
  nonceConsumedBefore: boolean;
  nonceConsumedAfter: boolean;
  settlementConsumedEventEmitted: boolean;
  txHash: string | null;
  blockNumber: number | null;
  explorerUrl: string | null;
  gasUsed: string | null;
  facilitatorInvoked: false;
  asExpected: boolean;
  note: string;
};

function resultRow(result: PublicResult): Array<string | number | boolean | null> {
  return [
    result.id,
    result.attempt,
    result.expectedReason,
    result.reverted,
    result.reason,
    result.commitment,
    result.nonce,
    result.commitmentParityOk,
    result.nonceConsumedBefore,
    result.nonceConsumedAfter,
    result.settlementConsumedEventEmitted,
    result.txHash,
    result.blockNumber,
    result.explorerUrl,
    result.gasUsed,
    result.facilitatorInvoked,
    result.asExpected,
    result.note,
  ];
}

async function writeArtifacts(
  meta: Record<string, unknown>,
  results: PublicResult[],
): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(
    join(artifactsDir, "onchain-guard-results.public.json"),
    `${JSON.stringify({ ...meta, results }, null, 2)}\n`,
  );
  const rows =
    results.length > 0
      ? results.map(resultRow)
      : [
          [
            "NOT RUN",
            "",
            "",
            "",
            String(meta.reason ?? ""),
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "no public transaction was mined",
          ],
        ];
  await writeFile(join(artifactsDir, "onchain-guard-results.public.csv"), csv(CSV_HEADER, rows));
}

async function toolVersions(): Promise<Record<string, string | null>> {
  let forge: string | null = null;
  try {
    forge =
      execFileSync(forgeBin, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
        .split("\n")[0]
        ?.trim() ?? null;
  } catch {
    forge = null;
  }
  let viemVersion: string | null = null;
  try {
    viemVersion = (
      JSON.parse(
        await readFile(join(repoRoot, "node_modules", "viem", "package.json"), "utf8"),
      ) as {
        version: string;
      }
    ).version;
  } catch {
    viemVersion = null;
  }
  return { bun: Bun.version, forge, viem: viemVersion };
}

async function main(): Promise<void> {
  const rpc = process.env.RPC_URL_BASE_SEPOLIA?.trim() || process.env.RPC_URL?.trim() || "";
  const rawKey = (process.env.DEPLOYER_PRIVATE_KEY?.trim() ||
    process.env.SHOPPING_AGENT_PRIVATE_KEY?.trim() ||
    "") as Hex;
  const guardOverride = (process.env.PREDICATE_GUARD_ADDRESS?.trim() || "") as Address;
  const redact = (text: string): string => (rawKey ? text.replaceAll(rawKey, "<redacted>") : text);
  const credentialsPresent = {
    RPC_URL_BASE_SEPOLIA: Boolean(process.env.RPC_URL_BASE_SEPOLIA?.trim()),
    RPC_URL: Boolean(process.env.RPC_URL?.trim()),
    DEPLOYER_PRIVATE_KEY: Boolean(process.env.DEPLOYER_PRIVATE_KEY?.trim()),
    SHOPPING_AGENT_PRIVATE_KEY: Boolean(process.env.SHOPPING_AGENT_PRIVATE_KEY?.trim()),
    PREDICATE_GUARD_ADDRESS: Boolean(guardOverride),
  };
  const versions = await toolVersions();
  const baseMeta: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    startedAt,
    network: "base-sepolia",
    chainId,
    executionEnvironment: "base-sepolia-public-testnet",
    rpcUrl: rpc,
    explorerBase,
    credentialsPresent,
    toolVersions: versions,
    contract: "contracts/src/PredicatePaymentGuard.sol::validateAndConsume",
    guardEntrypoint: "ContractPredicateGuard.settleOnChain (force-broadcast, explicit gas)",
    registrationMethod: "registerPredicateBound",
    registrationMethodNote:
      "Predicates are registered through the enforced human-bound path: the signer is the " +
      "principal (msg.sender), and it signs bindingDigest(predicateId, config, principal, " +
      "mandateDigest, taskHash, extraFieldsDigest). The binding extras/mandate are taken from " +
      "the same draft that builds C', so registration and settlement agree and every plan keeps " +
      "its expected outcome. The settlement call stays the 7-arg validateAndConsume, which " +
      "enforces payee/asset/chain/amount/expiry (no chain cross-check or taskHash gate), so " +
      "CHAIN_SWITCH and TASK_SUBSTITUTION behave exactly as in the local Anvil harness.",
    caveat:
      "Reverts are decoded from a non-broadcast simulation, then the same calldata is " +
      "force-broadcast with an explicit gas limit so a real failed public tx is mined. " +
      "facilitatorInvoked is always false: the guard transfers no funds.",
  };
  const notRun = (reason: string, extra: Record<string, unknown> = {}) => ({
    ...baseMeta,
    status: "NOT RUN",
    reason,
    PUBLIC_NETWORK_EVIDENCE: false,
    ON_CHAIN_EXECUTION_CLAIM:
      "NO PUBLIC NETWORK TRANSACTIONS WERE MINED. NO TX HASHES OR BLOCK NUMBERS ARE CLAIMED. " +
      "LOCAL ANVIL EVIDENCE REMAINS THE EXECUTED DEFAULT.",
    ...extra,
  });

  const results: PublicResult[] = [];
  let meta: Record<string, unknown>;

  try {
    if (!rpc || !rawKey) {
      meta = notRun(
        "credentials missing: RPC_URL_BASE_SEPOLIA (or RPC_URL) and DEPLOYER_PRIVATE_KEY " +
          "(or SHOPPING_AGENT_PRIVATE_KEY) are required",
      );
    } else {
      let account;
      try {
        account = privateKeyToAccount(rawKey);
      } catch (error) {
        meta = notRun("invalid signer private key", { detail: redact(String(error)) });
        await writeArtifacts(meta, results);
        console.log(
          JSON.stringify(
            { status: meta.status, reason: meta.reason, outputDir: artifactsDir },
            null,
            2,
          ),
        );
        return;
      }
      const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
      const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(rpc),
      });
      baseMeta.signerAddress = account.address;

      // --- Preflight: eth_chainId + eth_getBalance (never print/store the key) ---
      let actualChainId: number;
      let balance: bigint;
      try {
        actualChainId = await publicClient.getChainId();
        balance = await publicClient.getBalance({ address: account.address });
      } catch (error) {
        meta = notRun("Base Sepolia RPC did not respond to preflight", {
          detail: redact(String(error)),
        });
        await writeArtifacts(meta, results);
        console.log(
          JSON.stringify(
            { status: meta.status, reason: meta.reason, outputDir: artifactsDir },
            null,
            2,
          ),
        );
        return;
      }
      baseMeta.observedChainId = actualChainId;
      baseMeta.balanceAtPreflightWei = balance.toString();
      if (actualChainId !== chainId) {
        meta = notRun(`wrong chain: eth_chainId=${actualChainId}, expected ${chainId}`);
        await writeArtifacts(meta, results);
        console.log(
          JSON.stringify(
            { status: meta.status, reason: meta.reason, outputDir: artifactsDir },
            null,
            2,
          ),
        );
        return;
      }
      if (balance === 0n) {
        meta = notRun("signer unfunded on Base Sepolia", {
          detail: guardOverride
            ? "A guard address was supplied, but the signer has 0 ETH and cannot send registration/settlement txs."
            : "Fund the throwaway key (or supply a funded signer) and re-run; no deployment was attempted.",
          guardAddressSupplied: Boolean(guardOverride),
        });
        await writeArtifacts(meta, results);
        console.log(
          JSON.stringify(
            { status: meta.status, reason: meta.reason, outputDir: artifactsDir },
            null,
            2,
          ),
        );
        return;
      }

      // --- Guard: deploy once via forge create, or reuse PREDICATE_GUARD_ADDRESS ---
      let guardAddress: Address = guardOverride;
      let deployTxHash: string | null = null;
      if (!guardAddress) {
        const args = [
          "create",
          "src/PredicatePaymentGuard.sol:PredicatePaymentGuard",
          "--rpc-url",
          rpc,
          "--private-key",
          rawKey,
          "--broadcast",
          "--constructor-args",
          String(chainId),
        ];
        // forge prints "Deployed to:" on stdout on some versions, stderr on others.
        const created = spawnSync(forgeBin, args, {
          cwd: contractsDir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        const output = `${created.stdout ?? ""}${created.stderr ?? ""}`;
        if (created.status !== 0) {
          throw new Error(redact(`forge create failed (exit ${created.status}):\n${output}`));
        }
        deployTxHash = output.match(/Transaction hash:\s*(0x[0-9a-fA-F]{64})/)?.[1] ?? null;
        const deployed = output.match(/Deployed to:\s*(0x[0-9a-fA-F]{40})/)?.[1];
        if (!deployed) throw new Error("forge create did not print 'Deployed to:'");
        guardAddress = deployed as Address;
      }
      baseMeta.guardAddress = guardAddress;
      baseMeta.guardSource = guardOverride ? "PREDICATE_GUARD_ADDRESS" : "forge create --broadcast";
      baseMeta.deployTxHash = deployTxHash;

      const reader = makeViemGuardReader({ publicClient });
      const registrationTxHashes: Record<string, string> = {};
      baseMeta.registrationTxHashes = registrationTxHashes;

      const register = async (draft: Awaited<ReturnType<typeof draftModeBPayment>>) => {
        const already = await publicClient.readContract({
          address: guardAddress,
          abi: PREDICATE_GUARD_ABI,
          functionName: "isBound",
          args: [draft.predicateId],
        });
        if (already) return;
        const hash = await registerPredicateBound(
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
        registrationTxHashes[draft.predicateId] = hash;
      };

      // Receipts are captured here so the mined revert still has a real tx hash.
      const receiptByNonce = new Map<
        Hex,
        {
          blockNumber: number;
          gasUsed: string;
          settlementConsumed: boolean;
          status: string;
        }
      >();
      const hashByNonce = new Map<Hex, Hex>();

      const writer: ContractGuardWriter = async ({
        address,
        commitment,
        extraFieldsDigest,
        cPrime,
        nonce,
      }) => {
        const id = {
          chainId: BigInt(commitment.identityRef.chainId),
          registryAddr: commitment.identityRef.registryAddr as Hex,
          agentId: commitment.identityRef.agentId,
        };
        const p = commitment.settlementParams;
        const settleParams = {
          chainId: BigInt(p.chainId),
          network: p.network,
          asset: p.asset,
          payTo: p.payTo as Hex,
          value: p.value,
          valueAtomic: BigInt(p.valueAtomic),
          validBefore: p.validBefore,
          payerAgentId: p.payerAgentId,
        };
        const args = [
          id,
          commitment.mandateDigest,
          commitment.predicateId,
          extraFieldsDigest,
          settleParams,
          cPrime,
          nonce,
        ] as const;

        // Decode the Solidity error without broadcasting, then force-mine the same calldata.
        let reason: string | undefined;
        try {
          await publicClient.simulateContract({
            address,
            abi: PREDICATE_GUARD_ABI,
            functionName: "validateAndConsume",
            args,
            account,
          });
        } catch (error) {
          reason = extractRevertName(error);
        }

        const hash = await walletClient.writeContract({
          address,
          abi: PREDICATE_GUARD_ABI,
          functionName: "validateAndConsume",
          args,
          gas: settleGas,
        });
        hashByNonce.set(nonce, hash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        receiptByNonce.set(nonce, {
          blockNumber: Number(receipt.blockNumber),
          gasUsed: receipt.gasUsed.toString(),
          status: receipt.status,
          settlementConsumed: receipt.logs.some(
            (log) =>
              log.topics[0] === settlementConsumedTopic &&
              log.address.toLowerCase() === address.toLowerCase(),
          ),
        });
        if (receipt.status === "reverted") {
          throw new PredicateOnChainRevertError(
            reason ?? "reverted (Solidity error not decoded by simulation)",
          );
        }
        return { txHash: hash };
      };

      const guard = new ContractPredicateGuard({ address: guardAddress, writer, reader });
      // Local Anvil has a 2026-05-30 clock; the public chain uses real block time.
      // Keep every predicate valid for a day so only the EXPIRED plan expires.
      const futureUntil = new Date(Date.now() + 86_400_000).toISOString();
      for (const plan of PLANS) {
        const predicate =
          plan.id === "EXPIRED_AUTHORIZATION"
            ? plan.predicate
            : { ...(plan.predicate ?? defaultPredicate()), validUntil: futureUntil };
        const draft = await draftModeBPayment({
          traceId: plan.traceId,
          predicateId: plan.traceId,
          predicate,
          ...(plan.concrete ? { concrete: plan.concrete } : {}),
        });
        await register(draft);

        const input: GuardSettlementInput = {
          predicate: draft.predicate,
          params: draft.settlementParams,
          commitment: draft.commitment,
          now: new Date(),
        };
        const readConsumed = async () =>
          (
            await reader({
              address: guardAddress,
              commitment: draft.modeBCommitment,
              nonce: draft.nonce,
            })
          ).consumed;

        for (let attempt = 0; attempt < plan.expected.length; attempt += 1) {
          const nonceConsumedBefore = await readConsumed();
          const result = await guard.settleOnChain(input);
          const nonceConsumedAfter = await readConsumed();
          const expectedReason = plan.expected[attempt] ?? null;
          const txHash = result.txHash ?? hashByNonce.get(result.nonce) ?? null;
          const receipt = txHash ? receiptByNonce.get(result.nonce) : undefined;
          const asExpected =
            result.reverted === (expectedReason !== null) &&
            (expectedReason === null || result.reason === expectedReason) &&
            nonceConsumedAfter === (expectedReason === null || nonceConsumedBefore) &&
            (receipt?.settlementConsumed ?? false) === (expectedReason === null);

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
            nonceConsumedBefore,
            nonceConsumedAfter,
            settlementConsumedEventEmitted: receipt?.settlementConsumed ?? false,
            txHash,
            blockNumber: receipt?.blockNumber ?? null,
            explorerUrl: txHash ? `${explorerBase}${txHash}` : null,
            gasUsed: receipt?.gasUsed ?? null,
            facilitatorInvoked: false,
            asExpected,
            note: plan.note,
          });
        }
      }

      const expectedAttempts = PLANS.reduce((sum, plan) => sum + plan.expected.length, 0);
      const minedTxCount = results.filter((row) => row.txHash !== null).length;
      const allAsExpected =
        results.length === expectedAttempts &&
        results.every((row) => row.asExpected && row.commitmentParityOk);
      const publicEvidence = allAsExpected && minedTxCount === expectedAttempts;
      meta = {
        ...baseMeta,
        finishedAt: new Date().toISOString(),
        status: publicEvidence ? "COMPLETED" : "FAILED",
        reason: publicEvidence ? null : "public run did not match every expected plan outcome",
        PUBLIC_NETWORK_EVIDENCE: publicEvidence,
        ON_CHAIN_EXECUTION_CLAIM: publicEvidence
          ? "EXECUTED ON THE BASE SEPOLIA PUBLIC TESTNET. EVERY ATTEMPT HAS A MINED PUBLIC TX " +
            "WITH A BASESCAN-VERIFIABLE HASH; REVERTS ARE REAL FAILED TXS. NOT MAINNET."
          : "NO COMPLETE PUBLIC-NETWORK EVIDENCE WAS PRODUCED. LOCAL ANVIL EVIDENCE REMAINS THE EXECUTED DEFAULT.",
        minedTxCount,
        expectedAttempts,
      };
    }
  } catch (error) {
    meta = {
      ...baseMeta,
      finishedAt: new Date().toISOString(),
      status: "FAILED",
      reason: redact(error instanceof Error ? error.message.split("\n")[0] : String(error)),
      PUBLIC_NETWORK_EVIDENCE: false,
      ON_CHAIN_EXECUTION_CLAIM:
        "PUBLIC RUN DID NOT COMPLETE. LOCAL ANVIL EVIDENCE REMAINS THE EXECUTED DEFAULT.",
    };
  }

  await writeArtifacts(meta, results);
  console.log(
    JSON.stringify(
      {
        outputDir: artifactsDir,
        status: meta.status,
        reason: meta.reason ?? null,
        network: meta.network,
        chainId: meta.chainId,
        signerAddress: meta.signerAddress ?? null,
        guardAddress: meta.guardAddress ?? null,
        attempts: results.length,
        minedTransactions: meta.minedTxCount ?? results.filter((row) => row.txHash !== null).length,
        asExpected: results.filter((row) => row.asExpected).length,
        publicNetworkEvidence: meta.PUBLIC_NETWORK_EVIDENCE,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    `\n✗ reviewer2 comment2 public evaluation failed: ${error instanceof Error ? error.stack : error}`,
  );
  process.exit(1);
});
