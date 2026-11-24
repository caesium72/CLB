# R3-C2 — Code-evidenced predicate authorization / enforcement spec

Scope: what the **code actually does** for items 44–60, not what the paper claims.
Evidence is line-pinned to the checked-in Solidity, TypeScript, schemas, and formal
artifacts in `A3C-v2`. No contract or existing source file was modified.

## 0. Evidence base

| Source | What it establishes |
|---|---|
| `contracts/src/PredicatePaymentGuard.sol` | On-chain registration, commitment recomputation, field checks, single-use nonce. |
| `contracts/test/PredicatePaymentGuard.t.sol` | 12 pre-existing happy/revert tests (baseline). |
| `contracts/test/PredicatePaymentGuard.adversarial.t.sol` (new) | 21 adversarial tests: 14 for enforced conditions, 7 that **document** known gaps. |
| `packages/clb-core/src/index.ts` | Off-chain `evaluatePredicate`, `settlementParamsFromExact`, `computeModeBSettlementCommitment`. |
| `packages/predicate-adapter/src/{index,onchain}.ts` | Where taskHash/agent checks live (off-chain only) and how `validateAndConsume` is broadcast. |
| `packages/schemas/src/index.ts` | `Mandate.humanPrincipal` / `signature` vs `SpendingPredicate` (no principal). |
| `scripts/deploy-predicate-guard-sepolia.ts` | Registration is an ordinary wallet `writeContract` by the deployer. |
| `formal/tamarin/clb.spthy`, `formal/proverif/clb-offchain.pv` + archived results | Model and current proof evidence (see `formal-model-reconciliation.md`). |

## 1. Implemented authorization/enforcement pipeline

```
  human signs AP2 Mandate (humanPrincipal, constraints, predicateRef)
        │  computeMandateDigest() [clb-core:62-67] → mandateDigest
        ▼
  off-chain evaluatePredicate(predicate, params, now, observedTaskHash)
        │  [clb-core:317-371]  asset/payee/value/expiry/chain/agent/taskHash
        ▼
  agent picks params → C' = EIP712(identityRef, mandateDigest, predicateId,
  │                                settlementParamsDigest)   [sol:121-137 / core:254-256]
  │  nonce = H(C')                                            [sol:140-142]
  ▼
  PredicatePaymentGuard.validateAndConsume(...)                [sol:169-200]
    1 registered?             sol:177-179
    2 C' recompute + equal?   sol:181-183
    3 nonce == H(C')?         sol:184-185
    4 nonce unused?           sol:187-188
    5 payee / asset / chain / atomic amount / expiry  sol:190-195
    6 consumed[nonce] = true; emit                     sol:197-198
        │
        ▼  (external to the contract) x402 facilitator transfers value
```

**Critical boundary:** steps 1–6 prove only *internal consistency of caller-supplied
inputs*. The contract never receives or verifies a human signature, a human
principal, a task hash, or an agent allow-list. `mandateDigest` is an unconstrained
`bytes32` calldata field that is hashed into C' — being "bound" is not the same as
being "authorized".

## 2. Item-by-item status (44–60)

