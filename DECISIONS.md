# CLB-ACEL Architecture Decisions

Record of implementation choices. Overrides `CONTEXT_FULL_PROJECT.md` where noted.

## Phase 0 (Scaffold)

| Decision           | Choice                                                 | Rationale                                                    |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------ |
| Package manager    | Bun                                                    | Section 12 default; fast TS monorepo tooling                 |
| Frontend           | Next.js App Router + TypeScript + Tailwind + shadcn/ui | Plan section Phase 0; research-mode toggle via shadcn Switch |
| Schema validation  | Zod in `packages/schemas`                              | Shared types across apps/services; section 15                |
| Local chain        | Anvil via docker-compose                               | Section 12; testnet Base Sepolia for later phases            |
| Database / storage | PostgreSQL + MinIO                                     | Section 12; evidence payloads off-chain                      |
| Lint / format      | ESLint 9 flat config + Prettier                        | Minimal shared config at repo root                           |
| Workspaces         | `apps/*`, `packages/*`, `services/*`                   | Section 11 monorepo layout                                   |

## Deferred (later phases)

- Mode B predicate flow + `PredicatePaymentGuard.sol` — Phase 4
- Full interactive demo (live services, no mock trace) — Phase 5
- AWS deployment, encrypted evidence payloads — Phase 6

## Phase 1 (Evidence Graph)

| Decision          | Choice                                                                                      | Rationale                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence hashing  | `keccak256(canonical_json(event_without_signature))` in `@clb-acel/evidence-core`           | Deterministic verifier-compatible event hashes while allowing signatures to vary independently                                                       |
| Hash chain        | `previousEventHash` is service-enforced from the prior append-order event hash              | Creates a tamper-evident sequence before payment/settlement integration exists                                                                       |
| Merkle root       | Ordered binary Merkle tree; empty trace uses zero root and single-event trace uses the leaf | Simple deterministic root for anchoring in later phases                                                                                              |
| Evidence storage  | `services/evidence-service` reads `DATABASE_URL` and initializes Postgres schema on startup | Supports Neon by URI while keeping storage behind a repository interface                                                                             |
| Trace concurrency | Postgres append uses a transaction-scoped advisory lock per `traceId`                       | Prevents concurrent genesis events and keeps chain construction serialized per trace                                                                 |
| Local Postgres    | Docker Postgres service is commented out                                                    | Cloud Postgres is the active default; local container can be restored by uncommenting                                                                |
| Object storage    | AWS S3 via `S3_BUCKET`, `AWS_REGION`, and standard AWS credentials                          | Production evidence payloads; local MinIO docker services commented for future offline use                                                           |
| Local MinIO       | Docker MinIO + minio-init services are commented out                                        | AWS S3 is the active default; local container can be restored by uncommenting                                                                        |
| Evidence UI       | Web demo fetches `EVIDENCE_SERVICE_URL` and falls back to a computed mock trace             | Demo remains useful without live database credentials while showing real graph data when the service is seeded. **Live-only path ships in Phase 5.** |

## Phase 2 (Mode A CLB exact flow)

