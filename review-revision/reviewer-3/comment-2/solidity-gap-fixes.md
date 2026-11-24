# R3-C2 — on-chain predicate-guard gap fixes (items 44–51)

Scope: `contracts/src/PredicatePaymentGuard.sol`, `contracts/test/PredicateGuardSecurity.t.sol`
(new), `packages/clb-core/src/index.ts`, `packages/predicate-adapter/src/{index,onchain}.ts`.
Changes are **additive at the interface level** (typehash, `PredicateConfig` /
`SettlementParams` structs and C′ computation are untouched, so the TS↔Solidity golden
vectors still pass), but **behavioural**: both `validateAndConsume` overloads are now
gated on the human `Binding` — a predicate registered only through the legacy
`registerPredicate` path can never be settled. The 7-arg/6-arg signatures are kept for
source compatibility, not as an unauthenticated fallback. `registerPredicateBound` may
take over an id that the legacy path squatted. See "Legacy entry points" below.

## Design (DEMO, honest trust boundary)

A human-signed **binding** is stored in a separate `Binding` mapping keyed by
`keccak256(bytes(predicateId))`, so the on-chain config digest stays byte-identical
to clb-core. The enforced entry points are:

```
registerPredicateBound(predicateId, config, principal, mandateDigest, taskHash,
                       extraFieldsDigest, signature)
    ├─ caller must == principal                      (no third-party registration)
    ├─ EIP-191 signature by principal over
    │  BINDING_TYPEHASH(predicateId, configDigest, principal, mandateDigest,
    │                   taskHash, extraFieldsDigest, domainChainId)
    └─ stores Binding + config; duplicate ids still rejected

validateAndConsumeBound(id, mandateDigest, predicateId, extraFieldsDigest,
                        agentIdHashes, taskHash, p, commitment, nonce)
    ├─ binding exists, msg.sender == principal
    ├─ mandateDigest / taskHash / extraFieldsDigest match the human pin
    ├─ keccak256(abi.encode(agentIdHashes, taskHash)) == extraFieldsDigest
    ├─ id.chainId == p.chainId == DOMAIN_CHAIN_ID
    ├─ p.valueAtomic == parseUnits6(p.value)      (6-decimal USDC assumption)
    └─ delegates to the existing C′/nonce/replay/policy checks
```

`computePredicateGuardBindingDigest` (clb-core) produces the identical EIP-191
digest off-chain; a golden-vector test asserts TS↔Solidity parity by executing both.

## Per-item status

| # | Gap | Status | Evidence |
|---|---|---|---|
| 44 | Authenticated registration | **CLOSED on bound path (DEMO)** | `registerPredicateBound` requires caller == principal *and* a principal signature over the full config; wrong caller/key/tampered config each have a dedicated test. The unauthenticated legacy `registerPredicate` path is retained but settlement-inert: no `Binding` is created, so every settlement entry point reverts `PredicateNotBound` (`test_LegacyRegistrationCannotSettle`, `test_Closed_AnyoneCanRegisterAndSettleToArbitraryPayee`); an id squatted through it can be taken over by the human (`test_BoundRegistrationTakesOverSquattedId`). |
| 45 | Human-principal binding | **CLOSED on all settlement entry points** | `Binding.principal` stored; `PrincipalMismatch` enforced in `validateAndConsume` (7-arg and 6-arg) and in `validateAndConsumeBound`. `agentIdHashes` pinned via the human-signed extras digest. |
| 46 | Mandate-digest binding | **CLOSED on all settlement entry points** | `Binding.mandateDigest` pinned at registration; `MandateDigestMismatch` on calldata divergence in both the 7-arg/6-arg overloads and `validateAndConsumeBound` (`test_Closed_ConfigIsNotBoundToHumanOrMandateDigest`). |
| taskHash (G4) | `taskHash` not enforced on-chain | **CLOSED on bound path** | explicit `bytes32 taskHash` calldata + `TaskHashMismatch`, plus recomputation of the clb-core extras digest so the checked task hash is exactly the one bound into C′. On the 7-arg/6-arg path the pin is still enforced through the extras digest (`ExtrasDigestMismatch`, `test_Closed_TaskSubstitutionRejectedOnChain`). |
| 48 | Chain cross-field consistency | **CLOSED on bound path** | `DOMAIN_CHAIN_ID` immutable + `ChainIdMismatch` for `id.chainId != p.chainId` or either != domain. |
| 49 | Decimal ↔ atomic divergence | **CLOSED on bound path** | on-chain `parseUnits6` (matches viem `parseUnits(value, 6)`) + `AmountMismatch`; malformed/>6-decimal input reverts `InvalidDecimalValue`. |
| 50 | Front-runnable nonce / no recovery | **PARTIALLY CLOSED** | caller==principal blocks third-party nonce griefing on **all** settlement entry points (7-arg, 6-arg and `validateAndConsumeBound`; `test_Closed_AnyCallerCanFrontRunNonceConsumption`, `test_RejectsNonceFrontRunningByThirdParty`). Failed settlements still roll back atomically (existing adversarial test). Residual: the guard transfers **no funds**, so guard consumption and the external payment leg are not atomic; a consumed nonce has no release API (correct one-shot semantics). |
| 51 | Adversarial Solidity coverage | **DONE** | 17 new tests in `PredicateGuardSecurity.t.sol` (positives + every fixed condition + TS parity). |

## Residual limits (not fixed, deliberate)

1. **Legacy entry points are retained but can no longer settle.** `registerPredicate`
   is still unauthenticated and still stores a config, so fixture/inspection code and
   the viem/mock TS writers keep working, but that config gets no `Binding`, so every
   settlement entry point rejects it with `PredicateNotBound`
   (`test_LegacyRegistrationCannotSettle`). An attacker can still squat a free id;
   `registerPredicateBound` takes it over, so the squat is not durable
   (`test_BoundRegistrationTakesOverSquattedId`). The 7-arg and 6-arg
   `validateAndConsume` overloads are now gated too (binding present, caller ==
   principal, mandate + extras digests equal the human pin), and the 6-arg one takes
   `extraFieldsDigest` from the binding rather than calldata
   (`test_LegacySixArgUsesBindingExtras`). The former `test_Gap_*` cases in
   `PredicatePaymentGuard.adversarial.t.sol` were therefore inverted into
   `test_Closed_*` cases in this round. The only `test_Gap_*` cases left assert limits
   that genuinely survive on the 7-arg/6-arg path: `id.chainId` is cross-checked only
   in `validateAndConsumeBound`, and `payerAgentId` is never checked on-chain.
2. **No external identity registry.** `principal` is self-asserted by the signing
   key; this is an ERC-7710 demo substitute, not production delegation.
3. **Fixed 6 decimals** in `parseUnits6`, matching clb-core's USDC/EURC convention;
   multi-decimal assets need a decimals field in the binding (future work).
4. **No atomic payment leg / no consumed-nonce recovery** — see item 50.

## Verification (exact commands and results)

```
$ forge test
Ran 8 test suites: 74 tests passed, 0 failed, 0 skipped (74 total tests)

$ bun test
Ran 362 tests across 62 files: 360 pass, 2 skip, 0 fail

$ bun run typecheck   → tsc --build, exit 0
$ bun run reproduce:all → exit 0, 11/11 steps PASS, version check PASS, validator 49/49
```

`forge-std` 1.16.1 is vendored in `contracts/lib/forge-std` (the archive's
submodule was empty), so `forge test` works without ad-hoc remappings and the
Phase 7 forge gas report is populated again (`validateAndConsumeForgeReport: 72925`).
