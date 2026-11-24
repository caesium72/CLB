import { describe, expect, test } from "bun:test";
import { canonicalJson } from "@clb-acel/evidence-core";
import type {
  CLBCommitmentInput,
  Mandate,
  SettlementDescriptorExact,
  SettlementParams,
} from "@clb-acel/schemas";
import {
  createHttpFacilitator,
  createLocalFacilitator,
  buildPaymentAuthorization,
  NonceAlreadyConsumedError,
  signPaymentPayload,
  verifyPaymentPayload,
} from "@clb-acel/x402-adapter";
import { concatHex, encodeAbiParameters, keccak256, toBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createInMemoryErc8004Registry,
  finalizeAgentCard,
  isPaymentKeyAuthorized,
} from "../../erc8004-adapter/src/index";
import {
  CLB_SETTLEMENT_TYPED_DATA_TYPES,
  CLB_TYPED_DATA_TYPES,
  computeCommitment,
  computeMandateDigest,
  computeModeBSettlementCommitment,
  computeSettlementDigest,
  computeSettlementParamsDigest,
  deriveCommitment,
  deriveNonce,
} from "../src/index";

// ---------------------------------------------------------------------------
// Fixed vector. Every hex below was produced by the implementation under test
// (bun, viem 2.x) and is pinned here as a regression/parity anchor.
// ---------------------------------------------------------------------------
const REGISTRY = "0x0000000000000000000000000000000000000001";
const PAY_TO = "0x00000000000000000000000000000000000000a1";
const PAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

const SETTLEMENT: SettlementDescriptorExact = {
  chainId: 84532,
  network: "base-sepolia",
  asset: "USDC",
  payTo: PAY_TO,
  value: "2.00",
  validBefore: "2026-05-30T06:00:00.000Z",
  x402Scheme: "exact",
};

const MANDATE: Mandate = {
  mandateId: "mandate-1",
  type: "CART",
  humanPrincipal: "user:0xabc",
  authorizedAgent: { chainId: 84532, registryAddr: REGISTRY, agentId: "analysis-agent-001" },
  constraints: {
    maxAmount: "2.00",
    allowedAssets: ["USDC"],
    allowedPayees: [PAY_TO],
    validUntil: "2026-05-30T06:00:00.000Z",
  },
  signature: `0x${"1".repeat(130)}`,
};

const BASE: CLBCommitmentInput = {
  identityRef: { chainId: 84532, registryAddr: REGISTRY, agentId: "analysis-agent-001" },
  mandateDigest: computeMandateDigest(MANDATE),
  settlementDescriptor: SETTLEMENT,
  domain: { name: "CLB-ACEL", version: "0.1", chainId: 84532 },
};

const VECTOR = {
  canonicalSettlement:
    '{"asset":"USDC","chainId":84532,"network":"base-sepolia","payTo":"0x00000000000000000000000000000000000000a1","validBefore":"2026-05-30T06:00:00.000Z","value":"2.00","x402Scheme":"exact"}',
  mandateDigest: "0x31deaae3a1f93c309b430365ad8881c532532ee2ac06f816755b2eb47784dc28",
  settlementDigest: "0xfaa4ca710737736a4c87c05739bfed31156f8e74eca62128d385432788fd7468",
  commitment: "0x73c13de8e1f12c40ca31e199869524a83829694208376015a5f9056a2a380181",
  nonce: "0x001f7cda30d4bd6ccf176d33615ded12547290f2b8f91f5af1a8a72b576c2c52",
  domainTypehash: "0xc2f8787176b8ac6bf7215b4adcc1e069bf4ab82d9ab1df05a57a91d425935b6e",
  identityRefTypehash: "0x8aa72cd3bef5cf63440d10d2c9cd3014b688ec4363b865971533ca0ae124dcd6",
  clbTypehash: "0x604b26243dd3518142fda62df2f9bfd240bdd7a5eefc8f632d1ce2c3a1cea2e8",
  settlementTypehash: "0xe2204d152d0b4c4ff6013775b14e090fcd6aa139b7f3e71b44578a37c45ffd1c",
  domainSeparator84532: "0x101056d5d703ece53a7cf703aaf0d03a80ad7990bb7a5b4a28d6502cfc915f47",
  identityRefHash: "0x5bf4e4831e02597fb76b438830d1776799bb2b80316240b25971662efe099a12",
  structHashC: "0xf81100bc5d8d8b96c07d41ec1a312bac5c5ec9517818f23152ef59d9cf057c7f",
  structHashCp: "0x29e8dc889f66a5a29246b21d47982650ff31cd54c7ce2adf963e1ed029fcb1f9",
  settlementParamsDigest: "0x31c3a08746fb658e8a0b0e70c47cd5cca15a72c6ec13868552188ab7b64474c8",
  modeBCommitment: "0xfed84b833ff1dcf78d467c608f532611e2ef5cf21d07b8c25e01bba3a66f2b47",
  modeBNonce: "0xc4f18fcc753eeb022687d5609fab8966431991794b842bd8a923639c88b3a128",
  domainNameOther: "0xd1e49257264669607fa8ae625942a3abc9dbd2fc230cb77794f27a6e9db69372",
  domainVersion99: "0x1fa4613516714f526906afb49be104adfb9c9f5a15c8e55f73530b06e9d05608",
  domainChain1: "0x9cb00b531535fe628a7bc861ec0e93a1397862a3e3fea0ab2a71b3d80591e97c",
} as const;

