# Full Project Context — Unified Implementation Context for CLB + Evidence Graph Demo

**Project codename:** CLB-ACEL  
**Full idea:** Cross-Layer Binding (CLB) inside an Agentic Commerce Evidence Layer (ACEL).  
**ACEL Documentation:** ACEL.md
**CLB Documentation:** CLB.md
**Purpose of this file:** Persistent context for Codex, Claude Code, Cursor, or any coding agent working on this repository. Treat this as the source-of-truth implementation brief unless `DECISIONS.md` overrides a point.

---

## 0. Non-negotiable instruction for coding agents

Do not build a generic “AI blockchain payment app.” Build a research-grade production demo that proves a specific claim:

> A transaction executed by an AI agent can be cryptographically and auditably bound across identity, authorization, checkout/task state, settlement, delivery, and feedback.

The core research contribution is **Cross-Layer Binding (CLB)**:

```txt
ERC-8004 identity + AP2 authorization + x402 settlement
```

The production demo wrapper is **Agentic Commerce Evidence Layer (ACEL)**:

```txt
Evidence collection + evidence graph + deterministic verifier + audit anchor + attack simulator
```

CLB should prevent or detect binding-class failures. ACEL should collect, visualize, verify, benchmark, and explain them.

---

## 1. User/project context

The human owner wants to build a real production-quality demo with testnet settlement and real LLM/ML agents. Available resources:

- AWS credits for deployment.
- Google Colab Pro for ML/risk-model experiments and evaluation notebooks.
- MacBook Pro M4 for local development.
- OpenAI/Grok credits for LLM-based agents.
- Can obtain additional infrastructure if technically justified.

The owner wants an original, defensible AI + blockchain research contribution, not a shallow integration demo.

### Standing research goal

Whenever implementing, keep asking:

```txt
What new failure mode appears when AP2, ACP, x402, and ERC-8004 are composed?
Can CLB/ACEL detect or prevent it?
Can we measure the cost of this prevention/detection?
```

---

## 2. Current public protocol assumptions to respect

These points were checked against current public documentation around May 2026. Re-check official docs before major implementation changes.

### x402

- x402 is an HTTP-native payment protocol using the HTTP `402 Payment Required` pattern.
- The `exact` scheme is the practical starting point for exact-amount API/resource payments.
- A facilitator can verify and settle payments for the resource server.
- For demo v1, prefer **Base Sepolia + USDC-like test token + x402 exact**.
- Coinbase/x402 and Stripe/Cloudflare docs may differ in SDK maturity. Prefer official SDKs where stable, otherwise isolate x402 integration behind an adapter.

### AP2

- AP2 centers on cryptographically signed mandates / verifiable credentials.
- Important mandate concepts:
  - Intent Mandate: pre-authorized constraints for human-not-present flows.
  - Cart Mandate: finalized cart/checkout state for human-present flows.
  - Payment Mandate: payment authorization/liability signal.
- For v1, build AP2-compatible mandate objects and verification logic. If the official SDK is unstable, implement a faithful typed JSON/EIP-712/VC-like model behind `packages/ap2-adapter`.

### ERC-8004

- ERC-8004 provides trustless agent identity/reputation/validation registries.
- Identity is the primary v1 need:
  - `identity_ref = (chainId, registryAddr, agentId)`.
  - Agent card/URI should list service endpoint(s), public signing key(s), and payment key(s).
- Reputation/validation is v2 unless easy to mock.

### ACP

- ACP is a commerce protocol for agentic checkout flows.
- In this project, ACP is part of the **evidence/audit graph**, not the core CLB cryptographic proof.
- v1 can implement an ACP-like checkout/task object with compatible schemas. Real ACP compatibility can be added after CLB works.

---

## 3. Unified concept

### 3.1 CLB: the narrow protocol contribution

CLB binds three independently keyed layers:

```txt
Identity layer:      ERC-8004 agentId / agent card / key authorization
Authorization layer: AP2 mandate digest / user constraints
Settlement layer:    x402 payment requirement and on-chain settlement
```

Central commitment:

```txt
C = H(identity_ref || mandate_digest || settlement_descriptor)
```

Recommended hash/signing format:

```txt
H = keccak256 over canonical EIP-712 typed data
```

CLB target claim:

```txt
The agent that was trusted is the agent that was authorized is the key that paid,
for exactly one fresh transaction.
```

### 3.2 ACEL: the broader system wrapper

ACEL watches the whole transaction and builds a tamper-evident trace:

```txt
User intent
  -> ERC-8004 identity resolution
  -> AP2 mandate
  -> ACP-like checkout/task object
  -> x402 payment requirement
  -> x402/on-chain settlement
  -> delivery artifact
  -> verification certificate
  -> optional ERC-8004 feedback/reputation reference
```

ACEL target claim:

```txt
A deterministic evidence graph can detect cross-protocol inconsistencies that are missed when each protocol is verified in isolation.
```

### 3.3 Relationship between the two

Do not treat CLB and ACEL as separate apps.

```txt
CLB = core cryptographic/protocol binding.
ACEL = production demo, observability, audit, attack simulator, and paper evaluation layer.
```

---

## 4. Demo product/use case

Build a concrete paid-agent scenario. Recommended v1:

> A user asks a shopping/research agent to buy a token-risk report from a verified analysis agent/API, with a spending limit such as 2 USDC.

Why this use case:

- It naturally fits x402 paid API calls.
- It allows real LLM/ML inference.
- It avoids physical shipping complexity.
- Delivery can be represented as `report_hash`.
- The merchant/seller can be another agent registered with ERC-8004.
- The benchmark can simulate malicious merchants, malicious shopping agents, replay, amount substitution, payee substitution, and fake delivery.

Example user prompt:

```txt
Buy me a token-risk report for token XYZ.
Use only verified analysis agents.
Spend at most 2 test USDC.
Do not pay if the report provider is not registered.
```

