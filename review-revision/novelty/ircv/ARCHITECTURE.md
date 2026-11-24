# Novelty 2 - IRCV: architecture

## 1. What this novelty does

IRCV (implementation-refined compositional verification) is a **reusable
model-to-code refinement methodology**, not a new protocol. It puts a formal
model and an implementation on one observable-event footing, then reports
concrete differences instead of asserting refinement.

- `tau_model` - trace language of the committed Tamarin theory: sequences of
  action facts (`PrincipalAnchored`, `KeyAuthorized`, `PredicateRegistered`,
  `DelegatedB`, `AdmitB`/`GuardPassed`, `Paid`/`SettledB`, `FailedSettle`,
  `Consumed`, `Eq(...)`) from `formal/tamarin/clb-aligned.spthy`. Restricted to
  the Mode B (delegated/predicate) alphabet the theory actually expresses.
- `tau_impl` - trace language of the TypeScript implementation: observable
  events from existing fixtures through `verifyTrace` and the local x402
  facilitator, plus concrete digests from the Solidity helper.
- `Normalize` - projection to `ircv-trace/v1` (`kind`, `label`, `subject`,
  `bindings`, `origin`). Model side parses action facts; implementation side
  maps verifier/facilitator outputs into the *same* schema.
- `AllowedTraces(M)` - traces admitted by constraints MC-P1..MC-P6 extracted
  from the model's lemmas: authorized key, matching delegation, single nonce
  consumption, admitting predicate decision, equal predicate digest, anchored
  principal. Necessary, not sufficient, conditions.
- **Correspondence condition (tested form):** for each *comparable* trace
  `t in Normalize(tau_impl)`, the violations of `AllowedTraces(M)` on `t` equal
  the scenario's recorded expectation. PASS means "observation matched the
  recorded expectation", not universal refinement.

```
  ARTIFACTS (.spthy/.proof/.result.txt, TS fixtures, contracts)
     --> TOOLING (tools/ircv: parse/normalize/compare; no prover, no on-chain change)
     --> EVIDENCE (experiments/novelty/ircv/*.json,*.md + REPORT.md)
```

## 2. Where it fits in the architecture

IRCV sits **beside** the protocol as a verification tool, not inside it:

- **Tamarin artifacts:** `.spthy` (rules, action facts, lemmas), `.proof` (toolchain
  footer), `.result.txt` (statuses copied verbatim; `tamarinExecutedInThisRun: false`).
- **TS implementation:** `buildValidBundle`, `buildValidModeBBundle`,
  `markReplayAttempt`, `verifyTrace`, clb-core digests, local x402 facilitator.
- **Solidity contract:** `PredicatePaymentGuard.sol` imported by the isolated forge
  project (`tools/ircv/solidity/`, remappings); its real pure/view formulas run on
  seeded inputs.
- **Execution:** `forge script` local EVM produces `parity-solidity.json`; `bun run`
  of a generated adversarial script produces `counterexample-execution.json`. No
  Anvil node or RPC - see section 6.

## 3. Architecture diagram

```
 INPUT                          PROCESSING (tools/ircv)              OUTPUT
 =====                          ========================              ======

 [A] FORMAL MODEL
 formal/tamarin/
   clb-aligned.spthy ----+
   proofs/*.proof       +--->[1] model-trace-generator --->[N1] normalized
   proofs/*.result.txt -+     (regex parse; NO Tamarin)        model trace
                               |                                ircv-trace/v1
                               | MC-P1..MC-P6                         |
                               | AllowedTraces(M)                     |
                               v                                      v
 [B] TS IMPLEMENTATION          +------>[3] differential-engine <----+
 attack-core fixtures ---+      |       (Normalize(tau_impl) vs
 x402 facilitator        +->[2] impl-trace-normalizer                  |
 verifyTrace             +      (fixtures + verifyTrace + settle)     |
 clb-core digests -----+        |                                     |
                                 +->[N2] normalized impl trace -------+
                                     ircv-trace/v1                    |
                                                                     v
                                                          [R] PASS / FAIL
                                                            + concrete diffs

 [C] SERIALIZATION (TS <-> TS mirror)
 clb-core digests ---->[4] serialization-checker ---> serialization-report
 viem ABI/EIP-712 mirror    (17 checks)               (17/17 matched)

 [D] SOLIDITY PBT (genuine cross-language)
 seed 20261125 ------>[5] runPropertyBasedTests --> parity-cases.json
                             |                            |
                             +-- forge script ParityProbe.s.sol --> parity-solidity.json
                                 (real PredicatePaymentGuard;           |
                                  local EVM forge script; no RPC)       +--> [5] compare
                                                                        --> 512/512 matches
                                                                        --> property-tests

 [E] COUNTEREXAMPLE
 textual description ->[6] counterexample-reproducer -> reproduce-stale-identity-epoch.ts
                             |                                  |
                             +-- bun run ----------------> counterexample-execution.json
                                                                 |
                                                                 +--> cex-report (PASS/FAIL)

 [1]+[2]+[3]+[4]+[5]+[6] ----> run.ts (orchestrator) ----> ircv-summary.json + REPORT.md
```

`Input -> Processing -> Output`: committed artifacts/fixtures on the left,
`tools/ircv/*.ts` in the middle, JSON/MD evidence under
`experiments/novelty/ircv/` on the right.

## 4. Execution flow (numbered, exact script names)

1. `bun run novelty:ircv` - `package.json` maps it to
   `bun run tools/ircv/run.ts`, the orchestrator.
