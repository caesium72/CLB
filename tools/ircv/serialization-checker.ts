/**
 * IRCV component 4 — cryptographic serialization consistency checker.
 *
 * Compares clb-core digest functions against an INDEPENDENT TypeScript mirror
 * of the Solidity ABI/EIP-712 formulas in `contracts/src/PredicatePaymentGuard.sol`
 * and `contracts/src/RevocationAwareGuard.sol`. This is a TS<->TS mirror check;
 * the genuine cross-language (Solidity-executed) comparison lives in the
 * seeded property-based component.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defaultConcrete, defaultPredicate, merchantAddress } from "@clb-acel/attack-core";
import {
  computeModeBSettlementCommitment,
  computePredicateConfigDigest,
  computePredicateDigest,
  computePredicateExtrasDigest,
  computePredicateGuardBindingDigest,
  computeRevocationAwareCommitment,
  computeSettlementParamsDigest,
  deriveRevocationAwareNonce,
  deriveSettlementNonce,
  settlementParamsFromExact,
} from "@clb-acel/clb-core";
import type { SpendingPredicate } from "@clb-acel/schemas";
import {
  type Address,
  type Hex,
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseUnits,
  toBytes,
} from "viem";

const ZERO = `0x${"00".repeat(32)}` as Hex;
const MANDATE_DIGEST = `0x${"ab".repeat(32)}` as Hex;
const PRINCIPAL = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
const REGISTRY = "0x0000000000000000000000000000000000008004" as Address;

const IDENTITY_REF_TYPEHASH = keccak256(
  toBytes("IdentityRef(uint256 chainId,address registryAddr,string agentId)"),
);
const SETTLEMENT_TYPEHASH = keccak256(
  toBytes(
    "CLBSettlementCommitment(IdentityRef identityRef,bytes32 mandateDigest,string predicateId,bytes32 predicateDigest,bytes32 settlementParamsDigest)IdentityRef(uint256 chainId,address registryAddr,string agentId)",
  ),
);
const DOMAIN_TYPEHASH = keccak256(
  toBytes("EIP712Domain(string name,string version,uint256 chainId)"),
);
const BINDING_TYPEHASH = keccak256(
  toBytes(
    "PredicateGuardBinding(string predicateId,bytes32 configDigest,address principal,bytes32 mandateDigest,bytes32 taskHash,bytes32 extraFieldsDigest,uint256 chainId)",
  ),
);

export type SerializationCheck = {
  id: string;
  field: string;
  clbCore: string;
  solidityMirror: string;
  ok: boolean;
  note?: string;
};

export type SerializationReport = {
  schema: "ircv-serialization/v1";
  method: string;
  sources: string[];
  checks: SerializationCheck[];
  /** Honest findings about the existing implementation; not fixed here. */
  findings: Array<{ id: string; severity: string; detail: string }>;
  summary: {
    total: number;
    matched: number;
    mismatched: number;
  };
};

