# RCLB implementation map

## Files changed (all additive)

```
packages/clb-core/src/epochs.ts                         NEW  C_t + acceptance core
packages/clb-core/src/index.ts                          +1 line: export * from "./epochs"
packages/clb-core/test/epochs.test.ts                   NEW  12 tests
packages/erc8004-adapter/src/index.ts                   + epoch registry (revoke/rotate)
packages/verifier-core/src/index.ts                     + import, option type, R18 region, gate
packages/verifier-core/test/revocation.test.ts          NEW  9 tests
contracts/src/RevocationAwareGuard.sol                  NEW  on-chain guard
contracts/test/RevocationAwareGuard.t.sol               NEW  13 forge tests
packages/attack-core/src/revocation-scenarios.ts        NEW  8 deterministic scenarios
packages/attack-core/test/revocation-scenarios.test.ts  NEW  8 tests
experiments/novelty/rclb/{generate-metrics.ts,metrics.json,forge-rclb.log,README.md}
review-revision/novelty/rclb/{design,implementation,evaluation,paste-ready-text}.md
```

`PredicatePaymentGuard.sol`, `verifier-core/src/types.ts`, rule bodies
R1/R2/R5/R10/R11, `modeBCommitmentInputOf`, root `package.json`, `tsconfig*`,
manuscript files and all other paths were **not touched**.

## Data flow

```
 human mandate ──> C / C' (existing clb-core) ──┐
 authority epochs E_I,E_M ──> current snapshot ─┼─> C_t = H(C,EI,EM,T,N)
 expiry T, application nonce N ─────────────────┘         │
                                                          v
                      ┌───────────────────────────────────────────────┐
                      │ acceptance (E_I==cur, E_M==cur, t<=T, N fresh)│
                      └───────────────────────────────────────────────┘
                            │                             │
                            v                             v
                verifyTrace R18 (opt-in)        RevocationAwareGuard.sol
```

## Public API additions

**`clb-core`** (`export * from "./epochs"`):

- `Epoch`, `REVOCATION_AWARE_COMMITMENT_SCHEMA`, `RevocationAwareCommitmentFields`
- `computeRevocationAwareCommitment(fields) -> Hex`
- `deriveRevocationAwareNonce(C_t) -> Hex`
- `checkRevocationAwareAcceptance(input) -> { ok, violations, detail }`
- `consumeRevocationNonce(set, N) -> Set<string>`, `revocationNonceKey(N)`
- `RevocationViolationCode` union (7 codes)

**`erc8004-adapter`**: `AuthorityEpochs`, `EpochSeed`, `EpochRegistry`,
`createInMemoryEpochRegistry(seed?, registry?)` with `currentEpochs`,
`currentSigningKey`, `revokeIdentity`, `revokeMandate`, `rotateIdentityKey`.
Unknown agents return `null` from `currentEpochs` (fail-closed) and throw from
mutators. When an `Erc8004Registry` is supplied, identity revocation also calls
`setStatus(agentId, "REVOKED")`; mandate revocation deliberately does not.

**`verifier-core`**: `RevocationVerifierInput`, `R18_REVOCATION_AWARE_BINDING`,
`verifyRevocationBinding(input)`, and `revocationBinding?: RevocationVerifierInput`
on the existing `VerifyTraceOptionsWithPrincipal`. When the option is omitted,
`verifyTrace` output is unchanged (same `rulesChecked`, same certificate fields).
When present, `certificate.rulesChecked` includes R18 and a failed gate appends
`"R18_REVOCATION_AWARE_BINDING"` to `result.failedRules`.

**Solidity guard**: constructor `RevocationAwareGuard(address authority_)`;
`initializeEpochs`, `currentEpochs`, `revokeIdentity`, `revokeMandate`,
`rotateIdentityKey`, `computeRevocationAwareCommitment`,
`deriveRevocationAwareNonce`, `validateAndConsume`. All epoch mutations are
`onlyAuthority`; unknown agents revert `AuthorityStateUnavailable`.

## Minimal-change decisions

- R18 is a *new* identifier in `index.ts` rather than a change to `RuleId` in
  `types.ts`, because that file is owned by concurrent work. The appended id
  is cast at the `RuleId[]` boundary only; no existing rule object is altered.
- `attack-core/src/index.ts` was not edited (not owned), so scenarios are
  imported from `../src/revocation-scenarios` in the new test and in the
  generator. No undeclared package dependency was introduced.
- The fixture epoch authority inside `revocation-scenarios.ts` keeps that
  package dependency-free; the real adapter is exercised by the verifier test.
- No new npm dependency, no root config change, no manuscript edit.

## Test inventory

| File | Tests | What it proves |
|------|-------|----------------|
| `clb-core/test/epochs.test.ts` | 4 + 7 = 11 | deterministic construction, all five fields bound, H(C_t) nonce, malformed input rejection, all acceptance rules and accumulated violations |
| `verifier-core/test/revocation.test.ts` | 7 + 1 = 8 | R18 PASS/FAIL on revocation, fail-closed snapshot, stale read, expiry/replay, unchanged default path, adapter epoch state |
| `attack-core/test/revocation-scenarios.test.ts` | 9 | all adversarial scenarios, honest control, deterministic fixture, metrics computed from outcomes |
| `contracts/test/RevocationAwareGuard.t.sol` | 13 | golden vector parity, happy path, identity/mandate revocation, rotation, stale read, race, expiry, replay, unknown agent, authority-only, mismatch, gas probe |

`bun test` (full repo): **421 pass / 2 skip / 0 fail** after this change
(the pre-change suite was reported as 360 pass / 2 skip; concurrent agents
added other tests in the same window).
`bun run typecheck`: clean.
`forge test` (TEMP forge-std remap): **87 tests passed, 0 failed** across 9 suites.
