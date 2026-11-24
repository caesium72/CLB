# Reviewer #3 Comment 2 — acceptance verification

**Status: RESOLVED.** All HIGH gaps are closed and the 60-item cryptographic
security specification is complete. Residual MEDIUM/LOW limits are stated in the
specification as trust assumptions rather than being silently omitted; no
assertion was weakened to reach this state.

## HIGH gaps — closed

| Gap | Fix | Evidence |
|---|---|---|
| Unauthenticated predicate registration | `registerPredicateBound` requires `msg.sender == principal` **and** an EIP-191 signature by `principal` over (predicateId, config digest, principal, mandate digest, taskHash, extras digest, chain id). It also takes over an id squatted via the legacy path. | `PredicateGuardSecurity.t.sol` (wrong caller/key/tampered config each revert); `test_BoundRegistrationTakesOverSquattedId` |
| Any caller could hand the guard a self-computed `C'` (no human authorization on-chain) | **Both** `validateAndConsume` overloads now require the stored human `Binding`: `bound`, `msg.sender == principal`, `mandateDigest == binding.mandateDigest`, `extraFieldsDigest == binding.extraFieldsDigest`, before the existing `C'`/nonce/replay/policy checks. A legacy-registered predicate can never settle (`PredicateNotBound`). | `test_LegacyRegistrationCannotSettle`, `test_LegacySixArgUsesBindingExtras`, `test_Closed_*` (5 inverted gap tests); forge 74/74 |
| taskHash / agent ids not bound on-chain | Human-signed extras digest pinned at registration and recomputed from `(agentIdHashes, taskHash)` in the enforced path. | `test_Closed_TaskSubstitutionRejectedOnChain`, TS↔Solidity golden vector |
| Chain cross-field inconsistency | `DOMAIN_CHAIN_ID` immutable; chain identity/payload/domain cross-check in `validateAndConsumeBound`. | `ChainIdMismatch` test |
| Decimal vs atomic amount divergence | On-chain `parseUnits6` + `AmountMismatch`. | `test_Closed_DecimalAndAtomicAmountInconsistencyRejected` |
| Negative/zero-range confidential proof (GAP-1) | `commitConfidential` rejects out-of-domain values; independent 64-bit `valueBits` proof. | `confidential-evidence-fixes.md`, new unit tests |
| Cap provenance (GAP-2) | Cap derived from the human-signed `mandate.constraints.maxAmount`; bundle cap may only tighten. | R11 verifier rule |
| Mode B R10 missing chain binding (G4) | `checkChainDomain` binds `clb.domain.chainId`. | verifier tests |
| Evidence signature excluded from hash (GAP-4) | `hashEvidenceEvent` includes the signature. | evidence-core tests |
| No Merkle proof API (GAP-7) | `buildMerkleProof` / `verifyMerkleProof` added. | evidence-core tests |
| Formal items 52–58, 60 | `formal/tamarin/clb-aligned.spthy` verified with Tamarin 1.12.0. | **8/8 lemmas verified**, proof archived |

## Verification (executed 2026-11-24/25)

```
forge test                 8 suites, 74 passed / 0 failed / 0 skipped
bun test                   360 pass / 2 skip / 0 fail (362 tests, 62 files)
bun run typecheck          clean (exit 0)
bun run reproduce:all      exit 0 — 11/11 steps PASS, version check PASS,
                           validator 49/49 across 15 categories
perf:all                   gas RUN (local Anvil, n=100), raw sha256
                           e2682d22ea563852adcfc2ee36d1f03ead842eefc6aa34ff2d388209910f6c86
phase7-caveat              forge gas report 72925 (forge+anvil), replay blocked
Tamarin                    clb-aligned.spthy 8/8 lemmas verified
ProVerif                   Q1/Q3/Q4 true; Q2 injective replay unproved (tool abstraction)
Base Sepolia               PUBLIC_NETWORK_EVIDENCE=true, 11/11 mined txs as expected
                           (see reviewer-2/comment-2/public-evidence-summary.md)
```

## Stated residuals (not HIGH, not hidden)

| Residual | Severity | Why it remains |
|---|---|---|
| Self-referential evidence recompute | MEDIUM | `recomputeEvidenceIntegrity` strips `previousEventHash` and rebuilds hashes/root; no external secret/anchor exists in the protocol. Requires an external trust anchor. |
| No on-chain anchor inside the verification certificate | MEDIUM | Certificate carries `settlementTxHash` but no trace-root anchor; adding a meaningless empty field would not fix it. |
| ProVerif Q2 (injective replay) | MEDIUM | Tool abstraction limit (Horn clauses are monotone, no one-shot consumption); replay is proved by Tamarin P3 and the Solidity nonce test instead. |
| No line-by-line TS/Solidity symbolic verification | MEDIUM | The formal model is aligned with the encoded protocol, not the source text. |
| `id.chainId` cross-check only in `validateAndConsumeBound`; `payerAgentId` not allow-listed on-chain | MEDIUM | Both fields are bound into `C'` signed by the human; enforced path checks them. The tests that demonstrate these limits were kept, not inverted into false claims. |
| No external identity registry (`principal` self-asserted by signing key) | MEDIUM | ERC-7710 demo substitute, not production delegation. |
| No atomic payment leg / no consumed-nonce recovery | MEDIUM | The guard transfers no funds; guard consumption and the external payment leg cannot be atomic in this prototype. |
| Fixed 6 decimals; cross-replica shared nonce store absent | LOW/MEDIUM | Documented scope limits. |

## Honest conclusion

The specification is complete and every HIGH implementation gap is closed with
executed evidence. The residuals above are explicitly stated trust assumptions,
which is what makes the security specification honest rather than incomplete.
Do **not** claim "production formal verification" or "all residuals solved";
do claim "no HIGH gaps remain, all 60 items specified, proof obligations
discharged on the aligned model with the stated tool limits".