Normal successful trace:

```txt
1. User creates AP2 Intent Mandate or Cart/Payment Mandate.
2. Shopping Agent resolves Analysis Agent via ERC-8004 identity.
3. Analysis Agent exposes `/risk-report` protected by x402.
4. Shopping Agent receives `402 Payment Required`.
5. CLB computes commitment C.
6. Payment nonce or settlement authorization is pinned to H(C).
7. x402 settlement happens on testnet.
8. Analysis Agent returns a signed report.
9. ACEL logs evidence events and anchors Merkle root.
10. Deterministic verifier returns `TRACE_VERIFIED`.
11. Optional feedback/reputation reference is created from the verification certificate.
```

---

## 5. Core actors and keys

| Actor                   | Implementation                           | Key/identity                                   | Role                                      |
| ----------------------- | ---------------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| Human Principal         | Web UI + wallet                          | `k_user` / wallet / DID-like id                | Creates mandates and constraints          |
| Shopping Agent          | Node.js/TypeScript agent service         | ERC-8004 `agentId`, signing key, payment key   | Plans and executes purchase               |
| Merchant/Analysis Agent | x402-protected API service               | ERC-8004 `agentId`, service key, payTo address | Sells token-risk report                   |
| Mandate Service         | AP2 adapter service                      | issuer/verifier key                            | Issues/verifies mandate objects           |
| Facilitator             | Hosted x402 facilitator or local adapter | facilitator key/service                        | Verifies/settles x402 payment             |
| Evidence Collector      | Middleware/library                       | service signing keys                           | Emits signed canonical evidence events    |
| Deterministic Verifier  | Python/TypeScript service                | no LLM                                         | Checks invariants and outputs certificate |
| Audit Anchor            | Solidity contract                        | deployer/admin                                 | Stores trace/Merkle roots on testnet      |
| Attack Simulator        | Python/TypeScript scripts                | adversarial keys                               | Reproduces composition attacks            |

Important: LLMs may plan, summarize, or choose tools, but **LLMs must not be trusted for verification**. The verifier must be deterministic.

---

## 6. Required security properties

Implement and test these as first-class invariants.

### P1 — Identity binding

The settled payer key must be authorized by the ERC-8004 `agentId` named in the mandate.

```txt
settled_payer_key ∈ agent_card.authorizedPaymentKeys
mandate.identity_ref.agentId == resolved_agent.agentId
```

### P2 — Authorization integrity

For human-present exact flow:

```txt
settled(asset, to, value) == authorized(asset, to, value)
```

For human-not-present delegated/predicate flow:

```txt
predicate_pi(settled_params) == true
```

### P3 — Freshness / non-replay

Each mandate/CLB commitment can lead to at most one successful settlement.

```txt
nonce == H(C)
nonce_status == consumed_once
```

### P4 — Non-transferability

A mandate cannot be transplanted to a different:

```txt
agent identity
merchant/payee
chain/network
asset
amount
cart/task
expiry window
```

### P5 — Predicate soundness

For delegated/human-not-present Mode B, no settlement violating the signed predicate can complete.

---

## 7. CLB modes

### Mode A — Human-present exact payment

Use this for the first working demo.

Settlement descriptor:

```ts
type SettlementDescriptorExact = {
  chainId: number;
  network: string;
  asset: string;
  payTo: `0x${string}`;
  value: string;
  validBefore: string;
  x402Scheme: "exact";
};
```

Commitment:

```txt
C = keccak256(EIP712(identity_ref, mandate_digest, settlement_descriptor))
```

Payment binding:

```txt
x402/EIP-3009 nonce or adapter nonce = H(C)
```

Verifier checks:

```txt
human signature covers C
agent identity exists and authorizes payer key
settlement params match descriptor
nonce == H(C)
nonce consumed exactly once
chainId/domain match
```

### Mode B — Human-not-present delegated/predicate flow

Use this after Mode A works.

At authorization time, exact settlement params are unknown. The human signs a predicate.

Minimal predicate language:

```ts
type SpendingPredicate = {
  allowedAssets: string[];
  allowedPayees: `0x${string}`[];
  maxValue: string;
  validUntil: string;
  allowedChainIds: number[];
  allowedAgentIds: string[];
  taskHash?: `0x${string}`;
};
```

Commitment:

```txt
C_prime = H(identity_ref || mandate_digest || predicate_id || concrete_settlement_params)
```

Enforcement target:

```txt
Smart-account caveat / delegation checks predicate before transfer.
```

If ERC-7710 or account-abstraction tooling is not stable enough, implement an explicit `PredicateEscrow` or `PredicatePaymentGuard` contract for the demo, but label it as an adapter/mocking layer.

---

## 8. Evidence graph model

### 8.1 Canonical event

Every service should emit signed canonical events.

```ts
type EvidenceEvent = {
  traceId: string;
  eventId: string;
  protocol:
    | "USER"
    | "ERC8004"
    | "AP2"
    | "ACP"
    | "X402"
    | "CHAIN"
    | "DELIVERY"
    | "VERIFIER"
    | "ATTACK";
  objectType: string;
  actor: string;
  timestamp: string;
  objectHash: `0x${string}`;
  previousEventHash?: `0x${string}`;
  publicFields: Record<string, unknown>;
  privateRef?: string;
  signature: `0x${string}`;
};
```

### 8.2 Evidence nodes

```ts
type EvidenceNode =
  | "USER_INTENT"
  | "ERC8004_AGENT_IDENTITY"
  | "AP2_INTENT_MANDATE"
  | "AP2_CART_MANDATE"
  | "AP2_PAYMENT_MANDATE"
  | "ACP_CHECKOUT_OR_TASK"
  | "X402_PAYMENT_REQUIREMENT"
  | "X402_PAYMENT_PAYLOAD"
  | "CHAIN_SETTLEMENT"
  | "DELIVERY_PROOF"
  | "VERIFICATION_CERTIFICATE"
  | "ERC8004_FEEDBACK";
```