| Decision             | Choice                                                                                                          | Rationale                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| EIP-712 library      | `viem` for typed-data hashing, signing, and address recovery in `@clb-acel/clb-core`                            | Battle-tested EIP-712/keccak/secp256k1; avoids hand-rolled encoding. Same keccak as evidence-core                                               |
| CLB commitment shape | `CLBCommitment{ IdentityRef identityRef; bytes32 mandateDigest; bytes32 settlementDigest }`                     | Stable, on-chain-recomputable typed data; full settlement descriptor bound via its keccak digest                                                |
| Nonce derivation     | `nonce = keccak256(C)` (`deriveNonce`)                                                                          | Section 7 "nonce = H(C)"; pins one settlement to one commitment                                                                                 |
| Mandate signing      | CART/PAYMENT sign EIP-712 over C; INTENT signs the authorization digest as a personal message                   | Human signature covers C (R5/R6); INTENT (Mode B) deferred but issuable                                                                         |
| Shared service kit   | `@clb-acel/service-kit` provides `loadMonorepoEnv` (upward search) + `registerOpenApi`                          | DRY env loading + consistent Swagger across all six Fastify services                                                                            |
| Identity registry    | In-memory `@clb-acel/erc8004-adapter` behind an interface; `MockERC8004IdentityRegistry.sol` mirrors it         | Adapter swappable for a real ERC-8004 registry without service changes                                                                          |
| Bound identity       | CLB `identity_ref` = **shopping (payer) agent**; merchant resolved separately for payee/registration checks     | Matches §9.3 (`authorizedPaymentKeys.includes(settlement.payer)`) and P1 identity binding                                                       |
| x402 facilitator     | Local facilitator adapter: EIP-712 payment authorization, single-use nonce, simulated tx hash                   | Deterministic, testable; Base Sepolia facilitator can replace it behind the same interface                                                      |
| Report crypto        | `@clb-acel/delivery-core` owns `reportHash`, signing, verification, **and** deterministic risk scoring          | Single source of truth so the merchant and verifier never diverge on the delivery hash                                                          |
| Verifier             | `@clb-acel/verifier-core` pure rules R1–R14 over a `TraceBundle`; `verifier-service` is a thin Fastify wrapper  | Deterministic, LLM-free, unit-testable independent of HTTP; reused by orchestrator                                                              |
| Orchestrator         | `@clb-acel/agent-orchestrator` runs the flow **in-process** via the adapter packages                            | Self-contained demo + deterministic integration tests without standing up five servers                                                          |
| Determinism          | `runHumanPresent` accepts a fixed `nowMs`; web demo pins intent + clock                                         | Every screen renders an identical, reproducible trace (stable C, nonce, Merkle root, certificate)                                               |
| Python risk scoring  | `experiments/risk-scoring` (uv) mirrors `delivery-core.scoreToken`, verified byte-identical via TS test vectors | uv-managed evaluation/Colab path; verifier stays TypeScript                                                                                     |
| Contracts toolchain  | Foundry (`contracts/`), `forge` not bundled — documented install + deploy steps                                 | `forge` unavailable in this environment; contracts + tests written to standard Foundry conventions                                              |
| Web demo data        | Pages are async server components reading one in-process `getModeATrace()` (React `cache`)                      | Live Mode A data on every screen; prerenders statically at build. **Full live interactive demo deferred to Phase 5** (after Mode B in Phase 4). |

## Phase 2 follow-ups (foundation complete; hardening deferred)

These items were in the original Phase 2 plan but intentionally deferred to keep the foundation milestone shippable. They do not block Phase 3 (attack simulator).

| Item                      | Status           | Notes                                                                                                                                            |
| ------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| On-chain anchor           | ✅ Wired         | `@clb-acel/anchor-core` + evidence-service calls `AgenticAuditAnchor` when `AUDIT_ANCHOR_ADDRESS`, `RPC_URL`, and `DEPLOYER_PRIVATE_KEY` are set |
| `forge test` in CI        | ✅ Wired         | `.github/workflows/ci.yml` runs `forge test`; see `contracts/README.md`                                                                          |
| Cross-service HTTP E2E    | ✅ Wired         | `runHumanPresentOverHttp()` + `ORCHESTRATOR_TRANSPORT=http` or `transport: "http"` on `/run-human-present`                                       |
| Browser wallet            | ✅ Wired         | MetaMask/Rabby EIP-712 signing on `/mandate` via `MandateWalletSign`                                                                             |
| Base Sepolia settlement   | ✅ Wired         | `createFacilitator()` supports `local`, `http` (`X402_FACILITATOR_URL`), and `chain` (`X402_FACILITATOR_MODE=chain`)                             |
| LLM report explanation    | ✅ Wired         | `@clb-acel/llm-adapter` behind merchant `/risk-report` + `/risk-report/explain`                                                                  |
| Python scorer in merchant | ✅ Wired         | `RISK_SCORER=python` invokes `experiments/risk-scoring` via subprocess                                                                           |
| `/attacks` screen         | Stub placeholder | Phase 3 attack runner                                                                                                                            |

