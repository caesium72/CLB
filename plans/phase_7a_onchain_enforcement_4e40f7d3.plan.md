---
name: Phase 7A — On-chain Predicate Enforcement (headline)
overview: "Make Mode B prevention REAL: a predicate-violating delegated settlement reverts on-chain before transfer, not just fails the off-chain R17 audit. Fold valueAtomic into the C' commitment so the committed value and the on-chain compare are the same quantity; add settleIfPredicateHolds() to PredicatePaymentGuard.sol with typed reverts + single-use nonce; make ContractPredicateGuard the default in runDelegatedOverHttp; add an ERC-7710 caveat-enforcer adapter seam (swappable production-delegation path); ship e2e:phase7-caveat producing a tx-reverted artifact + gas report. Spec: docs/superpowers/specs/2026-06-04-phase-7-sub-phases-design.md §5 (7A)."
todos:
  - id: 7a-valueatomic-in-cprime
    content: "clb-core: computeSettlementParamsDigest commits valueAtomic (uint) so committed value == on-chain compare; update SettlementParams + C' parity vectors and TS<->Solidity parity test"
    status: completed
  - id: 7a-guard-settle
    content: "PredicatePaymentGuard.sol: settleIfPredicateHolds() recomputes C', checks payee/asset/chain/amount/expiry on-chain, enforces single-use nonce=H(C'), reverts with typed errors; Foundry tests revert-per-violation + happy + gas report"
    status: completed
  - id: 7a-contract-guard-default
    content: "predicate-adapter: ContractPredicateGuard calls settleIfPredicateHolds; createPredicateGuard defaults to contract guard for delegated HTTP flow; InMemoryPredicateGuard kept for unit tests only"
    status: completed
  - id: 7a-orchestrator-onchain
    content: "agent-orchestrator: runDelegatedOverHttp deploys/points to the guard and settles through it; predicate violation surfaces as an on-chain revert"
    status: completed
  - id: 7a-erc7710-seam
    content: "ERC-7710 caveat-enforcer adapter: wrap PredicatePaymentGuard as an IERC7710-compatible caveat enforcer (swappable production-delegation seam); document the demo-vs-production gap"
    status: completed
  - id: 7a-e2e-artifact
    content: "scripts/e2e-phase7-caveat.ts + root script e2e:phase7-caveat: drive a violating + happy delegated settlement, assert on-chain revert, emit experiments/benchmarks/phase7-caveat.json + gas-report"
    status: completed
  - id: 7a-decisions
    content: "DECISIONS.md: add Phase 7A row(s) (valueAtomic-in-C', on-chain enforcement default, ERC-7710 seam, demo-vs-production label)"
    status: completed
isProject: false
---

# Phase 7A — On-chain Predicate Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A predicate-violating Mode B (delegated) settlement **reverts on-chain before any transfer**, derived from a C′ commitment that itself binds the atomic value — moving Mode B from "audited" (R17 post-hoc) to "prevented in-protocol."

**Architecture:** Bind `valueAtomic` (integer base units) _inside_ the C′ commitment in `clb-core` so the on-chain comparison and the committed value are the same quantity (removes the documented demo simplification). Promote `PredicatePaymentGuard.sol` to a real enforcer with `settleIfPredicateHolds(...)` that recomputes C′, enforces the predicate fields + a single-use nonce on-chain, and reverts with typed errors. Default the delegated HTTP flow (`runDelegatedOverHttp`) through `ContractPredicateGuard`. Add an ERC-7710 caveat-enforcer adapter as the swappable "production delegation" seam, keeping the existing guard as the honest demo enforcer. Real core, swappable adapters.

**Tech Stack:** TypeScript (Bun) monorepo · `viem` EIP-712/keccak · Foundry (Solidity tests + gas) · existing `@clb-acel/clb-core`, `@clb-acel/predicate-adapter`, `apps/agent-orchestrator`.

**Repo grounding (verify before editing):**

