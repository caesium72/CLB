# Phase 7E "Real Demo" — Canonical ERC-8004 Feasibility Assessment

**Date:** 2026-06-05
**Status:** approved direction; updates `plans/phase_7e_validation_registry_loop_fdf9bc81.plan.md`
**Trigger:** owner observed that [8004scan.io](https://8004scan.io/) exposes live testnet ERC-8004 register/get/use flows, and asked whether the demo can become "real" against canonical contracts instead of our mocks.

---

## 1. Why this document exists

7E was written under the assumption that the ERC-8004 **Validation Registry** ABI was unknown and in flux, so the plan ships a *standalone* `CrossLayerBindingValidator.sol` (its own `recordValidation`/`getValidation` mapping) behind an adapter, with a mock default. The owner found that canonical ERC-8004 is **live and publicly indexed on Base Sepolia** (8004scan shows 6,542 agents). That raises a real-demo opportunity — but the naive read ("just point everything at canonical") is wrong in a specific, decision-relevant way. This document records what is actually feasible, what it costs, and the chosen direction.

This is a **planning/spec document — no code.** The plan it updates re-verifies paths/symbols before editing.

---

## 2. What is actually live (verified) vs. assumed

**Confirmed canonical addresses — Base Sepolia (chain 84532), from the 8004scan network card:**

| Registry | Address | Status |
| --- | --- | --- |
| Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | **Live, public, indexed** (ERC-721, 6,542 agents) |
| Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Live, public, indexed |
| **Validation Registry** | *not shown on the Base Sepolia card* | **UNCONFIRMED on Base Sepolia** |

> The 8004scan Base Sepolia card lists **only Identity + Reputation**. The EIP itself still calls the Validation Registry "under active discussion with the TEE community." We could **not** confirm a canonical Validation Registry deployed/indexed on Base Sepolia. (A secondary source earlier suggested `0x662b40A5…`, and another suggested Identity `0x7177…` — both contradicted by the authoritative on-explorer card; treat unverified addresses as wrong.)

**Open item O1 (gates Increment A below):** confirm or deny a canonical Validation Registry on Base Sepolia (check the official `erc-8004-contracts` deployments file / 8004scan API). ~10 minutes; decides whether the canonical validation path can ever light up on our network.

---

## 3. Canonical ABIs (known) and how they map to CLB-ACEL

### 3.1 Identity Registry (ERC-721, `agentId` = `uint256` tokenId)
- `register(...)` → mints an agent NFT, returns `agentId`
- `setAgentURI(agentId, uri)` → sets the registration file (tokenURI / agent card)
- `setAgentWallet(...)` / `getAgentWallet(agentId)` → one verified receiving wallet (EIP-712/ERC-1271 proof)
- `setMetadata(agentId, key, value)` / `getMetadata(agentId, key)` → arbitrary `bytes` metadata

**Gap vs. our code:** our `AgentCard` carries `authorizedPaymentKeys[]` and `authorizedSigningKeys[]` arrays (consumed by verifier R4 and others — `verifier-core/src/index.ts:193,355,408`). Canonical has **no such arrays** — it has one `getAgentWallet` + arbitrary metadata. So a canonical reader must *assemble* our `AgentCard` from canonical primitives (`tokenURI` → card body; `getAgentWallet` + `getMetadata("paymentKeys"/"signingKeys")` → the key arrays). Done in the **adapter**, this leaves schemas and the verifier untouched (`agentId` stays a `string` holding the decimal tokenId).

### 3.2 Validation Registry (ABI now known)
- `validationRequest(address validator, uint256 agentId, string requestURI, bytes32 requestHash)` — **called by the agent owner/operator**
- `validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)` — **called by the named validator**; `response` ∈ 0..100 (0 = fail, 100 = pass)
- reads: `getValidationStatus`, `getSummary`, `getAgentValidations`, `getValidatorRequests`

**Mapping — `VerificationCertificate` → canonical validation (clean fit):**

| Canonical field | CLB-ACEL source |
| --- | --- |
| `agentId` | merchant's canonical ERC-721 `agentId` (requires §3.1) |
| `validator` | our deployer EOA, or `CrossLayerBindingValidator.sol` acting as validator (no whitelist — validator is named per request) |
| `requestHash` | `certificateHash` |
| `response` | `100` on PASS / `0` on FAIL |
| `responseURI` | evidence/certificate read-back URL |
| `responseHash` | `traceMerkleRoot` |
| `tag` | `"CrossLayerBindingValidator"` ← the new validator-type name lives here |

The reserved `zkmlDigest` fits later via `responseHash`/metadata. **7E's core idea survives intact** — it gains a real, public target instead of a private mapping, with no change to the verifier (which stays deterministic + LLM-free).

---

## 4. The cost framing (the owner's question)

"Cost" is three independent axes; conflating them caused confusion:

1. **Effort** — hours / lines changed. The owner has time → **discount this axis.**
2. **Blast radius** — how much already-committed, working 7A/7B code a change can break. Time helps care, not safety.
3. **External-dependency risk** — reliance on things outside our control (a moving ABI; a contract maybe-not-deployed on our network). Time does **not** help.

Because effort is discounted, the decision is driven by blast radius (2) and external risk (3).

---

## 5. Decomposition and decision

| Increment | Blast radius | External-dep risk | Real-demo payoff | Verdict |
| --- | --- | --- | --- | --- |
| **B — Canonical Identity** (register demo agents in `0x8004A818…`; add a `canonical` reader mode to `erc8004-adapter` mapping canonical primitives → existing `AgentCard`) | **Low** (adapter-local; schemas + R3/R4 untouched) | **Low** (Identity is live & stable) | **High** — our agents appear publicly on 8004scan among 6,542 | **DO NOW** |
| **A — Canonical Validation** (publish to the canonical Validation Registry) | Low (adapter-isolated) | **High / blocked** (registry unconfirmed on Base Sepolia; ABI still moving — O1) | High *if it existed* | **Pre-wire, gate off** until O1 |
| **C — Full cutover** (canonical default end-to-end) | High | Medium | Marginal over B | **Defer** (only if reviewers demand) |

**Decision:** **B-first.** Make *Identity* real (the part that is genuinely live and public on Base Sepolia), keep `CrossLayerBindingValidator` as our own deterministic contract (better for paper reproducibility — no dependency on a registry that may not exist), and **pre-wire** the canonical `validationRequest`/`validationResponse` ABI behind the validation adapter pointed at our contract, flippable to the canonical Validation Registry by config the day O1 resolves positively. The deterministic mock remains the default for tests/CI/offline conference fallback (the standing "real core, swappable adapters" rule).

### Why not the earlier "Increment A first" recommendation
The first pass leaned on a canonical Validation Registry on Base Sepolia. The 8004scan card shows that registry is not present there. Identity — not Validation — is the piece that is safe to make real today.

---

## 6. Scope of the plan update (`phase_7e_…plan.md`)

1. **New Task — Canonical ERC-8004 Identity (Increment B):** a `canonical` reader mode in `packages/erc8004-adapter` (numeric `agentId`; `tokenURI` → card; `getAgentWallet` + `getMetadata` → key arrays); a script registering the demo agents in `0x8004A818…`; env selection (`ERC8004_IDENTITY_MODE=canonical|onchain|mock`). Default stays mock/onchain; canonical is opt-in.
2. **Keep Task 1** (`CrossLayerBindingValidator.sol`) as the deterministic own contract.
3. **Revise Task 2** (validation adapter) to three targets — `mock | onchain` (our contract) `| canonical` (ERC-8004 Validation Registry, ABI pre-wired, **gated off** behind a flag until O1) — with the §3.2 certificate→request/response mapping.
4. **Keep Task 3** (`verifier-service` emit-on-PASS + read-back); it targets whichever validation adapter is selected.
5. **Revise Task 4** (paper reframe + DECISIONS): Identity is real/canonical/public on 8004scan; `CrossLayerBindingValidator` is the validator type, canonical-ready; record O1 and the three cost axes.

---

## 7. Out of scope (unchanged honesty)
- Full canonical identity cutover (Increment C) — deferred.
- Full zkML proof in the validation entry — schema leaves room; generation is follow-on.
- Reputation Registry integration — live and tempting, but not part of the composition thesis; note as future.

---

## 8. Acceptance for the updated 7E
- Demo agents resolve from the **canonical** Identity Registry `0x8004A818…` and are visible on 8004scan (Increment B).
- A PASS verification yields a validation entry retrievable by `traceId` via the selected adapter (mock default; our `CrossLayerBindingValidator` on-chain; canonical pre-wired but gated).
- All canonical/Validation-Registry ABI specifics live in `validation-registry.ts` (one-file blast radius).
- O1 is recorded as an explicit open item; flipping to canonical validation is a config change, not a rewrite.

**Sources:** [ERC-8004 EIP](https://eips.ethereum.org/EIPS/eip-8004) · [erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) · [8004scan.io](https://8004scan.io/)
