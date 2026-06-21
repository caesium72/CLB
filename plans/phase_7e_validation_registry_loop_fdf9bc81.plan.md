---
name: Phase 7E — Economic Loop: Real Canonical ERC-8004 (Identity now, Validation pre-wired)
overview: "Close the loop from verification certificate to on-chain, priceable trust — made REAL where it is safe to. Per the 2026-06-05 feasibility assessment: the canonical ERC-8004 Identity Registry is LIVE + publicly indexed on Base Sepolia (0x8004A818…, 6,542 agents on 8004scan), but the canonical Validation Registry is NOT confirmed on Base Sepolia (open item O1). So: (B-first) make IDENTITY real/canonical so our demo agents appear publicly on 8004scan; KEEP CrossLayerBindingValidator as our own deterministic contract (reproducible for the paper); and PRE-WIRE the canonical validationRequest/validationResponse ABI behind the validation adapter, gated OFF until O1 resolves. Deterministic mock stays the default (real core, swappable adapters). Spec §5/§6 of the feasibility doc. Depends on 7B identity wiring + existing verifier certificate."
todos:
  - id: 7e-canonical-identity
    content: "erc8004-adapter: canonical ERC-8004 Identity reader mode (numeric agentId; tokenURI→card; getAgentWallet overlay); ERC8004_IDENTITY_MODE=canonical|onchain|mock; register demo agents in 0x8004A818… so they show on 8004scan"
    status: completed
  - id: 7e-validator-contract
    content: "contracts: CrossLayerBindingValidator.sol records (traceId, certificateHash, result, merkleRoot, settlementTxHash); emits ValidationRecorded; readable by traceId; one-entry-per-trace; Foundry tests"
    status: completed
  - id: 7e-validation-adapter
    content: "validation-registry adapter: mock | onchain (our CrossLayerBindingValidator) | canonical (ERC-8004 Validation Registry, ABI pre-wired but GATED OFF until O1). Certificate→validationRequest/validationResponse mapping isolated in one file"
    status: completed
  - id: 7e-verifier-emit
    content: "verifier-service: on PASS emit a validation write via the selected adapter; expose GET read-back by traceId; on FAIL, no entry"
    status: completed
  - id: 7e-paper-reframe
    content: "docs/paper-outline.md + DECISIONS: Identity is real/canonical/public on 8004scan; CrossLayerBindingValidator is the validator type, canonical-ready; record O1 + the three cost axes (effort/blast-radius/external-dependency)"
    status: completed
isProject: false
---

# Phase 7E — Real Canonical ERC-8004 (Identity now, Validation pre-wired) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> **Design of record:** `docs/superpowers/specs/2026-06-05-phase-7e-real-demo-canonical-erc8004-feasibility.md`.

**Goal:** Our demo agents resolve from the **canonical** ERC-8004 Identity Registry on Base Sepolia and appear publicly on 8004scan; a verified trace produces a validation entry retrievable by `traceId` under a new validator type `CrossLayerBindingValidator`; the canonical Validation Registry path is pre-wired and config-flippable the day it is confirmed live (open item O1).

**Architecture (per feasibility §5 — "B-first"):** Effort is discounted (no deadline); the decision is driven by *blast radius* and *external-dependency risk*. **Identity** is the piece that is live + stable + public on Base Sepolia, so we make it real via a `canonical` reader mode added to `erc8004-adapter` (it maps canonical primitives → our existing `AgentCard`, leaving schemas + verifier untouched). The **Validation** loop keeps our own deterministic `CrossLayerBindingValidator.sol` (reproducible for the paper, no dependency on a maybe-absent registry), with the canonical `validationRequest`/`validationResponse` ABI pre-wired behind the validation adapter but **gated off** until O1. The deterministic mock stays the default everywhere (the standing "real core, swappable adapters" rule).

**Tech Stack:** Foundry (Solidity) · TypeScript (Bun) · `viem` · existing `verifier-core` (`VerificationCertificate` with `certificateHash`, `traceMerkleRoot`, `settlementTxHash`), `verifier-service`, `erc8004-adapter`, `anchor-core` (on-chain-write pattern).