- `packages/clb-core/src/index.ts`: `computeSettlementParamsDigest` (~L195), `deriveSettlementNonce` (~L253), `SettlementParams`, `computeSettlementCommitment`/C′ type.
- `contracts/src/PredicatePaymentGuard.sol` + `contracts/test/` (Foundry); `contracts/foundry.toml`.
- `packages/predicate-adapter/src/index.ts`: `PredicateGuardAdapter`, `InMemoryPredicateGuard`, `ContractPredicateGuard`, `ContractGuardReader`, `createPredicateGuard`, `GuardSettlementInput`, `GuardResult`, `PredicateViolationError`, `SettlementNonceMismatchError`.
- `apps/agent-orchestrator` `runDelegatedOverHttp` (Phase 5 delegated HTTP flow).
- E2E pattern: `scripts/e2e-phase4b.ts`; root scripts in `package.json`.
- DECISIONS Phase 4 row "Amount on-chain" documents the parallel `valueAtomic` simplification this plan removes.

> **forge note:** `forge` may be absent locally (per DECISIONS); Foundry tests run in CI (`.github/workflows/ci.yml`) and on any machine with Foundry installed. Write the tests regardless; run them where `forge` exists.

---

## Task 1: Fold `valueAtomic` into the C′ commitment (clb-core)

**Files:**

- Modify: `packages/clb-core/src/index.ts` (`SettlementParams`, `computeSettlementParamsDigest`)
- Modify/Create: `packages/clb-core/test/settlement-commitment.test.ts`
- Modify: `packages/clb-core/test/parity-vectors.json` (or the existing C′ parity fixture used by `test_ParityWithClbCore`)

- [ ] **Step 1: Write the failing test** — the digest must change when only `valueAtomic` changes, and must equal a fixed vector.

> **Real-code note:** `SettlementParams` (from `@clb-acel/schemas`) already has 7 fields
> (`chainId, network, asset:string, payTo, value:string, validBefore:datetime-string, payerAgentId`).
> We **add** `valueAtomic` (integer base-units, represented as a **decimal string** to match the
> existing `value:string` convention and avoid bigint/JSON-serialization issues) and encode it as
> `uint256` in the digest — we do **not** drop `network`/`payerAgentId` or change `asset`/`value`.

```ts
// packages/clb-core/test/settlement-commitment.test.ts
import { describe, expect, it } from "bun:test";
import type { SettlementParams } from "@clb-acel/schemas";
import { computeSettlementParamsDigest } from "../src";

const base: SettlementParams = {
  chainId: 84532,
  network: "base-sepolia",
  asset: "USDC",
  payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  value: "2.00",
  valueAtomic: "2000000", // 2 USDC, 6 decimals — NOW part of the digest (uint256)
  validBefore: "2026-12-30T06:00:00.000Z",
  payerAgentId: "shopping-agent-001",
};

it("digest depends on valueAtomic (not just the decimal string)", () => {
  const d1 = computeSettlementParamsDigest(base);
  const d2 = computeSettlementParamsDigest({ ...base, valueAtomic: "3000000" });
  expect(d1).not.toEqual(d2);
});

it("digest is stable for a frozen vector (TS<->Solidity parity anchor)", () => {
  // Update this constant once, from the first green run, then freeze it + mirror into Solidity GOLDEN_*.
  expect(computeSettlementParamsDigest(base)).toBe("0x__FROZEN_AFTER_FIRST_RUN__");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/clb-core/test/settlement-commitment.test.ts`
Expected: FAIL — `valueAtomic` not yet in `SettlementParams`/digest (type error or digest unchanged).

- [ ] **Step 3: Add `valueAtomic` to the digest**

`valueAtomic` is added to the existing `SettlementParamsSchema` (`packages/schemas/src/index.ts`)
as `z.string().regex(/^\d+$/)`, and folded into the existing 7-field digest as a `uint256`
inserted **right after `value`** (so the field stays grouped with the decimal it mirrors):

```ts
// packages/clb-core/src/index.ts — extend the EXISTING encoder (do not replace fields)
export function computeSettlementParamsDigest(params: SettlementParams): Hex {
  // keccak256(abi.encode(chainId, network, asset, payTo, value, valueAtomic, validBefore, payerAgentId))
  // valueAtomic (uint256) is the quantity the on-chain guard compares — same quantity it commits to.
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" }, // chainId
        { type: "string" },  // network
        { type: "string" },  // asset
        { type: "address" }, // payTo
        { type: "string" },  // value (decimal, display/off-chain parity)
        { type: "uint256" }, // valueAtomic (NEW — enforced quantity)
        { type: "string" },  // validBefore
        { type: "string" },  // payerAgentId
      ],
      [
        BigInt(params.chainId),
        params.network,
        params.asset,
        getAddress(params.payTo),
        params.value,
        BigInt(params.valueAtomic),
        params.validBefore,
        params.payerAgentId,
      ],
    ),
  );
}

// settlementParamsFromExact derives valueAtomic from value via viem parseUnits(value, decimals=6).
```

