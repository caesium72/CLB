# Reviewer #3 Comment 1 — Acceptance verification

Generated after the three security fixes (human-principal anchor, predicate-content binding, chain-bound facilitator).

| # | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| 1 | Verifier rejects a mandate signed by an untrusted principal | ✅ | `packages/verifier-core/test/human-principal.test.ts` — re-sign attack → R2/R5 FAIL; `verifyTrace` fails closed when no anchor supplied. Extended test `extended-attacks.test.ts` "FIXED — attacker re-signs…" passes. |
| 2 | Predicate substitution under an existing predicate ID is rejected | ✅ | `packages/clb-core/test/predicate-content-binding.test.ts` (10 pass); `contracts/test/PredicateContentBinding.t.sol` (5 pass); C′ now binds `predicateDigest`; extended test "FIXED — predicate CONTENT substitution…" → R6/R8 FAIL. |
| 3 | Same signed payment authorization cannot settle on a second chain | ✅ | `packages/x402-adapter/test/cross-chain-replay.test.ts` — `ChainMismatchError` on a different-chain facilitator; same-facilitator replay still rejected. **Limit:** cross-replica on the SAME chain still needs a shared nonce store. |
| 4 | Three previously exploited attacks are PREVENTED before settlement | ✅ | All three now fail at a pre-settlement gate with **no receipt issued**: (a) replica re-sign → `verifyMandate` with anchored principal rejects before settlement; (b) predicate-content substitution → guard's `expectedNonce` (from human-signed C′) rejects before settlement; (c) cross-chain replay → `ChainMismatchError` at facilitator before nonce check. See `extended-attacks.test.ts` tests named `PREVENTION — …` (21/21 pass). |
| 5 | All positive-path tests continue to pass | ✅ | Full suite: 311 pass / 2 skip / 0 fail. Every attack test has a paired positive. |
| 6 | Extended attack suite passes without weakened assertions | ✅ | `extended-attacks.test.ts` 21/21 pass; assertions were STRENGTHENED (EXPLOITED → DETECTION with required failed rules). |
| 7 | R3-C1 items 1–9 have implementation and test evidence | ✅ | `items-1-9-evidence.md` — items 2 and 6 closed (runtime version probes; 7-category outcome taxonomy). All 9 COMPLETE. |
| 8 | Performance measurements regenerated where security changes affect paths | ✅ | `bun run perf:all` re-run after fixes; `performance-raw.json` new SHA-256 `d0585369…`; 11 metrics regenerated. |
| 9 | Reproducibility and baseline evidence available | ✅ | `reproduce:all` exit 0, version check PASS, 49/49 artifact validation, `REPRODUCIBILITY.md` with 20 sections, baseline fairness report + JSON artifacts. |

## Prevention status

All three attacks are now rejected at a pre-settlement gate with no receipt issued. The two that were previously post-settlement detection tests were rewritten to invoke the real control BEFORE calling the facilitator: the anchored `verifyMandate` check for mandate re-sign, and the guard's human-signed-C′ nonce check for predicate substitution. `receiptIssued === false` is asserted in both.

## Environment at verification

```
Bun 1.4.5 · Node v26.13.1 · Foundry NOT INSTALLED (SKIP) · Windows x64
Full suite: 311 pass / 2 skip / 0 fail
reproduce:all: 10 steps (9 PASS + 1 SKIP), version check PASS, validate 49/49
```
