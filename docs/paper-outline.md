# CLB-ACEL — Paper Outline (working)

> Sections accrue as sub-phases land; **Phase 7G** consolidates this into the full outline +
> related-work paragraph. This file currently holds the **Phase 7E** contribution framing.

## Pricing cross-layer trust, made real where it's safe to be

CLB-ACEL composes three agent-economy layers — ERC-8004 identity, AP2 mandates, and x402
settlement — and proves the *composition* is sound where each single layer is not. Phase 7E closes
the loop from a verification certificate to on-chain, priceable trust, and makes it **real on the
piece that is safe to make real today**.

**Two honest claims:**

1. **Identity is canonical + public.** Our demo agents resolve from the **live** ERC-8004 Identity
   Registry `0x8004A818BFB912233c491871b3d84c89A494BD9e` on Base Sepolia (an ERC-721, `AgentIdentity`/
   `AGENT`) and are visible on public ERC-8004 explorers (8004scan / 8004agents.ai) among the live
   agent set — no mock on the happy path. A `canonical` reader mode maps the canonical primitives
   (`ownerOf` / `tokenURI` / `getAgentWallet`) onto our `AgentCard`, leaving the deterministic verifier
   (R3/R4) and the schemas untouched.

2. **`CrossLayerBindingValidator` is a new ERC-8004 validator type** — alongside staker re-execution,
   zkML verifiers, and TEE oracles. On a PASS, the deterministic verifier's certificate becomes an
   on-chain validation entry, retrievable by `traceId`; on FAIL, nothing is written. Its record maps
   **1:1** onto the canonical Validation Registry call
   `validationResponse(requestHash, response, responseURI, responseHash, tag)`
   (`requestHash = certificateHash`, `response = 100/0`, `responseHash = traceMerkleRoot`,
   `tag = "CrossLayerBindingValidator"`), so it is **canonical-ready**: the day a canonical Validation
   Registry is confirmed on the target chain (open item **O1**), the path lights up as a config flip —
   no code rewrite.

**Why this is the loop no competitor closes.** Five-Attacks (x402-only) and the eBay monitor (AP2-only,
off-chain) produce no on-chain validation; A402 is a new payment rail, not a binding. CLB-ACEL turns a
*composition* certificate into a priced, on-chain validation primitive — letting the agent economy
*price* cross-layer trust.

### Honest scope (O1)

As of 2026-06-05 there is **no** canonical ERC-8004 Validation Registry deployed on Base Sepolia (or
any network) — the authoritative `erc-8004-contracts` deployments list only Identity + Reputation; the
Validation Registry "remains under active discussion with the TEE community." So the validation loop
ships with **our own** deterministic `CrossLayerBindingValidator.sol` as the real on-chain target
(reproducible for the paper), and the canonical Validation Registry path is **pre-wired against the
confirmed ABI but gated off** until O1 resolves positively. The deterministic mock remains the default
for tests / CI / offline conference fallback (the standing "real core, swappable adapters" rule).

**Sources:** [ERC-8004 EIP](https://eips.ethereum.org/EIPS/eip-8004) ·
[erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) · 8004scan.io · 8004agents.ai

---

## Formal soundness (Phase 7C)

We machine-check the soundness of the *composed* protocol — the direct answer
to the reviewer question "Five-Attacks has proofs and you don't." The model
(`formal/tamarin/clb.spthy`) is written in **Tamarin** under a **Dolev–Yao**
attacker with perfect (symbolic) cryptography, and mirrors the deployed design:
`C = h(chainId, agentId, mandate, asset, payee, value)` with `nonce = H(C)`
(Mode A); a settlement-time `C'` with the `PredicatePaymentGuard` modelled as a
guarded transition that fires only on an admissible tuple and consumes the
single-use nonce once (Mode B). Each model carries an `exists-trace` sanity
lemma so the security lemmas are never vacuously true.

**All five properties verify** against *every* attacker behaviour (not just the
fixtures in `packages/attack-core`):

| Lemma | Property | Verifier rule(s) |
| --- | --- | --- |
| P1 | identity binding | R4 |
| P2 | authorization integrity | R7 / R11 / R12 / R13 |
| P3 | freshness / non-replay | R8 / R9 |
| P4 | non-transferability | R10 |
| P5 | predicate soundness (Mode B) | R17 |

**Attack-found → patched-model-proven.** An ablation that drops `chainId` from
the commitment (`formal/tamarin/clb-naive.spthy`) keeps P2 but **falsifies P4**:
Tamarin constructs a cross-chain transplant. Re-adding the chain/domain
separation (the deployed `clb.spthy`) makes P4 verify — demonstrating the
EIP-712 domain separation is *load-bearing, not decorative*.

**Independent cross-check.** A ProVerif model of the off-chain sub-protocol
(`formal/proverif/clb-offchain.pv`, applied pi-calculus, unbounded sessions)
confirms authentication (P2) holds from the messages alone, while injective
non-replay (P3) does **not** — i.e. freshness must be (and is) enforced by the
on-chain single-use nonce, not the off-chain exchange. Two tools, one
consistent story.

**Honest scope.** The proofs cover the *abstract protocol logic*, assuming
perfect cryptography; code-level correctness comes from the TS↔Solidity `C'`
parity tests and the deterministic verifier. Reproduce with
`formal/tamarin/prove.sh` (Tamarin 1.12.0) and `proverif formal/proverif/clb-offchain.pv`.