### 8.3 Evidence edges

```ts
type EvidenceEdge =
  | "AUTHORIZES"
  | "BINDS_TO"
  | "PAYS_FOR"
  | "SETTLES"
  | "DELIVERS"
  | "VALIDATES"
  | "RATES";
```

### 8.4 Hash chain

Events should form a tamper-evident chain:

```txt
intent -> identity -> mandate -> checkout/task -> payment requirement -> payment payload -> settlement -> delivery -> verification
```

Each event hash:

```txt
event_hash = keccak256(canonical_json(event_without_signature))
```

Merkle root:

```txt
trace_root = merkle_root(event_hashes)
```

Audit anchor:

```txt
onchain_anchor(traceId, traceRoot, traceHash, metadataURI)
```

---

## 9. Deterministic verifier requirements

The verifier is the research heart. It must be explainable, testable, and independent of any LLM.

### 9.1 Verification result

```ts
type VerificationResult = {
  traceId: string;
  status: "PASS" | "FAIL" | "WARNING";
  failedRules: string[];
  warnings: string[];
  certificateHash: `0x${string}`;
  checkedAt: string;
  mode: "MODE_A_EXACT" | "MODE_B_PREDICATE";
};
```

### 9.2 Rules to implement

```txt
R1_HASH_CHAIN_INTACT
R2_SIGNATURES_VALID
R3_AGENT_IDENTITY_RESOLVES
R4_AGENT_PAYMENT_KEY_AUTHORIZED
R5_MANDATE_SIGNATURE_VALID
R6_CLB_COMMITMENT_RECOMPUTES
R7_SETTLEMENT_PARAMS_MATCH_DESCRIPTOR
R8_PAYMENT_NONCE_EQUALS_HASH_C
R9_NONCE_CONSUMED_EXACTLY_ONCE
R10_CHAIN_DOMAIN_MATCHES
R11_AMOUNT_WITHIN_MANDATE
R12_PAYEE_MATCHES_CHECKOUT_OR_TASK
R13_ASSET_ALLOWED
R14_DELIVERY_AFTER_SETTLEMENT
R15_DELIVERY_HASH_MATCHES_TASK
R16_FEEDBACK_REQUIRES_VERIFIED_TRACE
R17_PREDICATE_TRUE_FOR_MODE_B
```

### 9.3 Example pseudo-code

```ts
function verifyTrace(trace: EvidenceGraph): VerificationResult {
  assertHashChain(trace.events);
  assertEventSignatures(trace.events);

  const identity = trace.get("ERC8004_AGENT_IDENTITY");
  const mandate = trace.getMandate();
  const settlement = trace.get("CHAIN_SETTLEMENT");
  const delivery = trace.getOptional("DELIVERY_PROOF");

  const C = recomputeCLBCommitment(identity, mandate, settlement.descriptor);

  assert(mandate.signedCommitment === C, "CLB_COMMITMENT_MISMATCH");
  assert(
    identity.authorizedPaymentKeys.includes(settlement.payer),
    "AGENT_KEY_MISMATCH",
  );
  assert(settlement.nonce === hash(C), "NONCE_MISMATCH");
  assert(settlement.consumedExactlyOnce, "REPLAY_OR_NONCE_NOT_CONSUMED");
  assert(settlement.chainId === identity.chainId, "CHAIN_DOMAIN_MISMATCH");

  if (trace.mode === "MODE_B_PREDICATE") {
    assert(
      evaluatePredicate(mandate.predicate, settlement.params),
      "PREDICATE_VIOLATION",
    );
  }

  if (delivery) {
    assert(delivery.createdAfter(settlement), "DELIVERY_BEFORE_SETTLEMENT");
    assert(delivery.taskHash === mandate.taskHash, "DELIVERY_TASK_MISMATCH");
  }

  return passCertificate(trace);
}
```

---

## 10. Attack simulator

Implement attacks as reproducible fixtures. Each attack should generate a full trace and expected verifier result.

| Attack                       | Description                                               | Expected result                                                   |
| ---------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `PAYEE_SUBSTITUTION`         | AP2/checkout authorizes Merchant A, x402 pays Wallet B    | `PAYEE_MISMATCH`                                                  |
| `AMOUNT_ESCALATION`          | User max is 2, settlement is 3                            | `AMOUNT_EXCEEDS_MANDATE`                                          |
| `ASSET_SWITCH`               | Mandate allows USDC, settlement uses another token        | `ASSET_NOT_ALLOWED`                                               |
| `CHAIN_TRANSPLANT`           | Same mandate replayed on wrong chain                      | `CHAIN_DOMAIN_MISMATCH`                                           |
| `AGENT_IDENTITY_SWAP`        | Trusted Agent A identity, Agent B payment key             | `AGENT_KEY_MISMATCH`                                              |
| `MANDATE_REPLAY`             | Same commitment/nonce used twice                          | `REPLAY_OR_NONCE_NOT_CONSUMED`                                    |
| `CART_OR_TASK_SWITCH`        | User authorized task X, delivery/payment linked to task Y | `TASK_OR_CHECKOUT_MISMATCH`                                       |
| `PAYMENT_WITHOUT_DELIVERY`   | Settlement completed, no report or bad report hash        | `DELIVERY_MISSING_OR_MISMATCH`                                    |
| `FAKE_FEEDBACK`              | ERC-8004 feedback without verified trace                  | `FEEDBACK_WITHOUT_VERIFIED_TRACE`                                 |
| `PROMPT_INJECTION_SELECTION` | Agent chooses malicious merchant despite user constraint  | `POLICY_OR_CONSTRAINT_VIOLATION` if logged constraints capture it |

