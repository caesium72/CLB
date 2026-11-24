# Baseline Fairness Report — R3-C5

**Repo:** `E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2`
**Investigation type:** Read-only baseline fairness & outcome-classification audit
**Baselines:** B0 = vanilla-x402, B1 = ap2-x402, B2 = ebay-monitor, B3 = full CLB-ACEL
**Harness:** `scripts/e2e-phase7-baselines.ts` → `experiments/benchmarks/baseline-comparison.json` / `.md`
**BaselineId taxonomy (schemas):** `["B0","B1","B2","B3"]`
**Outcome taxonomy required:** PREVENTED / DETECTED / EXPLOITED / PARTIALLY_MITIGATED / NOT_APPLICABLE / ERROR / SKIPPED

---

## Attack cases coverage matrix

| Attack ID | Case name | B0 applicable? | B1 applicable? | B2 applicable? | B3 applicable? | Shared fixture? | Outcome classification source |
|---|---|---|---|---|---|---|---|
| PAYEE_SUBSTITUTION | Settlement payee swapped to attacker address | Yes | Yes | Yes | Yes | Yes | runBaselineMatrix / liveBaselineOutcomes (actual run) |
| AMOUNT_ESCALATION | Settlement amount exceeds mandate maxAmount | Yes | Yes | Yes | Yes | Yes | runBaselineMatrix / liveBaselineOutcomes (actual run) |
| ASSET_SWITCH | Settlement asset changed from allowed USDC | Yes | Yes | Yes | Yes | Yes | runBaselineMatrix / liveBaselineOutcomes (actual run) |
| CHAIN_TRANSPLANT | Settlement transplanted to wrong chain domain | Yes | Yes | Yes | Yes | Yes | runBaselineMatrix / liveBaselineOutcomes (actual run) |
| AGENT_IDENTITY_SWAP | Payer payment key not authorized by agent card | Yes | Yes | Yes | Yes | Yes | runBaselineMatrix / liveBaselineOutcomes (actual run) |
| MANDATE_REPLAY | Same CLB-derived nonce submitted twice | Yes | Yes | Yes | Yes | Yes | runBaselineMatrix / liveBaselineOutcomes (actual run) |
| CART_OR_TASK_SWITCH | Mandate taskHash vs report inputDataHash diverge | Yes | Yes | Yes | Yes | Yes | runBaselineMatrix / liveBaselineOutcomes (actual run) |
| PAYMENT_WITHOUT_DELIVERY | Delivery proof invalid after settlement | Yes | Yes | Yes | Yes | Yes | runBaselineMatrix / liveBaselineOutcomes (actual run) |
| FAKE_FEEDBACK | ERC-8004 feedback without verifier certificate | Yes | Yes | Yes | Yes | Yes | runBaselineMatrix / liveBaselineOutcomes (actual run) |
| PROMPT_INJECTION_SELECTION | Discovery steered to unauthorized merchant | Yes | Yes | Yes | Yes | Yes | runBaselineMatrix / liveBaselineOutcomes (actual run) |
| PREDICATE_HAPPY_PATH | Agent stays within limits (no attack) | Yes | Yes | Yes | Yes | Yes | buildP5Matrix / liveBaselineOutcomes (actual run) |
| PREDICATE_PAYEE_VIOLATION | Pay an unapproved merchant | Yes | Yes | Yes | Yes | Yes | buildP5Matrix / liveBaselineOutcomes (actual run) |
| PREDICATE_AMOUNT_VIOLATION | Spend above limit | Yes | Yes | Yes | Yes | Yes | buildP5Matrix / liveBaselineOutcomes (actual run) |
| PREDICATE_ASSET_VIOLATION | Pay with wrong token | Yes | Yes | Yes | Yes | Yes | buildP5Matrix / liveBaselineOutcomes (actual run) |
| PREDICATE_EXPIRED | Settle after deadline | Yes | Yes | Yes | Yes | Yes | buildP5Matrix / liveBaselineOutcomes (actual run) |