const PARAMS: SettlementParams = {
  chainId: 84532,
  network: "base-sepolia",
  asset: "USDC",
  payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  value: "2.00",
  valueAtomic: "2000000",
  validBefore: "2026-12-30T06:00:00.000Z",
  payerAgentId: "shopping-agent-001",
};

describe("deterministic commitment vectors", () => {
  test("canonicalJson(settlement) is byte-exact", () => {
    expect(canonicalJson(SETTLEMENT)).toBe(VECTOR.canonicalSettlement);
  });

  test("mandateDigest is byte-exact and excludes signature/clbCommitment", () => {
    expect(computeMandateDigest(MANDATE)).toBe(VECTOR.mandateDigest);
    expect(
      computeMandateDigest({
        ...MANDATE,
        signature: "0xdead",
        clbCommitment: "0xbeef",
      }),
    ).toBe(VECTOR.mandateDigest);
  });

  test("settlementDigest is byte-exact", () => {
    expect(computeSettlementDigest(SETTLEMENT)).toBe(VECTOR.settlementDigest);
  });

  test("C = EIP712 digest is byte-exact", () => {
    expect(computeCommitment(BASE)).toBe(VECTOR.commitment);
    expect(deriveCommitment(BASE)).toEqual({
      commitment: VECTOR.commitment,
      nonce: VECTOR.nonce,
      settlementDigest: VECTOR.settlementDigest,
    });
  });

  test("nonce = keccak256(C) is byte-exact", () => {
    expect(deriveNonce(VECTOR.commitment)).toBe(VECTOR.nonce);
    expect(keccak256(VECTOR.commitment)).toBe(VECTOR.nonce);
  });

  test("EIP-712 type/domain/struct hashes match the on-chain constants", () => {
    const k = (s: string) => keccak256(toBytes(s));
    expect(k("EIP712Domain(string name,string version,uint256 chainId)")).toBe(
      VECTOR.domainTypehash,
    );
    expect(
      k("IdentityRef(uint256 chainId,address registryAddr,string agentId)"),
    ).toBe(VECTOR.identityRefTypehash);
    expect(
      k(
        "CLBCommitment(IdentityRef identityRef,bytes32 mandateDigest,bytes32 settlementDigest)IdentityRef(uint256 chainId,address registryAddr,string agentId)",
      ),
    ).toBe(VECTOR.clbTypehash);
    expect(
      k(
        "CLBSettlementCommitment(IdentityRef identityRef,bytes32 mandateDigest,string predicateId,bytes32 predicateDigest,bytes32 settlementParamsDigest)IdentityRef(uint256 chainId,address registryAddr,string agentId)",
      ),
    ).toBe(VECTOR.settlementTypehash);

    const domainSeparator = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
        [VECTOR.domainTypehash, k("CLB-ACEL"), k("0.1"), 84532n],
      ),
    );
    expect(domainSeparator).toBe(VECTOR.domainSeparator84532);

    const identityRefHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }],
        [VECTOR.identityRefTypehash, 84532n, REGISTRY, k("analysis-agent-001")],
      ),
    );
    expect(identityRefHash).toBe(VECTOR.identityRefHash);

    const structHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
        [VECTOR.clbTypehash, identityRefHash, VECTOR.mandateDigest, VECTOR.settlementDigest],
      ),
    );
    expect(structHash).toBe(VECTOR.structHashC);
    expect(keccak256(concatHex(["0x1901", domainSeparator, structHash]))).toBe(VECTOR.commitment);
  });

  test("Mode B: settlementParamsDigest / C' / nonce are byte-exact (TS<->Solidity parity)", () => {
    expect(computeSettlementParamsDigest(PARAMS)).toBe(VECTOR.settlementParamsDigest);

    const k = (s: string) => keccak256(toBytes(s));
    const identityRefHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }],
        [VECTOR.identityRefTypehash, 84532n, REGISTRY, k("analysis-agent-001")],
      ),
    );
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
        ],
        [
          VECTOR.settlementTypehash,
          identityRefHash,
          VECTOR.mandateDigest,
          k("pred-1"),
          `0x${"0".repeat(64)}`, // no predicate supplied: digest is zero
          VECTOR.settlementParamsDigest,
        ],
      ),
    );
    expect(structHash).toBe(VECTOR.structHashCp);
    expect(keccak256(concatHex(["0x1901", VECTOR.domainSeparator84532, structHash]))).toBe(
      VECTOR.modeBCommitment,
    );

    const modeBInput = {
      identityRef: BASE.identityRef,
      mandateDigest: VECTOR.mandateDigest,
      predicateId: "pred-1",
      settlementParams: PARAMS,
      domain: BASE.domain,
    };
    expect(computeModeBSettlementCommitment(modeBInput)).toBe(VECTOR.modeBCommitment);
    expect(deriveNonce(VECTOR.modeBCommitment)).toBe(VECTOR.modeBNonce);
  });
});

