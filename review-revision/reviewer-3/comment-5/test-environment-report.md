# Test Environment Report — R3-C5

**Repo:** `E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2`
**Bun:** 1.4.5 (`C:\Users\Hp\.bun\bin\bun.exe`)
**Run from:** repo root
**Prepend:** `$env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"`

## Summary table

| # | Test file | Test name | Cause category | Deterministic? | External service? | Credentials? | Resolution (A–E) | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | `apps/merchant-agent-api/test/merchant-agent-api.test.ts` | returns 402 with payment requirements before payment | incorrect test setup | Yes | No | No | A | Failing (pre-existing, excluded) |
| 2 | `services/identity-service/test/identity-service.test.ts` | seeds a default agent and hosts its well-known card | incorrect test setup | Yes | No | No | A | Failing (pre-existing, excluded) |
| 3 | `apps/agent-orchestrator/test/agent-orchestrator.test.ts` | runHumanPresent (in-process Mode A) > produces a fully bound, verified trace | incorrect test setup | Yes | No | No | A | Failing (pre-existing, excluded) |

## Detail per test

### Test 1 — returns 402 with payment requirements before payment

- File: `E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2\apps\merchant-agent-api\test\merchant-agent-api.test.ts`
- Command: `bun test apps/merchant-agent-api/test/merchant-agent-api.test.ts`
- Error:
  ```
  Expected: "0.0000001"
  Received: "2.00"
    at <anonymous> (...merchant-agent-api.test.ts:31:88)
  ```
  Full context (line 30–31): `expect(response.statusCode).toBe(402)` passes; `expect(...accepts[0]?.maxAmountRequired).toBe("0.0000001")` fails because the server returns price "2.00".
- Required environment variables: none are *required* — all have code defaults. Relevant reads in `apps/merchant-agent-api/src/server.ts` `resolveConfig()`:
  - `X402_PRICE` → default `"2.00"` (this is the value driving the failure)
  - `X402_NETWORK` → default `"base-sepolia"`
  - `CHAIN_ID` → default `84532`
  - `X402_ASSET` → default `"USDC"`
  - `MERCHANT_AGENT_PRIVATE_KEY` → default hardcoded Anvil key
  - `X402_PAY_TO_ADDRESS` → default derived from merchant key
  - `MERCHANT_AGENT_URL` → default `http://localhost:4004`
  - `.env.example` sets `X402_PRICE=2.00`; `.env` sets only `RPC_URL_BASE_SEPOLIA` and `DEPLOYER_PRIVATE_KEY`. No env var anywhere resolves to `"0.0000001"`.
- Required external service: None. The test builds an in-process Fastify server with a local facilitator; no HTTP to any service.
- Credentials required: No. Uses hardcoded test-only Anvil keys.
- Network access required: No. `createFacilitator()` → `createLocalFacilitator()` (local in-memory).
- Deterministic (run 3×): Yes — fails identically every run (Expected "0.0000001", Received "2.00").
- Suite type: Integration — spins up a real in-process server and exercises the full 402 flow; not a pure unit test, not e2e (no network/external service).
- Root cause: **incorrect test setup**. The test hardcodes an expectation of `"0.0000001"` for `maxAmountRequired`, but the implementation's price comes from `X402_PRICE` which defaults to `"2.00"` (`.env.example`). Nothing configures `"0.0000001"`. The test neither passes `price` in its server config override nor sets `X402_PRICE`, so its expectation matches no configured value.
- Resolution: **A** (mock/fixture replacement). Make the test control its price input explicitly instead of relying on the ambient default: either pass `config: { price: "0.0000001" }` to `buildMerchantServer(...)` (matching the expectation), or change the expectation to `"2.00"` to match the implementation default. This is a test-side correction only — no production-source change, and no env/credential/service prerequisite is missing.
- Recommended command: `bun test apps/merchant-agent-api/test/merchant-agent-api.test.ts` (after aligning the price expectation/fixture).