## Phase 3 (Attack Simulator)

| Decision            | Choice                                                                               | Rationale                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Core logic location | `packages/attack-core`                                                               | Pure TypeScript fixtures reused by tests, services, scripts, and orchestrator            |
| Fixture strategy    | Shared `buildValidBundle()` plus deterministic fixture mutation                      | Removes verifier-test duplication and keeps expected failures reproducible               |
| Replay modeling     | `TraceBundle.nonceReplayAttempt` plus live local facilitator replay attempt          | Verifier stays deterministic while B3 records x402 prevention for nonce reuse            |
| Task binding        | New verifier rule `R15_TASK_HASH_MATCHES`                                            | Covers cart/task switch without overloading report signature checks                      |
| Audit-layer attacks | `FAKE_FEEDBACK` and `PROMPT_INJECTION_SELECTION` in `attack-core` audit checks       | Keeps the verifier focused on CLB binding while still evaluating decision-layer evidence |
| HTTP surface        | `services/attack-simulator` on port 4006 and orchestrator `POST /attack/:attackName` | Provides both standalone benchmark API and orchestrator-compatible attack runs           |
| Benchmark artifacts | `experiments/benchmarks/*` generated by `bun run e2e:phase3`                         | Gives the paper a checked-in matrix, CSV, and latency/gas report snapshot                |

## Phase 4 (Mode B delegated / predicate flow)