describe("canonicalization / optional-field handling", () => {
  test("undefined optional fields are omitted, explicit fields are kept", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson({ a: 1, b: null })).not.toBe(canonicalJson({ a: 1 }));
  });

  test("input object key order does not change digests", () => {
    const reordered = {
      domain: BASE.domain,
      settlementDescriptor: SETTLEMENT,
      mandateDigest: BASE.mandateDigest,
      identityRef: BASE.identityRef,
    } as CLBCommitmentInput;
    expect(computeCommitment(reordered)).toBe(VECTOR.commitment);
    expect(computeSettlementDigest({
      x402Scheme: "exact",
      value: "2.00",
      validBefore: "2026-05-30T06:00:00.000Z",
      payTo: PAY_TO,
      asset: "USDC",
      network: "base-sepolia",
      chainId: 84532,
    } as SettlementDescriptorExact)).toBe(VECTOR.settlementDigest);
  });

  test("type declarations pin the EIP-712 field order", () => {
    expect(canonicalJson(CLB_TYPED_DATA_TYPES)).toBe(
      '{"CLBCommitment":[{"name":"identityRef","type":"IdentityRef"},{"name":"mandateDigest","type":"bytes32"},{"name":"settlementDigest","type":"bytes32"}],"IdentityRef":[{"name":"chainId","type":"uint256"},{"name":"registryAddr","type":"address"},{"name":"agentId","type":"string"}]}',
    );
    expect(canonicalJson(CLB_SETTLEMENT_TYPED_DATA_TYPES)).toBe(
      '{"CLBSettlementCommitment":[{"name":"identityRef","type":"IdentityRef"},{"name":"mandateDigest","type":"bytes32"},{"name":"predicateId","type":"string"},{"name":"predicateDigest","type":"bytes32"},{"name":"settlementParamsDigest","type":"bytes32"}],"IdentityRef":[{"name":"chainId","type":"uint256"},{"name":"registryAddr","type":"address"},{"name":"agentId","type":"string"}]}',
    );
  });
});

