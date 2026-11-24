# RCLB architecture — Revocation-Aware Temporal Cross-Layer Binding

## 1. What this novelty does

A plain CLB commitment `C` (or Mode-B `C'`) binds only the *content* of an
authorization (identity ref + AP2 mandate digest + settlement descriptor). As a
fixed hash it stays valid forever, so a holder can replay a signed message after
revocation, key rotation, or past its useful time and every layer-local check passes.
RCLB wraps a second, **short-lived** binding around `C` so settlement is bound to
the authority state current **at execution time**:

```
C_t = keccak256(abi.encode(C, E_I, E_M, T_expiry, N))

  C        = 32-byte base commitment (computeCommitment / computeModeBSettlementCommitment)
  E_I      = identity-authorization epoch at signing time
  E_M      = mandate-revocation epoch at signing time
  T_expiry = Unix seconds, INCLUSIVE upper bound on settlement time
  N        = 32-byte single-use application nonce (NOT the payment nonce)

payment nonce = keccak256(C_t)       // same H(commitment) rule as before
```

`abi.encode` is static, padded, big-endian — identical to `computePredicateDigest`
and `RevocationAwareGuard.sol`, so TS/Solidity digests are byte-equal. No new EIP-712
domain: `C`/`C'` already carries the CLB domain; a second would double-count it.

Acceptance predicate (`checkRevocationAwareAcceptance`, all conjunctive):

```
ACCEPT iff  C,N are 32-byte hex; E_I,E_M,T_expiry,now >= 0
         && currentIdentityEpoch != null && currentMandateEpoch != null
         && E_I == currentIdentityEpoch
         && E_M == currentMandateEpoch
         && now <= T_expiry
         && recomputed C_t == presented C_t     // case-insensitive
         && N not in consumedNonces
```

Violations: `REVOCATION_STATE_UNAVAILABLE`, `IDENTITY_EPOCH_STALE`, `MANDATE_EPOCH_STALE`,
`COMMITMENT_EXPIRED`, `NONCE_ALREADY_CONSUMED`, `COMMITMENT_MISMATCH`,
`MALFORMED_COMMITMENT_INPUT`. A failed authority read is never "no revocation" — it fails closed.

## 2. Where it fits in the existing pipeline

```
 ERC-8004 identity -> AP2 mandate -> CLB commitment -> x402 settlement -> verifier
 (agent key K1)       (human-signed)  (C or C')         (payment/H(C))     (R1-R17)
      |                    |               |                 |                |
      +-- EpochRegistry <--+               +-- C_t wrap <----+-- R18 gate <----+
          E_I / E_M           epochs.ts        fresh snapshot    RevocationAwareGuard
```

Additive modules (no existing rule body touched):

| Layer | Existing module | RCLB addition |
|---|---|---|
| Identity | `erc8004-adapter/src/index.ts` | `EpochRegistry`, `AuthorityEpochs`, `createInMemoryEpochRegistry()` with `currentEpochs`, `revokeIdentity`, `revokeMandate`, `rotateIdentityKey` |
| Commitment | `clb-core/src/index.ts` (`computeCommitment`, `computeModeBSettlementCommitment`) | NEW `clb-core/src/epochs.ts`, re-exported via `export * from "./epochs"` |
| Mandate | `ap2-adapter/src/index.ts` (`attachMandateSignature`) | unchanged; its `mandateDigest` feeds `C` then `C_t` |
| Settlement | `x402-adapter/src/index.ts` (facilitators, nonce store) | unchanged; payment nonce now `H(C_t)` |
| Verification | `verifier-core/src/index.ts` (`verifyTrace`, R1–R17) | `RevocationVerifierInput`, `revocationBinding?`, `R18_REVOCATION_AWARE_BINDING`, `verifyRevocationBinding()` |
| On-chain | `PredicatePaymentGuard.sol` (untouched) | NEW `RevocationAwareGuard.sol` (`validateAndConsume`) |
| Attack eval | `attack-core/src/` | NEW `revocation-scenarios.ts` (8 scenarios) |

Untouched: `PredicatePaymentGuard.sol`, `verifier-core/src/types.ts`, R1–R17
bodies, `modeBCommitmentInputOf`, root configs, manuscript files.

## 3. ASCII architecture diagram (Input → Processing → Output)