Notes:
- Mode A fixtures (10): `ATTACK_FIXTURES` in `packages/attack-core/src/index.ts`; attacked bundle built once via `buildValidBundle` + `fixture.mutate`, then all baselines run on the identical object.
- Mode B fixtures (5): `MODE_B_PREDICATE_FIXTURES` in `packages/attack-core/src/mode-b.ts`; one bundle from `fixture.build()` shared across all baselines.
- "Applicable?" = Yes for every cell: no baseline returns NOT_APPLICABLE; every baseline is invoked on every attack and returns a verdict. Conceptually out-of-scope dimensions are recorded as ACCEPT/EXPLOITED rather than NOT_APPLICABLE (see Findings F2).

---

## Per-baseline input equivalence review

| Baseline | Receives same attacked bundle? | Separate input construction? | Documented differences? |
|---|---|---|---|
| B0 vanilla-x402 | Yes — identical `TraceBundle` from `fixture.mutate` / `fixture.build()` | No | None; docs in `vanilla-x402.ts` header are accurate (well-formedness only, no cross-layer rules). |
| B1 ap2-x402 | Yes — same bundle as B0/B2 | No | Documented in `ap2-x402.ts` header: no CLB C-recompute, no identity authorization (R4) detection. |
| B2 ebay-monitor | Yes — same bundle as B0/B1 | No | Documented in `ebay-monitor.ts` header: consume-once + context binding only; explicitly lists missed dimensions (chain, identity, amount, asset, task hash, delivery, x402 sig). |
| B3 CLB-ACEL | Yes — same bundle (via `b3` outcome supplied by caller) | No | Full stack; reference, not a weaker baseline. |

**Input source:** All baselines receive the *same* `TraceBundle` object — inputs are **shared from canonical fixtures**, not hand-constructed per-baseline. No per-baseline input construction was found.

**Execution sequence:** In `runAttack` (`index.ts`) and `runPredicateAttack` (`mode-b.ts`), `liveBaselineOutcomes(bundle, b3)` is called once with the single attacked bundle; it invokes `bVanillaX402`, `bAp2X402`, `bEbayMonitor` on that same object. All baselines see identical initial state, payment/task parameters, and environment configuration.

---

## Outcome classification audit

Code model (not the 7-category taxonomy): `BaselineOutcome = { detected: boolean, prevented: boolean, note: string }`. Mapping used for this report:

| Code state | Mapped category | Meaning |
|---|---|---|
| `accepted` (verdict) → `{detected:false, prevented:false}` | EXPLOITED | Baseline missed; attack would succeed against this stack. |
| `rejected` → `{detected:true, prevented:false}` | DETECTED | Baseline identified the attack but cannot prevent in-protocol (verifier only). |
| `prevented:true` | PREVENTED | Blocked before transfer (B3 only: x402 replay, Mode B predicate guard). |
| `detected:true, prevented:true` | PREVENTED | Prevented (and detected). |
| PARTIALLY_MITIGATED / NOT_APPLICABLE / ERROR / SKIPPED | never emitted | Not represented in code (see F1). |