Do not claim CLB solves agent decision quality. CLB proves transaction binding. ACEL can provide evidence for decision-layer analysis only if constraints and candidate-selection metadata are logged.

### 10.1 Mode A binding attacks (Phase 3)

The table above covers **human-present exact flow (Mode A)** — properties P1–P4. Implement as reproducible fixtures in `packages/attack-core` with baseline matrix B0–B3 (Phase 3).

### 10.2 Mode B predicate attacks (Phase 4 follow-up, Option A)

Build **after Phase 4 foundation** ships. Do **not** re-run all Mode A attacks in Mode B — the same binding failures map to R17 instead of R11–R13 and add little research value. Instead, add a **separate P5-focused fixture set** for delegated/human-not-present flow (property P5: predicate soundness).

| Attack | Description | Expected result | Primary rule |
| ------ | ----------- | --------------- | ------------ |
| `PREDICATE_PAYEE_VIOLATION` | Settlement payee ∉ `allowedPayees` | `PREDICATE_VIOLATION` | R17 |
| `PREDICATE_AMOUNT_VIOLATION` | Settlement value > `maxValue` | `PREDICATE_VIOLATION` | R17 |
| `PREDICATE_ASSET_VIOLATION` | Settlement asset ∉ `allowedAssets` | `PREDICATE_VIOLATION` | R17 |
| `PREDICATE_EXPIRED` | Settlement after `validUntil` | `PREDICATE_VIOLATION` | R17 |
| `PREDICATE_HAPPY_PATH` | Agent settles within signed π | PASS | R17 ok |

**UI (Option A):** `/attacks` screen uses two tabs — **Binding attacks (Mode A)** (existing 10 fixtures) and **Predicate attacks (Mode B)** (fixtures above). Do not merge into one 20-row matrix.

**P5 baseline matrix** (separate artifact `experiments/benchmarks/p5-attack-matrix.md`, not an extension of the Phase 3 10×4 table):

```txt
B0: vanilla x402 — predicate violation completes; undetected
B1: AP2 intent + x402 — no in-protocol π enforcement; undetected
B2: ACEL audit-only — R17 detects post-settlement; not prevented
B3: CLB + guard — predicate-guard prevents at settlement; R17 audit if bypass attempted
```

Extend `preventionLayer` to include `predicate-guard` (parallel to x402 replay prevention for `MANDATE_REPLAY` in Mode A).

**Explicitly out of scope for Mode B attacks:** duplicating `FAKE_FEEDBACK` / `PROMPT_INJECTION_SELECTION` (mode-agnostic audit-layer checks); re-implementing all 10 Mode A attacks under Mode B traces.

---

## 11. Repository architecture

Recommended monorepo:

```txt
clb-acel/
  AGENTS.md
  README.md
  DECISIONS.md
  SECURITY.md
  docker-compose.yml
  package.json
  bun-workspace.yaml

  apps/
    web-demo/                 # Next.js UI: create intent, run demo, view trace, attacks
    agent-orchestrator/       # Shopping agent, LLM tools, protocol orchestration
    merchant-agent-api/       # Analysis agent API, x402 protected risk-report endpoint
    admin-dashboard/          # Optional: traces, verification results, anchors

  services/
    mandate-service/          # AP2-style mandates, signing, verification
    verifier-service/         # Deterministic verifier API
    evidence-service/         # Event ingestion, graph builder, Merkle root builder
    identity-service/         # ERC-8004 adapter + agent card hosting
    attack-simulator/         # Attack fixtures and benchmark runner

  packages/
    schemas/                  # Zod/JSON schemas for events, mandates, descriptors
    clb-core/                 # Commitment, EIP-712 structs, nonce derivation
    evidence-core/            # Canonical JSON, event hash, Merkle utilities
    ap2-adapter/              # Official AP2 integration or faithful local adapter
    x402-adapter/             # x402 client/server/facilitator wrapper
    erc8004-adapter/          # Contract reads/writes, agent cards
    acp-adapter/              # ACP-like checkout/task schema, future real ACP integration
    agent-tools/              # Tool definitions for LLM agents

  contracts/
    foundry.toml
    src/
      AgenticAuditAnchor.sol
      MockERC8004IdentityRegistry.sol
      PredicatePaymentGuard.sol
    test/
    script/

  experiments/
    tamarin/                  # Formal model files
    notebooks/                # Colab ML/evaluation notebooks
    benchmarks/               # CSV/JSON benchmark outputs

  infra/
    aws/                      # Terraform/CDK for ECS/Lambda/RDS/S3/CloudWatch
    docker/                   # Dockerfiles
    github-actions/           # CI/CD workflows

  docs/
    protocol/
    threat-model.md
    paper-outline.md
    demo-script.md
    api-reference.md
```

---

## 12. Technology choices

### Default local stack

```txt
Package manager: bun
Frontend: Next.js + TypeScript
Backend APIs: Fastify or NestJS + TypeScript
Verifier: TypeScript for shared schemas, Python optional for formal/evaluation tooling
Contracts: Foundry preferred; Hardhat acceptable if x402 tooling requires it
Database: PostgreSQL
Queue/events: PostgreSQL outbox first; later SQS/EventBridge if needed
Storage: S3-compatible local/minio for encrypted evidence payloads
Chain local: Anvil
Testnet: Base Sepolia first
LLM: OpenAI or Grok behind provider adapter
ML: Python notebooks in Colab Pro for token-risk model/evaluation
Deployment: AWS ECS/Fargate or App Runner; avoid overcomplicated Kubernetes v1
```

### Why these choices

- TypeScript lets protocol schemas and app code share types.
- Python/Colab is useful for ML scoring and evaluation tables, but not required for core verifier if TS is faster.
- Foundry is clean for contract tests and gas reporting.
- PostgreSQL is enough for production demo trace storage.
- S3 stores encrypted full evidence; chain stores only roots/hashes.

