# CLB-ACEL — Paper Artifacts & Core Pseudocode

> **What this file is.** The curated set of artifacts to put in the paper, plus **core-part pseudocode only** (the
> algorithms that *are* the contribution). Deliberately skips boilerplate, adapters, UI, glue. Feed this to the AI
> paper agent alongside [`paper-full-outline.md`](paper-full-outline.md). Facts/numbers: [`../PROJECT_OVERVIEW.md`](../PROJECT_OVERVIEW.md).
>
> **Rule:** pseudocode below is faithful to the real implementation (file paths cited per block) but stripped to the
> essence. Use it for the paper's algorithm boxes; do **not** paste full source.

---

## Part A — Most important artifacts (include these; skip the rest)

| # | Artifact | Path | Why it's core | Paper use |
| --- | --- | --- | --- | --- |
| A1 | **Tamarin model (P1–P5)** | `formal/tamarin/clb.spthy` | the machine-checked soundness result | listing / appendix |
| A2 | **Tamarin ablations** | `clb-naive.spthy` (Mode A, P4) + `clb-naive-modeb.spthy` (Mode B, P5) | attack-found→patched, both modes | listings |
| A3a | **Mode-A attack graph** (cross-chain transplant) | `formal/tamarin/proofs/clb-naive-P4-attack.pdf` (+`.svg`,`@300dpi.png`) | marquee formal figure | **Figure** |
| A3b | **Mode-B attack graph** (guard bypass) | `formal/tamarin/proofs/clb-naive-modeb-P5-attack.pdf` (+`.svg`,`@300dpi.png`) | motivates the on-chain guard | **Figure** |
| A4 | **Proof outputs** | `formal/tamarin/proofs/*.proof` | reproducible verification record | appendix |
| A5 | **ProVerif cross-check** | `formal/proverif/clb-offchain.pv` + `.result.txt` | independent confirmation | appendix |
| A6 | **Predicate guard contract** | `contracts/src/PredicatePaymentGuard.sol` | the on-chain enforcement headline | algorithm box (B2) |
| A7 | **CLB core (C / C′ / nonce)** | `packages/clb-core/src/index.ts` | the binding mechanism | algorithm box (B1) |
| A8 | **Deterministic verifier** | `packages/verifier-core/src/index.ts` | the 17-rule cross-layer checker | algorithm box (B3) |
| A9 | **Benchmark data** | `experiments/benchmarks/results.csv`,`*.json`,`*.md` | all eval numbers | tables + plotted figures |
| A10 | **Attack/baseline matrices** | `experiments/benchmarks/{attack-matrix,baseline-comparison,p5-attack-matrix,five-attacks-comparison}.*` | the "baselines miss it" result | tables / heatmap |

**Deliberately excluded from the paper** (engineering, not contribution): web-demo UI, Fastify services, LLM
adapter, Zod schemas, mocks, deployment scripts.

### Regenerating the figure at high resolution (the low-res PNG complaint)

```bash
cd formal/tamarin/proofs
# Mode-A figure (cross-chain transplant):
tamarin-prover --prove ../clb-naive.spthy --output-dot=clb-naive-P4-attack.dot --with-dot=$(which dot)
dot -Tpdf clb-naive-P4-attack.dot -o clb-naive-P4-attack.pdf          # vector — best for LaTeX
dot -Tsvg clb-naive-P4-attack.dot -o clb-naive-P4-attack.svg          # vector — web
dot -Tpng -Gdpi=300 clb-naive-P4-attack.dot -o clb-naive-P4-attack@300dpi.png
# Mode-B figure (guard bypass):
tamarin-prover --prove ../clb-naive-modeb.spthy --output-dot=clb-naive-modeb-P5-attack.dot --with-dot=$(which dot)
dot -Tpdf clb-naive-modeb-P5-attack.dot -o clb-naive-modeb-P5-attack.pdf
```

Use the **PDF/SVG** in the paper — they are vector and scale to any size with no pixelation.

---

## Part B — Core pseudocode (the contribution; everything else omitted)

### B1 — CLB commitment and nonce (the binding mechanism)
*Faithful to `packages/clb-core/src/index.ts`.*

