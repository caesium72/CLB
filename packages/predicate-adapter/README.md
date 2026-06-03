# @clb-acel/predicate-adapter

Predicate guard / caveat adapter for the delegated (Mode B) flow.

In Mode B the human signs a **spending predicate** π at authorization time; the
agent later chooses concrete settlement params `(asset, payTo, value, …)` within
π. This package enforces π at settlement time and recomputes the settlement-time
commitment `C' = keccak256(EIP712(identityRef, mandateDigest, predicateId, settlementParamsDigest))`,
checking `nonce == H(C')` before settlement is allowed.

## ⚠️ Demo substitute for ERC-7710

This is a **demo/mock caveat layer**, not a production smart-account delegation
implementation. ERC-7710 / ERC-4337 caveat enforcers are not stable enough for
v1 (see `DECISIONS.md`). The `PredicateGuardAdapter` interface is intentionally
small so a real ERC-7710 enforcer can replace it later without touching the
orchestrator or x402 settle path.

## Adapters

| Adapter                  | Use                                                                          |
| ------------------------ | ---------------------------------------------------------------------------- |
| `InMemoryPredicateGuard` | Default for CI / orchestrator — calls `evaluatePredicate` from `clb-core`.   |
| `ContractPredicateGuard` | Optional — cross-checks `PredicatePaymentGuard.sol` via an injected reader.  |

`createPredicateGuard()` picks the contract guard when `PREDICATE_GUARD_ADDRESS`
is set, otherwise the in-memory guard.

## Usage

```ts
import { createPredicateGuard } from "@clb-acel/predicate-adapter";

const guard = createPredicateGuard();
const { commitment, nonce } = await guard.assertSettlementAllowed({
  predicate,
  params,            // concrete SettlementParams chosen by the agent
  commitment: modeBSettlementInput,
  expectedNonce,     // payload nonce; rejected unless it equals H(C')
});
```

`assertSettlementAllowed` throws `PredicateViolationError` when π is violated and
`SettlementNonceMismatchError` when the payload nonce is not `H(C')`.