---

## 13. Smart contracts

### 13.1 `AgenticAuditAnchor.sol`

Purpose: anchor trace root and timestamp.

Required functions:

```solidity
function anchorTrace(
    bytes32 traceId,
    bytes32 merkleRoot,
    bytes32 traceHash,
    string calldata metadataURI
) external;

function getTraceAnchor(bytes32 traceId) external view returns (...);
```

Rules:

- One anchor per `traceId` in v1.
- Emit `TraceAnchored` event.
- Do not store private raw evidence.

### 13.2 `MockERC8004IdentityRegistry.sol`

Purpose: practical v1 registry if official/testnet ERC-8004 contracts are unavailable.

Required fields:

```solidity
agentId
owner
agentURI
authorizedSigningKeys
authorizedPaymentKeys
status
```

Rules:

- Make it clear in UI/docs when mock registry is used.
- Adapter interface should allow replacing it with real ERC-8004 registry.

### 13.3 `PredicatePaymentGuard.sol`

Purpose: Mode B fallback if smart-account caveats are not stable enough.

Required checks:

```txt
allowed asset
allowed payee
max amount
validUntil
chain/domain
agentId
nonce = H(C')
```

Label this as demo guard, not final ERC-7710 implementation, unless real delegation support is implemented.

---

## 14. APIs to implement

### 14.1 Agent Orchestrator

```http
POST /intent
POST /run-human-present
POST /run-delegated
GET  /trace/:traceId
POST /attack/:attackName
```

### 14.2 Mandate Service

```http
POST /mandates/intent
POST /mandates/cart
POST /mandates/payment
POST /mandates/verify
GET  /mandates/:mandateId
```

### 14.3 Merchant/Analysis Agent API

```http
GET  /risk-report?token=XYZ
POST /risk-report
GET  /.well-known/agent-card.json
GET  /x402/payment-requirements
POST /x402/settle
```

`/risk-report` should be x402-protected.

### 14.4 Evidence Service

```http
POST /events
GET  /traces/:traceId
GET  /traces/:traceId/graph
POST /traces/:traceId/merkle
POST /traces/:traceId/anchor
```

### 14.5 Verifier Service

```http
POST /verify/:traceId
GET  /verify/:traceId/result
GET  /verify/:traceId/certificate
```

### 14.6 Identity Service

```http
POST /agents/register
GET  /agents/:agentId
GET  /agents/:agentId/card
POST /agents/:agentId/authorize-payment-key
```

---

## 15. Data schemas

### 15.1 Identity reference

```ts
type IdentityRef = {
  chainId: number;
  registryAddr: `0x${string}`;
  agentId: string;
};
```

### 15.2 Agent card

```ts
type AgentCard = {
  agentId: string;
  name: string;
  description: string;
  serviceEndpoints: string[];
  owner: `0x${string}`;
  authorizedSigningKeys: `0x${string}`[];
  authorizedPaymentKeys: `0x${string}`[];
  supportedProtocols: ("AP2" | "ACP" | "x402" | "ERC8004")[];
  metadataHash: `0x${string}`;
};
```

### 15.3 AP2-style mandate

```ts
type Mandate = {
  mandateId: string;
  type: "INTENT" | "CART" | "PAYMENT";
  humanPrincipal: string;
  authorizedAgent: IdentityRef;
  constraints: {
    maxAmount?: string;
    allowedAssets?: string[];
    allowedPayees?: `0x${string}`[];
    validUntil?: string;
    taskHash?: `0x${string}`;
    checkoutHash?: `0x${string}`;
  };
  clbCommitment?: `0x${string}`;
  parentMandateHash?: `0x${string}`;
  signature: `0x${string}`;
};
```

### 15.4 CLB commitment input

```ts
type CLBCommitmentInput = {
  identityRef: IdentityRef;
  mandateDigest: `0x${string}`;
  settlementDescriptor: SettlementDescriptorExact | PredicateDescriptor;
  domain: {
    name: "CLB-ACEL";
    version: "0.1";
    chainId: number;
    verifyingContract?: `0x${string}`;
  };
};
```

### 15.5 Verification certificate

```ts
type VerificationCertificate = {
  traceId: string;
  mode: "MODE_A_EXACT" | "MODE_B_PREDICATE";
  status: "PASS" | "FAIL";
  rulesChecked: string[];
  failedRules: string[];
  clbCommitment: `0x${string}`;
  settlementTxHash?: `0x${string}`;
  traceMerkleRoot: `0x${string}`;
  certificateHash: `0x${string}`;
  verifierVersion: string;
  createdAt: string;
};
```

---

## 16. LLM/agent behavior

### 16.1 Shopping Agent

The Shopping Agent may use LLMs for:

```txt
understanding user intent
choosing candidate merchant agents
summarizing token-risk report
explaining verification result
```

The Shopping Agent must not:

```txt
invent protocol evidence
skip mandate creation
skip identity lookup
pay unregistered merchant in verified mode
override verifier failures
hide failed verification from UI
```

### 16.2 Merchant/Analysis Agent

The Merchant Agent should:

```txt
serve an agent card
publish payment requirements
return signed report artifacts
log evidence events
support malicious mode for attack simulator
```

### 16.3 Verifier Agent

The “verifier agent” is not an LLM. It is deterministic code. An LLM may explain the result to the user after deterministic verification is complete.

---

## 17. Token-risk report demo details

The risk-report endpoint should return a structured artifact:

```ts
type TokenRiskReport = {
  token: string;
  chain: string;
  riskScore: number;
  signals: {
    liquidityRisk: number;
    holderConcentrationRisk: number;
    contractRisk: number;
    marketVolatilityRisk: number;
    socialNarrativeRisk?: number;
  };
  modelVersion: string;
  inputDataHash: `0x${string}`;
  reportHash: `0x${string}`;
  merchantAgentSignature: `0x${string}`;
  generatedAt: string;
};
```