describe("tamper tests: every bound field changes C", () => {
  const mutations: ReadonlyArray<readonly [string, CLBCommitmentInput]> = [
    ["identityRef.chainId", { ...BASE, identityRef: { ...BASE.identityRef, chainId: 1 } }],
    [
      "identityRef.registryAddr",
      {
        ...BASE,
        identityRef: {
          ...BASE.identityRef,
          registryAddr: "0x0000000000000000000000000000000000000002",
        },
      },
    ],
    [
      "identityRef.agentId",
      { ...BASE, identityRef: { ...BASE.identityRef, agentId: "evil-agent-999" } },
    ],
    ["mandateDigest", { ...BASE, mandateDigest: `0x${"d".repeat(64)}` }],
    [
      "settlementDescriptor.chainId",
      { ...BASE, settlementDescriptor: { ...SETTLEMENT, chainId: 1 } },
    ],
    [
      "settlementDescriptor.network",
      { ...BASE, settlementDescriptor: { ...SETTLEMENT, network: "ethereum" } },
    ],
    [
      "settlementDescriptor.asset",
      { ...BASE, settlementDescriptor: { ...SETTLEMENT, asset: "DAI" } },
    ],
    [
      "settlementDescriptor.payTo",
      {
        ...BASE,
        settlementDescriptor: {
          ...SETTLEMENT,
          payTo: "0x00000000000000000000000000000000000000b2",
        },
      },
    ],
    [
      "settlementDescriptor.value",
      { ...BASE, settlementDescriptor: { ...SETTLEMENT, value: "3.00" } },
    ],
    [
      "settlementDescriptor.validBefore",
      {
        ...BASE,
        settlementDescriptor: { ...SETTLEMENT, validBefore: "2027-05-30T06:00:00.000Z" },
      },
    ],
    [
      "settlementDescriptor.x402Scheme (exact -> predicate)",
      {
        ...BASE,
        settlementDescriptor: {
          predicateId: "pred-1",
          predicate: {
            allowedAssets: ["USDC"],
            allowedPayees: [PAY_TO],
            maxValue: "2.00",
            validUntil: "2026-05-30T06:00:00.000Z",
            allowedChainIds: [84532],
            allowedAgentIds: ["analysis-agent-001"],
          },
          x402Scheme: "predicate",
        },
      },
    ],
    ["domain.name", { ...BASE, domain: { ...BASE.domain, name: "OTHER" } }],
    ["domain.version", { ...BASE, domain: { ...BASE.domain, version: "9.9" } }],
    ["domain.chainId", { ...BASE, domain: { ...BASE.domain, chainId: 1 } }],
    [
      "domain.verifyingContract",
      {
        ...BASE,
        domain: {
          ...BASE.domain,
          verifyingContract: "0x0000000000000000000000000000000000000003",
        },
      },
    ],
  ];

  for (const [name, input] of mutations) {
    test(`mutating ${name} changes C`, () => {
      expect(computeCommitment(input)).not.toBe(VECTOR.commitment);
    });
  }

  test("every authorization sub-field flows into C through mandateDigest", () => {
    const authorizationMutations = [
      ["mandateId", { mandateId: "mandate-evil" }],
      ["type", { type: "PAYMENT" as const }],
      ["humanPrincipal", { humanPrincipal: "user:0xevil" }],
      ["authorizedAgent.agentId", {
        authorizedAgent: { ...BASE.identityRef, agentId: "evil-agent-999" },
      }],
      ["constraints.maxAmount", {
        constraints: { ...MANDATE.constraints, maxAmount: "9.99" },
      }],
      ["constraints.allowedAssets", {
        constraints: { ...MANDATE.constraints, allowedAssets: ["DAI"] },
      }],
      ["constraints.allowedPayees", {
        constraints: {
          ...MANDATE.constraints,
          allowedPayees: ["0x00000000000000000000000000000000000000b2"],
        },
      }],
      ["constraints.validUntil", {
        constraints: { ...MANDATE.constraints, validUntil: "2027-05-30T06:00:00.000Z" },
      }],
      ["parentMandateHash", { parentMandateHash: `0x${"a".repeat(64)}` }],
    ] as const;

    for (const [name, patch] of authorizationMutations) {
      const changedDigest = computeMandateDigest({ ...MANDATE, ...patch } as Mandate);
      expect(changedDigest, name).not.toBe(VECTOR.mandateDigest);
      expect(
        computeCommitment({ ...BASE, mandateDigest: changedDigest }),
        name,
      ).not.toBe(VECTOR.commitment);
    }
  });
});

