# Reviewer #4, Comment 3 — Prevention semantics of the "5 of 14" result

> **Comment:** "The 'prevented 5 of 14' result is overstated. Explain why Mode A payee or amount substitution cannot be rejected before settlement, since the commitment already binds them."

## 1. The claim under review

`Manuscript/main.tex` (lines 417–420, 423–438, 463) states:

- *"B3 detected every case and prevented five: the replay and all four delegated-predicate violations."*
- Table 1 row: `Prevented before settlement & 0 & 0 & 0 & 5 \\`
- Fig. 1 caption: *"B3 detects nine after settlement and prevents five before transfer."*

The 14 unsafe cases are 10 Mode A binding attacks + 4 Mode B predicate violations. The five B3 preventions are:

| # | Attack | Mode | Rejection mechanism in the evaluated pipeline |
|---|---|---|---|
| 1 | `MANDATE_REPLAY` | A | x402 facilitator `NonceAlreadyConsumedError` (nonce already spent) |
| 2 | `PREDICATE_PAYEE_VIOLATION` | B | Mode B predicate guard, before settlement |
| 3 | `PREDICATE_AMOUNT_VIOLATION` | B | Mode B predicate guard, before settlement |
| 4 | `PREDICATE_ASSET_VIOLATION` | B | Mode B predicate guard, before settlement |
| 5 | `PREDICATE_EXPIRED` | B | Mode B predicate guard, before settlement |

The other nine (the remaining Mode A attacks, including payee substitution and amount escalation) are **detected after settlement** by the deterministic verifier — chiefly `R12_PAYEE_MATCHES_CHECKOUT_OR_TASK` and `R11_AMOUNT_WITHIN_MANDATE`.

## 2. Why the original "5" was accurate — and what it actually measured

The reviewer is right that the commitment already binds payee and amount. Nothing in the cryptography prevents an earlier rejection. The limit was the **placement of verification**, not the binding:

```
Original Mode A flow (as evaluated in the paper)
  human signs C over approved descriptor
        |
        v
  x402 facilitator.settle()  -->  RECEIPT EXISTS
        |
        v
  verifyTrace(bundle)        -->  R2/R5/R6/R7/R8/R11/R12 flag the substitution
                                  (DETECTION — value has already moved)
```

`buildValidBundle` (`packages/attack-core/src/fixtures.ts:121-188`) builds the mandate, commitment, nonce, signed authorization **and then calls `facilitator.settle()`**. `verifyTrace` (`packages/verifier-core/src/index.ts:558`) runs only afterwards on the completed bundle. A verifier can fail a rule; it cannot un-issue a receipt. Therefore the five-case count is a faithful description of the code that was actually run: one Mode A nonce rejection plus four Mode B guard rejections.

The original `presettlement.ts` had a genuine pre-settlement path **only for Mode B** (it asks the predicate guard before calling the facilitator). Its single Mode A rejection was a side effect of the facilitator's single-use nonce store. There was no Mode A gate that checked the payment authorization against the human-signed descriptor before settlement.

**Honesty note:** the paper's original experiment did *not* include the Mode A gate described below. The "5" should not be retroactively re-labelled as "7".

## 3. Why the commitment is already strong enough for a pre-settlement gate

Mode A binds the layers as follows (`packages/clb-core/src/index.ts:103-111`, `packages/x402-adapter/src/index.ts:84-117`):

```
C = EIP-712(domain, IdentityRef, mandateDigest, settlementDigest)
settlementDigest = keccak256(canonicalJson(descriptor))
descriptor = { chainId, network, asset, payTo, value, validBefore, x402Scheme }
nonce      = H(C)
signature  = EIP-712 over (from, to, value, asset, validBefore, nonce, network, chainId)
```

The human signs `C` with EIP-712 (`issueMandate`, `signCommitment`). Because `payTo` and `value` are inside `settlementDigest`, a substituted payee or escalated amount necessarily changes `C`. Concretely, substituting either field produces three independent failures:

1. **Commitment mismatch** — recomputed `C` differs from the human-signed `mandate.clbCommitment` → `CLB_COMMITMENT_MISMATCH` and `MANDATE_SIGNATURE_INVALID` from `verifyMandate` with an independently anchored principal.
2. **Nonce mismatch** — the authorization still carries the nonce derived from the *approved* `C`, but `H(C)` of the substituted fields is different → `NONCE_NOT_H_OF_RECOMPUTED_C`.
3. **Payment-signature mismatch** — the attacker cannot re-sign as the payer, so `verifyPaymentPayload` rejects the mutated authorization → `PAYMENT_SIGNATURE_INVALID`.

