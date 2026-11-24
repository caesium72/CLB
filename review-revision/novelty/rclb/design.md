# RCLB design — Revocation-Aware Temporal Cross-Layer Binding

## Problem

A CLB commitment `C` (or Mode-B `C'`) is a binding over authorization *content*:
`keccak256(EIP712(identityRef, mandateDigest, settlementDescriptor))`. Once
signed, it stays cryptographically valid forever. Nothing in that digest changes
when an identity key is revoked, a mandate is revoked, or a stale message is
delivered late. A party holding a valid signed message can therefore settle
against authority that no longer exists.

```
 AUTHORIZATION TIME                         EXECUTION TIME
 ┌──────────────────────┐                  ┌──────────────────────────┐
 │ human signs C        │                  │ authority state NOW:     │
 │ E_I=1, E_M=1         │  ---- message -->│ E_I=2 (revoked/rotated)  │
 │ C stays valid        │                  │ E_M=1                    │
 └──────────────────────┘                  └──────────────────────────┘
   legacy CLB: PASS (wrong)                  RCLB: FAIL (E_I stale)
```

RCLB makes the binding **temporal**: it re-binds `C` to the current authority
epochs and an expiry at execution time.

## Exact construction

```
C_t = keccak256(abi.encode(
        bytes32 C,          // base commitment from existing clb-core
        uint256 E_I,        // identity-authorization epoch at signing time
        uint256 E_M,        // mandate-revocation epoch at signing time
        uint64  T_expiry,   // Unix seconds, INCLUSIVE
        bytes32 N           // single-use application nonce
      ))
payment_nonce = keccak256(C_t)
```

`abi.encode` is the static, padded big-endian encoding already used by
`computePredicateDigest` in `clb-core`; the Solidity guard uses the identical
`keccak256(abi.encode(...))`, so off-chain and on-chain digests are byte-equal.
No new EIP-712 domain is added: `C`/`C'` already carries the CLB domain, so a
second domain would double-count it.

Acceptance (all conjunctive):

```
E_I == current_E_I
E_M == current_E_M
t <= T_expiry
N not consumed
recomputed C_t == presented C_t
```

A failed authority read (`current_E_I`/`current_E_M` unavailable) is **not**
treated as "no revocation": the guard fails closed.

## State machine

```
                 revokeIdentity / rotateIdentityKey
                            │ E_I += 1
   ┌──────────────────────┐  ▼   ┌──────────────────────┐
   │ current {E_I=1,E_M=1}│ ----> │ current {E_I=2,E_M=1}│
   │ C_t(E_I=1) accepts   │       │ C_t(E_I=1) REJECTS   │
   └──────────────────────┘       └──────────────────────┘
                 revokeMandate
                            │ E_M += 1
   ┌──────────────────────┐  ▼   ┌──────────────────────┐
   │ current {E_I=1,E_M=1}│ ----> │ current {E_I=1,E_M=2}│
   │ C_t(E_M=1) accepts   │       │ C_t(E_M=1) REJECTS   │
   └──────────────────────┘       └──────────────────────┘
```

## Race ordering

The epoch checks run **before** nonce consumption. If revocation lands between
a pre-check and the settlement call, the settlement reverts atomically and
`N` stays unconsumed — a later correctly re-bound commitment can still settle.
Rejection must never burn the nonce (mirrors the FAILED_Settle_ModeB / P7 idea
in `formal/tamarin/clb-aligned.spthy`: a reverted attempt returns the linear
nonce fact).

## Trust boundary

- The CURRENT epoch snapshot must come from a trusted authority (ERC-8004
  adapter registry / on-chain guard), never from the message under test.
- The verifier option accepts an explicit `current` snapshot precisely so the
  caller must supply it; when absent, R18 fails closed.
- The Solidity authority address is configured in the constructor and all
  epoch mutations are restricted to it.

## Properties claimed (implementation-level, not literature novelty)

| ID | Property | Enforced by |
|----|----------|-------------|
| P8a | current identity epoch | `checkRevocationAwareAcceptance` / guard `IdentityEpochStale` |
| P8b | current mandate epoch | same / `MandateEpochStale` |
| P8c | bounded validity window | `t <= T_expiry` / `CommitmentExpired` |
| P8d | single-use application nonce | `N` consumed / `NonceAlreadyConsumed` |
| P8e | fail closed on unavailable state | `REVOCATION_STATE_UNAVAILABLE` / `AuthorityStateUnavailable` |
| P8f | no stale acceptance on race | revocation checks precede consumption (atomic revert) |

## Deliberate non-goals

- No revocation *broadcast* protocol, no CRL distribution, no consensus design.
- No claim of priority over prior work; this is an implemented mechanism in
  this repository, evaluated locally.
- No weakening of existing rules R1–R17; R18 is opt-in and additive.
- No nonstationary / continuous-time analysis; epochs are discrete counters.
