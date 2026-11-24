# Novelty 2 — IRCV: methodology

## 1. Formal vocabulary extraction (parsing only)

`tools/ircv/model-trace-generator.ts` reads:

- `formal/tamarin/clb-aligned.spthy` — rules, action facts, lemmas (names, quantifiers, formulas, line numbers).
- `formal/tamarin/proofs/clb-aligned.proof` — toolchain footer (Tamarin 1.12.0, Maude 3.1) and proof structure.
- `formal/tamarin/proofs/clb-aligned.result.txt` — lemma statuses (**copied**, not recomputed).

Rule action facts are split at top-level commas with parenthesis-depth tracking; facts spanning multiple lines (e.g. `SettledB(...)`) are handled. `Eq(Cp_in,Cp)` maps to `commitment`; `Eq(verify(...),true)` maps to `verification_verdict`.

**No Tamarin process is started.** Every artifact states `tamarinExecutedInThisRun: false`.

## 2. Implementation trace projection

`tools/ircv/implementation-trace-normalizer.ts` invokes existing fixtures:

- `buildValidBundle` — Mode A honest (out-of-model control).
- `buildValidModeBBundle` — Mode B honest, payee attack (`payTo = attackerAddress`), amount attack (`value = 9.00` with cap 5.00).
- `markReplayAttempt` — nonce replay through the local x402 facilitator.
- `verifyTrace(..., { expectedHumanPrincipal })` — rule outcomes and verdict.
- `verifyTrace(..., { revocationBinding })` — additive R18 gate for the stale-epoch case.

Each run is projected to `ircv-trace/v1` events with concrete bindings (commitment, nonce, predicateId, digests, payee, amount, chain, verdict). Trusted principal anchor is the fixture test key, never the bundle's self-declared field.

## 3. Differential semantics

For comparable scenarios, MC-P1..MC-P6 are evaluated on event order and bindings. For each scenario a recorded expectation states whether violations are expected:

- honest Mode B: no violations + verdict PASS;
- predicate attacks: MC-P4 violation + verdict FAIL (the direct facilitator fixture settles despite the off-chain predicate gate — reported explicitly);
- replay: no model violation after prevention + verdict FAIL (the attempt is flagged);
- out-of-model: no constraint evaluation, verdict recorded only.

`PASS` means "observation matched the recorded expectation", **not** "implementation refines model". Violations carry expected/actual strings for concrete diffs.

## 4. Serialization consistency

`runSerializationChecks` compares clb-core functions with an independent TypeScript mirror of the Solidity ABI/EIP-712 formulas: `predicateConfigDigest`, `predicateExtrasDigest`, `predicateDigest`, `settlementParamsDigest`, `C'`, `H(C')`, `bindingDigest` (EIP-191), RCLB `C_t` and its nonce. Two predicate shapes (default and multi-field) plus a negative control (digest must change) give 17 checks. All 17 matched.

A genuine defect was found and **reported, not fixed**: `computePredicateConfigDigest` calls `allowedPayees.map(getAddress)`; viem's `getAddress` accepts a second `chainId` argument, so `Array.map` passes the index as chainId, producing an EIP-1191 checksum that `encodeAbiParameters` rejects for the second and later payees (`InvalidAddressError`). See `FINDING-MULTI-PAYEE-GETADDRESS`.

## 5. Cross-language property-based testing

`runPropertyBasedTests` generates **64 deterministic cases** with seed **20261125** (mulberry32). Predicate/params fields vary: asset count, agent IDs, chain IDs, amounts, expiry, optional task hash. Inputs are written to `experiments/novelty/ircv/parity-cases.json`.

An isolated forge project at `tools/ircv/solidity/` imports the **existing** `contracts/src/PredicatePaymentGuard.sol` via remapping and executes its real pure/view functions (`predicateDigest`, `predicateDigestWithExtras`, `settlementParamsDigest`, `computeSettlementCommitment`, `deriveNonce`, `parseUnits6`, `bindingDigest`) for every case. Output is `parity-solidity.json`. Eight fields per case are compared: 64 × 8 = 512 comparisons, 512 matched, 0 mismatches.

Tool versions come from the forge stdout (`forge Version: 1.10.0`), the configured compiler (`solc 0.8.28`), and `node_modules/viem/package.json` (2.51.3).

## 6. Counterexample reproduction

The built-in textual description is the RCLB scenario "old identity epoch accepted after revocation". RCLB exists in this scope (`packages/clb-core/src/epochs.ts`, verifier R18), so the scenario is **actually executable**, not a schema demo. `counterexample-reproducer.ts` writes `counterexample.txt` and generates `reproduce-stale-identity-epoch.ts`, then runs it with Bun.

The generated script: computes `C_t` with `E_I=1`, derives `N=H(C_t)`, settles through the local facilitator (accepted), advances current `E_I` to 2, checks acceptance (rejected: `IDENTITY_EPOCH_STALE`), and runs `verifyTrace` with `revocationBinding` (FAIL with `R18_REVOCATION_AWARE_BINDING`). Expected rejection == actual rejection.

## Reproduce

```
bun run novelty:ircv
bun run typecheck
bun test
```

Component 5 locates an already-installed forge via `PATH` or `~/.foundry/bin`; nothing is installed. If forge is genuinely absent, that component reports `NOT RUN` with a reason and no fabricated numbers.