For v1, risk scoring can be partially simulated with deterministic dummy data plus LLM-generated explanation. For research credibility, eventually add a Colab notebook that trains/evaluates or calibrates a simple risk model.

Important:

```txt
reportHash must bind the delivered report to the task paid for.
```

---

## 18. UI requirements

The web demo should make the protocol understandable.

**Phase 2** ships read-only screens backed by a deterministic in-process trace (stable hashes for research mode). **Phase 5** replaces this with a full interactive walkthrough over live HTTP services — see §21 Phase 5.

Required screens:

1. **Create Intent**
   - User enters task, budget, allowed asset, allowed agent/merchant.
2. **Agent Discovery**
   - Shows ERC-8004 identity resolution and agent card.
3. **Mandate Signing**
   - Shows AP2-style mandate and CLB commitment.
4. **x402 Payment Flow**
   - Shows 402 requirement, payment payload, settlement tx.
5. **Evidence Graph**
   - Visual graph of events and edges.
6. **Verifier Result**
   - PASS/FAIL with failed rules.
7. **Attack Simulator**
   - Run attacks and compare baseline vs CLB/ACEL.
8. **Audit Anchor**
   - Shows Merkle root and testnet transaction.

UI should include a “research mode” toggle that exposes hashes and protocol objects.

---

## 19. Evaluation plan

### 19.1 Baselines

Implement or simulate:

```txt
B0: vanilla x402 payment only
B1: AP2-style mandate + x402 without CLB nonce/commitment binding
B2: ACEL audit-only detection without in-protocol CLB enforcement
B3: CLB + ACEL full system
```

### 19.2 Metrics

```txt
attack detection/prevention rate
false positive rate
settlement latency overhead
verification latency
Merkle anchoring gas cost
predicate guard gas cost
storage overhead per trace
developer integration complexity
privacy leakage fields
```

### 19.3 Output files

Benchmark runner should produce:

```txt
experiments/benchmarks/results.json
experiments/benchmarks/results.csv
experiments/benchmarks/attack-matrix.md
experiments/benchmarks/gas-report.md
experiments/benchmarks/latency-report.md
experiments/benchmarks/p5-attack-matrix.md   # Phase 4 follow-up: P5 predicate baseline (Option A)
experiments/benchmarks/p5-results.json      # Phase 4 follow-up: P5 benchmark run
```

---

## 20. Formal verification plan

Formal verification is not required for first demo, but architecture must not block it.

Target tools:

```txt
Tamarin for stateful nonce-consumption and injective agreement properties.
ProVerif as optional cross-check for pure off-chain subprotocol.
```

Formal model should include:

```txt
agents and keys
Dolev-Yao A2A network
abstract chain state with nonce consumption
EIP-712 commitment
identity registry resolution
mandate signing
settlement transition
predicate guard for Mode B
```

Formal lemmas:

```txt
P1 identity binding
P2 authorization integrity
P3 freshness / non-replay
P4 non-transferability
P5 predicate soundness
```

Expected research story:

```txt
A naive commitment without chainId/domain separation permits transplant/cross-chain replay.
The fixed CLB commitment blocks it.
```

---

## 21. Development phases

**v1 (Phases 0–6) — complete.** A working but largely mock / in-process demo: verifier R1–R17,
`PredicatePaymentGuard.sol` with C′ parity but in-process Mode B settlement, mock ERC-8004 identity,
timestamp-only R14, narrative baselines, no formal model.

**v2 (Phase 7) — real work for a conference paper.** Decomposed into 7 sub-phases (7A–7G); see
`docs/superpowers/specs/2026-06-04-phase-7-sub-phases-design.md` and the per-sub-phase plans
`plans/phase_7a_*` … `plans/phase_7g_*`. The umbrella overview is
`plans/phase_7_research_contribution_hardening_3f3rdfgdf3.plan.md`.

### Phase 0 — Decisions and repo bootstrap

Deliverables:

```txt
DECISIONS.md
repo scaffold
shared schemas
local Anvil chain
PostgreSQL + MinIO docker-compose
basic web UI shell
```

### Phase 1 — Evidence graph without payments

Deliverables:

```txt
EvidenceEvent schema
event ingestion
hash chain
Merkle root
trace graph UI
mock identity and mock mandate events
```

### Phase 2 — Mode A CLB exact flow

Deliverables:

```txt
ERC-8004 mock or testnet identity registry
AP2-style mandate service
x402 exact protected merchant API
CLB commitment calculation
nonce = H(C) binding where supported or adapter equivalent
on-chain/testnet settlement trace
verifier rules R1-R14
```

### Phase 3 — Attack simulator

Deliverables:

```txt
attack fixtures
baseline comparison
attack matrix
latency/gas/storage metrics
UI attack runner
```

### Phase 4 — Mode B delegated/predicate flow

Deliverables (foundation):

```txt
predicate schema
predicate guard / smart-account caveat adapter
predicate verifier
Mode B UI
gas benchmark
```

### Phase 4 follow-up — Mode B predicate attacks in simulator (Option A)

Build **after Phase 4 foundation**. Extends §10.2 and the attack simulator without blocking core Mode B flow.

Deliverables:

```txt
attack-core: buildValidModeBBundle + PREDICATE_* fixtures (4 violations + happy path)
attack-simulator: GET/POST /attacks/predicate*, POST /benchmark/predicate
web-demo /attacks: Binding (Mode A) | Predicate (Mode B) tabs
preventionLayer: predicate-guard for B3 prevention story
experiments/benchmarks/p5-attack-matrix.md + p5-results.json
scripts/e2e-phase4b.ts (bun run e2e:phase4b)
```