| Attack | Baseline | Code verdict | Category | Traceable to run? | Detection confused with prevention? |
|---|---|---|---|---|---|
| PAYEE_SUBSTITUTION | B0 | ACCEPT | EXPLOITED | Yes (live run) | No |
| PAYEE_SUBSTITUTION | B1 | REJECT | DETECTED | Yes | No |
| PAYEE_SUBSTITUTION | B2 | REJECT | DETECTED | Yes | No |
| PAYEE_SUBSTITUTION | B3 | REJECT | DETECTED | Yes | No |
| AMOUNT_ESCALATION | B0 | ACCEPT | EXPLOITED | Yes | No |
| AMOUNT_ESCALATION | B1 | REJECT | DETECTED | Yes | No |
| AMOUNT_ESCALATION | B2 | ACCEPT | EXPLOITED | Yes | No |
| AMOUNT_ESCALATION | B3 | REJECT | DETECTED | Yes | No |
| ASSET_SWITCH | B0 | ACCEPT | EXPLOITED | Yes | No |
| ASSET_SWITCH | B1 | REJECT | DETECTED | Yes | No |
| ASSET_SWITCH | B2 | ACCEPT | EXPLOITED | Yes | No |
| ASSET_SWITCH | B3 | REJECT | DETECTED | Yes | No |
| CHAIN_TRANSPLANT | B0 | ACCEPT | EXPLOITED | Yes | No |
| CHAIN_TRANSPLANT | B1 | ACCEPT | EXPLOITED | Yes | No |
| CHAIN_TRANSPLANT | B2 | ACCEPT | EXPLOITED | Yes | No |
| CHAIN_TRANSPLANT | B3 | REJECT | DETECTED | Yes | No |
| AGENT_IDENTITY_SWAP | B0 | ACCEPT | EXPLOITED | Yes | No |
| AGENT_IDENTITY_SWAP | B1 | ACCEPT | EXPLOITED | Yes | No |
| AGENT_IDENTITY_SWAP | B2 | ACCEPT | EXPLOITED | Yes | No |
| AGENT_IDENTITY_SWAP | B3 | REJECT | DETECTED | Yes | No |
| MANDATE_REPLAY | B0 | ACCEPT | EXPLOITED | Yes | No |
| MANDATE_REPLAY | B1 | ACCEPT | EXPLOITED | Yes | No |
| MANDATE_REPLAY | B2 | REJECT | DETECTED | Yes | No |
| MANDATE_REPLAY | B3 | REJECT + prevented | PREVENTED | Yes | No |
| CART_OR_TASK_SWITCH | B0 | ACCEPT | EXPLOITED | Yes | No |
| CART_OR_TASK_SWITCH | B1 | ACCEPT | EXPLOITED | Yes | No |
| CART_OR_TASK_SWITCH | B2 | ACCEPT | EXPLOITED | Yes | No |
| CART_OR_TASK_SWITCH | B3 | REJECT | DETECTED | Yes | No |
| PAYMENT_WITHOUT_DELIVERY | B0 | ACCEPT | EXPLOITED | Yes | No |
| PAYMENT_WITHOUT_DELIVERY | B1 | ACCEPT | EXPLOITED | Yes | No |
| PAYMENT_WITHOUT_DELIVERY | B2 | ACCEPT | EXPLOITED | Yes | No |
| PAYMENT_WITHOUT_DELIVERY | B3 | REJECT | DETECTED | Yes | No |
| FAKE_FEEDBACK | B0 | ACCEPT | EXPLOITED | Yes | No |
| FAKE_FEEDBACK | B1 | ACCEPT | EXPLOITED | Yes | No |
| FAKE_FEEDBACK | B2 | ACCEPT | EXPLOITED | Yes | No |
| FAKE_FEEDBACK | B3 | REJECT | DETECTED | Yes | No |
| PROMPT_INJECTION_SELECTION | B0 | ACCEPT | EXPLOITED | Yes | No |
| PROMPT_INJECTION_SELECTION | B1 | ACCEPT | EXPLOITED | Yes | No |
| PROMPT_INJECTION_SELECTION | B2 | ACCEPT | EXPLOITED | Yes | No |
| PROMPT_INJECTION_SELECTION | B3 | REJECT | DETECTED | Yes | No |
| PREDICATE_HAPPY_PATH | B0–B2 | ACCEPT | N/A (happy path, no attack) | Yes | No |
| PREDICATE_HAPPY_PATH | B3 | ACCEPT | N/A (happy path, no attack) | Yes | No |
| PREDICATE_PAYEE_VIOLATION | B0 | ACCEPT | EXPLOITED | Yes | No |
| PREDICATE_PAYEE_VIOLATION | B1 | REJECT | DETECTED | Yes | No |
| PREDICATE_PAYEE_VIOLATION | B2 | REJECT | DETECTED | Yes | No |
| PREDICATE_PAYEE_VIOLATION | B3 | REJECT + prevented | PREVENTED | Yes | No |
| PREDICATE_AMOUNT_VIOLATION | B0 | ACCEPT | EXPLOITED | Yes | No |
| PREDICATE_AMOUNT_VIOLATION | B1 | REJECT | DETECTED | Yes | No |
| PREDICATE_AMOUNT_VIOLATION | B2 | ACCEPT | EXPLOITED | Yes | No |
| PREDICATE_AMOUNT_VIOLATION | B3 | REJECT + prevented | PREVENTED | Yes | No |
| PREDICATE_ASSET_VIOLATION | B0 | ACCEPT | EXPLOITED | Yes | No |
| PREDICATE_ASSET_VIOLATION | B1 | REJECT | DETECTED | Yes | No |
| PREDICATE_ASSET_VIOLATION | B2 | ACCEPT | EXPLOITED | Yes | No |
| PREDICATE_ASSET_VIOLATION | B3 | REJECT + prevented | PREVENTED | Yes | No |
| PREDICATE_EXPIRED | B0 | ACCEPT | EXPLOITED | Yes | No |
| PREDICATE_EXPIRED | B1 | ACCEPT | EXPLOITED | Yes | No |
| PREDICATE_EXPIRED | B2 | REJECT | DETECTED | Yes | No |
| PREDICATE_EXPIRED | B3 | REJECT + prevented | PREVENTED | Yes | No |

