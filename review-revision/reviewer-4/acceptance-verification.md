# Reviewer #4 Comments 2–4 — Status

## C2 — Trust model gaps: ✅ resolved (technical, with stated residual)

| Reviewer ask | Status | Evidence |
|---|---|---|
| Explain how omitted/fabricated events are prevented | ✅ | `evidence-trust-model-report.md`; trusted expectedMerkleRoot + strict mode, duplicate-ID and required-object-type checks; 21 new tests |
| Describe prompt-injection detection | ✅ | Exact algorithm documented: first `ERC8004_AGENT_SELECTION` → `publicFields.selectedPayee` → checksummed comparison against `mandate.constraints.allowedPayees`; detects the *effect*, not NLP prompt text |
| Residual | ⚠️ documented | Without a trusted anchor, self-consistent rewrites are undetectable by verifier alone. Verifier still does not read `AgenticAuditAnchor`. Medium-severity limitation, not claimed closed. |

## C3 — "Prevented 5 of 14" overstated: ✅ resolved (technical + corrected claim)

| Reviewer ask | Status | Evidence |
|---|---|---|
| Explain why Mode A payee/amount substitution can't be rejected before settlement in the evaluated pipeline | ✅ | `prevention-semantics-report.md`: verification was placed after settlement, so the receipt already existed; C itself does bind payee/amount under the human signature |
| Corrected formulation | ✅ | **5/14 in the evaluated pipeline** (1 Mode A replay + 4 Mode B guard violations); with the new pre-settlement Mode A authorization gate, **7/14 in the gated configuration**; remaining 7 are post-settlement detections |
| Real gate | ✅ | `presettlement.ts` Mode A scenarios: payee/amount substitution rejected pre-settlement with no receipt; 7 new tests |

## C4 — Performance limited: ✅ technically resolved (with two honest gaps)

| Reviewer ask | Status | Evidence |
|---|---|---|
| Scaling | ✅ | 7/16/32/64/128 events; evidence chain 0.58→13.09 ms (log-log slope 1.06); verifyTrace 6.98→13.64 ms (slope 0.24); `scaling-results.json` + report |
| Variance | ✅ | mean/median/stddev/min/max/p50/p95, n=100 per series, raw samples preserved |
| Overhead vs plain x402 | ✅ | plain 1.94±0.59 ms vs full 8.55±0.94 ms; paired difference 6.61±1.12 ms; ratio 4.41×, n=100 |
| Base Sepolia | ✅ (evidence exists) | `reviewer2/comment2/public/onchain-guard-results.public.json`: 11/11 plans as expected, real txHash + blockNumber on Base Sepolia, `PUBLIC_NETWORK_EVIDENCE: true`. NOTE: this public run was produced by a parallel workstream sharing this folder, not by this task's agents. |
| Multi-machine | ⚠️ not done | one machine (i5-1240P, 16 cores) — explicitly stated in every artifact |

## Verification

```
typecheck         clean
full bun test     360 pass / 2 skip / 0 fail
reproduce:all     exit 0 · version check PASS · validator 49/49
public artifact   11/11 as expected · PUBLIC_NETWORK_EVIDENCE true
```

## Honest conclusion

C2, C3, C4 are technically resolved. C4 retains one explicit limitation (single machine) and C2 retains one explicit limitation (no trusted on-chain anchor read by the verifier). Both are documented in the paste-ready manuscript text — do not claim they are closed.