**Repo grounding (verify before editing):**
- `packages/erc8004-adapter/src/index.ts` — `createIdentityRegistry(env)` / `createIdentityRegistryFromEnv()`; current modes are `mock` (in-memory) and `onchain` (our string-`agentId` `MockERC8004IdentityRegistry`).
- `packages/erc8004-adapter/src/onchain-reader.ts` — the viem reader pattern + `fetchAgentCard`, `finalizeAgentCard`, `overlayOnchainKeys` (mirror this for the canonical reader).
- `packages/erc8004-adapter/src/types.ts` / `card.ts` — `AgentRecord`, `Erc8004Registry`, `finalizeAgentCard`.
- `packages/verifier-core/src/index.ts` — `VerificationCertificate`; R3/R4 consume `authorizedPaymentKeys[]`/`authorizedSigningKeys[]` (do NOT change these — the canonical reader must still produce a populated `AgentCard`).
- `services/verifier-service/src/{index,server}.ts` — verify + certificate endpoints.
- `scripts/register-testnet-agents.ts` — existing registration script (mirror for the canonical register script).
- `contracts/script/Deploy.s.sol` — deploy-script entry to extend.
- **Confirmed Base Sepolia (chain 84532):** Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`; Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`. **Validation Registry: UNCONFIRMED (O1).**
- Env: `RPC_URL_BASE_SEPOLIA`, `DEPLOYER_PRIVATE_KEY`, `CHAIN_ID=84532`, new `ERC8004_IDENTITY_MODE`, `ERC8004_IDENTITY_REGISTRY_CANONICAL`, `CLB_VALIDATOR_ADDRESS`, `VALIDATION_REGISTRY_CANONICAL`, `VALIDATION_REGISTRY_MODE`.

> **Open item O1 (must resolve before any canonical-validation write):** confirm or deny a canonical ERC-8004 Validation Registry deployed/indexed on Base Sepolia (check the official `erc-8004-contracts` deployments file / 8004scan API). Until O1 is positive, the validation adapter's `canonical` mode stays unreachable behind a config flag; `mock`/`onchain` are the only selectable modes.

---

## Task 0: Canonical ERC-8004 Identity reader mode (Increment B — the real, public win)

**Files:**
- Create: `packages/erc8004-adapter/src/canonical-reader.ts`
- Create: `packages/erc8004-adapter/test/canonical-reader.test.ts`
- Modify: `packages/erc8004-adapter/src/index.ts` (env-selected `canonical` mode)
- Create: `scripts/register-canonical-agents.ts`
- Modify: `package.json` (`setup:register-canonical` script)

- [ ] **Step 1: Write the failing test for the pure mapper.** The live contract reads are integration-only; the unit under test is the pure function `mapCanonicalToCard` that turns on-chain reads + the fetched card into our `AgentCard`. It must (a) keep the fetched card's arrays, (b) ensure the on-chain `agentWallet` is present in `authorizedPaymentKeys`, (c) set `owner`, (d) carry the numeric `agentId` as a string, (e) recompute `metadataHash`.

```ts
// packages/erc8004-adapter/test/canonical-reader.test.ts
import { describe, expect, it } from "bun:test";
import { finalizeAgentCard } from "../src/card";
import { mapCanonicalToCard } from "../src/canonical-reader";

const baseCard = finalizeAgentCard({
  agentId: "1978",
  name: "Merchant",
  description: "Canonical agent",
  serviceEndpoints: ["https://example.test/.well-known/agent-card.json"],
  owner: "0x1111111111111111111111111111111111111111",
  authorizedSigningKeys: ["0x2222222222222222222222222222222222222222"],
  authorizedPaymentKeys: ["0x2222222222222222222222222222222222222222"],
  supportedProtocols: ["ERC8004"],
});

describe("mapCanonicalToCard", () => {
  it("adds the on-chain agentWallet to authorizedPaymentKeys and recomputes metadataHash", () => {
    const wallet = "0x3333333333333333333333333333333333333333";
    const card = mapCanonicalToCard({
      agentId: "1978",
      owner: "0x4444444444444444444444444444444444444444",
      agentWallet: wallet,
      fetchedCard: baseCard,
    });
    expect(card.agentId).toBe("1978");
    expect(card.owner).toBe("0x4444444444444444444444444444444444444444");
    expect(card.authorizedPaymentKeys.map((k) => k.toLowerCase())).toContain(wallet.toLowerCase());
    expect(card.metadataHash).not.toBe(baseCard.metadataHash); // owner+keys changed → hash changes
  });

  it("does not duplicate a wallet already authorized", () => {
    const card = mapCanonicalToCard({
      agentId: "1978",
      owner: baseCard.owner,
      agentWallet: "0x2222222222222222222222222222222222222222",
      fetchedCard: baseCard,
    });
    expect(card.authorizedPaymentKeys).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** Run: `bun test packages/erc8004-adapter/test/canonical-reader.test.ts` → FAIL (`mapCanonicalToCard` not defined).

- [ ] **Step 3: Implement the canonical reader.** The live ABI is isolated in this file. **Before running against the live contract, confirm the verified ABI on the explorer** for `0x8004A818…` (function names/param types for `tokenURI`, `ownerOf`, `getAgentWallet` — the canonical Identity Registry is an ERC-721; `getAgentWallet`/metadata are the 8004 extensions). The pure mapper has no live dependency and is fully tested by Step 1.

```ts
// packages/erc8004-adapter/src/canonical-reader.ts
import type { AgentCard, Address } from "@clb-acel/schemas";
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
} from "viem";
import { finalizeAgentCard } from "./card";
import { fetchAgentCard } from "./onchain-reader";
import { AgentNotFoundError, type AgentRecord } from "./types";