**Detection not collapsed into prevention:** Confirmed. `verdictToOutcome` (`baselines.ts:15-19`) maps REJECT → `{detected:true, prevented:false}` and ACCEPT → `{detected:false, prevented:false}`. For B0–B2, `prevented` is always `false` (they are off-chain verifiers, not enforcers). Detection and prevention are independent booleans; no cell conflates the two.

---

## Classification of every cell (full matrix with classification source)

Source key: `RUN` = live baseline verifier execution (`liveBaselineOutcomes` → `bVanillaX402`/`bAp2X402`/`bEbayMonitor`); `B3` = live CLB-ACEL verifier/guard result supplied by caller.

| Attack (Mode) | B0 | B1 | B2 | B3 | Classification source |
|---|---|---|---|---|---|
| PAYEE_SUBSTITUTION (A) | EXPLOITED | DETECTED | DETECTED | DETECTED | RUN |
| AMOUNT_ESCALATION (A) | EXPLOITED | DETECTED | EXPLOITED | DETECTED | RUN |
| ASSET_SWITCH (A) | EXPLOITED | DETECTED | EXPLOITED | DETECTED | RUN |
| CHAIN_TRANSPLANT (A) | EXPLOITED | EXPLOITED | EXPLOITED | DETECTED | RUN |
| AGENT_IDENTITY_SWAP (A) | EXPLOITED | EXPLOITED | EXPLOITED | DETECTED | RUN |
| MANDATE_REPLAY (A) | EXPLOITED | EXPLOITED | DETECTED | PREVENTED | RUN |
| CART_OR_TASK_SWITCH (A) | EXPLOITED | EXPLOITED | EXPLOITED | DETECTED | RUN |
| PAYMENT_WITHOUT_DELIVERY (A) | EXPLOITED | EXPLOITED | EXPLOITED | DETECTED | RUN |
| FAKE_FEEDBACK (A) | EXPLOITED | EXPLOITED | EXPLOITED | DETECTED | RUN |
| PROMPT_INJECTION_SELECTION (A) | EXPLOITED | EXPLOITED | EXPLOITED | DETECTED | RUN |
| PREDICATE_HAPPY_PATH (B) | N/A | N/A | N/A | N/A | RUN (no attack present) |
| PREDICATE_PAYEE_VIOLATION (B) | EXPLOITED | DETECTED | DETECTED | PREVENTED | RUN |
| PREDICATE_AMOUNT_VIOLATION (B) | EXPLOITED | DETECTED | EXPLOITED | PREVENTED | RUN |
| PREDICATE_ASSET_VIOLATION (B) | EXPLOITED | DETECTED | EXPLOITED | PREVENTED | RUN |
| PREDICATE_EXPIRED (B) | EXPLOITED | EXPLOITED | DETECTED | PREVENTED | RUN |

---

## Findings