describe("domain separation", () => {
  test("different domain name / version / chainId produce different commitments (fixed vectors)", () => {
    expect(computeCommitment({ ...BASE, domain: { ...BASE.domain, name: "OTHER" } })).toBe(
      VECTOR.domainNameOther,
    );
    expect(computeCommitment({ ...BASE, domain: { ...BASE.domain, version: "9.9" } })).toBe(
      VECTOR.domainVersion99,
    );
    expect(computeCommitment({ ...BASE, domain: { ...BASE.domain, chainId: 1 } })).toBe(
      VECTOR.domainChain1,
    );
    for (const hex of [VECTOR.domainNameOther, VECTOR.domainVersion99, VECTOR.domainChain1]) {
      expect(hex).not.toBe(VECTOR.commitment);
    }
  });

  test("payment authorization lives in a separate EIP-712 domain", () => {
    // The x402 authorization domain name is "CLB-ACEL-x402" (x402-adapter), not
    // the CLB domain name "CLB-ACEL"; a CLB signature cannot double as a payment
    // signature even with identical field bytes.
    const payer = privateKeyToAccount(PAYER_KEY).address;
    const auth = buildPaymentAuthorization({
      from: payer,
      descriptor: SETTLEMENT,
      nonce: VECTOR.nonce,
    });
    expect(auth.nonce).toBe(VECTOR.nonce);
    expect(auth.chainId).toBe(84532);
    expect(auth.asset).toBe("USDC");
    expect(auth.value).toBe("2.00");
  });
});