| Decision                     | Choice                                                                                                                                                                                                            | Rationale                                                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ERC-7710 vs demo guard       | `PredicatePaymentGuard.sol` behind `@clb-acel/predicate-adapter`, labelled a demo/mock caveat layer                                                                                                               | CONTEXT §7/§13.3: ERC-7710 not stable for v1; the `PredicateGuardAdapter` interface is swappable for a real enforcer later                                                                                         |
| C' commitment shape          | New EIP-712 type `CLBSettlementCommitment{ IdentityRef identityRef; bytes32 mandateDigest; string predicateId; bytes32 settlementParamsDigest }` in `clb-core`                                                    | Binds settlement-time concrete params under the human-signed predicate id; `settlementParamsDigest = keccak256(abi.encode(...))` gives byte-exact off-chain/on-chain parity (verified by `test_ParityWithClbCore`) |
| Auth-time vs settlement-time | INTENT mandate (personal-message signature, no `clbCommitment`) + settlement-time C' on the trace bundle                                                                                                          | Matches the existing AP2 INTENT path; the human signs π once, the agent binds concrete params later via C'                                                                                                         |
| Predicate storage            | `PredicateDescriptor` on `TraceBundle.clb.settlementDescriptor`; concrete params in `TraceBundle.concreteSettlement`; C' in `TraceBundle.modeBCommitment`                                                         | Verifier evaluates π against the concrete settlement                                                                                                                                                               |
| Nonce (Mode B)               | `nonce = H(C')` via `deriveSettlementNonce`                                                                                                                                                                       | Pins one delegated settlement to one C'; mirrors Mode A `nonce = H(C)`                                                                                                                                             |
| Mode-aware rules             | R6/R8 recompute C'/`H(C')`; R7 binds concrete params to the receipt; R10/R11/R12/R13 read predicate fields; **R17** runs `evaluatePredicate`; R7 is not vacuous (it binds the concrete params, π is owned by R17) | One verifier, two modes; violations surface at R17 (+ redundant R11–R13) while binding rules R6/R8 still hold                                                                                                      |
| R17 expiry clock             | Evaluate `validUntil` against `settlement.settledAt`, not wall-clock                                                                                                                                              | Deterministic and semantically correct ("did settlement occur within the window?")                                                                                                                                 |
| Enforcement (P5)             | In-process `InMemoryPredicateGuard` (and optional `ContractPredicateGuard`) both call `evaluatePredicate`; the on-chain guard additionally enforces payee/asset/chain/amount/expiry + single-use nonce            | Prevention at settlement for the demo; verifier R17 provides the audit                                                                                                                                             |
| Mode B settlement            | `runDelegated` uses the deterministic local facilitator (not `createFacilitator`)                                                                                                                                 | Reproducible in-process trace; live HTTP/chain Mode B is deferred to Phase 5 (`runDelegatedOverHttp` is a stub)                                                                                                    |
| Amount on-chain              | Guard binds the decimal `value` string in C' but compares a parallel `valueAtomic` integer for `<= maxValue` — **superseded by Phase 7A** (`valueAtomic` now bound inside C')                                      | Solidity has no decimals; documented demo simplification, off-chain `evaluatePredicate` remains authoritative                                                                                                      |

## Phase 4 follow-up (P5 predicate attacks, Option A)

| Decision                 | Choice                                                                                                                                                                                                                                                                      | Rationale                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope                    | A focused P5 slice (`MODE_B_PREDICATE_FIXTURES`: 4 violations + 1 happy path) separate from the Phase 3 binding matrix                                                                                                                                                      | Mode B's novel contribution is predicate soundness (P5), not re-running the 10 binding attacks under R17                                                                |
| Fixtures                 | `buildValidModeBBundle()` + concrete-param mutations; C' is recomputed for the tampered params so violations fail R17/R11–R13, not R6/R8                                                                                                                                    | Isolates the predicate-soundness failure from the binding rules                                                                                                         |
| Prevention layer         | `preventionLayer: "predicate-guard"` when the guard blocks before settlement; verifier R17 audits regardless                                                                                                                                                                | Distinguishes guard prevention (B3) from audit-only detection (B2)                                                                                                      |
| Artifacts                | `experiments/benchmarks/p5-attack-matrix.md` + `p5-results.json` via `bun run e2e:phase4b`; separate from the Phase 3 matrix                                                                                                                                                | Paper can cite P5 evaluation without redundant Mode A duplication                                                                                                       |
| HTTP surface             | `services/attack-simulator` predicate endpoints (`/attacks/predicate`, `/benchmark/predicate`, …) + orchestrator `POST /attack/predicate/:attackName`                                                                                                                       | Mirrors the Phase 3 attack API for Mode B                                                                                                                               |
| Demo copy                | Visitor-facing labels in `apps/web-demo/src/lib/demo-copy.ts`: Mode A = "You approve each payment" (human-present checkout), Mode B = "You set limits, agent pays" (agent-delegated spending). Internal terms (Mode A/B, R17, C', fixture IDs) only render in research mode | A general visitor cannot parse "Binding/Predicate (Mode A/B)"; commerce language explains the scenario while research mode preserves protocol identifiers for the paper |
| Predicate attack anatomy | `runPredicateAttack` returns a `PredicateAttackAnatomy` (signed predicate vs agent attempt, mutations, prevention narrative) built from an honest `buildValidModeBBundle()` baseline + the tampered fixture bundle                                                          | Gives the Mode B UI the same explanatory depth as the Mode A `AttackAnatomy`; visitors see what the human signed and what the agent tried                               |

## Phase 5 (Interactive live demo)

| Decision           | Choice                                                                                                                                         | Rationale                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Demo data path     | Live HTTP services on the happy path; in-process traces remain only as research/build fixtures                                                 | The walkthrough now demonstrates the real service boundary: orchestrator, identity, mandate, merchant, evidence, verifier, and anchor |
| Browser to backend | Next.js Route Handlers under `apps/web-demo/src/app/api/demo/*`                                                                                | Avoids CORS across Fastify services and keeps service URLs/RPC details server-side                                                    |
| Session state      | `DemoRunProvider` + `sessionStorage` + URL `mode`/`traceId` sync                                                                               | Steps 1-8 share `intentId`, `mandateId`, and `traceId` without re-running the flow                                                    |
| Wallet mandates    | Browser wallet signs prepared mandate payloads; BFF attaches the signature and `mandate-service` verifies before storing                       | Keeps the human signature in the browser while services enforce AP2/CLB validity                                                      |
| Mode B HTTP        | `runDelegatedOverHttp` mirrors the in-process delegated flow using live services and a registered INTENT predicate mandate                     | Phase 5 resolves the Phase 4 transport gap and makes R17 visible in the demo                                                          |
| Anchor UX          | Anchor page computes trace hash from `{ traceId, merkleRoot, eventHashes }`, posts to evidence-service, and reads `isAnchored` when configured | Fixes the certificate-hash display bug and gives clear `PENDING_CONTRACT` setup feedback                                              |
| Chain default      | Anvil (`CHAIN_ID=31337`, `RPC_URL=http://127.0.0.1:8545`)                                                                                      | Local demos and CI are deterministic; Base Sepolia is an explicit environment switch                                                  |

## Phase 5b (Agent commerce narrative UX)

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Story arc | Insert **quote** + **checkout** steps; mandate is sign-only | Separates human authorization from the visible 402 → settle climax |
| Discovery | Deterministic heuristic selection + animated activity log; decoy merchant in identity seed | Shows agent choice without LLM or manual merchant picker |
| Checkout | Manual **Agent pays** click; probe real 402 before `POST /run` | User watches payment drama; Mode B still has only one wallet signature |
| Session | Extended `DemoRunProvider` with `discovery`, `quote`, `checkoutStage`, step gates | Steps 1–10 share state with friendly empty states |
| Payment page | Reframed as **receipt**; run button removed from happy path | Payment no longer completes before user reaches the receipt step |

## Phase 7 (v2) — Research contribution hardening

v1 (Phases 0–6) is a working but largely mock demo; Phase 7 makes it real for a conference paper.
Decomposed into 7 sub-phases (plans `phase_7a_*` … `phase_7g_*`; spec
`docs/superpowers/specs/2026-06-04-phase-7-sub-phases-design.md`; umbrella overview
`plans/phase_7_research_contribution_hardening_3f3rdfgdf3.plan.md`). Decisions are recorded here as each
sub-phase lands.

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Headline contribution | On-chain enforcement: a predicate-violating Mode B settlement **reverts on-chain** (7A), not just fails the R17 audit | Owner decision 2026-06-04; the uncontested "green cell"; Five-Attacks repro builds on it |
| Real vs mock posture | **Real core + swappable adapters** — real ERC-8004 identity (7B) + real on-chain enforcement (7A) on the happy path; facilitator/registry/enforcer stay adapter-isolated with deterministic mock fallback | Conference credibility without live-demo fragility |
| `valueAtomic` in C′ | Fold `valueAtomic` (uint) **inside** the C′ commitment (7A) | Removes the Phase 4 "Amount on-chain" parallel-field simplification so the committed value == the on-chain compare |
| ERC-7710 enforcer | Promote `PredicatePaymentGuard.sol` to a real enforcer (default, demo-labelled) + add a `CLBCaveatEnforcer` ERC-7710 seam for the MetaMask Delegation Framework (7A) | ERC-7710 + MetaMask toolkit are audited/production (June 2026); hardened enforcer is future work |
| Delivery binding | R14 stays timestamp; add **R14b** binding delivery to `settlementTxHash` (7B); framed as accountability, **not** atomicity (cite A402) | Cryptographic dispute evidence without overclaiming fair exchange |
| Formal track | Tamarin P1–P5 over the **composed** protocol, run in **parallel** (7C); attack-found→patched-model is an acceptable, publishable degrade | Answers "Five-Attacks has proofs"; de-risk early |
| Baselines | Replace narrative `LOGICAL_BASELINE_OUTCOMES` with **runnable** verifiers (7D) | A reviewer must see the weaker stack accept a trace CLB rejects |
| Validation Registry | New `CrossLayerBindingValidator` type; **adapter-isolated** because the ERC-8004 Validation Registry ABI is still in revision (7E); `zkmlDigest` reserved | Economic loop no competitor closes, without coupling to a moving spec |
| Confidential variant | **Optional** (7F); degrade to selective-disclosure-only if range-proof tooling is too heavy | Privacy answer to the leakage critique; must not block the paper |

## Phase 7F (landed) — Confidential commit-and-prove (full path, not degraded)

Design of record: `plans/phase_7f_confidential_commit_prove_95a409ec.plan.md` + spec §5 (7F). The decision-gate spike confirmed `@noble/curves` runs cleanly under Bun, so the **full** range-proof path shipped (not the selective-disclosure-only degrade).

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Range-proof construction | Pedersen commitments on secp256k1 + a **bit-decomposition OR-proof** that `delta = maxValue − value ∈ [0, 2^64)` (Fiat–Shamir; the Confidential-Transactions/Borromean predecessor to Bulletproofs), in `packages/clb-core/src/confidential.ts` | Genuinely sound, pure-TS, Bun-native; no WASM/native deps. Soundness rests on the unknown dlog of the NUMS generator `H` vs `G`; the verifier recomputes `C_delta = maxValue·G − C` so Pedersen binding forces an in-range delta ⇒ `value ≤ maxValue` |
| Swappable adapter | `@noble/curves` is imported in **exactly one file** (`confidential.ts`); consumers use `commitConfidential`/`verifyConfidential` via the `@clb-acel/clb-core` re-export | A Bulletproof/WASM backend can replace the proof system without touching clb-core's consumers (verifier, e2e) |
| Proof size | Linear ~24 KB per 64-bit proof (captured as `rangeProofByteSize` in the benchmark) | Honest cost of the non-logarithmic construction; acceptable for the demo, and the adapter seam leaves room for a logarithmic Bulletproof later |
| `maxValue` is public | The human-signed cap is **not** embedded in the on-chain blob; the verifier supplies it from the predicate | Keeps the blob free of the exact value even when `value == maxValue`; matches the "public range / cap, private amount" model |
| Selective disclosure | `services/evidence-service/src/encrypted-payload.ts`: AES-256-GCM encrypt payee/amount/cart to an off-chain blob behind a swappable `BlobStore` (in-memory/filesystem now, S3/MinIO drop-in); event keeps only a public `objectHash` digest + `privateRef`. Blobs are lowercase hex so ciphertext can never contain an uppercase plaintext substring | Delivers the deferred ACEL.md §4 design; key from `EVIDENCE_ENCRYPTION_KEY` hardened to 32 bytes via SHA-256 |
| Confidential verification | `verifyTrace(bundle, { confidential: true })` discharges **R11** via `verifyConfidential(...)` instead of reading `settlement.value`; `readPlaintextAmount` is left `undefined` on this proof-only path. Standard plaintext path unchanged | Proves the amount predicate without the verifier ever seeing the value; R11 still **fails** when the committed value exceeds the cap (range proof rejects) |
| Acceptance | `bun run e2e:phase7-confidential` → "CONFIDENTIAL PASS — payee/amount not revealed on-chain"; deterministic `experiments/benchmarks/phase7-confidential.json` (seeded RNG + fixed salt for reproducibility; production uses the secure CSPRNG) | Full-path acceptance met: payee + exact amount hidden on-chain, all three package suites green |

## Phase 7E (landed) — Economic loop: real canonical ERC-8004 (Identity now, Validation pre-wired)

Design of record: `docs/superpowers/specs/2026-06-05-phase-7e-real-demo-canonical-erc8004-feasibility.md`.
"Cost" is three independent axes — **effort** (hours/lines; discounted, owner has time), **blast radius**
(how much working 7A/7B code a change can break), and **external-dependency risk** (reliance on a moving
ABI / a maybe-absent contract). Effort discounted → the decision is driven by blast radius + external risk.

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| B-first | Make **Identity** real/canonical (low blast radius, low external risk — it is live + stable + public); keep `CrossLayerBindingValidator` as **our own** deterministic contract for the validation loop | Identity, not Validation, is the piece safe to make real today; our own validator keeps the paper reproducible with no dependency on a registry that may not exist |
| **O1 resolved — NEGATIVE** | No canonical ERC-8004 **Validation Registry** is deployed on Base Sepolia (or any network) per the authoritative `erc-8004-contracts` README. The ABI **is** published (`abis/ValidationRegistry.json` + `ValidationRegistryUpgradeable.sol`) but unwired to any deployment | Verified 2026-06-05. The Validation Registry "remains under active discussion with the TEE community." A search-surfaced address `0x8004C269…` was **unverified** and discarded |
| Canonical validation mode | Adapter `canonical` mode is **fully wired** against the confirmed ABI (`validationRequest`/`validationResponse`/`getValidationStatus`) but **gated off**: `createValidationRegistry` throws unless `canonicalValidationConfirmed=true`. Flipping it is the only change needed the day a registry deploys | "Implemented but gated" beats a stub — O1 positive becomes a config flip + integration test, not a rewrite |
| Identity reader | `ERC8004_IDENTITY_MODE=canonical` adds a read-only reader over `0x8004A818…`; pure `mapCanonicalToCard` turns `ownerOf`/`tokenURI`/`getAgentWallet` → our `AgentCard`, leaving `schemas` + verifier R3/R4 untouched | One-file blast radius (`canonical-reader.ts`); `agentId` stays a string holding the decimal `uint256` tokenId |
| Validator → canonical field map | `CrossLayerBindingValidator` records `(certificateHash, result, merkleRoot, settlementTxHash, zkmlDigest, timestamp)` chosen so the entry maps 1:1 to `validationResponse(requestHash=certificateHash, response=result?100:0, responseURI, responseHash=merkleRoot, tag="CrossLayerBindingValidator")` | The same record can be replayed to the canonical registry with no schema change; `tag` carries the new validator-type name |
| `zkmlDigest` | Reserved (`0x0`), documented as future, not implemented | Aligns with the zkML/Validation-Registry research thread without scope creep |
| One entry per trace | A second `recordValidation` for the same `traceId` reverts `AlreadyValidated` | Mirrors the `AgenticAuditAnchor` one-anchor-per-trace rule |
| Confirmed addresses (Base Sepolia, chain 84532) | Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e` (ERC-721 `AgentIdentity`/`AGENT`), Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`. Earlier guesses `0x7177…` (identity) and `0x662b40A5…`/`0x8004C269…` (validation) are **wrong** | Cross-checked against the live contract via `cast` + the authoritative repo ABIs |
| Live registration | `setup:register-canonical` runs `register(agentURI)` then EIP-712 `setAgentWallet`. Domain = `EIP712("ERC8004IdentityRegistry","1")` at the registry; typehash `AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)`; the **wallet** signs consent, the owner (deployer) submits; deadline ≤ 5 min | Confirmed from `IdentityRegistryUpgradeable.sol`; resolves the plan's open `setAgentWallet` TODO. Idempotent via `experiments/canonical-agents.json` |
| tokenURI card format | Canonical agents publish ERC-8004 `registration-v1` JSON (often a base64 `data:` URI), **not** our `AgentCard` shape. Our reader's `fetchAgentCard` parses our schema, so the canonical reader is scoped to **our** demo agents (registered with an `AgentCard`-serving URI) | Noted caveat; a registration-v1 ↔ AgentCard bridge is follow-on if we want to read arbitrary canonical agents |

## Phase 7B (landed) — Real identity + evidentiary delivery

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Identity adapter switch | `createIdentityRegistry()` / `createIdentityRegistryFromEnv()` — **on-chain** when `RPC_URL_BASE_SEPOLIA` + `ERC8004_REGISTRY_ADDRESS` are set; **in-memory mock** otherwise | Happy path resolves a live ERC-8004 card on Base Sepolia; CI/offline stays deterministic. Identity service skips seeding when `kind === "onchain"` |
| On-chain reader ABI | `MockERC8004IdentityRegistry` views (`getAgent`, `getAuthorizedPaymentKeys`, `getAuthorizedSigningKeys`) + `agentURI` card fetch | Matches the deployable mock and the repo's existing Solidity mirror; official ERC-8004 registry can replace the address without TS changes |
| Delivery binding | Merchant signs `keccak256(settlementTxHash, reportHash)` as `deliveryBinding` on the report; **R14b** verifies it | Cryptographic dispute evidence binding delivery to *this* settlement |
| R14 unchanged | Timestamp check `generatedAt >= settledAt` remains **R14**; R14b is additive | Preserves Phase 2 semantics; binding is a separate accountability layer |
| Accountability framing | R14/R14b = accountability/dispute evidence, **not** payment–delivery atomicity; cite **A402** ([arXiv:2603.01179](https://arxiv.org/abs/2603.01179)) as the fair-exchange alternative we do not claim | Honest scope per CONTEXT §28 and Phase 7 spec §5 (7B) |
| Auto-anchor | `runHumanPresentOverHttp` + `runDelegatedOverHttp` call `createAnchorClientFromEnv()` after PASS; non-fatal `catch(() => {})` | Merkle root written to `AgenticAuditAnchor` on every successful HTTP demo; no-op when `AUDIT_ANCHOR_ADDRESS` unset |
| x402 chain mode | `X402_FACILITATOR_MODE=chain` + funded wallets → real Base Sepolia txHash; `X402_PAY_TO_ADDRESS` drives merchant `payTo` | Documented in `docs/testnet-setup.md`; offline default remains `local` |

## Phase 7A (landed) — On-chain predicate enforcement

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| `valueAtomic` representation | Add `valueAtomic` to `SettlementParams` as an **integer-base-units decimal string** (`z.string().regex(/^\d+$/)`), encoded as `uint256` in the C′ digest (8th field, right after `value`); derived in `settlementParamsFromExact` via `parseUnits(value, 6)` | Matches the existing `value: string` convention, avoids bigint/JSON-serialization landmines across HTTP + evidence, and keeps the human-readable decimal for display |
| C′ parity | Regenerated `GOLDEN_PARAMS_DIGEST`/`COMMITMENT`/`NONCE`; `test_ParityWithClbCore` proves byte-exact TS↔Solidity agreement | The on-chain compare and the committed quantity are now provably the same |
| On-chain enforcement | Reuse the existing `validateAndConsume` (typed reverts + single-use `nonce=H(C')`), folding `valueAtomic` into the struct and dropping the separate amount arg — **no** parallel `settleIfPredicateHolds` API | The contract already enforced payee/asset/chain/amount/expiry; the only gap was the unbound amount. Gas: `validateAndConsume` ≈ 50.6k |
| `via_ir` | Enabled in `foundry.toml` | The 8th struct field tipped `validateAndConsume` over the legacy stack limit; `via_ir` resolves it without changing runtime keccak digests |
| Off-chain vs on-chain guard | `ContractPredicateGuard.settleOnChain` **always** broadcasts the tx (the contract is the enforcer) and maps a typed revert to `{ reverted, reason }`; `assertSettlementAllowed` stays off-chain-authoritative | `assertSettlementAllowed` throws before any tx, so a genuine on-chain revert needs a dedicated path; non-revert errors propagate (not swallowed) |
| Orchestrator wiring | `runDelegatedOverHttp` accepts an `onchainGuard` and surfaces `onchain: { reverted, reason?, txHash? }`; default flow stays in-memory | Opt-in real settlement on the happy path; the violation revert is proven end-to-end by `e2e:phase7-caveat` on Anvil |
| ERC-7710 seam (demo vs production) | Ship `CLBCaveatEnforcer.sol` as an **interface-shaped stand-in** that reverts `CaveatPredicateViolation` on a predicate violation; **not** wired to the live MetaMask Delegation Framework `beforeHook(...)`/EIP-712 redemption | Honest seam for the production-delegation story. The bulletproof headline is the **real** revert in `PredicatePaymentGuard`; a hardened, audited, DTF-wired enforcer remains future work. No half-wired `erc7710` TS guard mode was added (would be dead code without a real DTF) |