```
// Mode A — human-present, exact settlement.
function computeCommitment(identityRef, mandateDigest, settlementDescriptor):
    // identityRef = (chainId, registryAddr, agentId)   ← ERC-8004 identity
    // mandateDigest = keccak(canonicalJson(AP2 authorization))   ← reused, not replaced
    // settlementDigest = keccak(canonicalJson(settlementDescriptor))
    structHash = EIP712_hashStruct("CLBCommitment", {
        identityRef, mandateDigest, settlementDigest })
    C = keccak( "\x19\x01" || EIP712_DOMAIN_SEPARATOR || structHash )   // domain-separated
    return C

function deriveNonce(C):
    return keccak(C)            // nonce = H(C): pins the transfer to exactly one mandate

// Mode B — delegated. Exact params do not exist at signing time; the human signs a
// predicate, the agent forms concrete params later and a SETTLEMENT-time commitment C'.
function computeSettlementCommitment(identityRef, mandateDigest, predicateId, params):
    settlementParamsDigest = keccak(abiEncode(
        params.chainId, params.network, params.asset, params.payTo,
        params.value, params.valueAtomic, params.validBefore, params.payerAgentId))
    structHash = EIP712_hashStruct("CLBSettlementCommitment", {
        identityRef, mandateDigest, predicateId, settlementParamsDigest })
    Cp = keccak( "\x19\x01" || EIP712_DOMAIN_SEPARATOR || structHash )
    return Cp                   // nonce' = H(C')
```

> **Why it's core:** `C` is the single value that ties identity + authorization + settlement; `nonce = H(C)`
> makes the binding *in-protocol* (one mandate ⇒ one settlement). `chainId` inside `identityRef`/`params` is the
> piece the Tamarin ablation proves is load-bearing (P4).

### B2 — On-chain predicate guard (the enforcement headline, Mode B)
*Faithful to `contracts/src/PredicatePaymentGuard.sol :: validateAndConsume`.*

```
function validateAndConsume(identityRef id, mandateDigest, predicateId, params p,
                            commitment, nonce) -> commitment:
    cfg = predicates[keccak(predicateId)]
    require cfg.registered                                     else revert PredicateNotRegistered

    // (1) Binding integrity — recompute C' on-chain; nonce must equal H(C').
    recomputed = computeSettlementCommitment(id, mandateDigest, predicateId, p)
    require recomputed == commitment                           else revert CommitmentMismatch
    require keccak(commitment) == nonce                        else revert NonceMismatch

    // (2) Freshness / non-replay  (P3)
    require not consumed[nonce]                                else revert NonceAlreadyConsumed

    // (3) Predicate field checks  (P5) — evaluated ON-CHAIN, before any transfer
    require p.payTo    in cfg.allowedPayees                    else revert PayeeNotAllowed
    require keccak(p.asset) in cfg.allowedAssetHashes          else revert AssetNotAllowed
    require p.chainId  in cfg.allowedChainIds                  else revert ChainNotAllowed
    require p.valueAtomic <= cfg.maxValueAtomic                else revert AmountExceedsMax
    require block.timestamp <= cfg.validUntil                  else revert PredicateExpired

    consumed[nonce] = true                                     // consume exactly once
    emit SettlementConsumed(nonce, commitment, p.payTo)
    return commitment
```

> **Why it's core:** this is the project's headline — the human's spending predicate is **re-checked by the chain at
> settlement** and a violation **reverts before any transfer** (real reverted tx on Base Sepolia). The check order
> isolates one error per violation and reverts *before* consuming the nonce, so it's repeatable. `valueAtomic` is the
> quantity bound inside `C'`, so the committed and compared amounts are identical (no TOCTOU gap).

### B3 — Deterministic cross-layer verifier (PASS/FAIL certificate)
*Faithful to `packages/verifier-core/src/index.ts :: verifyTrace` (mode-aware; never an LLM).*