describe("nonce consumption / replay (existing facilitator)", () => {
  const payer = privateKeyToAccount(PAYER_KEY).address;

  async function signedPayload(nonce = VECTOR.nonce) {
    const auth = buildPaymentAuthorization({ from: payer, descriptor: SETTLEMENT, nonce });
    return signPaymentPayload(PAYER_KEY, auth);
  }

  test("nonce is consumed exactly once; replay is rejected", async () => {
    const facilitator = createLocalFacilitator();
    const payload = await signedPayload();

    const first = await facilitator.settle(payload);
    expect(first.settled).toBe(true);
    expect(first.nonce).toBe(VECTOR.nonce);
    expect(facilitator.isConsumed(VECTOR.nonce)).toBe(true);
    await expect(facilitator.settle(payload)).rejects.toBeInstanceOf(NonceAlreadyConsumedError);
  });

  test("concurrent submissions with the same nonce: exactly one settles", async () => {
    const facilitator = createLocalFacilitator();
    const payload = await signedPayload();
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, () => facilitator.settle(payload)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(15);
  });

  test("different nonces settle independently", async () => {
    const facilitator = createLocalFacilitator();
    const a = await signedPayload(`0x${"1".repeat(64)}`);
    const b = await signedPayload(`0x${"2".repeat(64)}`);
    expect((await facilitator.settle(a)).settled).toBe(true);
    expect((await facilitator.settle(b)).settled).toBe(true);
  });

  test("tampered authorization is rejected by the facilitator", async () => {
    const facilitator = createLocalFacilitator();
    const payload = await signedPayload();
    const tampered = {
      ...payload,
      authorization: { ...payload.authorization, value: "9.99" },
    };
    expect(await facilitator.verify(tampered)).toBe(false);
    expect(await verifyPaymentPayload(tampered)).toBe(false);
  });

  test("a failed settlement releases the nonce reservation (retry allowed)", async () => {
    let attempt = 0;
    const facilitator = createHttpFacilitator({
      baseUrl: "http://local.test",
      fetchImpl: async () => {
        attempt += 1;
        if (attempt === 1) return new Response("boom", { status: 500 });
        return new Response(
          JSON.stringify({
            settled: true,
            txHash: `0x${"7".repeat(64)}`,
            payer,
            payTo: payload.authorization.to,
            value: payload.authorization.value,
            asset: payload.authorization.asset,
            network: payload.authorization.network,
            chainId: payload.authorization.chainId,
            nonce: payload.authorization.nonce,
            settledAt: "2026-01-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    const payload = await signedPayload();

    await expect(facilitator.settle(payload)).rejects.toThrow("Facilitator settlement failed (500)");
    expect(facilitator.isConsumed(VECTOR.nonce)).toBe(false);
    expect((await facilitator.settle(payload)).settled).toBe(true);
    expect(facilitator.isConsumed(VECTOR.nonce)).toBe(true);
  });
});

describe("documented gaps (do not silently drop requirements)", () => {
  const payer = privateKeyToAccount(PAYER_KEY).address;

  test.skip("GAP 27/28: a nonce must not settle on a second chain/facilitator", async () => {
    const payload = await signPaymentPayload(
      PAYER_KEY,
      buildPaymentAuthorization({ from: payer, descriptor: SETTLEMENT, nonce: VECTOR.nonce }),
    );
    const firstFacilitator = createLocalFacilitator();
    const secondChainFacilitator = createLocalFacilitator();
    await firstFacilitator.settle(payload);
    // Desired behaviour: shared, cross-chain nonce store rejects this.
    await expect(secondChainFacilitator.settle(payload)).rejects.toBeInstanceOf(
      NonceAlreadyConsumedError,
    );
  });

  test("GAP EVIDENCE 27/28: separate facilitators re-settle the identical signed nonce", async () => {
    const payload = await signPaymentPayload(
      PAYER_KEY,
      buildPaymentAuthorization({ from: payer, descriptor: SETTLEMENT, nonce: VECTOR.nonce }),
    );
    const firstFacilitator = createLocalFacilitator();
    const secondChainFacilitator = createLocalFacilitator();

    const first = await firstFacilitator.settle(payload);
    const replay = await secondChainFacilitator.settle(payload);
    expect(first.settled).toBe(true);
    // This is the gap: a fresh store (modelling another chain/facilitator) has
    // no knowledge of the consumed nonce, so C's replay protection is local.
    expect(replay.settled).toBe(true);
    expect(replay.nonce).toBe(first.nonce);
  });

  test("GAP EVIDENCE 15: registry has add-key and status APIs but no revoke/rotate", async () => {
    const registry = createInMemoryErc8004Registry();
    expect(typeof registry.authorizePaymentKey).toBe("function");
    expect(typeof registry.setStatus).toBe("function");
    const surface = registry as unknown as Record<string, unknown>;
    expect(surface.revokePaymentKey).toBeUndefined();
    expect(surface.rotatePaymentKey).toBeUndefined();
  });

  test.skip("GAP 15: rotating/revoking a payment key must invalidate the old key", async () => {
    const registry = createInMemoryErc8004Registry();
    const owner = privateKeyToAccount(PAYER_KEY).address;
    const newKey = "0x00000000000000000000000000000000000000b2" as Address;
    await registry.register({
      registryAddr: REGISTRY,
      chainId: 84532,
      card: finalizeAgentCard({
        agentId: "analysis-agent-001",
        name: "analysis",
        description: "",
        serviceEndpoints: ["https://example.test"],
        owner,
        authorizedSigningKeys: [owner],
        authorizedPaymentKeys: [owner],
        supportedProtocols: ["AP2"],
      }),
    });
    // Desired behaviour: a rotation primitive exists and invalidates the old key.
    const rotating = registry as unknown as {
      rotatePaymentKey(id: string, oldKey: Address, newKey: Address): Promise<unknown>;
    };
    await rotating.rotatePaymentKey("analysis-agent-001", owner, newKey);
    const record = await registry.getAgent("analysis-agent-001");
    expect(record && isPaymentKeyAuthorized(record, owner)).toBe(false);
  });
});