| # | Item | Status | Concrete evidence |
|---|---|---|---|
| 44 | Authenticated predicate registration | **GAP (HIGH)** | `registerPredicate` is `external` with no `onlyOwner`, no signature, no principal arg (`sol:89-102`). `scripts/deploy-predicate-guard-sepolia.ts:63-81` calls it as a plain wallet tx. `test_Gap_AnyoneCanRegisterAndSettleToArbitraryPayee` shows an attacker registering its own payee list and settling to itself. |
| 45 | Predicate config bound to human principal | **GAP (HIGH)** | `PredicateConfig` (`sol:39-46`) has only payees/assets/chains/max/validUntil/registered — no principal. `SpendingPredicate` (`schemas:90-100`) has no principal either (`Mandate` does, `schemas:65-76`). `identityRef.agentId` and `p.payerAgentId` are hashed but never checked (`test_Gap_PayerAgentIdNotCheckedOnChain`). |
| 46 | Predicate config bound to mandate digest | **GAP (HIGH)** | `mandateDigest` (`sol:171`) is free calldata; config storage has no digest field; any digest can be used with any registered predicate (`test_Gap_ConfigIsNotBoundToHumanOrMandateDigest`). |
| 47 | Authorization + expiration enforcement | **PARTIAL** | Expiry enforced at `sol:195` (`block.timestamp > validUntil`), registration at `sol:179`; C'/nonce/replay checks at `sol:181-188`. Human authorization is *not* enforced on-chain (see 44–46); `evaluatePredicate` does enforce the signed predicate off-chain (`core:317-371`) but is bypassable in `settleOnChain` (`adapter/index.ts:223-242` broadcasts without calling it). |
| 48 | Chain consistency enforcement | **PARTIAL** | `p.chainId ∈ allowedChainIds` (`sol:193`); domain chainId in `DOMAIN_SEPARATOR` (`sol:77-86`) and `id.chainId` in C' (`sol:117`). But `id.chainId`, `p.chainId`, and the domain chain are never cross-checked (`test_Gap_IdentityChainNotCrossCheckedWithSettlementChain`). |
| 49 | Atomic and decimal amount consistency | **PARTIAL** | `valueAtomic` is bound in the params digest (`sol:112`, `core:199-224`) and compared to `maxValueAtomic` (`sol:194`); boundary test passes at exactly max. No on-chain derivation from decimal `value` (`core:269-284` uses `parseUnits`); mismatch accepted (`test_Gap_DecimalAndAtomicAmountInconsistencyAccepted`). |
| 50 | Atomic payment + predicate consumption / secure recovery | **PARTIAL** | All checks precede `consumed[nonce] = true` (`sol:190-198`), so EVM reverts roll back guard state; `test_Adversarial_FailedSettlementLeavesNonceUnconsumedAndRecoverable` proves recovery after a failed attempt. The contract transfers **no funds** — "before any transfer" is a harness convention (`reviewer-2/comment-2/implementation-report.md:41-53`). No caller binding means anyone can burn the nonce (`test_Gap_AnyCallerCanFrontRunNonceConsumption`); there is no recovery API once consumed. |
| 51 | Adversarial Solidity tests for each security condition | **IMPLEMENTED** | New `contracts/test/PredicatePaymentGuard.adversarial.t.sol`: 21 tests, all passing under `forge` 1.10.0 with a temporary forge-std remap (exact output in §5). Covers every enforced revert plus 7 executed known-limitation cases. |
| 52 | Align Tamarin models with actual authorization lifecycle | **GAP — NOT DONE** | Model change required; see formal reconciliation §3. |
| 53 | Model predicate registration and authorization | **GAP — NOT DONE** | No `RegisterPredicate` rule in `clb.spthy`; only `Authorize_ModeB` mints `!Admissible`/nonce. |
| 54 | Model human-principal-to-mandate relationship | **GAP — NOT DONE** | `$H` never linked to a mandate digest or predicate id in the model. |
| 55 | Model actual settlement operations | **GAP — NOT DONE** | Abstract tuples, no `valueAtomic`/`taskHash`/`payerAgentId`/`C'` fields. |
| 56 | Model failed settlement and nonce recovery | **GAP — NOT DONE** | No failed-settlement rule or state rollback in the model. |
| 57 | Revisit P1–P5 assumptions | **IMPLEMENTED** (documentation) | Reassessment recorded in `formal-model-reconciliation.md` §2 with per-property divergence; no proofs regenerated. |
| 58 | Regenerate and archive proof outputs | **GAP — NOT DONE** | No new Tamarin/ProVerif run. Existing artifacts unchanged and cited by path/hash metadata only. |
| 59 | Reconcile ProVerif results with updated construction | **PARTIAL** | Existing Q1=true / Q2=false result reconciled in prose with the current guard; no new ProVerif model or run. |
| 60 | Document formal-model assumptions and implementation boundaries | **IMPLEMENTED** | This spec + `formal-model-reconciliation.md`; includes the filename observation that the on-disk ProVerif result is `clb-offchain.result.txt` (no `clb-offchain.pv.result.txt` exists). |

**Counts:** IMPLEMENTED 3 (51, 57, 60) · PARTIAL 5 (47, 48, 49, 50, 59) · GAP 9 (44, 45, 46, 52, 53, 54, 55, 56, 58).

## 3. Gap register (severity → remedy)