Do **not** re-run the full Phase 3 attack matrix in Mode B. P5 evaluation is a separate, smaller artifact focused on predicate soundness and guard prevention.

### Phase 5 — Full interactive demo (research walkthrough)

Replace the Phase 2 read-only / in-process walkthrough with a live, end-to-end UI that drives real services — suitable for paper demos, investor walkthroughs, and conference presentations.

Deliverables:

```txt
interactive intent creation (task, budget, asset, merchant constraints)
browser wallet mandate signing wired into the live flow (not a side demo)
orchestrator-driven Mode A + Mode B runs via HTTP (POST /intent, /run-human-present, /run-delegated)
live evidence graph from evidence-service (no in-process mock trace fallback on the happy path)
live verifier certificate display from verifier-service
on-chain anchor action on /anchor (POST /traces/:traceId/anchor)
research mode toggle retained for protocol object inspection
E2E UI smoke test or Playwright script for the full click-through path
remove stub/mock data from primary demo screens (attacks screen: Binding tab uses Phase 3 runner; Predicate tab uses Phase 4 follow-up runner)
```

### Phase 6 — Production hardening

Deliverables:

```txt
AWS deployment
CI/CD
structured logs
testnet faucet/key hygiene docs
encrypted evidence payloads
public demo script
paper outline
```

### Phase 7 (v2) — Research contribution hardening

Convert the v1 demo into a defensible conference paper. Decomposed into 7 sub-phases (full plans in
`plans/phase_7a_*` … `plans/phase_7g_*`; decomposition spec in `docs/superpowers/specs/`):

```txt
7A  On-chain predicate enforcement (HEADLINE) — Mode B settlement reverts on-chain, not just R17 audit;
    real ERC-7710 caveat seam; valueAtomic folded into C'.            [must-have]
7B  Real identity + evidentiary delivery — live ERC-8004 Base Sepolia card (R3/R4); R14b binds
    delivery to THIS settlement (accountability, not atomicity).      [must-have]
7C  Tamarin proofs P1–P5 of the composed protocol — runs in parallel; answers "Five-Attacks has
    proofs and you don't"; attack-found→patched-model degrade path.   [stretch, parallel]
7D  Composition evaluation — runnable baselines (vanilla-x402 / AP2+x402 / eBay-monitor) MISS what
    CLB catches; Five-Attacks reproduction; decision-layer instrumentation (audit, not enforce). [must-have]
7E  Economic loop — verifier certificate → ERC-8004 Validation Registry entry (new
    CrossLayerBindingValidator type); adapter-isolated (ABI in flux). [high-value stretch]
7F  Confidential commit-and-prove — on-chain digest + range proof (value ≤ max); encrypted
    selective-disclosure evidence. OPTIONAL; degrade to selective-disclosure-only. [optional]
7G  Paper consolidation — composition-theorem framing; related work vs Five-Attacks / eBay / A402 /
    SoK (+ new SoK 2604.15367); threat-model alignment; artifact index. [must-have, final]
```

Ordering: spine 7A→7B→7D→7E; 7C parallel from day 1; 7F optional; 7G last. Philosophy: real core +
swappable adapters; every sub-phase strengthens a claim and emits a checked-in artifact.

---

## 22. Environment variables

Use `.env.example` with no secrets.

```bash
# App
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
API_BASE_URL=http://localhost:4000

# Database/storage
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/clb_acel
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=clb-acel-evidence
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio123

# Chain
CHAIN_ID=84532
RPC_URL_BASE_SEPOLIA=
DEPLOYER_PRIVATE_KEY=
USER_TEST_PRIVATE_KEY=
SHOPPING_AGENT_PRIVATE_KEY=
MERCHANT_AGENT_PRIVATE_KEY=

# Contracts
AUDIT_ANCHOR_ADDRESS=
ERC8004_REGISTRY_ADDRESS=
PREDICATE_GUARD_ADDRESS=

# x402
X402_FACILITATOR_URL=
X402_NETWORK=base-sepolia
X402_ASSET_ADDRESS=
X402_PAY_TO_ADDRESS=

# LLM
OPENAI_API_KEY=
GROK_API_KEY=
LLM_PROVIDER=openai

# Security
EVIDENCE_ENCRYPTION_KEY=
JWT_SECRET=
```

Never commit private keys. Test keys only. No mainnet by default.

---

## 23. Testing requirements

### Unit tests

```txt
canonical JSON hash stability
EIP-712 commitment stability
mandate digest stability
nonce derivation
predicate evaluation
Merkle root generation
signature validation
```

### Integration tests

```txt
normal Mode A trace passes
each attack trace fails with expected rule
anchor contract stores root
identity registry authorizes payment key
x402 adapter records requirement + settlement
```

### E2E tests

```txt
user creates intent
agent discovers merchant
mandate created
x402 payment completed
report delivered
trace verified
root anchored
UI displays evidence graph
```

---

## 24. Documentation requirements

Create/update:

```txt
README.md                         # how to run demo
DECISIONS.md                      # all architecture decisions and rationale
docs/threat-model.md              # adversaries, assets, assumptions
docs/protocol/clb.md              # CLB construction
docs/protocol/evidence-graph.md   # ACEL model
docs/demo-script.md               # step-by-step demo narrative
docs/paper-outline.md             # research paper framing
SECURITY.md                       # key handling and non-mainnet warning
```

---

## 25. Open questions for the human owner

Ask these once before locking the production demo. Do not silently assume final answers. Temporary defaults are provided only to unblock prototyping.

1. **Demo domain:** Should v1 definitely be token-risk-report marketplace, or do you prefer another paid API such as AI image analysis, smart-contract audit snippet, or ML inference endpoint?
   - Temporary default: token-risk report.