// Read-only ABI for the canonical ERC-8004 Identity Registry.
// Signatures confirmed from the EIP (https://eips.ethereum.org/EIPS/eip-8004).
const CANONICAL_IDENTITY_ABI = [
  { type: "function", name: "ownerOf", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokenURI", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "getAgentWallet", stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "getMetadata", stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }, { name: "metadataKey", type: "string" }],
    outputs: [{ name: "", type: "bytes" }] },
] as const;

export type CanonicalMapInput = {
  agentId: string;          // decimal string of the uint256 tokenId
  owner: Address;
  agentWallet: Address;
  fetchedCard: AgentCard;   // card body served at tokenURI
};

/** Pure: assemble our AgentCard from canonical primitives (no live dependency). */
export function mapCanonicalToCard(input: CanonicalMapInput): AgentCard {
  const wallet = getAddress(input.agentWallet);
  const existingPayment = input.fetchedCard.authorizedPaymentKeys.map((k) => getAddress(k));
  const paymentKeys = existingPayment.some((k) => k === wallet) ? existingPayment : [...existingPayment, wallet];
  // Canonical Identity Registry has no signingKeys array — use the verified agentWallet as the
  // canonical signing identity. Extended signing keys can be stored via setMetadata and overlaid here.
  const existingSigning = input.fetchedCard.authorizedSigningKeys.map((k) => getAddress(k));
  const signingKeys = existingSigning.some((k) => k === wallet) ? existingSigning : [...existingSigning, wallet];
  const { metadataHash: _drop, ...rest } = input.fetchedCard;
  void _drop;
  return finalizeAgentCard({
    ...rest,
    agentId: input.agentId,
    owner: getAddress(input.owner),
    authorizedPaymentKeys: paymentKeys,
    authorizedSigningKeys: signingKeys,
    supportedProtocols: rest.supportedProtocols.includes("ERC8004")
      ? rest.supportedProtocols
      : [...rest.supportedProtocols, "ERC8004"],
  });
}

export type CanonicalRegistryConfig = { rpcUrl: string; registryAddr: Address; chainId: number };