### Test 2 — seeds a default agent and hosts its well-known card

- File: `E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2\services\identity-service\test\identity-service.test.ts`
- Command: `bun test services/identity-service/test/identity-service.test.ts`
- Error:
  ```
  Expected: "analysis-agent-001"
  Received: "6827"
    at <anonymous> (...identity-service.test.ts:101:49)
  ```
  Full context (line 98–101): `expect(wellKnown.statusCode).toBe(200)` passes; `expect(wellKnown.json<AgentCard>().agentId).toBe("analysis-agent-001")` fails because `/well-known/agent-card.json` returns the first seeded agent.
- Required environment variables: none required — all have code defaults. Relevant reads (via `services/identity-service/src/seed.ts` `defaultAgents()` and `src/server.ts`):
  - `MERCHANT_AGENT_PRIVATE_KEY` → default hardcoded
  - `SHOPPING_AGENT_PRIVATE_KEY` → default hardcoded
  - `GRAMMAR_AGENT_PRIVATE_KEY` → default hardcoded
  - `WEATHER_AGENT_PRIVATE_KEY` / `SHOPPING_AGENT_PRIVATE_KEY` → default hardcoded
  - `MERCHANT_AGENT_URL` → default `http://localhost:4004`
  - `AGENT_ORCHESTRATOR_URL` → default `http://localhost:4000`
  - `NEXT_PUBLIC_APP_URL` → default `http://localhost:3000`
  - `CHAIN_ID` → default `84532`
  - `ERC8004_REGISTRY_ADDRESS` → default placeholder `...8004`
  - `ERC8004_IDENTITY_REGISTRY_CANONICAL` → default `...494BD9e`
- Required external service: None. Uses `createInMemoryErc8004Registry()` (in-memory) with `seed: true`.
- Credentials required: No. Uses hardcoded test-only keys.
- Network access required: No. Fully in-process/in-memory.
- Deterministic (run 3×): Yes — fails identically every run (Expected "analysis-agent-001", Received "6827").
- Suite type: Integration — builds a real in-process identity server with a seeded in-memory registry.
- Root cause: **incorrect test setup**. With `seed: true`, `defaultAgents()` registers agents in this order: grammar (`"6827"`), weather (`"6823"`), analysis (`"analysis-agent-001"`), decoy, shopping. The well-known endpoint (`/.well-known/agent-card.json`, `server.ts` line 150–161) returns `agents[0]` when no `?agentId=` query is given, which is the grammar agent `"6827"` — the first seeded record, not the analysis agent. The test assumes the analysis agent is the default/first well-known card, but seeding order puts grammar first. ("6827" is `DEFAULT_GRAMMAR_AGENT_ID`, not truly port-derived despite the task description.)
- Resolution: **A** (mock/fixture replacement). Make the test explicit: request `GET /.well-known/agent-card.json?agentId=analysis-agent-001`, or reorder/seed so the analysis agent is first, or change the expectation to `"6827"`. Test-side correction only — no production-source change, and no env/credential/service prerequisite is missing.
- Recommended command: `bun test services/identity-service/test/identity-service.test.ts` (after aligning the well-known agentId expectation/query).

### Test 3 — runHumanPresent (in-process Mode A) > produces a fully bound, verified trace

- File: `E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2\apps\agent-orchestrator\test\agent-orchestrator.test.ts`
- Command: `bun test apps/agent-orchestrator/test/agent-orchestrator.test.ts`
- Error:
  ```
  Expected length: 7
  Received length: 8
    at <anonymous> (...agent-orchestrator.test.ts:15:26)
  ```
  Full context (line 15): `expect(trace.events).toHaveLength(7)` fails because `runHumanPresent` builds 8 evidence events. (Line 17 `trace.graph.nodes` toHaveLength 9 would also fail: 8 events + 2 presentation nodes = 10, not 9.)