2. **Primary chain/testnet:** Should we use Base Sepolia as the first testnet?
   - Temporary default: Base Sepolia.

3. **Wallet UX:** Should the demo use a browser wallet such as MetaMask/Rabby, or custodial test wallets generated by the app?
   - Temporary default: browser wallet for user, service keys for agents.

4. **x402 facilitator:** Should we use a hosted facilitator where possible, or run/localize our own facilitator adapter?
   - Temporary default: hosted where stable, adapter abstraction always.

5. **Real AP2 integration depth:** Should v1 use official AP2 sample code directly, or implement AP2-style mandates first and swap official implementation later?
   - Temporary default: AP2-style local adapter first, official adapter later.

6. **Real ERC-8004 deployment:** Should we use an official deployed registry if available, or deploy a mock registry to Base Sepolia?
   - Temporary default: adapter supports both; mock registry first if official address/tooling is unclear.

7. **ACP depth:** Should ACP be real from v1 or represented as ACP-like checkout/task object?
   - Temporary default: ACP-like task/checkout first, real ACP compatibility later.

8. **Mode B priority:** Should delegated human-not-present predicate enforcement be included in first public demo, or second milestone?
   - Temporary default: Mode A first public demo; Mode B second milestone.

9. **LLM provider:** Which provider should be primary for demo agents: OpenAI, Grok, or both?
   - Temporary default: provider abstraction with OpenAI first.

10. **ML realism:** Should token-risk scoring be simulated, heuristic, or trained/evaluated from a real dataset in Colab?
    - Temporary default: deterministic heuristic + LLM explanation first; Colab model later.

11. **Deployment target:** Should AWS deployment use ECS/Fargate, App Runner, Lambda, or a single EC2 for speed?
    - Temporary default: ECS/Fargate if time allows; single EC2 for fastest demo.

12. **Paper positioning:** Should the final claim emphasize formal verification, production demo, or attack benchmark?
    - Temporary default: attack benchmark + CLB construction first; formal verification as strong extension.

13. **Privacy scope:** Should v1 include encrypted private evidence payloads, or only hashes/public fields?
    - Temporary default: hashes/public fields first; encrypted S3 evidence next.

14. **Reputation loop:** Should verified traces write into ERC-8004 reputation/validation registry in v1?
    - Temporary default: produce certificate hash and UI display; actual registry write optional v2.

15. **Project name:** Do you prefer CLB-ACEL, CAPS, or another name?
    - Temporary default: CLB-ACEL.

---

## 26. What not to do

Do not:

```txt
build only a chatbot
build only a payment demo
use LLM output as proof
skip deterministic verification
store private raw user/payment data on-chain
claim we solved all agentic commerce security
claim we solve agent competence or best-choice selection
hardcode protocol objects in a way that prevents swapping official SDKs
ship without attack traces
```

---

## 27. Success criteria

A successful demo should show:

```txt
1. Real agent initiates a paid task.
2. User mandate/authorization is created and signed.
3. Agent identity is resolved from ERC-8004-style registry.
4. x402-style testnet payment occurs.
5. CLB commitment binds identity + mandate + settlement.
6. Evidence graph logs all critical events.
7. Deterministic verifier returns a certificate.
8. Audit root is anchored on testnet.
9. Attack simulator demonstrates failures in weak baselines and detection/prevention in CLB-ACEL.
10. UI makes the whole flow understandable to researchers/investors/demo viewers.
```

---

## 28. Paper framing to preserve

Possible title:

> Composable Accountability for Agentic Payments: Cross-Layer Binding of Identity, Authorization, and Settlement

Core research questions:

```txt
RQ1: Which failures appear when agent identity, authorization mandates, checkout/task state, and settlement are composed across emerging protocols?
RQ2: Can a CLB commitment prevent identity/authorization/settlement transplant and replay failures?
RQ3: Can an evidence graph detect delivery, feedback, and checkout inconsistencies not covered by settlement alone?
RQ4: What are the latency, gas, storage, and privacy costs of adding this layer?
```

Main contribution statement:

```txt
We define and evaluate a cross-layer binding mechanism and evidence graph for agentic payments, binding ERC-8004 identity, AP2-style authorization, x402 settlement, ACP-like task/checkout state, and delivery evidence into a verifiable trace.
```

Be honest in the paper:

```txt
CLB proves binding, not agent competence.
ACEL provides auditability, not automatic dispute resolution.
Mode B predicate enforcement is the hardest and most novel part.
```

---

## 29. Source/reference checklist for coding agents

Before implementing protocol-specific code, check official sources again:

```txt
x402 docs and SDKs
Coinbase/CDP x402 docs
Cloudflare x402/Agents docs
Stripe x402 docs if using Stripe-hosted flow
Google/AP2 GitHub and specification docs
Ethereum EIP-8004 page and any reference contracts
ACP GitHub, OpenAI commerce docs, Stripe ACP docs
EIP-712, EIP-3009, ERC-1271, ERC-4337, ERC-7710 references
```

When docs conflict, do not guess. Add a note in `DECISIONS.md` and choose the smallest adapter-compatible implementation.

---

## 30. Immediate next coding tasks

Suggested first PR sequence:

```txt
PR1: repo scaffold + bun workspace + docker-compose PostgreSQL/MinIO/Anvil
PR2: schemas package: EvidenceEvent, Mandate, IdentityRef, SettlementDescriptor, VerificationCertificate
PR3: clb-core: canonicalization, EIP-712 typed data, C computation, nonce derivation
PR4: contracts: AgenticAuditAnchor + tests
PR5: evidence-service: POST /events, trace hash chain, Merkle root
PR6: verifier-service: R1-R8 minimal rules with mocked events
PR7: web-demo: create and display a mock trace graph
PR8: identity + mandate adapters
PR9: x402-protected merchant API
PR10: full Mode A demo trace
PR11: attack simulator
```
