# CLB-ACEL threat model (excerpt)

## Delivery accountability (Phase 7B)

Rules **R14** and **R14b** provide **accountability and dispute evidence**, not payment–delivery atomicity or fair exchang

e.


| Rule     | What it checks                                                                                                      | What it does *not* claim                        |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **R14**  | `report.generatedAt >= settlement.settledAt` — delivery timestamp is not before settlement                          | That delivery is guaranteed if payment succeeds |
| **R14b** | Merchant signed `keccak256(settlementTxHash, reportHash)` — the delivered artifact is bound to *this* settlement tx | Atomic payment↔delivery exchange                |


Together they give a verifier (or court) a **signed, cross-checkable claim**: "this report was issued for that on-chain settlement." A merchant cannot later substitute a different report for the same payment without invalidating R14b.

### What we deliberately do not claim

**Payment–delivery atomicity** — ensuring payment and service are exchanged in one indivisible step — is the domain of **A402** ([arXiv:2603.01179](https://arxiv.org/abs/2603.01179)), which uses TEE adaptor signatures and a TEE Liquidity Vault as a *new rail*. CLB-ACEL binds existing protocols (ERC-8004 + AP2 + x402) and adds evidentiary binding; it does not replace x402 with an atomic fair-exchange protocol.

### Identity realness (Phase 7B)

On the happy path with `RPC_URL_BASE_SEPOLIA` + `ERC8004_REGISTRY_ADDRESS`, identity resolution reads a **live** on-chain registry and agent card. Offline tests and CI use the in-memory mock behind the same `Erc8004Registry` interface — see `DECISIONS.md` and `docs/testnet-setup.md`.

### Agent decision rationale (audit-only, not enforced)

The shopping agent uses a real LLM (OpenAI `gpt-4o-mini` or Grok-2, selected by `LLM_PROVIDER`, with a deterministic heuristic fallback when no key is configured or a call fails) to reason in plain commerce language about **why** it selected a particular merchant from the discovered candidates. That reasoning is recorded in a `DECISION_CONTEXT` evidence event whose `publicFields` (candidates, selected merchant, rationale, provider) are hashed into the trace's evidence chain alongside every other event. This rationale is **auditable, not enforced**: the verifier trusts only the deterministic cryptographic binding rules (R1–R17) and never the LLM output — consistent with the CLB.md non-goal of "agent capability trust." An adversary who manipulates the agent's reasoning (e.g. via prompt injection) cannot thereby pass verification; they can only leave a tamper-evident record of the manipulated rationale. This separation of *auditable narrative* from *enforced binding* follows the SoK 2604.15367 guidance that competence/intent of an agent is out of scope for cryptographic accountability.