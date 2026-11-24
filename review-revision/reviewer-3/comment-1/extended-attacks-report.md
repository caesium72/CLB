# Reviewer 3 / Comment 1 — Extended attack scenarios and outcome classification

Scope: R3-C1 items 10–14. Items 1–9 and 26–29 (R3-C5) were not touched.
No production source, existing test, manuscript, `package.json`, reproduce script,
or reproducibility document was modified. All classification logic lives inline
in the new test file.

## Method

Every attack case starts from a real valid bundle (`buildValidBundle` for Mode A,
`buildValidModeBBundle` / `draftModeBPayment` for Mode B), applies one attack
mutation, and then runs the **real** `verifyTrace`, predicate guard and/or local
x402 facilitator. Each attack has a paired positive test proving the unmodified
valid bundle passes all rules (`failedRules === []`).

Classification is explicit and layered — detection is **never** reported as
prevention:

- **PREVENTION** — a guard or facilitator rejected the attempt before any receipt existed.
- **DETECTION** — a rule/audit flagged an already-issued settlement receipt (post-settlement).
- **ACCOUNTABILITY** — the verifier certificate binds `traceId`, settlement tx hash and
  evidence Merkle root, and the trace carries real mandate/payment signatures.
- **EXPLOITED** — the attacker reached its objective without any evaluated control rejecting or flagging it.
- **NOT_APPLICABLE** — clean happy path; no incident to classify.

## Attack → fixture/test mapping

| Reviewer attack name | Existing fixture or new test | Outcome classification | Rule / guard that catches it | Positive counterpart |
|---|---|---|---|---|
| Mandate modification | **New** `extended-attacks.test.ts` › "1. mandate modification › ATTACK: mandate edited after the human signed it". Partial predecessors: `CART_OR_TASK_SWITCH` (taskHash constraint), `MANDATE_REPLAY`. | DETECTION + ACCOUNTABILITY (post-settlement) | `R5_MANDATE_SIGNATURE_VALID`, `R6_CLB_COMMITMENT_RECOMPUTES`, `R8_PAYMENT_NONCE_EQUALS_HASH_C`, also `R2_SIGNATURES_VALID` | "POSITIVE: unmodified mandate passes" (all rules PASS) |
| Unauthorized predicate registration | **New — GAP** "2 & 3 › GAP — EXPLOITED: unauthorised predicate CONTENT under the human-signed predicateId". Related existing: `MODE_B_PREDICATE_FIXTURES` / `PREDICATE_*` (they use a trusted caller-supplied predicate). | **EXPLOITED** | **None.** C′ binds only `predicateId` + settlement params; R17 evaluates the untrusted predicate content. Human predicate rejects the same 9.99 payment (guard + `R17_PREDICATE_TRUE_FOR_MODE_B`), proving the objective was achieved by substitution. | "POSITIVE: honest predicate + in-limit settlement passes" |
| Predicate substitution | **New** "2 & 3 › ATTACK: predicate ID substitution (swap the reference after signing)". Content-substitution variant is the GAP row above. Existing relatives: `PREDICATE_PAYEE_VIOLATION`, `PREDICATE_EXPIRED`, etc. | DETECTION + ACCOUNTABILITY (ID swap) / **EXPLOITED** (content swap) | ID swap: `R6_CLB_COMMITMENT_RECOMPUTES`, `R8_PAYMENT_NONCE_EQUALS_HASH_C`. Content swap: no rule. | "POSITIVE: honest predicate + in-limit settlement passes" |
| Expired authorization | **Existing** `EXPIRED_AUTHORIZATION` (`presettlement.ts`) and `PREDICATE_EXPIRED` (`mode-b.ts`); new test exercises the same guard/rules through the draft-before-settlement path. | PREVENTION + DETECTION + ACCOUNTABILITY | `InMemoryPredicateGuard` → `PredicateViolationError` (`PREDICATE_EXPIRED`) before settlement; forced trace fails `R17_PREDICATE_TRUE_FOR_MODE_B` | "POSITIVE: in-window authorization is allowed and settles" |
| Cross-chain replay | **Existing** `CHAIN_TRANSPLANT` + `MANDATE_REPLAY`; new test adds an actual replay on a second facilitator's nonce store. | **EXPLOITED** (payment layer) + DETECTION + ACCOUNTABILITY (trace layer) | Trace: `R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR`, `R10_CHAIN_DOMAIN_MATCHES`. Second facilitator: **no control** — identical payload settles again. | "POSITIVE: distinct nonces settle independently and verify" |
| Nonce reuse | **Existing** `MANDATE_REPLAY` (`NonceAlreadyConsumedError` + `R9`). New test pairs the facilitator rejection with verifier evidence. | PREVENTION + DETECTION + ACCOUNTABILITY | Local x402 facilitator `NonceAlreadyConsumedError`; `R9_NONCE_CONSUMED_EXACTLY_ONCE` | "POSITIVE: a fresh nonce settles once" |
| Amount representation inconsistency | **New** "7 › ATTACK: value rewritten in atomic base-unit representation" and "ATTACK: harmless-looking decimal drift (2.00 → 2.0)". Related existing: `AMOUNT_ESCALATION` (different attack — over-limit, not representation). | DETECTION + ACCOUNTABILITY | Atomic: `R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR` + `R11_AMOUNT_WITHIN_MANDATE`. Decimal drift: `R7` only. | "POSITIVE: canonical decimal representation passes" |
| Settlement descriptor modification | **New** "8 › ATTACK: descriptor payee swapped after the mandate was signed". | DETECTION + ACCOUNTABILITY | `R2_SIGNATURES_VALID`, `R5_MANDATE_SIGNATURE_VALID`, `R6_CLB_COMMITMENT_RECOMPUTES`, `R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR`, `R8_PAYMENT_NONCE_EQUALS_HASH_C` | "POSITIVE: untouched descriptor passes" |
| Evidence tampering | **New** "9 › ATTACK: edit an evidence event without rebuilding the chain". Related existing: `FAKE_FEEDBACK` (appends an event, does not rewrite the chain). | DETECTION + ACCOUNTABILITY | `R1_HASH_CHAIN_INTACT` (broken hash chain / Merkle root mismatch) | "POSITIVE: intact hash chain and Merkle root pass" |
| Delivery evidence substitution | **New** "10 › ATTACK: substitute a delivery binding signed for another settlement". Related existing: `PAYMENT_WITHOUT_DELIVERY` (report hash tamper detected by R2). | DETECTION + ACCOUNTABILITY | `R14b_DELIVERY_BOUND_TO_SETTLEMENT` (binding is for a different `settlementTxHash`; `R2_SIGNATURES_VALID` correctly still passes) | "POSITIVE: binding matches this settlement tx hash" |