This was verified directly in `packages/attack-core/test/mode-a-presettlement.test.ts` ("C cryptographically binds payee and amount..."): both substituted descriptors produce different `C` and nonce, fail `verifyMandate` against the honest anchor, and fail `verifyPaymentPayload`; the untouched descriptor passes all three.

## 4. What was added

`packages/attack-core/src/presettlement.ts` now contains a genuine Mode A pre-settlement gate that runs **before** `facilitator.settle()`:

```
submitted authorization
        |
        v
derive descriptor from authorization (to / value / asset / chain)
        |
        +--> recompute C and nonce = H(C)
        +--> verifyMandate(human-signed C, anchored principal)   [not mandate.humanPrincipal]
        +--> verifyPaymentPayload(payer signature)
        |
        v
gate allows  --> settle ; gate rejects --> NO settle call, no receipt
```

New scenario IDs (the nine existing Mode B scenarios and their behaviour are untouched):

- `MODE_A_PAYEE_SUBSTITUTION`
- `MODE_A_AMOUNT_ESCALATION`
- `MODE_A_HONEST_AUTHORIZATION` (positive control)

New entry points: `runModeAPreSettlementScenarios()` and `runPreSettlementScenarios({ includeModeA: true })`. The no-argument `runPreSettlementScenarios()` deliberately still returns the original nine Mode B results so existing artifacts and callers are unaffected. `classifyOutcome()` makes the PREVENTION/DETECTION distinction explicit: a prevented attempt has no receipt; a detected attempt has one.

## 5. Measured results

`bun test packages/attack-core/test/mode-a-presettlement.test.ts` → **7 pass / 0 fail / 83 assertions**.

| Scenario | Gate | Settlement attempted | Receipt | Classification |
|---|---|---|---|---|
| `MODE_A_PAYEE_SUBSTITUTION` | rejected (4 reasons above) | no | no | **PREVENTION** |
| `MODE_A_AMOUNT_ESCALATION` | rejected (4 reasons above) | no | no | **PREVENTION** |
| `MODE_A_HONEST_AUTHORIZATION` | allowed | yes | yes | honest control (settles) |
| `MULTI_STEP_ESCALATION_THEN_REPLAY` (legacy) | allowed, facilitator rejects replay | yes (first) / no (replay) | no (replay) | **PREVENTION** |

`bun test` → **360 pass / 2 skip / 0 fail** (1999 assertions). `bun run typecheck` → clean.

## 6. Corrected, defensible formulation

Use this wording in the manuscript (full paste-ready LaTeX is in `manuscript-insert.md`):

> **Five of the 14 unsafe cases were prevented before settlement in the evaluated pipeline** — the Mode A nonce replay and all four Mode B predicate violations — while the remaining nine were detected after settlement because the trace was verified only after the facilitator had issued a receipt. This is an artifact of where verification was placed, not a weakness of the commitment: in Mode A, C is an EIP-712 commitment over `settlementDigest`, which includes payee and amount, so neither field can be substituted under the human's signature. **We additionally implemented a pre-settlement Mode A authorization gate** that derives the descriptor from the submitted authorization, recomputes C and nonce = H(C), verifies the human signature against an independently anchored principal, and verifies the x402 payment signature before the facilitator is called. With this gate, Mode A payee substitution and amount escalation are both rejected with no settlement receipt, **raising pre-settlement prevention from 5 of 14 in the evaluated pipeline to 7 of 14 in the gated configuration**; the remaining seven Mode A attacks stay post-settlement detections.

Recommended table/caption update (labelled as two configurations, never implying the original experiment had the gate):

| Outcome (B3) | Evaluated pipeline | With pre-settlement authorization gate |
|---|---|---|
| Detected after settlement | 9 | 7 |
| Prevented before settlement | 5 | 7 |

If the paper reports the gated configuration as its headline result, Table 1 and Fig. 1 must be regenerated from the gated runner and the experimental setup must say the gate is present. Otherwise keep the existing 5/14 table and present the gate as an additional experiment, as worded above.

## 7. Scope and limits

- The gate is implemented and evaluated in the local in-process harness (`packages/attack-core`); it is not part of the original 14-case artifacts, nor is it deployed in the HTTP/on-chain facilitator. The "7 of 14" figure composes the original five with two newly demonstrated Mode A preventions; it is **not** a fresh end-to-end run of all 14 cases through the gated pipeline.
- No assertions were weakened; no existing scenario ID or behaviour changed; the manuscript file itself was not edited by this change.