```
  INPUT                         PROCESSING (binding)                       AUTHORITY STATE
  ┌───────────────────┐  ┌───────────────────────┐  ┌──────────────────────────┐
  │ HUMAN / USER      │  │ AP2 mandate           │  │ ERC-8004 epoch registry  │
  │ signs mandate,    │─>│ ap2-adapter           │  │ EpochRegistry            │
  │ key K1            │  │ attachMandateSignature│  │ currentEpochs()          │
  └────────┬──────────┘  └──────────┬────────────┘  │ revokeIdentity()         │
           │ identityRef             │ mandateDigest  │ revokeMandate()          │
           │                         v                │ rotateIdentityKey()      │
           │            ┌────────────────────────┐    └────────────┬─────────────┘
           └───────────>│ clb-core C / C'        │<───────────────┘
                        │ computeCommitment()     │   E_I,E_M at signing time
                        │ computeModeBSettlement()│
                        └───────────┬────────────┘
                                    │ C (or C')
                    ┌───────────────v──────────────────────┐
                    │ clb-core/src/epochs.ts               │
                    │ computeRevocationAwareCommitment()   │
                    │ C_t = H(C,E_I,E_M,T_expiry,N)        │
                    │ deriveRevocationAwareNonce()=H(C_t)  │
                    └───────────────┬──────────────────────┘
                                    │ {C_t,E_I,E_M,T_expiry,N,H(C_t)}
   ┌────────────────────────────────v───────────────────────────────────────┐
   │ RACE GATE (t = now; trusted snapshot read at execution time)         │
   │  revoke/rotate since signing ──YES──> REJECT (N unconsumed)           │
   │  stale epoch | t>T_expiry | state unavailable -> atomic revert        │
   │  otherwise ──────────────────────────NO────> ACCEPT: consume N        │
   └───────┬──────────────────────────────────────┬─────────────────────────┘
           │ off-chain                            │ on-chain
           v                                      v
   ┌───────────────────────────────┐  ┌──────────────────────────────────┐
   │ verifier-core R18             │  │ RevocationAwareGuard.sol         │
   │ verifyRevocationBinding()     │  │ validateAndConsume()             │
   │ -> checkRevocationAware...()  │  │ onlyAuthority epoch mutations   │
   └──────────────┬────────────────┘  └───────────────┬──────────────────┘
                  │ R18 in certificate                │ revert or consumed[f.nonce]
                  v                                   v
   ┌───────────────────────────────┐  ┌──────────────────────────────────┐
   │ OUTPUT: audit certificate     │  │ OUTPUT: x402 settlement / Anvil  │
   │ failedRules += R18 on FAIL    │<─│ local EVM receipt, event log     │
   └───────────────────────────────┘  └──────────────────────────────────┘
```

## 4. Execution flow (exact functions, in order)

1. `createInMemoryEpochRegistry(seed, registry)` — seed `E_I`/`E_M` (epoch 0 valid);
   optional `Erc8004Registry` coupling makes `revokeIdentity` call `setStatus(agentId, "REVOKED")`.
2. `currentEpochs(agentId)` / `currentSigningKey(agentId)` — trusted signing-time
   snapshot; unknown agent returns `null` (fail closed).
3. `computeMandateDigest(mandate)` (AP2), then `computeCommitment(input)` or
   `computeModeBSettlementCommitment(input)` — produce base `C` / `C'`.
4. `computeRevocationAwareCommitment(fields)` — bind `C`, `E_I`, `E_M`, `T_expiry`, `N`.
5. `deriveRevocationAwareNonce(C_t)` — payment nonce `keccak256(C_t)`.
6. *(may interleave before 7)* `revokeIdentity(agentId)` / `revokeMandate(agentId)` /
   `rotateIdentityKey(agentId, newKey)` — advance `E_I`/`E_M`; on-chain: `onlyAuthority`.
7. At execution: fresh `currentEpochs(agentId)` → `checkRevocationAwareAcceptance(input)`
   with injected `now` — the race decision point.
8. Off-chain: `verifyTrace(bundle, options)` with `options.revocationBinding` →
   `verifyRevocationBinding(input)` → step 7 → R18 outcome, append
   `R18_REVOCATION_AWARE_BINDING` to `failedRules` and `certificate.rulesChecked`.
9. On success `consumeRevocationNonce(consumed, N)`; on-chain equivalent
   `validateAndConsume(agentId, f, commitment, paymentNonce)` → `currentEpochs` →
   `computeRevocationAwareCommitment` → `deriveRevocationAwareNonce` →
   `consumed[f.nonce] = true` → `RevocationAwareSettlementConsumed`.
   Rejection is atomic: never burns `N`.