```
function verifyTrace(bundle, mode):                 // mode ∈ {MODE_A_EXACT, MODE_B_PREDICATE}
    R = {}
    R.R1  = hashChainIntact(bundle.events)                       // tamper-evidence
    R.R2  = allEventSignaturesValid(bundle.events)
    R.R3  = agentIdentityResolves(bundle.payerAgent)             // ERC-8004 live
    R.R4  = payerKey in agentCard.authorizedPaymentKeys         // P1
    R.R5  = humanMandateSignatureValid(bundle.mandate)
    R.R6  = recompute(C or C') == signedCommitment              // binding recomputes
    R.R7  = settlementParams == committedDescriptor             // P2/P4 (Mode A)
    R.R8  = settlement.nonce == H(commitment)                   // P3
    R.R9  = nonceConsumedExactlyOnce(bundle)                    // P3 (no replay)
    R.R10 = settlement.chainId == committed.chainId             // P4 (no transplant)
    R.R11 = mode==confidential ? rangeProofValid(value<=max)    // privacy: no plaintext amount
                               : settlement.value <= mandate.max
    R.R12 = settlement.payTo == authorizedMerchant
    R.R13 = settlement.asset in allowedAssets
    R.R14  = delivery.timestamp >= settlement.timestamp
    R.R14b = verify(merchantSig over keccak(settlementTxHash, reportHash))  // artifact ↔ this settlement
    R.R15  = deliveredArtifact.inputHash == paidTaskHash
    if mode == MODE_B_PREDICATE:
        R.R17 = predicate(concreteSettlementParams) == true     // P5 (audit mirror of the guard)

    status = all(R.values == PASS) ? "VALID" : "INVALID"
    return Certificate{ status, failedRules: [k for k,v in R if v==FAIL] }
```

> **Why it's core:** one deterministic pass evaluates *cross-layer* invariants that each single protocol ignores;
> the certificate names the exact failed rule. The verifier never reads LLM output, so prompt injection can only
> leave a tamper-evident record — it cannot pass verification.

### B4 — Evidence chain + on-chain anchor (ACEL tamper-evidence)
*Faithful to `packages/evidence-core` + `contracts/src/AgenticAuditAnchor.sol`.*

```
function appendEvent(event, prevEventHash):
    event.previousEventHash = prevEventHash                     // chain link
    event.objectHash = keccak(canonicalJson(event without signature))
    event.signature = sign(event.objectHash, actorKey)
    return event                                                // tampering any earlier event breaks all later hashes

function anchorTrace(events):
    root = merkleRoot([ e.objectHash for e in events ])
    AgenticAuditAnchor.anchorTrace(traceId, root, traceHash, metadataURI)  // only the ROOT goes on-chain
```

### B5 — The formal properties, as proved (Tamarin lemma essence)
*Faithful to `formal/tamarin/clb.spthy`. State P1–P5 in the paper as both English and lemma form.*

```
P1 identity binding :    Paid(agentId, K)          ==>  exists KeyAuthorized(agentId, K)
P2 authz integrity  :    Settled(_,aid,_,p,a,v,c)  ==>  exists Authorized(_,aid,p,a,v,c)
P3 non-replay       :    Consumed(n)@i & Consumed(n)@j  ==>  i = j
P4 non-transferable :    Settled(...,chainId=c)     ==>  exists Authorized(...,chainId=c)
P5 predicate sound  :    SettledB(...,predId=p)      ==>  exists AdmitB(...,predId=p)
// ablation clb-naive.spthy: drop chainId from C  ⇒  P4 FALSIFIED (cross-chain transplant trace)
```

---

## Part C — Numbers to cite (from `experiments/benchmarks/`, do not invent)

| Metric | Value | Source file |
| --- | --- | --- |
| Verifier latency | p50 ≈ 3.7 ms, p95 ≈ 6.6 ms | `latency-report.md`, `results.csv` |
| Replay-check latency | p50 ≈ 1.5 ms | `latency-report.md` |
| Guard `validateAndConsume` gas | ≈ 50–53k (forge avg) / 76k live happy path | `gas-report.md`, `phase7-caveat-gas.md` |
| Confidential range proof | 64-bit, ≈ 23.9 KB; payee+amount not on-chain | `phase7-confidential.json` |
| Replay DGR under R9 | collapses 1/5/10/50 → 1 | `five-attacks-comparison.md` |