And the Solidity `settlementParamsDigest` (PredicatePaymentGuard.sol) is updated in lockstep:
`keccak256(abi.encode(p.chainId, p.network, p.asset, p.payTo, p.value, p.valueAtomic, p.validBefore, p.payerAgentId))`
with `uint256 valueAtomic` added to the on-chain `SettlementParams` struct in the same position.

- [ ] **Step 4: Run test to verify it fails on the frozen-vector assertion only**, then paste the real digest into `__FROZEN_AFTER_FIRST_RUN__` and re-run.

Run: `bun test packages/clb-core/test/settlement-commitment.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Update every caller** of `SettlementParams`/`computeSettlementParamsDigest` to supply `valueAtomic` (orchestrator, attack-core mode-b, predicate-adapter, fixtures). Grep first:

Run: `grep -rln "computeSettlementParamsDigest\|SettlementParams" packages apps services scripts --include=*.ts | grep -v node_modules`
Then add `valueAtomic` wherever a `SettlementParams` literal is built (derive from `value` × 10^decimals, decimals from the asset).

- [ ] **Step 6: Run the full clb-core suite + typecheck**

Run: `bun test packages/clb-core && bun run -s typecheck` (or `bunx tsc -p packages/clb-core`)
Expected: PASS / no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/clb-core
git commit -m "feat(clb-core): bind valueAtomic inside C' settlement digest"
```

---

## Task 2: Bind `valueAtomic` into on-chain `validateAndConsume` + gas report

> **Real-code note:** `PredicatePaymentGuard.sol` **already** has the enforcer: `validateAndConsume(...)`
> recomputes C′ (EIP-712) on-chain, checks payee/asset/chain/amount/expiry, consumes `nonce=H(C')`
> once, and reverts with typed errors (`PayeeNotAllowed`, `AssetNotAllowed`, `ChainNotAllowed`,
> `AmountExceedsMax`, `PredicateExpired`, `NonceAlreadyConsumed`, `CommitmentMismatch`, `NonceMismatch`).
> The only gap is that `valueAtomic` is a **separate argument** (the unbound quantity). This task
> folds `valueAtomic` into the on-chain `SettlementParams` struct + `settlementParamsDigest` (Task 1
> parity) and makes the amount check use `p.valueAtomic` — so the committed and compared quantities are
> identical. We do **not** add a parallel `settleIfPredicateHolds`/`SettleParams` API.

**Files:**

- Modify: `contracts/src/PredicatePaymentGuard.sol` (add `uint256 valueAtomic` to `SettlementParams`
  struct; include it in `settlementParamsDigest`; drop the separate `valueAtomic` arg from
  `validateAndConsume` and use `p.valueAtomic`)
- Modify: `contracts/test/PredicatePaymentGuard.t.sol` (regenerate `GOLDEN_*` vectors from Task 1's
  frozen TS digest; update `_params` to set `valueAtomic`; drop the trailing `valueAtomic` arg from
  `validateAndConsume` call sites; add a `test_GasReport_HappyPath` emitting `settle_gas`)

- [ ] **Step 1: Update the parity vectors + struct in the existing test.** Set `valueAtomic: 2_000000`
  in `_params`, and replace `GOLDEN_PARAMS_DIGEST`/`GOLDEN_COMMITMENT`/`GOLDEN_NONCE` with the values
  printed by the Task 1 frozen-vector run (same canonical params). Update every
  `guard.validateAndConsume(..., 2_000_000)` call to drop the trailing amount arg.

- [ ] **Step 2: Run to verify it fails** (where `forge` exists)

Run: `cd contracts && forge test --match-contract PredicatePaymentGuardTest -vvv`
Expected: FAIL — struct/digest/`validateAndConsume` signature mismatch.

