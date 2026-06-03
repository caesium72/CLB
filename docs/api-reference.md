# API Reference

Every backend service registers `@fastify/swagger` + `@fastify/swagger-ui` via
`@clb-acel/service-kit`, exposing Swagger UI at `/docs` and the OpenAPI spec at
`/docs/json`.

| Service            | Port | Swagger UI                   | OpenAPI JSON                      |
| ------------------ | ---- | ---------------------------- | --------------------------------- |
| agent-orchestrator | 4000 | `http://localhost:4000/docs` | `http://localhost:4000/docs/json` |
| evidence-service   | 4001 | `http://localhost:4001/docs` | `http://localhost:4001/docs/json` |
| identity-service   | 4002 | `http://localhost:4002/docs` | `http://localhost:4002/docs/json` |
| mandate-service    | 4003 | `http://localhost:4003/docs` | `http://localhost:4003/docs/json` |
| merchant-agent-api | 4004 | `http://localhost:4004/docs` | `http://localhost:4004/docs/json` |
| verifier-service   | 4005 | `http://localhost:4005/docs` | `http://localhost:4005/docs/json` |
| attack-simulator   | 4006 | `http://localhost:4006/docs` | `http://localhost:4006/docs/json` |

## Key endpoints (Mode A, human-present)

### agent-orchestrator (4000)

- `POST /intent` — create a user intent.
- `POST /run-human-present` — run the full Mode A flow (identity → mandate → CLB
  commitment → x402 402 → settle → delivery → evidence → verify).
- `POST /run-delegated` — run the full Mode B (delegated/predicate) flow: INTENT
  mandate over a spending predicate → agent picks concrete settlement → C' +
  guard enforcement → settle → delivery → evidence → verify (R17).
- `POST /attack/:attackName` — run a Phase 3 binding attack fixture in-process.
- `POST /attack/predicate/:attackName` — run a Phase 4 predicate (P5) attack
  fixture; returns `PredicateAttackRunResult` plus a trace summary.
- `GET /trace/:traceId` — assembled trace + verification certificate (Mode A or B).

### identity-service (4002) — ERC-8004 adapter

- `POST /agents/register`, `GET /agents/:agentId`, `GET /agents/:agentId/card`
- `POST /agents/:agentId/authorize-payment-key`
- `GET /.well-known/agent-card.json`

### mandate-service (4003) — AP2 adapter

- `POST /mandates/intent` (accepts an optional `predicate` for Mode B), `POST /mandates/cart`, `POST /mandates/payment`
- `POST /mandates/verify` (accepts exact or predicate settlement context), `GET /mandates/:mandateId`

### merchant-agent-api (4004) — x402-protected analysis agent

- `GET /x402/payment-requirements`, `POST /x402/settle`
- `GET|POST /risk-report` (402 until settled), `GET /.well-known/agent-card.json`

### evidence-service (4001)

- `POST /events`, `GET /traces/:traceId`, `GET /traces/:traceId/graph`
- `POST /traces/:traceId/merkle`, `POST /traces/:traceId/anchor`

### verifier-service (4005) — deterministic rules R1–R17 (mode-aware)

- `POST /verify/:traceId`, `GET /verify/:traceId/result`, `GET /verify/:traceId/certificate`
- Rules are mode-aware: Mode A uses the exact descriptor; Mode B recomputes C'
  and runs R17 (`evaluatePredicate`).

### attack-simulator (4006) — Phase 3 + Phase 4 benchmark runner

- `GET /attacks` — list the ten Mode A binding fixtures and expected result codes.
- `POST /attacks/:attackId/run` — run one binding fixture; returns verifier/audit outcome and metrics.
- `POST /benchmark` — run all binding fixtures and produce the B0–B3 matrix.
- `GET /benchmark/latest`, `GET /benchmark/matrix` — latest binding benchmark or matrix.
- `GET /attacks/predicate` — list the Mode B predicate (P5) fixtures.
- `POST /attacks/predicate/:attackId/run` — run one predicate fixture (R17 + guard prevention).
- `POST /benchmark/predicate`, `GET /benchmark/predicate/matrix` — P5 benchmark and baseline matrix.

## Notes

- The web demo (`apps/web-demo`) runs the orchestrator flow **in-process** for a
  zero-dependency walkthrough; the services above are the live HTTP surface.
- The verifier is deterministic TypeScript only — LLMs never verify.
- Contracts (`contracts/`) require Foundry (`forge`) to build/deploy; see
  `contracts/README.md`.