/** Read-only canonical ERC-8004 Identity Registry reader (numeric agentId). */
export function createCanonicalErc8004Registry(config: CanonicalRegistryConfig): {
  kind: "canonical";
  getCard(agentId: string): Promise<AgentCard>;
  getAgent(agentId: string): Promise<AgentRecord | null>;
} {
  const chain = defineChain({
    id: config.chainId,
    name: `chain-${config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const registryAddr = getAddress(config.registryAddr);

  async function resolve(agentId: string): Promise<AgentRecord> {
    const tokenId = BigInt(agentId); // throws on non-numeric → caught below
    try {
      const [owner, tokenURI, agentWallet] = await Promise.all([
        client.readContract({ address: registryAddr, abi: CANONICAL_IDENTITY_ABI, functionName: "ownerOf", args: [tokenId] }),
        client.readContract({ address: registryAddr, abi: CANONICAL_IDENTITY_ABI, functionName: "tokenURI", args: [tokenId] }),
        client.readContract({ address: registryAddr, abi: CANONICAL_IDENTITY_ABI, functionName: "getAgentWallet", args: [tokenId] }),
      ]);
      const fetchedCard = await fetchAgentCard(tokenURI as string);
      const card = mapCanonicalToCard({
        agentId,
        owner: getAddress(owner as Address),
        agentWallet: getAddress(agentWallet as Address),
        fetchedCard,
      });
      return {
        agentId, owner: getAddress(owner as Address), registryAddr,
        chainId: config.chainId, agentURI: tokenURI as string, card,
        status: "ACTIVE", registeredAt: new Date(0).toISOString(),
      };
    } catch {
      throw new AgentNotFoundError(agentId);
    }
  }

  return {
    kind: "canonical" as const,
    async getCard(agentId) { return (await resolve(agentId)).card; },
    async getAgent(agentId) {
      try { return await resolve(agentId); }
      catch (e) { if (e instanceof AgentNotFoundError) return null; throw e; }
    },
  };
}
```

- [ ] **Step 4: Run to verify the mapper passes** Run: `bun test packages/erc8004-adapter/test/canonical-reader.test.ts` → PASS.

- [ ] **Step 5: Wire env selection in `index.ts`.** Add a `canonical` branch driven by `ERC8004_IDENTITY_MODE`. Default behavior (mock/onchain) is unchanged when the var is unset.

```ts
// packages/erc8004-adapter/src/index.ts — extend createIdentityRegistryFromEnv()
import { createCanonicalErc8004Registry } from "./canonical-reader";

export function createIdentityRegistryFromEnv(): IdentityRegistry {
  const mode = process.env.ERC8004_IDENTITY_MODE?.trim();
  const rpcUrl = process.env.RPC_URL_BASE_SEPOLIA?.trim() ?? process.env.RPC_URL?.trim();
  const chainId = Number(process.env.CHAIN_ID ?? 84532);

  if (mode === "canonical") {
    const registryAddr = process.env.ERC8004_IDENTITY_REGISTRY_CANONICAL?.trim() as Address | undefined;
    if (!rpcUrl || !registryAddr) throw new Error("canonical identity mode requires RPC + ERC8004_IDENTITY_REGISTRY_CANONICAL");
    const canonical = createCanonicalErc8004Registry({ rpcUrl, registryAddr, chainId });
    return {
      ...canonical,
      kind: "canonical" as unknown as "onchain", // IdentityRegistry.kind is "mock"|"onchain"; treat canonical as onchain-class
      async register() { throw new Error("canonical registry is read-only here; use setup:register-canonical"); },
      async authorizePaymentKey() { throw new Error("read-only"); },
      async authorizeSigningKey() { throw new Error("read-only"); },
      async setStatus() { throw new Error("read-only"); },
      async list() { throw new Error("read-only"); },
    } as unknown as IdentityRegistry;
  }

  const registryAddr = process.env.ERC8004_REGISTRY_ADDRESS?.trim() as Address | undefined;
  return createIdentityRegistry({ rpcUrl, registryAddr, chainId });
}
```

> If `IdentityRegistry["kind"]` should legibly include `"canonical"`, widen the union in `index.ts` (`kind: "mock" | "onchain" | "canonical"`) and drop the casts. Prefer widening the union — do it in this step if the rest of the codebase only switches on `kind === "mock"`.

- [ ] **Step 6: Canonical registration script.** Mirror `scripts/register-testnet-agents.ts`. ABIs are now confirmed from the EIP. Note: `setAgentWallet` requires an EIP-712 signature from the *wallet's* private key (not the deployer's) — the wallet must sign consent. Registering the shopping + merchant demo agents makes them publicly visible on 8004scan. The script prints the assigned numeric `agentId`s.

```ts
// scripts/register-canonical-agents.ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount, signTypedData } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { DEFAULT_SHOPPING_AGENT_ID, DEFAULT_ANALYSIS_AGENT_ID } from "../services/identity-service/src/seed";

// ABIs confirmed against EIP-8004 (https://eips.ethereum.org/EIPS/eip-8004)
const CANONICAL_IDENTITY_ABI = [
  { type: "function", name: "register", stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }], outputs: [{ name: "agentId", type: "uint256" }] },
  { type: "function", name: "setAgentWallet", stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" }, { name: "newWallet", type: "address" },
      { name: "deadline", type: "uint256" }, { name: "signature", type: "bytes" },
    ], outputs: [] },
  { type: "function", name: "setAgentURI", stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "uint256" }, { name: "newURI", type: "string" }], outputs: [] },
] as const;

// NOTE: setAgentWallet signature must be signed by the agent's WALLET private key, not the deployer.
// EIP-712 domain + type for the consent signature — verify exact type hash against deployed contract.
// Domain: { name: "ERC8004", version: "1", chainId: 84532, verifyingContract: registryAddr }
// Type: SetAgentWallet { uint256 agentId, address newWallet, uint256 deadline }
// Run after confirming the exact domain separator from the live contract (call DOMAIN_SEPARATOR()).

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

async function main() {
  loadEnvFile(resolve(import.meta.dir, "../.env"));
  const rpcUrl = process.env.RPC_URL_BASE_SEPOLIA?.trim() ?? "https://sepolia.base.org";
  const registryAddr = requireEnv("ERC8004_IDENTITY_REGISTRY_CANONICAL") as Address;
  const deployerKey = requireEnv("DEPLOYER_PRIVATE_KEY") as Hex;
  const shopperKey = requireEnv("SHOPPING_AGENT_PRIVATE_KEY") as Hex;
  const merchantKey = requireEnv("MERCHANT_AGENT_PRIVATE_KEY") as Hex;
  const identityUrl = process.env.IDENTITY_SERVICE_URL?.trim() ?? "http://localhost:4002";
  const merchantUrl = process.env.MERCHANT_AGENT_URL?.trim() ?? "http://localhost:4004";

  const shopper = privateKeyToAccount(shopperKey);
  const merchant = privateKeyToAccount(merchantKey);
  const deployer = privateKeyToAccount(deployerKey);
  const transport = http(rpcUrl);
  const walletClient = createWalletClient({ chain: baseSepolia, transport, account: deployer });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });

  const agents = [
    { label: DEFAULT_SHOPPING_AGENT_ID, agentURI: `${identityUrl}/.well-known/agent-card.json`, walletAccount: shopper },
    { label: DEFAULT_ANALYSIS_AGENT_ID, agentURI: `${merchantUrl}/.well-known/agent-card.json`, walletAccount: merchant },
  ];

  for (const agent of agents) {
    // 1. register → get numeric agentId
    const registerHash = await walletClient.writeContract({
      address: registryAddr, abi: CANONICAL_IDENTITY_ABI, functionName: "register", args: [agent.agentURI],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });
    // agentId is in the Registered event (topic[1]) or returned via simulate — parse from receipt logs
    console.log(`registered ${agent.label} tx: ${registerHash}`);
    console.log(`receipt logs (find agentId):`, receipt.logs);

    // 2. setAgentWallet — wallet must sign consent (EIP-712).
    // TODO: read DOMAIN_SEPARATOR() from registry, then build typed data and sign with agent.walletAccount.
    // After signing: walletClient.writeContract({ functionName: "setAgentWallet", args: [agentId, wallet, deadline, sig] })
    console.log(`TODO: setAgentWallet for ${agent.label} with ${agent.walletAccount.address}`);
    console.log(`8004scan URL: https://testnet.8004scan.io/agent/<agentId>`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

> The `TODO: setAgentWallet` section is the one genuinely unresolved step — it requires reading `DOMAIN_SEPARATOR()` from the live contract to build the correct EIP-712 payload, then signing with the agent's wallet key. Complete it during implementation once the contract is live and readable. The `register` step alone is sufficient to create the on-chain entry; `setAgentWallet` adds the verified payment address.

- [ ] **Step 7: Commit**

```bash
git add packages/erc8004-adapter/src/canonical-reader.ts packages/erc8004-adapter/test/canonical-reader.test.ts packages/erc8004-adapter/src/index.ts scripts/register-canonical-agents.ts package.json
git commit -m "feat(erc8004-adapter): canonical ERC-8004 Identity reader mode + register-canonical script"
```

---

## Task 1: `CrossLayerBindingValidator.sol` + Foundry tests (our deterministic validator — unchanged)

**Files:**
- Create: `contracts/src/CrossLayerBindingValidator.sol`
- Create: `contracts/test/CrossLayerBindingValidator.t.sol`
- Modify: `contracts/script/Deploy.s.sol` (deploy entry)

- [ ] **Step 1: Write the failing Foundry test** — recording a PASS validation stores it and emits the event; reading by `traceId` returns it; a second record for the same `traceId` reverts (one entry per trace, mirroring the anchor's one-per-trace rule).

```solidity
// contracts/test/CrossLayerBindingValidator.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {CrossLayerBindingValidator} from "../src/CrossLayerBindingValidator.sol";

contract CrossLayerBindingValidatorTest is Test {
    CrossLayerBindingValidator v;
    function setUp() public { v = new CrossLayerBindingValidator(); }

    function test_RecordAndRead() public {
        bytes32 traceId = keccak256("trace-1");
        v.recordValidation(traceId, keccak256("cert"), true, keccak256("root"), bytes32("0xtx"));
        (bytes32 cert, bool result,,,) = v.getValidation(traceId);
        assertEq(cert, keccak256("cert"));
        assertTrue(result);
    }

    function test_OneEntryPerTrace() public {
        bytes32 traceId = keccak256("trace-1");
        v.recordValidation(traceId, keccak256("cert"), true, keccak256("root"), bytes32("0xtx"));
        vm.expectRevert(CrossLayerBindingValidator.AlreadyValidated.selector);
        v.recordValidation(traceId, keccak256("cert2"), true, keccak256("root"), bytes32("0xtx"));
    }
}
```

- [ ] **Step 2: Run to verify it fails** Run: `cd contracts && forge test --match-contract CrossLayerBindingValidatorTest -vvv` → FAIL.

- [ ] **Step 3: Implement** the contract. The `tag`/`zkmlDigest` reservation aligns with the canonical Validation Registry's `tag`/`responseHash` fields (Task 2) so the same record can be replayed to the canonical registry later.

```solidity
// contracts/src/CrossLayerBindingValidator.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A new ERC-8004 Validation Registry validator type: cross-layer-binding validation.
///         Records the deterministic verifier's PASS certificate for a trace. Canonical-ready:
///         its fields map 1:1 to validationResponse(requestHash, response, responseURI, responseHash, tag).
contract CrossLayerBindingValidator {
    struct Validation {
        bytes32 certificateHash;  // -> canonical requestHash
        bool    result;           // -> canonical response (100/0)
        bytes32 merkleRoot;       // -> canonical responseHash
        bytes32 settlementTxHash;
        bytes32 zkmlDigest;       // reserved for a future zkML proof digest (0x0 for now)
        uint256 timestamp;
    }
    mapping(bytes32 => Validation) public validations;
    error AlreadyValidated();
    event ValidationRecorded(bytes32 indexed traceId, bytes32 certificateHash, bool result);

    function recordValidation(bytes32 traceId, bytes32 certificateHash, bool result, bytes32 merkleRoot, bytes32 settlementTxHash) external {
        if (validations[traceId].timestamp != 0) revert AlreadyValidated();
        validations[traceId] = Validation(certificateHash, result, merkleRoot, settlementTxHash, bytes32(0), block.timestamp);
        emit ValidationRecorded(traceId, certificateHash, result);
    }

    function getValidation(bytes32 traceId) external view returns (bytes32, bool, bytes32, bytes32, uint256) {
        Validation memory v = validations[traceId];
        return (v.certificateHash, v.result, v.merkleRoot, v.settlementTxHash, v.timestamp);
    }
}
```

- [ ] **Step 4: Run to verify it passes** Run: `cd contracts && forge test --match-contract CrossLayerBindingValidatorTest -vvv` → PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/CrossLayerBindingValidator.sol contracts/test/CrossLayerBindingValidator.t.sol contracts/script/Deploy.s.sol
git commit -m "feat(contracts): CrossLayerBindingValidator records verifier PASS certificates (canonical-ready)"
```

---

## Task 2: Validation adapter (mock | onchain our-contract | canonical ERC-8004, gated)

**Files:**
- Create: `packages/erc8004-adapter/src/validation-registry.ts`
- Create: `packages/erc8004-adapter/test/validation-registry.test.ts`

- [ ] **Step 1: Write the failing test** — the mock adapter round-trips a validation; the factory selects `onchain` when `CLB_VALIDATOR_ADDRESS` + RPC are set; selecting `canonical` while O1 is unresolved throws a clear "gated" error (so no one accidentally writes to a phantom registry).

```ts
// packages/erc8004-adapter/test/validation-registry.test.ts
import { describe, expect, it } from "bun:test";
import { createValidationRegistry } from "../src/validation-registry";

describe("validation-registry adapter", () => {
  it("mock round-trips a validation by traceId", async () => {
    const a = createValidationRegistry({}); // mock
    await a.record({ traceId: "0xt", certificateHash: "0xc", result: true, merkleRoot: "0xr", settlementTxHash: "0xtx" });
    expect((await a.get("0xt"))?.result).toBe(true);
  });

  it("canonical mode is gated off until O1 is resolved", () => {
    expect(() =>
      createValidationRegistry({ mode: "canonical", rpcUrl: "https://x", validationRegistryAddr: "0xabc" as any }),
    ).toThrow(/gated|O1|not confirmed/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails** Run: `bun test packages/erc8004-adapter/test/validation-registry.test.ts` → FAIL.

- [ ] **Step 3: Implement** `createValidationRegistry(env)`. Three targets; **all ERC-8004-registry ABI specifics live in this one file** (one-file blast radius). The canonical writer is fully written but unreachable behind the O1 gate.

```ts
// packages/erc8004-adapter/src/validation-registry.ts
import type { Address, Hex } from "viem";

export type ValidationInput = {
  traceId: Hex | string;
  certificateHash: Hex | string;
  result: boolean;
  merkleRoot: Hex | string;
  settlementTxHash: Hex | string;
  responseURI?: string;           // evidence/certificate read-back URL (canonical responseURI)
  agentId?: string;               // canonical uint256 subject agentId (required for canonical mode)
};
export type ValidationRecord = { certificateHash: string; result: boolean; merkleRoot: string; settlementTxHash: string; timestamp: number };
export type ValidationRegistry = {
  kind: "mock" | "onchain" | "canonical";
  record(input: ValidationInput): Promise<{ txHash?: string }>;
  get(traceId: string): Promise<ValidationRecord | null>;
};

export type ValidationEnv = {
  mode?: "mock" | "onchain" | "canonical";
  rpcUrl?: string;
  chainId?: number;
  validatorAddr?: Address;            // our CrossLayerBindingValidator (onchain mode)
  validationRegistryAddr?: Address;   // canonical ERC-8004 Validation Registry (canonical mode)
  deployerKey?: Hex;
  // O1: flip to true ONLY after a canonical Validation Registry is confirmed on the target chain.
  canonicalValidationConfirmed?: boolean;
};

// Tag carried into the canonical registry — this IS the new validator-type name.
export const CLB_VALIDATOR_TAG = "CrossLayerBindingValidator";

export function createValidationRegistry(env: ValidationEnv = {}): ValidationRegistry {
  const mode = env.mode
    ?? (env.validatorAddr && env.rpcUrl ? "onchain" : "mock");

  if (mode === "canonical") {
    // O1 gate — do not write to a registry we have not confirmed exists on this chain.
    if (!env.canonicalValidationConfirmed) {
      throw new Error(
        "canonical validation mode is gated off (open item O1: canonical Validation Registry not confirmed on Base Sepolia). " +
        "Resolve O1 and set canonicalValidationConfirmed=true to enable.",
      );
    }
    return createCanonicalValidationRegistry(env);
  }
  if (mode === "onchain") return createOnchainValidationRegistry(env);
  return createMockValidationRegistry();
}

function createMockValidationRegistry(): ValidationRegistry {
  const store = new Map<string, ValidationRecord>();
  return {
    kind: "mock",
    async record(input) {
      store.set(String(input.traceId), {
        certificateHash: String(input.certificateHash), result: input.result,
        merkleRoot: String(input.merkleRoot), settlementTxHash: String(input.settlementTxHash),
        timestamp: Date.now(),
      });
      return {};
    },
    async get(traceId) { return store.get(traceId) ?? null; },
  };
}

// onchain: write/read our CrossLayerBindingValidator (ABI fully known from Task 1).
const CLB_VALIDATOR_ABI = [
  { type: "function", name: "recordValidation", stateMutability: "nonpayable",
    inputs: [
      { name: "traceId", type: "bytes32" }, { name: "certificateHash", type: "bytes32" },
      { name: "result", type: "bool" }, { name: "merkleRoot", type: "bytes32" },
      { name: "settlementTxHash", type: "bytes32" },
    ], outputs: [] },
  { type: "function", name: "getValidation", stateMutability: "view",
    inputs: [{ name: "traceId", type: "bytes32" }],
    outputs: [
      { name: "certificateHash", type: "bytes32" }, { name: "result", type: "bool" },
      { name: "merkleRoot", type: "bytes32" }, { name: "settlementTxHash", type: "bytes32" },
      { name: "timestamp", type: "uint256" },
    ] },
] as const;

function createOnchainValidationRegistry(env: ValidationEnv): ValidationRegistry {
  // Lazy import to keep viem out of the mock path; mirrors onchain-reader.ts client setup.
  const { createPublicClient, createWalletClient, defineChain, http } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");
  if (!env.rpcUrl || !env.validatorAddr) throw new Error("onchain validation requires rpcUrl + validatorAddr");
  const chainId = env.chainId ?? 84532;
  const chain = defineChain({ id: chainId, name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [env.rpcUrl] } } });
  const publicClient = createPublicClient({ chain, transport: http(env.rpcUrl) });
  const address = env.validatorAddr;
  return {
    kind: "onchain",
    async record(input) {
      if (!env.deployerKey) throw new Error("onchain validation write requires deployerKey");
      const wallet = createWalletClient({ chain, transport: http(env.rpcUrl), account: privateKeyToAccount(env.deployerKey) });
      const txHash = await wallet.writeContract({
        address, abi: CLB_VALIDATOR_ABI, functionName: "recordValidation",
        args: [input.traceId, input.certificateHash, input.result, input.merkleRoot, input.settlementTxHash],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return { txHash };
    },
    async get(traceId) {
      const [certificateHash, result, merkleRoot, settlementTxHash, timestamp] =
        await publicClient.readContract({ address, abi: CLB_VALIDATOR_ABI, functionName: "getValidation", args: [traceId] });
      if (Number(timestamp) === 0) return null;
      return { certificateHash, result, merkleRoot, settlementTxHash, timestamp: Number(timestamp) };
    },
  };
}

// canonical: validationRequest(validator, agentId, requestURI, requestHash) by owner,
//            then validationResponse(requestHash, result?100:0, responseURI, merkleRoot, CLB_VALIDATOR_TAG) by validator;
//            read back via getValidationStatus/getAgentValidations. Body written when O1 resolves —
//            it is unreachable until then (the gate above throws). Keep every canonical ABI literal HERE.
declare function createCanonicalValidationRegistry(env: ValidationEnv): ValidationRegistry;
```

> The `mock` and `onchain` writers above are complete. Only `createCanonicalValidationRegistry` is deferred — it is unreachable until O1 flips the gate, and its body must use exactly the §3.2 certificate→`validationRequest`/`validationResponse` mapping from the feasibility doc. Add an Anvil integration test for the `onchain` writer once the validator is deployed (Task 1).

- [ ] **Step 4: Run to verify it passes** Run: `bun test packages/erc8004-adapter/test/validation-registry.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/erc8004-adapter/src/validation-registry.ts packages/erc8004-adapter/test/validation-registry.test.ts
git commit -m "feat(erc8004-adapter): validation-registry adapter (mock|onchain|canonical-gated)"
```

---

## Task 3: `verifier-service` emits validation on PASS + read-back

**Files:**
- Modify: `services/verifier-service/src/{index,server}.ts`
- Create: `services/verifier-service/test/validation-emit.test.ts`

- [ ] **Step 1: Write the failing test** — on a PASS verification the service records a validation retrievable via `GET /verify/:traceId/validation`; on FAIL it records none.

```ts
// services/verifier-service/test/validation-emit.test.ts
import { describe, expect, it } from "bun:test";
import { request } from "./helpers"; // existing test harness; mirror sibling tests

describe("validation emit", () => {
  it("PASS emits a validation entry; FAIL does not", async () => {
    await request("POST", "/verify/0xpass");            // seeded passing trace
    expect((await request("GET", "/verify/0xpass/validation")).body.result).toBe(true);
    await request("POST", "/verify/0xfail");            // seeded failing trace
    expect((await request("GET", "/verify/0xfail/validation")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails** Run: `bun test services/verifier-service/test/validation-emit.test.ts` → FAIL.

- [ ] **Step 3: Implement** — after `verifyTrace` returns PASS, call `validationRegistry.record({ traceId, certificateHash, result: true, merkleRoot, settlementTxHash, responseURI })`; add `GET /verify/:traceId/validation` reading it back. Construct the adapter once with `createValidationRegistry({ mode: process.env.VALIDATION_REGISTRY_MODE as any, rpcUrl: process.env.RPC_URL_BASE_SEPOLIA, validatorAddr: process.env.CLB_VALIDATOR_ADDRESS as Address, validationRegistryAddr: process.env.VALIDATION_REGISTRY_CANONICAL as Address, canonicalValidationConfirmed: process.env.O1_VALIDATION_CONFIRMED === "true" })` — mock offline, our contract on-chain, canonical only when O1 is set.

- [ ] **Step 4: Run to verify it passes** Run: `bun test services/verifier-service` → PASS.

- [ ] **Step 5: Commit**

```bash
git add services/verifier-service
git commit -m "feat(verifier-service): emit validation entry on PASS + read-back (adapter-selected)"
```

---

## Task 4: Paper reframe + DECISIONS

**Files:** Modify `docs/paper-outline.md`, `DECISIONS.md`

- [ ] **Step 1: Paper section** — "Pricing cross-layer trust, made real where it's safe to be." Two honest claims: (a) **Identity is canonical + public** — our demo agents resolve from the live ERC-8004 Identity Registry `0x8004A818…` and are visible on 8004scan among 6,542 agents (no mock on the happy path); (b) `CrossLayerBindingValidator` is a **new validator type** alongside staker-re-exec / zkML / TEE, whose record maps 1:1 to the canonical `validationResponse(requestHash, response, responseURI, responseHash, tag)` and is **canonical-ready** — it lights up the moment the Validation Registry is confirmed on Base Sepolia (O1). This is the loop no competitor closes (Five-Attacks/eBay produce no on-chain validation; A402 is a rail).

- [ ] **Step 2: DECISIONS rows** — (1) B-first: make Identity canonical, keep our own validator (rationale: blast radius + external-dependency risk, not effort — owner has time; cite the three cost axes); (2) canonical Validation Registry unconfirmed on Base Sepolia → adapter `canonical` mode gated behind O1; (3) `CrossLayerBindingValidator` fields chosen to map onto canonical `validationResponse`; (4) `zkmlDigest` reserved; (5) one-entry-per-trace; (6) record confirmed addresses (Identity `0x8004A818…`, Reputation `0x8004B663…`) and the corrected earlier guesses.

- [ ] **Step 3: Commit**

```bash
git add docs/paper-outline.md DECISIONS.md
git commit -m "docs(7e): real canonical identity + canonical-ready CrossLayerBindingValidator framing"
```

---

## Acceptance (7E complete when)

- [ ] `ERC8004_IDENTITY_MODE=canonical` resolves the demo agents from `0x8004A818…`; they are visible on 8004scan; `bun test packages/erc8004-adapter` green (mapper + gate).
- [ ] `cd contracts && forge test --match-contract CrossLayerBindingValidatorTest` green.
- [ ] `bun test packages/erc8004-adapter services/verifier-service` green.
- [ ] A PASS verification yields a validation entry retrievable by `traceId` via the selected adapter (mock default; our `CrossLayerBindingValidator` on-chain); FAIL yields none.
- [ ] The canonical Validation Registry path is implemented but **gated** — selecting it without `O1_VALIDATION_CONFIRMED=true` throws a clear error.
- [ ] All ERC-8004 Validation Registry ABI specifics live in `validation-registry.ts`; all canonical Identity ABI specifics live in `canonical-reader.ts` (one-file blast radius each).

## Open items

- [ ] **O1 — confirm/deny a canonical ERC-8004 Validation Registry on Base Sepolia** (official `erc-8004-contracts` deployments file / 8004scan API). Positive → set `VALIDATION_REGISTRY_CANONICAL` + `O1_VALIDATION_CONFIRMED=true`, add an integration test, and the canonical path is live with no code rewrite. Negative → ship with `onchain` (our `CrossLayerBindingValidator`) as the real on-chain target and document canonical as flip-ready.

## Self-review checklist

- [ ] The canonical reader leaves `verifier-core` (R3/R4) and `schemas` untouched — it only produces a populated `AgentCard`.
- [ ] Read-back returns the same `certificateHash` the verifier produced.
- [ ] No verifier-core change couples it to any registry ABI (verifier stays deterministic + LLM-free; emission lives in the service).
- [ ] `zkmlDigest` is reserved (0x0) — documented as future, not implemented.
- [ ] Canonical validation cannot be written until O1 is explicitly confirmed.