- [ ] **Step 3: Implement** — add `uint256 valueAtomic` to the on-chain `SettlementParams` struct
  (right after `value`), include it in `settlementParamsDigest` in the same position as clb-core, and
  change the amount check in `validateAndConsume` to `if (p.valueAtomic > cfg.maxValueAtomic) revert
  AmountExceedsMax(p.valueAtomic, cfg.maxValueAtomic);`, removing the separate `valueAtomic` parameter.

- [ ] **Step 4: Add a gas-report test** — `test_GasReport_HappyPath` measuring `validateAndConsume`:

```solidity
function test_GasReport_HappyPath() public {
    PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
    (bytes32 commitment, bytes32 nonce) = _commitAndNonce(p);
    uint256 g0 = gasleft();
    guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
    emit log_named_uint("validateAndConsume_gas", g0 - gasleft());
}
```

- [ ] **Step 5: Run tests + gas**

Run: `cd contracts && forge test --match-contract PredicatePaymentGuardTest -vvv --gas-report`
Expected: PASS (all existing reverts + parity + gas line).

- [ ] **Step 6: Commit**

```bash
git add contracts/src/PredicatePaymentGuard.sol contracts/test/PredicatePaymentGuard.t.sol
git commit -m "feat(contracts): bind valueAtomic in C' digest + on-chain amount check; gas report"
```

---

## Task 3: `ContractPredicateGuard` gains a real on-chain `validateAndConsume` writer

> **Real-code note:** `ContractPredicateGuard.assertSettlementAllowed(...)` already exists but only runs
> the off-chain `evaluatePredicate` and (optionally) *reads* `consumed`. The headline gap is that
> nothing **broadcasts a transaction** to `validateAndConsume` and observes a real revert. This task
> adds an optional `writer` to `ContractPredicateGuard` that submits the on-chain tx; on the typed
> revert it throws the existing `PredicateViolationError`/`SettlementNonceMismatchError`. We keep the
> existing `assertSettlementAllowed` signature and the existing `createPredicateGuard` env resolution
> (`PREDICATE_GUARD_ADDRESS`); `InMemoryPredicateGuard` stays the offline/CI default.

**Files:**

- Modify: `packages/predicate-adapter/src/index.ts` (add `ContractGuardWriter` type + optional
  `writer` to `ContractPredicateGuard`; on success return a `GuardResult` carrying `txHash`; on a
  typed revert throw the existing errors. `GuardResult` gains optional `txHash?: Hex`.)
- Modify/Create: `packages/predicate-adapter/test/contract-guard.test.ts`

- [ ] **Step 1: Write the failing test** — with a writer stub that throws `PredicateViolationError`
  for a bad payee, `assertSettlementAllowed` rejects; on the happy path it resolves with
  `enforcedBy: "contract"` and the writer's `txHash`.

```ts
// packages/predicate-adapter/test/contract-guard.test.ts
import { describe, expect, it } from "bun:test";
import { ContractPredicateGuard, PredicateViolationError } from "../src";

it("contract guard surfaces an on-chain payee revert", async () => {
  const writer = async () => { throw new PredicateViolationError({ ok: false, violations: ["PAYEE_NOT_ALLOWED"], details: [] }); };
  const guard = new ContractPredicateGuard({ address: "0x...", writer });
  await expect(guard.assertSettlementAllowed(buildBadPayeeInput())).rejects.toBeInstanceOf(PredicateViolationError);
});

it("contract guard returns txHash on the happy path", async () => {
  const writer = async () => ({ txHash: "0xabc" as const });
  const guard = new ContractPredicateGuard({ address: "0x...", writer });
  const res = await guard.assertSettlementAllowed(buildHappyInput());
  expect(res.enforcedBy).toBe("contract");
  expect(res.txHash).toBe("0xabc");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/predicate-adapter/test/contract-guard.test.ts`
Expected: FAIL — no `writer` path / `txHash` on `GuardResult`.