| ID | Gap | Severity | Reproduction / evidence | Proposed remedy |
|---|---|---|---|---|
| G1 | Permissionless predicate registration (44) | **HIGH** | `test_Gap_AnyoneCanRegisterAndSettleToArbitraryPayee`; `registerPredicate` has no auth. | Gate registration on an EIP-712 human signature over `(predicateId, config, humanPrincipal, mandateDigest)` or an owner/registry; emit principal+digest in `PredicateRegistered`. |
| G2 | No human-principal binding (45) | **HIGH** | `test_Gap_ConfigIsNotBoundToHumanOrMandateDigest`, `test_Gap_PayerAgentIdNotCheckedOnChain`; config struct fields. | Store `humanPrincipal` and `mandateDigest` in `PredicateConfig`; require equality in `validateAndConsume`; add `allowedAgentIds` or bind identityRef to the signed mandate. |
| G3 | No mandate-digest binding (46) | **HIGH** | Same test: two unrelated digests both settle. | Verify a human signature over `mandateDigest` at registration and pin it in config; do not accept arbitrary calldata digest. |
| G4 | **`taskHash` not enforced on-chain** (47/55) | **HIGH** | Solidity has **no** `taskHash` field anywhere in `PredicateConfig`, `SettlementParams`, or `validateAndConsume` (`sol:28-46, 169-176`); only `clb-core:365-368` checks `observedTaskHash` off-chain. `test_Gap_TaskSubstitutionAllowedOnChain` passes. Independently observed in `reviewer-2/comment-2/implementation-report.md:56-62` (`COMPROMISED_AGENT_TASK_SUBSTITUTION` → allowed). | Add `taskHash` to `SettlementParams` (and therefore to `computeSettlementParamsDigest`/C'), add `expectedTaskHash` to `PredicateConfig`, and require equality in `validateAndConsume`; regenerate golden vectors and the TS↔Solidity parity tests. |
| G5 | Chain cross-field consistency (48) | **MEDIUM** | `test_Gap_IdentityChainNotCrossCheckedWithSettlementChain`. | Require `id.chainId == p.chainId == domainChainId` (store domain chain in a public immutable if needed). |
| G6 | Decimal ↔ atomic divergence (49) | **MEDIUM** | `test_Gap_DecimalAndAtomicAmountInconsistencyAccepted`; `core:269-284` derives atomics off-chain, contract does not. | Derive atomics on-chain from `value` + asset decimals, or remove `value` from the on-chain payload and keep it purely display. |
| G7 | Front-runnable nonce / no secure recovery / no payment leg (50) | **MEDIUM** | `test_Gap_AnyCallerCanFrontRunNonceConsumption`; no transfer in contract. | Bind the settlement to `msg.sender` (or signed payer key) in C'; make guard+transfer one atomic call; add explicit cancel/expiry-based nonce release if recovery is required. |
| G8 | Model/code divergence (52–56) and stale proof regeneration (58) | **MEDIUM** (paper-claim risk) | Formal reconciliation §2–§3; `clb.proof` header states Tamarin 1.12.0 / 2026-03-08. | Update `.spthy` models and regenerate proofs in a separate change with Tamarin/ProVerif installed; until then scope paper claims to the abstract protocol, not the deployed guard. |

Minor note (no severity assigned): `PredicateConfig.registered` is accepted as calldata
but ignored — `cfg.registered = true` unconditionally (`sol:99-100`). Harmless today,
but callers should not assume passing `false` disables registration.

## 4. What is genuinely enforced (do not under-claim)

- predicate id must be registered; duplicate registration cannot overwrite policy;
- C' recomputation must equal the supplied commitment, and nonce must equal H(C');
- nonce is single-use;
- payee, asset hash, chainId, and `valueAtomic` must be in the registered policy;
- `block.timestamp <= validUntil` (equality is still valid; check is `>`).

These are covered by `test_Adversarial_*` cases and are not affected by G1–G7.

## 5. Test execution

- Requested command from repo root: `forge test --match-path contracts/test/PredicatePaymentGuard.adversarial.t.sol` → `Nothing to compile` (repo root is not a Foundry project root; `foundry.toml` lives in `contracts/`).
- The repo's `forge-std` submodule is an **empty directory** (`contracts/lib/forge-std/`), so a plain `forge test` inside `contracts/` fails with `Source "lib/forge-std/src/Test.sol" not found`.
- To obtain real results without modifying the repo, forge-std v1.16.1 (the exact rev pinned in `contracts/foundry.lock`) was cloned to `C:\Users\Hp\AppData\Local\Temp\opencode\forge-std-1.16.1` and supplied **only** via the CLI flag `--remappings "forge-std/=C:/Users/Hp/AppData/Local/Temp/opencode/forge-std-1.16.1/src/"`.
- Result: `Suite result: ok. 21 passed; 0 failed; 0 skipped (21 total tests)`. `bun run typecheck` → `tsc --build`, exit 0.

## 6. Honest limitations of this spec

- Solidity tests prove behaviour of the current guard on a local EVM, not on a public network and not against a real human-signed mandate payload.
- The 7 `test_Gap_*` cases pass by design; they are executable documentation of unsafe behaviour, **not** security guarantees.
- No Tamarin or ProVerif binary was installed or run; items 52–56 and 58 are explicitly NOT DONE.