## Genuine gaps found (attacks that achieve their objective without detection)

1. **Mandate re-sign / missing human trust anchor — EXPLOITED.**
   `verifyTrace` calls `verifyMandate` without an `expectedSigner`, so the verifier
   trusts the self-declared `mandate.humanPrincipal`. An attacker can relax the
   mandate constraint, re-sign with their own key as `humanPrincipal`, recompute
   C / nonce / receipt / delivery binding, and obtain a trace where **all rules
   PASS**. The test "GAP — EXPLOITED: attacker re-signs a relaxed mandate as a new
   human principal" asserts `failedRules === []` rather than hiding the result.
   Fix direction: bind `humanPrincipal` to a trusted registry/allowlist and pass
   it as `expectedSigner` into verification.

2. **Predicate content substitution — EXPLOITED.**
   C′ commits to `predicateId` and settlement params, **not** the predicate body;
   the human-signed INTENT mandate stores only `constraints.predicateRef.predicateId`.
   Replacing the predicate content with a permissive one under the same ID passes
   both the guard and R17/R11/R12/R13 — a 9.99 payment settles under a 5.00 cap
   that the human actually signed. Fix direction: commit to `keccak256(predicate)`
   in C′ (and in the mandate digest) or load the predicate from a trusted registry
   keyed by `predicateId`.

3. **Cross-chain replay at the facilitator layer — EXPLOITED at that layer.**
   A fresh local facilitator (standing in for another chain's facilitator) accepts
   the identical signed payload because nonces are tracked per facilitator store,
   with no cross-chain/global coordination. The trace verifier detects the chain
   transplant (R7/R10) but cannot prevent a real second-chain settlement.
   Fix direction: a shared/chain-namespaced nonce registry plus chain-bound nonce
   derivation enforced at the facilitator, not only in post-hoc trace verification.

These are recorded, not softened: the three GAP tests assert the absence of
detection (`EXPLOITED`) and the report states the security implication explicitly.

## Exact results

```
bun test packages/attack-core/test/extended-attacks.test.ts
 21 pass
 0 fail
 99 expect() calls
 Ran 21 tests across 1 file.

bun run typecheck
 $ tsc --build
 (exit 0)
```

Tests: 12 attack/gap cases + 9 positive happy-path cases (two GAP cases also
contain an inline honest-bundle check). No assertions were weakened to obtain a
pass.

## Files created

- `packages/attack-core/test/extended-attacks.test.ts` — 21 tests, inline
  classification helpers, no production source changes.
- `review-revision/reviewer-3/comment-1/extended-attacks-report.md` — this report.
