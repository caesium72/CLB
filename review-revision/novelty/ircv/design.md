# Novelty 2 — IRCV: design

## Goal

Connect **formal model traces** (Tamarin `.spthy` artifacts already committed in this repository) to **implementation traces** (existing TypeScript fixtures) through a single normalized event schema, and report concrete differences instead of asserting refinement.

## Architecture

```
 formal/tamarin/clb-aligned.spthy        existing TS fixtures (attack-core)
 + proofs/*.proof, *.result.txt         buildValidBundle / buildValidModeBBundle
              |                                   | verifyTrace / facilitator
              v                                   v
   [1] model-trace-generator        [2] implementation-trace-normalizer
       (parse only, NO Tamarin)          (same ircv-trace/v1 schema)
              |                                   |
              +----------> [3] differential-engine <+
                            PASS / FAIL + concrete diffs
              |
              +--> [4] serialization-checker (clb-core vs independent TS mirror)
              +--> [5] cross-language PBT (TS vs executed Solidity via forge)
              +--> [6] counterexample-reproducer (generated executable script)
```

## Data flow

`Input -> Processing -> Output`

- `.spthy/.proof/.result.txt -> regex parser -> FormalVocabulary (rules, action labels, lemmas, constraints) -> model-trace.json/md`
- `fixtures -> verifyTrace -> normalized IrcvEvents -> implementation-traces.json/md`
- `(FormalVocabulary, normalized traces) -> constraint evaluation -> differential-report.json/md`
- `(predicate inputs) -> clb-core + viem mirror + forge Solidity helper -> serialization-report.json/md, property-tests.json/md`
- `(textual counterexample) -> generated TS adversarial script -> bun execution -> counterexample-report.json/md`
- `all -> ircv-summary.json + REPORT.md`

## File/module map

```
tools/ircv/
  model-trace-generator.ts          shared schema + formal parser (owned)
  implementation-trace-normalizer.ts scenario fixtures -> normalized traces
  differential-engine.ts            MC-P1..MC-P6 constraint checks
  serialization-checker.ts          fixed vectors + seeded cross-language PBT
  counterexample-reproducer.ts      textual input -> executable script -> verdict
  run.ts                            orchestrator, deterministic artifact writer
  solidity/
    foundry.toml, remappings.txt     isolated forge project (no new dependency)
    ParityProbe.s.sol                calls existing PredicatePaymentGuard formulas
experiments/novelty/ircv/            generated artifacts (JSON + MD)
review-revision/novelty/ircv/        this design + methodology/evaluation/text
```

## Normalized event schema (`ircv-trace/v1`)

Each event has `seq`, `label` (Tamarin action fact or implementation analogue), `kind`, `subject`, `bindings` (concrete digests/addresses/ids), and `origin`. Kinds: `principal_anchor`, `key_authorization`, `predicate_registration`, `delegation`, `commitment`, `nonce`, `predicate_decision`, `settlement`, `settlement_failure`, `nonce_consumption`, `verification_verdict`.

## Constraints (derived from committed lemmas, not re-proved)

| ID | Lemma | Checked condition |
| --- | --- | --- |
| MC-P1 | P1_identity_binding | authorized key of same agent before settlement |
| MC-P2 | P2_authorization_integrity | matching delegation commitment + nonce before settlement |
| MC-P3 | P3_no_replay | <= 1 consumption per nonce |
| MC-P4 | P4_non_transferability | admitting predicate decision before settlement |
| MC-P5 | P5_predicate_soundness | delegated predicate digest == settled digest |
| MC-P6 | P6_principal_anchor | anchored principal before settlement |

## Deliberate scope cuts

- No new Tamarin invocation: only committed artifacts are parsed, so no new proofs are claimed.
- Mode A and RCLB traces are marked `NOT COMPARABLE` rather than forced into the Mode B alphabet.
- No core source, tests, contracts, or manuscript files were changed; the only root edit is one `novelty:ircv` npm script.
- No new dependency: forge/solc/viem/Bun were already available in the workspace.