- Required environment variables: none required — all have code defaults. Relevant reads in `apps/agent-orchestrator/src/flow.ts` `resolveConfig()`:
  - `USER_TEST_PRIVATE_KEY` → default Anvil user key
  - `SHOPPING_AGENT_PRIVATE_KEY` → default Anvil shopper key
  - `MERCHANT_AGENT_PRIVATE_KEY` → default Anvil merchant key
  - `X402_PRICE` → default `"2.00"`
  - `X402_NETWORK`, `X402_ASSET`, `CHAIN_ID` → defaults
  - `nowMs` → not set in test → `Date.now()`
- Required external service: None. Fully in-process; `createFacilitator()` → `createLocalFacilitator()` (local).
- Credentials required: No. Uses hardcoded test-only Anvil keys.
- Network access required: No.
- Deterministic (run 3×): Yes — fails identically every run (Expected length 7, Received length 8). The flow itself completes (all earlier assertions pass, including verification `PASS`); only the event-count assertion mismatches.
- Suite type: Integration — executes the full Mode A flow (identity → mandate → CLB commitment → x402 → settle → delivery → evidence graph → verification) in-process.
- Root cause: **incorrect test setup**. `runHumanPresent` (`flow.ts` lines 355–406) pushes 8 evidence events: USER_INTENT(1), ERC8004_AGENT_IDENTITY(2), DECISION_CONTEXT(2.5), AP2_CART_MANDATE(3), X402_PAYMENT_REQUIREMENT(4), X402_PAYMENT_PAYLOAD(5), CHAIN_SETTLEMENT(6), DELIVERY_PROOF(7). The test expects 7 — matching the older 7-event list that did not include the `DECISION_CONTEXT` event at index 2.5 (added as audit-only decision-context evidence per `decisionPublicFields`). The test's expectation (and its `graph.nodes` length-9 assumption) is stale relative to the current implementation.
- Resolution: **A** (mock/fixture replacement) — more precisely, a test-expectation alignment. Update the test to expect 8 events (and `graph.nodes` length 10), since the 8th event is a deliberate, deterministic part of the current flow. Test-side correction only — no production-source change, and no env/credential/service prerequisite is missing.
- Recommended command: `bun test apps/agent-orchestrator/test/agent-orchestrator.test.ts` (after aligning event/graph counts to 8/10).

## Cross-cutting findings

- **None of the three failures is environmental.** All three run fully in-process with code-defaulted configuration, no network, no credentials, and no external service. They fail deterministically (3× identical) and would fail on any machine with a clean checkout.
- **None is a missing env var / missing service / missing credential / network dependency.** Each env var involved has a fallback default, and the test harness never sets the values the tests' hardcoded expectations assume.
- **None is an implementation defect in production source.** The production code behaves per its documented defaults; the tests' hardcoded expected values are simply out of sync with those defaults. Per the task constraints, no production source was modified.
- **Common root cause category (all three): incorrect test setup** — stale/hardcoded test expectations that do not match the implementation's deterministic defaults/outputs.

## Should any test be separated into an integration suite?

**No — not as a fix.** These tests are already integration-style (in-process, multi-component), they require no external service/credential/network, and they fail *deterministically*, not conditionally on absent prerequisites. Separating them into a tagged integration suite (option D) would only hide the failures; it would not resolve them. The correct resolution is to align each test's expectations/fixtures to the current deterministic implementation (option A, test-side only). If the team wishes to keep them excluded from the unit run while they are corrected, they may be tagged and reported as not-run (D), but that is a bookkeeping measure, not a root-cause fix.

## Recommended command summary

```
# From repo root, with Bun on PATH:
$env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
bun test apps/merchant-agent-api/test/merchant-agent-api.test.ts
bun test services/identity-service/test/identity-service.test.ts
bun test apps/agent-orchestrator/test/agent-orchestrator.test.ts
```
All three fail deterministically before any test-expectation alignment; none require `bun install`, network, credentials, or a local/external service to reproduce.