## 5. Data flow — one piece of data (`E_I`)

```
 creation      createInMemoryEpochRegistry({ agentA: { identityEpoch: 1n, ... } })
   |           currentEpochs() = { identityEpoch: 1n, mandateEpoch: 1n }
   v
 binding       epochs.ts: fields.identityEpoch = 1n
   |           computeRevocationAwareCommitment(fields) -> C_t (E_I in digest)
   v
 transport     settlement message { C_t, E_I=1, E_M=1, T_expiry, N, H(C_t) }
   |           (attacker replays this unchanged message later)
   v
 check         fresh currentEpochs() -> { identityEpoch: 2n, ... }
   |           checkRevocationAwareAcceptance(): 1n != 2n -> IDENTITY_EPOCH_STALE
   v
 outcome       verifier R18 FAIL / guard revert; N unconsumed; failedRules += R18
```

`E_I` is never taken from the message under test, only from the trusted snapshot.
`STALE_REGISTRY_READ` shows a cached snapshot would accept while a fresh read rejects.

## 6. Integration points & boundaries

- **Opt-in:** R18 runs only when `revocationBinding` is passed to `verifyTrace`; omitting it leaves outcomes/certificate byte-for-byte unchanged. Id cast at `RuleId[]` boundary only (`types.ts` owned by other work).
- **Fail-closed:** missing/unknown epoch state, unparseable time, malformed inputs, expiry breach, digest mismatch or consumed nonce all reject; `initialized` separates epoch 0 from unknown state.
- **Race ordering:** epoch checks precede nonce consumption in both `checkRevocationAwareAcceptance` and `validateAndConsume`; a revocation landing between pre-check and settlement wins and consumes nothing.
- **NOT covered:** no CRL / revocation broadcast / distribution; one authority and one epoch pair (no distributed or consensus revocation); single configured on-chain authority + in-memory TS registry, no live ERC-8004 deployment; gas is local EVM/Anvil demo only; no priority claim.

## 7. Verification pointers

Raw: `experiments/novelty/rclb/{metrics.json,forge-rclb.log,generate-metrics.ts}`.
Env: Bun 1.4.5, forge 1.10.0, solc 0.8.28, Windows x64, forge-std in TEMP (not in repo).
From repository root (PATH includes `~/.bun/bin`, `~/.foundry/bin`):

```bash
bun test packages/clb-core/test/epochs.test.ts \
          packages/verifier-core/test/revocation.test.ts \
          packages/attack-core/test/revocation-scenarios.test.ts
bun run typecheck
bun test
git clone --depth 1 https://github.com/foundry-rs/forge-std.git "$TEMP/rclb-forge-std"
cd contracts
forge test --remappings "forge-std/=$TEMP/rclb-forge-std/src/" \
           --match-contract RevocationAwareGuardTest -vv
cd ..
bun run experiments/novelty/rclb/generate-metrics.ts
```

Measured numbers (`metrics.json`, generated 2026-11-24):

| Metric | Value |
|---|---|
| Scenarios / adversarial / prevented | 8 / 7 / **7** |
| Stale acceptance / false rejection | 0/1 = **0.00** / 0/1 = **0.00** |
| Race resistance | 1/1 = **1.00** |
| Revocation latency median/mean/p95/max (200 samples) | **0.0465 / 0.0615 / 0.0930 / 2.2033 ms** |
| Gas baseline / guard / overhead | **5,769 / 59,834 / 54,065** |

`evaluation.md` quotes a slightly earlier latency run (median 0.0456, mean 0.0672, p95 0.0892, max 2.3342 ms); `metrics.json` is the regenerated raw artifact. Latency excludes network/RPC/finality/CRL; gas delta includes cold account access, ABI decode and event.
Golden vector: `C = 0xb037baea…bc01c3`, `E_I=E_M=1`, `T_expiry=1800000000`, `N=0x11…11` → `C_t = 0x0762bd5e…04cd`, `nonce = 0x56850147…1a63`.
Tests: new bun files **28 pass / 0 fail** (83 expect calls); full `bun test` **421 pass / 2 skip / 0 fail** (69 files); typecheck clean; forge full suite **87 passed / 0 failed** (9 suites), guard suite **13 passed**.