2. `run.ts` calls `loadFormalVocabulary()` in
   `tools/ircv/model-trace-generator.ts`; reads `.spthy`, `.proof`,
   `.result.txt`; writes `model-trace.json/.md`.
3. `run.ts` calls `normalizeImplementationScenarios()` in
   `tools/ircv/implementation-trace-normalizer.ts`; six fixture runs become
   `implementation-traces.json/.md`.
4. `run.ts` calls `runDifferential(vocabulary, scenarios)` in
   `tools/ircv/differential-engine.ts`; writes `differential-report.json/.md`.
5. `run.ts` calls `runSerializationChecks()` in
   `tools/ircv/serialization-checker.ts`; writes `serialization-report.json/.md`.
6. `run.ts` calls `runPropertyBasedTests()` (same file): writes
   `parity-cases.json`, spawns `forge script ParityProbe.s.sol:ParityProbe`
   with `cwd=tools/ircv/solidity`, reads `parity-solidity.json`, writes
   `property-tests.json/.md`.
7. `run.ts` calls `reproduceCounterexample()` in
   `tools/ircv/counterexample-reproducer.ts`: writes `counterexample.txt`,
   generates `reproduce-stale-identity-epoch.ts`, executes it via `bun run`,
   writes `counterexample-report.json/.md` + `counterexample-execution.json`.
8. `run.ts` aggregates into `ircv-summary.json` and `REPORT.md`, prints summary.

Missing forge -> step 6 `NOT RUN` with a reason; unparseable description -> step 7 `NOT RUNNABLE`.

## 5. Data flow - one event (nonce)

```
 MODEL
   action fact: Consumed(~n)   (nonce is a MODEL TERM, not an action fact)
     | kindForLabel("Consumed") -> "nonce_consumption", binding arg0 = ~n
     v ircv-trace/v1 event {kind:nonce_consumption, label:Consumed}

 IMPLEMENTATION
   bundle.paymentPayload.authorization.nonce
     | normalize(): event(4, kind="nonce", label="Nonce",
     |                    bindings.nonce=<hex>, derivation="H(C) or H(C')")
     | normalize(): event(kind="nonce_consumption", label="Consumed",
     |                    bindings.nonce=<hex>, origin="...:nonce-store")
     v ircv-trace/v1 events

 COMPARISON
   differential-engine.ts evaluateConstraints():
     group events where kind=="nonce_consumption" by bindings.nonce
     MC-P3: count(nonce) <= 1
     MODE_B_REPLAY_ATTACK: count == 1 (facilitator rejected the 2nd attempt)
     v differential-report -> ircv-summary.json -> REPORT.md
```

`nonce` is the one **implementation-only** kind: 10 of 11 observed kinds map
to the model alphabet; it appears as a model *term*, never an action fact.

## 6. Integration points and boundaries

**Covered:** 6 scenarios (MODE_A_HONEST, MODE_B_HONEST, MODE_B_PAYEE_ATTACK,
MODE_B_AMOUNT_ATTACK, MODE_B_REPLAY_ATTACK, RCLB_STALE_IDENTITY_EPOCH; 4 comparable,
2 out-of-model); 6 constraints MC-P1..MC-P6; 7 rules, 11 action labels, 8 copied lemma
statuses; 17 serialization checks (17/17); 64 seeded PBT cases x 8 fields = 512/512
comparisons; 1 executable counterexample.

**NOT PROVEN:**

- No new Tamarin proof: statuses copied from `proofs/clb-aligned.result.txt`; no prover was run.
- No general refinement theorem: only 6 concrete scenarios on 6 constraints; PASS means
  "matched the recorded expectation", not universal refinement.
- No general theorem / bisimulation: abstract event projection; symbolic equality approximated
  by concrete digests/addresses/ids; no symbolic execution of Solidity.
- Mode A exact traces are outside the Mode B model alphabet.
- RCLB / revocation epochs are absent from `clb-aligned.spthy`; the stale-epoch counterexample is executable but out-of-model.
- Fixed-vector serialization checks are TS<->TS mirrors; genuine cross-language evidence is the forge run, limited to fields exposed by the guard.
- Fixture-level predicate attacks settle in the direct facilitator path; the
  pre-settlement guard is a separate earlier gate - reported, not hidden.
- Raw digests embed fixture wall-clock timestamps: verdicts/counts stable,
  digests not byte-stable.
- No Anvil node/RPC: Solidity runs in forge's local EVM script environment.

## 7. Verification pointers

```
bun run novelty:ircv        # -> tools/ircv/run.ts
bun run typecheck
bun test
```

Measured numbers (`experiments/novelty/ircv/REPORT.md`, `ircv-summary.json`, status **PASS**):
7 rules, 11 action labels, 8 lemma statuses; differential 6/6 PASS (4 comparable,
2 out-of-model); serialization 17/17; PBT PASS 64/64 cases, 512/512 comparisons
(seed 20261125); counterexample PASS. Versions: bun 1.4.5, viem 2.51.3, TS ^5.8.3,
forge 1.10.0, solc 0.8.28; Tamarin 1.12.0 / Maude 3.1 read from the committed proof footer, not executed.

**Real bug found (reported, not fixed):** `FINDING-MULTI-PAYEE-GETADDRESS`
(medium). `computePredicateConfigDigest` uses `allowedPayees.map(getAddress)`; viem's
`getAddress` takes a second `chainId`, so `Array.map` passes the index as chain id. The
EIP-1191 checksum is rejected by `encodeAbiParameters` with `InvalidAddressError` for the
second and later payees (>= 2 allowedPayees). Core source was not modified; no contract redeployed.