- [ ] **Step 3: Implement** — `ContractGuardWriter` = `(input: { address, identityRef, mandateDigest,
  predicateId, params, commitment, nonce }) => Promise<{ txHash: Hex }>`. In `assertSettlementAllowed`,
  after `assertCommon`, if a `writer` is set, `await` it and attach `txHash`; let its thrown typed
  errors propagate. The concrete viem `writeContract` reader/writer factory lives behind
  `createPredicateGuard({ address, writer })` (wired in Task 4 / e2e).

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/predicate-adapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/predicate-adapter
git commit -m "feat(predicate-adapter): on-chain writer surfaces validateAndConsume reverts via assertSettlementAllowed"
```

---

## Task 4: `runDelegatedOverHttp` settles through the on-chain guard

**Files:**

- Modify: `apps/agent-orchestrator/src/**` (the `runDelegatedOverHttp` implementation)
- Modify/Create: `apps/agent-orchestrator/test/run-delegated-onchain.test.ts`

- [ ] **Step 1: Write the failing integration test** — a violating delegated run yields a prevented result with an on-chain revert reason; a happy run settles and verifier R17 passes.

> **Real-code note:** `runDelegatedOverHttp(intent, options)` returns `ModeBTraceResult & { transport }`
> with a `guardResult` field, and currently calls `createPredicateGuard()` (in-memory). We add an
> opt-in on-chain path (`options.onchainGuard` / env) that, when active, settles through
> `ContractPredicateGuard` with a viem writer and surfaces a new `onchain: { reverted, reason?, txHash? }`
> field. A violating settlement throws inside the guard → caught and surfaced as `onchain.reverted`.

```ts
// apps/agent-orchestrator/test/run-delegated-onchain.test.ts
import { describe, expect, it } from "bun:test";
import { runDelegatedOverHttp } from "../src/http-flow";

it("violating delegated settlement reverts on-chain", async () => {
  const out = await runDelegatedOverHttp(violatingIntent(), { onchainGuard: { address, rpcUrl } });
  expect(out.onchain?.reverted).toBe(true);           // NEW: real revert, not just R17 fail
  expect(out.guardResult.allowed).toBe(false);
});

it("happy delegated settlement completes and verifies (R17 ok)", async () => {
  const out = await runDelegatedOverHttp(happyIntent(), { onchainGuard: { address, rpcUrl } });
  expect(out.onchain?.reverted).toBe(false);
  expect(out.guardResult.evaluation.ok).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails** — `runDelegatedOverHttp` currently uses the in-process guard (no `onchain.reverted`).

Run: `bun test apps/agent-orchestrator/test/run-delegated-onchain.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — point `runDelegatedOverHttp` at `createPredicateGuard({ mode: "contract", rpcUrl, guardAddress })`, deploy/locate the guard (Anvil for tests, Base Sepolia behind env), settle through it, and surface `{ onchain: { reverted, reason, txHash } }` on the result.

- [ ] **Step 4: Run to verify it passes** (Anvil must be up: `bash scripts/deploy-anvil-contracts.sh` or the repo's anvil bootstrap).

Run: `bun test apps/agent-orchestrator/test/run-delegated-onchain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent-orchestrator
git commit -m "feat(orchestrator): runDelegatedOverHttp settles through on-chain predicate guard"
```

---

## Task 5: ERC-7710 caveat-enforcer adapter seam (swappable production path)

**Files:**

- Create: `contracts/src/CLBCaveatEnforcer.sol`
- Create: `contracts/test/CLBCaveatEnforcer.t.sol`
- Modify: `packages/predicate-adapter/src/index.ts` (add an `erc7710` guard mode that redeems via the enforcer)
- Modify: `DECISIONS.md` (label demo-vs-production gap)

- [ ] **Step 1: Write the failing Foundry test** — the enforcer implements the ERC-7710 `ICaveatEnforcer` `beforeHook`/`enforceCaveat` shape and reverts on a predicate violation when invoked during delegation redemption.

```solidity
// contracts/test/CLBCaveatEnforcer.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {CLBCaveatEnforcer} from "../src/CLBCaveatEnforcer.sol";

contract CLBCaveatEnforcerTest is Test {
    CLBCaveatEnforcer enf;
    function setUp() public { enf = new CLBCaveatEnforcer(); }

    function test_Enforce_RevertsOnPayeeViolation() public {
        bytes memory terms = abi.encode(/* allowedPayee */ address(0xBEEF), /* asset */ address(1), /* max */ uint256(2_000000), /* chain */ block.chainid);
        bytes memory execution = abi.encode(/* payTo */ address(0xBAD), address(1), uint256(2_000000), block.chainid);
        vm.expectRevert(CLBCaveatEnforcer.CaveatPredicateViolation.selector);
        enf.enforceCaveat(terms, execution, bytes32(0), address(this), address(this));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd contracts && forge test --match-contract CLBCaveatEnforcerTest -vvv`
Expected: FAIL — enforcer not defined.

- [ ] **Step 3: Implement the enforcer** — a thin `ICaveatEnforcer`-compatible contract (MetaMask Delegation Framework interface: `enforceCaveat(bytes terms, bytes execution, bytes32 delegationHash, address redeemer, address delegator)`) that decodes the predicate from `terms`, decodes the concrete settlement from `execution`, and reverts `CaveatPredicateViolation` if the predicate fails. This is the **production delegation seam**: the same predicate logic as `PredicatePaymentGuard`, expressed as an ERC-7710 caveat so it composes with the audited MetaMask Delegation Framework.

- [ ] **Step 4: Run to verify it passes**

Run: `cd contracts && forge test --match-contract CLBCaveatEnforcerTest -vvv`
Expected: PASS.

- [ ] **Step 5: Add an `erc7710` guard mode** in `predicate-adapter` that redeems a delegation through the enforcer (kept behind a flag; `PredicatePaymentGuard` remains the default demo enforcer). Document in `DECISIONS.md`:

> 7A: enforcement is real on-chain via `PredicatePaymentGuard.settleIfPredicateHolds` (default, demo-labelled). `CLBCaveatEnforcer` provides the ERC-7710/MetaMask-Delegation-Framework seam for the production delegation story; a fully battle-hardened enforcer (gas-optimized, audited, EIP-712 redemption) remains future work.

- [ ] **Step 6: Commit**

```bash
git add contracts/src/CLBCaveatEnforcer.sol contracts/test/CLBCaveatEnforcer.t.sol packages/predicate-adapter DECISIONS.md
git commit -m "feat(contracts): ERC-7710 caveat-enforcer seam for production delegation"
```

---

## Task 6: `e2e:phase7-caveat` — reverted artifact + gas report

**Files:**

- Create: `scripts/e2e-phase7-caveat.ts` (model on `scripts/e2e-phase4b.ts`)
- Modify: `package.json` (add `"e2e:phase7-caveat": "bun run scripts/e2e-phase7-caveat.ts"`)
- Output: `experiments/benchmarks/phase7-caveat.json`, `experiments/benchmarks/phase7-caveat-gas.md`

- [ ] **Step 1: Write the script** — boot/await Anvil + deploy guard; run one **violating** delegated settlement (assert `onchain.reverted === true`, capture revert reason) and one **happy** settlement (assert success + R17 ok); write a JSON artifact `{ violating: {...}, happy: {...}, gas: {...} }` and a markdown gas table.

- [ ] **Step 2: Run it**

Run: `bun run e2e:phase7-caveat`
Expected: exits 0; prints "REVERTED: PredicateAmountExceeded (or chosen violation)" and "HAPPY: settled, R17 ok"; writes both artifacts.

- [ ] **Step 3: Assert artifacts exist + are non-empty**

Run: `test -s experiments/benchmarks/phase7-caveat.json && head experiments/benchmarks/phase7-caveat-gas.md`
Expected: file present; gas table visible.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-phase7-caveat.ts package.json experiments/benchmarks/phase7-caveat.json experiments/benchmarks/phase7-caveat-gas.md
git commit -m "feat(e2e): phase7-caveat proves on-chain Mode B prevention + gas"
```

---

## Acceptance (7A complete when)

- [ ] `bun test packages/clb-core packages/predicate-adapter apps/agent-orchestrator` green.
- [ ] `cd contracts && forge test --gas-report` green incl. revert-per-violation + happy + replay; gas captured.
- [ ] `bun run e2e:phase7-caveat` exits 0 and writes `phase7-caveat.json` showing a **real on-chain revert** for a predicate violation and a settled happy path with R17 ok.
- [ ] DECISIONS.md records the `valueAtomic`-in-C′ change, the on-chain enforcement default, and the ERC-7710 demo-vs-production label.

## Self-review checklist (run before handoff)

- [ ] Every `SettlementParams` literal in the repo now sets `valueAtomic` (grep clean).
- [ ] On-chain `keccak256(abi.encode(...))` field order == `computeSettlementParamsDigest` field order (parity test passes).
- [ ] No step references a type/function not defined here or in the repo.
