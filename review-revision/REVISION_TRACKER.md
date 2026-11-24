# A³C-VPEAL Reviewer Revision Tracker

The uploaded repository archive did not include Git metadata. The extracted repository is being modified in a separate working copy; the original ZIP remains unchanged.

## Reviewer #2

| Comment | Code | Tests | Experiments | Manuscript | Rebuttal | Status |
|---|---|---|---|---|---|---|
| R2-C1: broader adversarial evaluation | Compositional matrix (9 primitives, singles + 72 ordered pairs + 12 chains, 5 seeds), pre-settlement guard ordering via `draftModeBPayment`, in-flight nonce reservation | 2 new attack-core tests (matrix shape, expected-rule coverage, 9/9 prevention), 1 new concurrency test; all pass | Executed: 465/465 scenarios detected, 9/9 prevented with no receipt, 3,720 concurrent attempts with 0 anomalies; artifacts in `experiments/benchmarks/reviewer2/comment1/` | Not required — this is a code/evaluation comment; optional paste-ready insert remains in `review-revision/reviewer-2/comment-1/manuscript-insert.tex` | `rebuttal-text.md` prepared | RESOLVED (technical) |
| R2-C2: public/production-like network evaluation | RESOLVED (technical) - REAL Base Sepolia (chain 84532) run: deployed guard 0xB1c8273F74365c146c9b8b233b7286a441ac2652 (tx 0xb519166199bebf4d4c244013578985ac8d95b8b6c29ebf838f7ef550365e3176, block 63090452), 11 mined txs, 11/11 as expected, PUBLIC_NETWORK_EVIDENCE=true, real tx hashes/blocks/BaseScan links in experiments/benchmarks/reviewer2/comment2/public/. Independently re-verified against the public RPC (HAPPY_PATH status 0x1 @63090479, payee substitution status 0x0 @63090504). Registration now uses registerPredicateBound. An earlier valid public run used guard 0xd52430439eA87A11580C37a6E9C20BAE26d6aa4E. Full suite 360 pass/2 skip/0 fail; reproduce:all exit 0. See comment-2/public-evidence-summary.md. |

## Reviewer #3

| Comment | Status |
|---|---|
| R3-C1: insufficient experimental validation | RESOLVED (technical) - all 29 checklist items and all 9 acceptance criteria verified. The three security gaps are closed and demonstrated as PRE-SETTLEMENT PREVENTION (no receipt issued): anchored mandate gate, human-signed-C-prime guard nonce check, and chain-bound facilitator. Full suite 311 pass / 2 skip / 0 fail; performance regenerated; reproduce:all exit 0 with version check PASS and 49/49 artifact validation. See acceptance-verification.md. |
| R3-C2: incomplete cryptographic security specification | RESOLVED (technical) - 60-item spec complete; ALL HIGH gaps closed: both validateAndConsume overloads gated on human Binding (bound/caller/mandate/extras), legacy registration is settlement-inert, bound registration takes over squatted ids, audited registration signature, negative-value proofs rejected, cap from signed mandate, R10 chain binding, Merkle proof API, signature in evidence hash; Tamarin 1.12 aligned model 8/8 lemmas, ProVerif Q1/Q3/Q4 true (Q2 tool limit). forge 74/74, full suite 360 pass/2 skip/0 fail, reproduce:all 11/11 PASS exit 0. MEDIUM residuals (self-referential evidence recompute, no on-chain certificate anchor, ProVerif Q2, no line-by-line code proof) explicitly stated in acceptance-verification.md. |
| R3-C3: novelty over prior CLB-ACEL manuscript | NOT STARTED (manuscript-only) |
| R3-C4: lack of formal security verification | RESOLVED — existing Tamarin P1–P5 + ablation counterexamples + ProVerif results inventoried; stale manuscript claim corrected in `Manuscript/main.tex`; report in `review-revision/reviewer-3/comment-4/` |
| R3-C5: insufficient reproducibility and baseline comparison | RESOLVED — `bun run reproduce:all` regenerates every benchmark with logged exit codes; `REPRODUCIBILITY.md` generated from JSON; conflicting static-vs-live baseline cells fixed in `baselines.ts` and `mode-b.ts` |

## Reviewer #4

| Comment | Status |
|---|---|
| R4-C1: (not addressed in this task) | NOT STARTED |
| R4-C2: trust model gaps | RESOLVED (technical, residual anchor gap documented) - trusted-root comparison, strict mode, duplicate-ID/required-type checks; 21 new tests; prompt-injection method documented exactly |
| R4-C3: prevented 5 of 14 overstated | RESOLVED - corrected claim: 5/14 in evaluated pipeline, 7/14 in gated configuration; Mode A pre-settlement gate added with no-receipt prevention; 7 new tests |
| R4-C4: performance limited | RESOLVED (technical, single-machine limit stated) - scaling 7..128 events (slope 1.06 / 0.24), variance p50/p95 + raw samples, overhead 4.41x vs plain x402; Base Sepolia public evidence exists (11/11 as expected, PUBLIC_NETWORK_EVIDENCE=true, produced by a parallel workstream sharing this folder) |

## Resolution policy

A comment is not marked RESOLVED until the relevant implementation is tested, required experiments have execution evidence, manuscript changes are verified, and the author response accurately describes those changes.