/** Independent EIP-712 struct-hash computation (no viem typed-data helper). */
function mirrorCommitment(input: {
  chainId: number;
  agentId: string;
  predicateId: string;
  mandateDigest: Hex;
  predicateDigest: Hex;
  settlementParamsDigest: Hex;
}): Hex {
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
      [DOMAIN_TYPEHASH, keccak256(toBytes("CLB-ACEL")), keccak256(toBytes("0.1")), BigInt(input.chainId)],
    ),
  );
  const identityRefHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }],
      [IDENTITY_REF_TYPEHASH, BigInt(input.chainId), REGISTRY, keccak256(toBytes(input.agentId))],
    ),
  );
  const structHash = keccak256(
    encodeAbiParameters(
      Array(6).fill({ type: "bytes32" }),
      [
        SETTLEMENT_TYPEHASH,
        identityRefHash,
        input.mandateDigest,
        keccak256(toBytes(input.predicateId)),
        input.predicateDigest,
        input.settlementParamsDigest,
      ],
    ),
  );
  return keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}` as Hex);
}

function mirrorPredicateConfigDigest(predicate: SpendingPredicate): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address[]" }, { type: "bytes32[]" }, { type: "uint256[]" }, { type: "uint256" }, { type: "uint64" }],
      [
        predicate.allowedPayees.map((address) => getAddress(address)),
        predicate.allowedAssets.map((asset) => keccak256(toBytes(asset))),
        predicate.allowedChainIds.map((chain) => BigInt(chain)),
        parseUnits(predicate.maxValue, 6),
        BigInt(Math.trunc(Date.parse(predicate.validUntil) / 1000)),
      ],
    ),
  );
}

function mirrorExtrasDigest(predicate: SpendingPredicate, taskHash: Hex = ZERO): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32[]" }, { type: "bytes32" }],
      [predicate.allowedAgentIds.map((agentId) => keccak256(toBytes(agentId))), taskHash],
    ),
  );
}

function mirrorBindingDigest(
  predicateId: string,
  predicate: SpendingPredicate,
  taskHash: Hex,
  extras: Hex,
  chainId: number,
): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" },
        { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" },
      ],
      [
        BINDING_TYPEHASH,
        keccak256(toBytes(predicateId)),
        mirrorPredicateConfigDigest(predicate),
        PRINCIPAL,
        MANDATE_DIGEST,
        taskHash,
        extras,
        BigInt(chainId),
      ],
    ),
  );
  return keccak256(`0x19457468657265756d205369676e6564204d6573736167653a0a3332${structHash.slice(2)}` as Hex);
}

function check(
  checks: SerializationCheck[],
  id: string,
  field: string,
  clbCore: string,
  solidityMirror: string,
  note?: string,
): void {
  checks.push({
    id,
    field,
    clbCore,
    solidityMirror,
    ok: clbCore.toLowerCase() === solidityMirror.toLowerCase(),
    ...(note ? { note } : {}),
  });
}

// ---------------------------------------------------------------------------
// Seeded cross-language property-based testing (TS vs executed Solidity).
// ---------------------------------------------------------------------------

export type PropertyTestReport = {
  schema: "ircv-property-tests/v1";
  status: "PASS" | "FAIL" | "NOT RUN";
  seed: number;
  caseCount: number;
  forgeVersion: string | null;
  solcVersion: string;
  solidityHelper: string;
  fieldsChecked: string[];
  counts: {
    comparisons: number;
    matched: number;
    mismatched: number;
    casesFullyMatched: number;
  };
  mismatches: Array<{ caseId: number; field: string; typescript: string; solidity: string }>;
  reason?: string;
};

const PBT_SEED = 20261125;
const PBT_CASES = 64;
const ARTIFACT_DIR = resolve(import.meta.dir, "../../experiments/novelty/ircv");
const SOLIDITY_DIR = resolve(import.meta.dir, "solidity");

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hexFromRand(rand: () => number, salt: number): Hex {
  let state = Math.floor(rand() * 0xffffffff) ^ salt;
  let hex = "";
  while (hex.length < 64) {
    state = Math.imul(state ^ salt, 2_654_435_761) >>> 0;
    hex += state.toString(16).padStart(8, "0");
  }
  return `0x${hex.slice(0, 64)}`;
}

export async function runPropertyBasedTests(): Promise<PropertyTestReport> {
  const rand = mulberry32(PBT_SEED);
  const cases: Array<Record<string, unknown>> = [];
  const tsDigests: Array<Record<string, string>> = [];
  const assets = ["USDC", "EURC", "DAI", "PYUSD"];
  const agentIds = ["shopping-agent-001", "analysis-agent-001", "weather-agent-003"];

  for (let i = 0; i < PBT_CASES; i += 1) {
    const assetCount = 1 + (i % assets.length);
    const chosenAssets = assets.slice(0, assetCount);
    const agentId = agentIds[i % agentIds.length]!;
    const agentIdCount = 1 + (i % agentIds.length);
    const maxValue = `${1 + (i % 9)}.${String(i % 100).padStart(2, "0")}`;
    const validUntil = new Date((1_800_000_000 + i * 86400) * 1000).toISOString();
    const taskHash = i % 2 === 0 ? hexFromRand(rand, i + 101) : ZERO;
    const predicate: SpendingPredicate = {
      allowedAssets: chosenAssets,
      allowedPayees: [merchantAddress], // one payee: see FINDING-MULTI-PAYEE-GETADDRESS
      maxValue,
      validUntil,
      allowedChainIds: i % 3 === 0 ? [84532, 84533] : [84532],
      allowedAgentIds: agentIds.slice(0, agentIdCount),
      ...(i % 2 === 0 ? { taskHash } : {}),
    };
    const value = `${1 + (i % Math.max(1, 1 + (i % 9)))}.${String(i % 50).padStart(2, "0")}`;
    const params = settlementParamsFromExact(
      defaultConcrete({
        asset: chosenAssets[i % chosenAssets.length],
        value,
        validBefore: validUntil,
      }),
      agentId,
    );
    const mandateDigest = hexFromRand(rand, i + 7);
    const predicateId = `ircv-pred-${i}`;

    const configDigest = computePredicateConfigDigest(predicate);
    const extrasDigest = computePredicateExtrasDigest(predicate);
    const predicateDigest = computePredicateDigest(predicate);
    const paramsDigest = computeSettlementParamsDigest(params);
    const cPrime = computeModeBSettlementCommitment({
      identityRef: { chainId: 84532, registryAddr: REGISTRY, agentId },
      mandateDigest,
      predicateId,
      predicate,
      settlementParams: params,
      domain: { name: "CLB-ACEL", version: "0.1", chainId: 84532 },
    });
    const bindingDigest = computePredicateGuardBindingDigest({
      predicateId,
      predicate,
      principal: PRINCIPAL,
      mandateDigest,
      taskHash,
      extraFieldsDigest: extrasDigest,
      chainId: 84532,
    });

    tsDigests.push({
      configDigest,
      extrasDigest,
      predicateDigest,
      paramsDigest,
      cPrime,
      nonce: deriveSettlementNonce(cPrime),
      parsedAtomic: BigInt(params.valueAtomic).toString(),
      bindingDigest,
    });

    cases.push({
      chainId: 84532,
      registryAddr: REGISTRY.toLowerCase(),
      agentId,
      mandateDigest,
      predicateId,
      payees: predicate.allowedPayees.map((address) => address.toLowerCase()),
      assetHashes: predicate.allowedAssets.map((asset) => keccak256(toBytes(asset))),
      chainIds: predicate.allowedChainIds,
      maxValueAtomic: parseUnits(predicate.maxValue, 6).toString(),
      validUntil: Math.trunc(Date.parse(predicate.validUntil) / 1000),
      agentIdHashes: predicate.allowedAgentIds.map((id) => keccak256(toBytes(id))),
      taskHash,
      principal: PRINCIPAL.toLowerCase(),
      params: {
        chainId: params.chainId,
        network: params.network,
        asset: params.asset,
        payTo: getAddress(params.payTo).toLowerCase(),
        value: params.value,
        valueAtomic: params.valueAtomic,
        validBefore: params.validBefore,
        payerAgentId: params.payerAgentId,
      },
    });
  }

  await mkdir(ARTIFACT_DIR, { recursive: true });
  const inputPath = resolve(ARTIFACT_DIR, "parity-cases.json");
  const outputPath = resolve(ARTIFACT_DIR, "parity-solidity.json");
  await writeFile(inputPath, JSON.stringify({ seed: PBT_SEED, count: cases.length, vectors: cases }, null, 2), "utf8");

  // Locate the already-installed forge without adding any dependency or PATH
  // mutation for the caller. Windows uses forge.exe, POSIX uses forge.
  let forgeCmd = Bun.which("forge");
  if (!forgeCmd) {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
    for (const candidate of [
      resolve(home, ".foundry/bin/forge.exe"),
      resolve(home, ".foundry/bin/forge"),
    ]) {
      if (existsSync(candidate)) {
        forgeCmd = candidate;
        break;
      }
    }
  }
  const forge = forgeCmd ?? "forge";
  const versionProc = Bun.spawnSync({ cmd: [forge, "--version"], stdout: "pipe", stderr: "pipe" });
  const forgeVersion = versionProc.exitCode === 0
    ? new TextDecoder().decode(versionProc.stdout).split(/\r?\n/)[0] ?? null
    : null;
  if (forgeVersion === null) {
    return {
      schema: "ircv-property-tests/v1",
      status: "NOT RUN",
      seed: PBT_SEED,
      caseCount: cases.length,
      forgeVersion: null,
      solcVersion: "0.8.28",
      solidityHelper: "tools/ircv/solidity/ParityProbe.s.sol",
      fieldsChecked: [],
      counts: { comparisons: 0, matched: 0, mismatched: 0, casesFullyMatched: 0 },
      mismatches: [],
      reason: "forge executable unavailable",
    };
  }

  const proc = Bun.spawnSync({
    cmd: [forge, "script", "ParityProbe.s.sol:ParityProbe"],
    cwd: SOLIDITY_DIR,
    env: { ...process.env, IRCV_PARITY_INPUT: inputPath, IRCV_PARITY_OUTPUT: outputPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    return {
      schema: "ircv-property-tests/v1",
      status: "NOT RUN",
      seed: PBT_SEED,
      caseCount: cases.length,
      forgeVersion,
      solcVersion: "0.8.28",
      solidityHelper: "tools/ircv/solidity/ParityProbe.s.sol",
      fieldsChecked: [],
      counts: { comparisons: 0, matched: 0, mismatched: 0, casesFullyMatched: 0 },
      mismatches: [],
      reason: `forge script failed: ${new TextDecoder().decode(proc.stderr).slice(-2000)}`,
    };
  }

  const solidity = JSON.parse(await readFile(outputPath, "utf8")) as {
    vectors: Array<Record<string, string>>;
  };
  const fields = [
    "configDigest", "extrasDigest", "predicateDigest", "paramsDigest",
    "cPrime", "nonce", "parsedAtomic", "bindingDigest",
  ];
  const mismatches: PropertyTestReport["mismatches"] = [];
  let comparisons = 0;
  let matched = 0;
  let casesFullyMatched = 0;

  for (let i = 0; i < tsDigests.length; i += 1) {
    const expected = tsDigests[i]!;
    const actual = solidity.vectors[i];
    let caseOk = true;
    for (const field of fields) {
      comparisons += 1;
      const left = expected[field] ?? "";
      const right = actual?.[field] ?? "";
      if (left.toLowerCase() === right.toLowerCase()) {
        matched += 1;
      } else {
        caseOk = false;
        mismatches.push({ caseId: i, field, typescript: left, solidity: right });
      }
    }
    if (caseOk) casesFullyMatched += 1;
  }

  return {
    schema: "ircv-property-tests/v1",
    status: mismatches.length === 0 ? "PASS" : "FAIL",
    seed: PBT_SEED,
    caseCount: cases.length,
    forgeVersion,
    solcVersion: "0.8.28",
    solidityHelper: "tools/ircv/solidity/ParityProbe.s.sol",
    fieldsChecked: fields,
    counts: {
      comparisons,
      matched,
      mismatched: mismatches.length,
      casesFullyMatched,
    },
    mismatches,
  };
}

export function runSerializationChecks(): SerializationReport {
  const checks: SerializationCheck[] = [];
  const predicates: Array<{ id: string; predicate: SpendingPredicate; taskHash: Hex }> = [
    { id: "default", predicate: defaultPredicate(), taskHash: ZERO },
    {
      id: "multi-field",
      predicate: defaultPredicate({
        allowedAssets: ["USDC", "EURC", "DAI"],
        // Single payee: see `findings` for the multi-payee getAddress/map bug.
        allowedPayees: [merchantAddress],
        allowedChainIds: [84532, 84533],
        allowedAgentIds: ["shopping-agent-001", "analysis-agent-001"],
        maxValue: "12.34",
        validUntil: "2027-01-31T23:59:59.000Z",
        taskHash: `0x${"7d".repeat(32)}`,
      }),
      taskHash: `0x${"7d".repeat(32)}`,
    },
  ];

  for (const { id, predicate, taskHash } of predicates) {
    const concrete = defaultConcrete();
    const params = settlementParamsFromExact(concrete, "shopping-agent-001");
    const configDigest = computePredicateConfigDigest(predicate);
    const extras = computePredicateExtrasDigest(predicate);
    const fullDigest = computePredicateDigest(predicate);
    const paramsDigest = computeSettlementParamsDigest(params);

    check(checks, `${id}-config`, "predicateConfigDigest", configDigest, mirrorPredicateConfigDigest(predicate));
    check(checks, `${id}-extras`, "predicateExtrasDigest", extras, mirrorExtrasDigest(predicate, taskHash));
    check(
      checks,
      `${id}-predicate`,
      "predicateDigest(config,extras)",
      fullDigest,
      keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [mirrorPredicateConfigDigest(predicate), mirrorExtrasDigest(predicate, taskHash)])),
    );
    check(checks, `${id}-params`, "settlementParamsDigest", paramsDigest, keccak256(
      encodeAbiParameters(
        [
          { type: "uint256" }, { type: "string" }, { type: "string" }, { type: "address" },
          { type: "string" }, { type: "uint256" }, { type: "string" }, { type: "string" },
        ],
        [
          BigInt(params.chainId), params.network, params.asset, getAddress(params.payTo),
          params.value, BigInt(params.valueAtomic), params.validBefore, params.payerAgentId,
        ],
      ),
    ));

    const modeBInput = {
      identityRef: { chainId: 84532, registryAddr: REGISTRY, agentId: "shopping-agent-001" },
      mandateDigest: MANDATE_DIGEST,
      predicateId: "predicate-001",
      predicate,
      settlementParams: params,
      domain: { name: "CLB-ACEL" as const, version: "0.1" as const, chainId: 84532 },
    };
    const cPrime = computeModeBSettlementCommitment(modeBInput);
    check(checks, `${id}-cprime`, "C' (EIP-712 struct hash)", cPrime, mirrorCommitment({
      chainId: 84532,
      agentId: "shopping-agent-001",
      predicateId: "predicate-001",
      mandateDigest: MANDATE_DIGEST,
      predicateDigest: fullDigest,
      settlementParamsDigest: paramsDigest,
    }));
    check(checks, `${id}-nonce`, "nonce = H(C')", deriveSettlementNonce(cPrime), keccak256(cPrime));
    check(
      checks,
      `${id}-binding`,
      "predicateGuardBindingDigest (EIP-191)",
      computePredicateGuardBindingDigest({
        predicateId: "predicate-001",
        predicate,
        principal: PRINCIPAL,
        mandateDigest: MANDATE_DIGEST,
        taskHash,
        extraFieldsDigest: extras,
        chainId: 84532,
      }),
      mirrorBindingDigest("predicate-001", predicate, taskHash, extras, 84532),
    );
  }

  const rclbFields = {
    baseCommitment: MANDATE_DIGEST,
    identityEpoch: 1n,
    mandateEpoch: 1n,
    expiry: 1_800_000_000n,
    nonce: `0x${"11".repeat(32)}` as Hex,
  };
  const rclb = computeRevocationAwareCommitment(rclbFields);
  check(
    checks,
    "rclb-ct",
    "C_t = keccak256(abi.encode(C,E_I,E_M,T,N))",
    rclb,
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32" }],
        [rclbFields.baseCommitment, rclbFields.identityEpoch, rclbFields.mandateEpoch, rclbFields.expiry, rclbFields.nonce],
      ),
    ),
  );
  check(checks, "rclb-nonce", "revocation-aware payment nonce", deriveRevocationAwareNonce(rclb), keccak256(rclb));

  // Negative control: a changed field MUST change the digest (no false parity).
  const changed = computePredicateConfigDigest(defaultPredicate({ maxValue: "5.01" }));
  check(
    checks,
    "negative-control-config",
    "maxValue change must change configDigest",
    String(changed !== computePredicateConfigDigest(defaultPredicate())),
    "true",
  );

  // Honest finding: `allowedPayees.map(getAddress)` passes the array index as
  // viem's second `chainId` argument, producing an EIP-1191 checksum that
  // encodeAbiParameters rejects for the second and later payees.
  const findings: SerializationReport["findings"] = [];
  try {
    computePredicateConfigDigest(
      defaultPredicate({ allowedPayees: [merchantAddress, merchantAddress] }),
    );
    findings.push({
      id: "FINDING-MULTI-PAYEE-NONE",
      severity: "info",
      detail: "Two-payee config digest computed without error.",
    });
  } catch (error) {
    findings.push({
      id: "FINDING-MULTI-PAYEE-GETADDRESS",
      severity: "medium",
      detail: `computePredicateConfigDigest throws for >=2 allowedPayees: ${error instanceof Error ? error.name : "UnknownError"} (viem getAddress receives the map index as chainId). Core source was NOT modified; this framework reports only.`,
    });
  }

  return {
    schema: "ircv-serialization/v1",
    method: "clb-core functions vs independent TypeScript mirror of Solidity ABI/EIP-712 formulas (no Solidity execution in this component)",
    findings,
    sources: [
      "packages/clb-core/src/index.ts",
      "packages/clb-core/src/epochs.ts",
      "contracts/src/PredicatePaymentGuard.sol",
      "contracts/src/RevocationAwareGuard.sol",
    ],
    checks,
    summary: {
      total: checks.length,
      matched: checks.filter((result) => result.ok).length,
      mismatched: checks.filter((result) => !result.ok).length,
    },
  };
}