| # | Severity | Description | Recommended fix |
|---|---|---|---|
| F1 | Medium | The 7-category outcome taxonomy (PREVENTED/DETECTED/EXPLOITED/PARTIALLY_MITIGATED/NOT_APPLICABLE/ERROR/SKIPPED) is **not implemented**. Code uses a 2-boolean model `{detected, prevented}`. PARTIALLY_MITIGATED, NOT_APPLICABLE, ERROR, SKIPPED are never emitted; cells are mapped to EXPLOITED/DETECTED/PREVENTED in this report only via post-hoc translation. | Either implement the 7-category enum in `BaselineOutcome` or document the boolean→category mapping in `baselines.ts` so the matrix is self-describing. |
| F2 | Low | No baseline ever returns NOT_APPLICABLE, even for dimensions each baseline explicitly documents as out of scope (e.g., B2 eBay monitor on CHAIN_TRANSPLANT, B1 on AGENT_IDENTITY_SWAP). Out-of-scope attacks are recorded as ACCEPT→EXPLOITED, which is operationally correct (the baseline misses them) but conflates "out of scope" with "missed". | If NOT_APPLICABLE is meaningful, emit it for explicitly documented out-of-scope baseline/attack pairs; otherwise keep ACCEPT and clarify in docs that ACCEPT on an out-of-scope dimension means "baseline does not cover this dimension". |
| F3 | Low | Static per-fixture `baselineOutcomes` in `index.ts` / `mode-b.ts` are **dead code for the final matrix**: `buildBaselineMatrix` / `buildP5Matrix` spread `fixture.baselineOutcomes` first, then overwrite with `live?.baselineComparison`. They are narrative labels that disagree with live results on several rows (as noted in code comment at `baselines.ts:95-96`). | Remove or clearly deprecate the static `baselineOutcomes` fields, or keep them only as documentation and never merge them into the emitted matrix. |
| F4 | Info | Mode B baselines *incidentally* catch single-field violations because the `SpendingPredicate` fields are mirrored into `mandate.constraints` (documented in the harness legend). B1 catches payee/amount/asset; B2 catches payee/expiry. This is documented, not hidden. | No fix needed; keep the legend documentation. Consider noting that this is incidental compatibility, not designed Mode B support. |
| F5 | Info | `liveBaselineOutcomes` genuinely runs B0–B2 against the attacked bundle (confirmed by execution); outcomes are derived from execution, not narrative. No hardcoded cells found. | No fix needed. |

---

## Verification summary

- Harness executed successfully and produced deterministic `baseline-comparison.json` / `.md`.
- `liveBaselineOutcomes` (`packages/attack-core/src/baselines.ts:26-38`) invokes `bVanillaX402`, `bAp2X402`, `bEbayMonitor` on the same attacked bundle; B3 supplied by caller from live verifier/guard result. ✓ Baselines run against attacked bundles, not hardcoded.
- All baselines receive the identical `TraceBundle`; inputs are shared from canonical fixtures (Mode A: `ATTACK_FIXTURES`, Mode B: `MODE_B_PREDICATE_FIXTURES`), not hand-constructed per-baseline. ✓
- Detection is not collapsed into prevention: B0–B2 always `prevented:false`; only B3 prevents (MANDATE_REPLAY via x402 replay enforcement; Mode B violations via predicate guard). ✓
- Every matrix cell traceable to an actual run (source = `RUN`). ✓
- No baseline-specific hidden/undocumented differences found; each baseline's scope and missed dimensions are documented in its file header. ✓

**Files read:** `packages/attack-core/src/baselines/vanilla-x402.ts`, `ap2-x402.ts`, `ebay-monitor.ts`, `types.ts`, `matrix.ts`; `packages/attack-core/src/baselines.ts`, `index.ts`, `mode-b.ts`, `types.ts`, `fixtures.ts`, `adversarial-matrix.ts`; `scripts/e2e-phase7-baselines.ts`; `packages/schemas/src/index.ts` (BaselineId); generated `experiments/benchmarks/baseline-comparison.json` / `.md`.
