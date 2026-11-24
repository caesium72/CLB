# R3-C2 — Confidential commitments & evidence integrity: code-evidenced spec

Repository: `E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2`
Scope: reviewer comment 3 / comment 2, items **29–43**.
Method: read the implementations first; status is assigned from code behaviour, not from names or doc comments. Every test asserts behaviour that was executed successfully.

---

## 0. Bottom line

The confidential module is **not a demo / simulation**. It is a real **secp256k1 Pedersen commitment** (`C = v·G + r·H`) with a **64-bit Borromean-style per-bit OR range proof** (Fiat–Shamir challenges, soundness check `Σ2^i·C_i = max·G − C`). It is an **unaudited research prototype**, not a Bulletproof and not production-hardened, and it has a **confirmed HIGH soundness bug**: negative amounts produce verifying proofs.

The evidence layer is real keccak-256 canonical-JSON hashing, an explicit hash chain, a binary Merkle root and an on-chain anchor contract — but the chain is self-referential (recomputable by anyone), event signatures are not hashed, there is no Merkle membership-proof API, and the verifier never checks the on-chain anchor.

```
  commitConfidential(v, max)                verifyConfidential(C, proof, max)
  ┌───────────────────────────┐             ┌────────────────────────────────┐
  │ C = v·G + r·H  (secp256k1)│──────┐      │ 1. shape: bits == 64           │
  │ delta = max − v           │      │      │ 2. Σ2^i·C_i == max·G − C       │
  │ delta mod 2^64 → 64 bits  │      ├─────▶│ 3. every bit opens to 0 or 1   │
  │ Σ2^i·r_i ≡ −r  (mod n)    │      │      │ → false on ANY throw           │
  └───────────────────────────┘      │      └────────────────────────────────┘
                                     │              ▲
              ⚠ NEGATIVE v: delta small, proof VERIFIES (GAP-1)

  evidence events ──hashEvidenceEvent──▶ hashes ──buildMerkleRoot──▶ merkleRoot
        │                                                              │
        └──previousEventHash = hash(prev)──▶ R1 recompute ──────────────┤
                                                                        ▼
                                     anchor-core ──anchorTrace──▶ AgenticAuditAnchor
                                     (merkleRoot, traceHash, URI)   ⚠ verifier never reads it (GAP-6)
```

Status counts: **IMPLEMENTED 9 · PARTIAL 5 · GAP 1** (15 items).

---

## 1. Per-item findings

| # | Requirement | Status | Concrete code evidence |
|---|---|---|---|
| 29 | Exact commitment scheme and cryptographic parameters | **IMPLEMENTED** | `packages/clb-core/src/confidential.ts:1-25` (design), `:27-38` (imports, `ORDER`, `RANGE_BITS=64`, `MAX_RANGE=2^64`, `DOMAIN="CLB-ACEL/confidential/v1"`), `:238-292` (`commitConfidential`), `:299-328` (`verifyConfidential`). Pedersen `C = v·G + r·H` over secp256k1; 64-bit Borromean-style OR proof; Fiat–Shamir `keccak256(DOMAIN‖points)` at `:112-116`. Re-exported from `packages/clb-core/src/index.ts:26-28`. **Not a demo.** Caveats: unaudited prototype; not Bulletproofs; proof is linear-size (~64 compressed points + 256 scalars). |
| 30 | Group and generator parameters | **IMPLEMENTED** | `confidential.ts:27` `import { secp256k1 } from "@noble/curves/secp256k1"`; `:30` `Point = secp256k1.ProjectivePoint`; `:33` `ORDER = secp256k1.CURVE.n`; `:96` `G = Point.BASE`; `:81-94` `deriveNumsGenerator` = keccak256 try-and-increment over labels `DOMAIN/H:{counter}` with SEC1 prefixes `02/03`; `:97` `H = deriveNumsGenerator(...)`. **Curve is secp256k1, not BN254.** Bit commitments are compressed 33-byte points (`0x02/03‖x`), confirmed by the new test. Caveat: `H` is NUMS-by-hash, discrete log is assumed unknown but not formally proven. |
| 31 | Secure generation of blinding factors | **IMPLEMENTED** | `confidential.ts:99-110` `secureScalar()` uses `crypto.getRandomValues(new Uint8Array(32))` then `mod n`, `nextScalar` maps 0→1; `:247` `rng = options.rng ?? secureScalar`; `:249` value blinding; `:258-267` 64 per-bit blindings with top-bit fix-up via `modInverse`; `:275` payee salt. Test confirms freshness across default calls and reproducibility with injected RNG. Caveat (LOW, GAP-8): the public `rng` option allows an insecure caller-supplied generator with no guard. |
| 32 | Range-proof generation and verification | **PARTIAL** | Real per-bit OR proof at `confidential.ts:118-177` (`proveBit`/`verifyBit`), aggregate binding at `:256-273` and `:314-321`, final `every(verifyBit)` at `:324`. Soundness holds for `value ∈ [0, max]`, and rejects `value > max` and `value ≥ 2^64` — but **fails for negative values** (GAP-1), so item 35 is a GAP. |
| 33 | Explicit integer-domain bounds | **PARTIAL** | `confidential.ts:244-246` and `:309-311` bound only **maxValue** to `[0, 2^64)`. `value` is unbounded at `:242`, `:250`, `:252-254` — no `value >= 0` / `value < MAX_RANGE` check anywhere. Additionally the verified max comes from `bundle.confidential.maxValueAtomic` (`verifier-core/src/index.ts:361-363`; type at `verifier-core/src/types.ts:64-70`), **not** the human-signed `mandate.constraints.maxAmount` used by the plaintext R11 (`verifier-core/src/index.ts:339-350`). |
| 34 | Reject negative, oversized, malformed, unsupported values | **PARTIAL** | Oversized (`≥2^64`) and over-cap values verify **false** (`confidential.ts:252-254, 319`); malformed numeric types throw via `BigInt()` (`:222-224`); negative max throws (`:244-246`). **Negative values are NOT rejected** and produce verifying proofs (GAP-1). Rejected at verification, not at generation, for oversized values. |
| 35 | Prevent modular-arithmetic range violations | **GAP** | `confidential.ts:48-51` `mul()` reduces scalars mod `n`; `:250` commits `value mod n`; `:254` `deltaBits = ((delta % 2^64) + 2^64) % 2^64` wraps. For `value < 0`, `delta = max + |value|` is a small positive integer, so the wrapped delta equals `max − value (mod n)` and `:319` passes. The doc claim at `:19-20` that "a negative delta wraps to ≈2^256" only covers `value > max`, not `value < 0`. Empirically: `value = -1, -1000, -(2^32)` with `max = 2_000000` all **verify true**. See `packages/clb-core/test/confidential-adversarial.test.ts` test `GAP-1`. |
| 36 | Adversarial proof and commitment-tampering tests | **IMPLEMENTED** | New `packages/clb-core/test/confidential-adversarial.test.ts`: zero/other/flipped commitment; all four scalars (`e0/e1/s0/s1`) at bits 0,1,31,62,63; off-curve / wrong / swapped / removed bit commitments; relabelled version. Pre-existing coverage at `packages/clb-core/test/confidential.test.ts:36-41`. |
| 37 | Proof-verification failure handling | **IMPLEMENTED** | `confidential.ts:304` `try { … } catch { return false }` at `:325-327`; shape/max guards at `:305-311`; verifier maps `false` to a failed R11 at `verifier-core/src/index.ts:356-367, 484-486`. Malformed hex, off-curve points, wrong bit length all return `false` without throwing (tested). Caveat: `rangeProof.version` is never checked (GAP-3). |
| 38 | Evidence-hashing algorithm | **IMPLEMENTED** | `packages/evidence-core/src/index.ts:8-9` imports `keccak_256` from `@noble/hashes/sha3`; `:53-56` `keccakHex` = `0x + bytesToHex(keccak_256(TextEncoder(bytes)))`; `:13-51` `canonicalJson` recursively sorts keys with `localeCompare`, drops `undefined`, preserves array order, rejects non-finite numbers; `:62-66` `hashEvidenceEvent = keccak256(canonicalJson(eventWithoutSignature))`. Caveat: `signature` deliberately excluded (GAP-4). |
| 39 | Hash-chain construction and event serialization | **IMPLEMENTED** | `evidence-core/src/index.ts:68-89` `linkEvidenceEvents`: first event's `previousEventHash` stripped (`:71`), each later event's `previousEventHash = hashEvidenceEvent(previous linked event)` (`:81-87`); serialization via `canonicalJson` (`:49-51`). Verifier R1 recomputes and checks links, optional declared hashes, and root at `verifier-core/src/index.ts:129-160`. Fixture construction at `attack-core/src/fixtures.ts:86-110`. Caveat: no external secret/anchor inside the chain (GAP-5). |
| 40 | Merkle leaf encoding and ordering | **IMPLEMENTED** | `evidence-core/src/index.ts:11` `ZERO_HASH`; `:58-60` `strip0x`; `:91-121` `buildMerkleRoot`: leaves are raw 32 bytes of each event hash (`:96`), parents `keccak256(left‖right)` (`:103-109`), odd last leaf **duplicated** (`:103`), no domain prefix / no sorted pairs, input order preserved, empty → `ZERO_HASH` (`:92-94`). Test confirms order sensitivity, odd-leaf duplication, single-leaf = leaf. Caveat: leaf encoding has no domain/type tag. |
| 41 | Merkle-root generation and proof verification | **PARTIAL** | Root generation is real and checked by R1 (`evidence-core/src/index.ts:91-121`; `verifier-core/src/index.ts:155-157`). **No membership-proof or proof-verification API exists**: evidence-core exports exactly 6 symbols (`src/index.ts:11,49,62,68,91,196`) — no `buildMerkleProof` / `verifyMerkleProof`. Membership can only be asserted by recomputing the root from the entire leaf set (GAP-7). |
| 42 | On-chain anchoring | **PARTIAL** | `contracts/src/AgenticAuditAnchor.sol:8-76` stores only `(merkleRoot, traceHash, metadataURI, anchoredBy, anchoredAt, exists)` keyed by `bytes32 traceId`; one anchor per trace, duplicate reverts `TraceAlreadyAnchored` (`:39-41`), missing read reverts `TraceNotAnchored` (`:68-70`), `TraceAnchored` event (`:20-27`). Client: `packages/anchor-core/src/index.ts:14-34` ABI, `:36-39` `traceIdToBytes32 = keccak256(string)`, `:41-56` `traceHash = keccak256(canonicalJson({traceId, merkleRoot, eventHashes}))`, `:125-204` bytecode check, duplicate check, receipt status and `isAnchored` retry verification. **NOT anchored**: raw evidence, individual events / `publicFields` / signatures, confidential commitment/range proof, verification-certificate hash. **Not enforced by the verifier** (GAP-6). |
| 43 | Evidence modification, deletion, reordering, substitution tests | **IMPLEMENTED** | New `packages/evidence-core/test/evidence-integrity-adversarial.test.ts`: per-index `publicFields` modification, deletion, reordering, valid-shaped substitution, signature-tamper documentation, recompute-heal documentation, plus end-to-end `buildValidBundle` → `verifyTrace` R1 assertions. Note (GAP-5/6): `attack-core/src/trace-utils.ts:4-14` `recomputeEvidenceIntegrity` rebuilds links + hashes + root for any edited event set with no secret, and R1 then passes again. |

---

## 2. What is actually anchored (item 42 detail)

```
ON-CHAIN (AgenticAuditAnchor)               OFF-CHAIN / NOT ANCHORED
┌──────────────────────────────────┐        ┌──────────────────────────────────────┐
│ bytes32 traceId  = keccak(id)    │        │ full EvidenceEvent[] + publicFields  │
│ bytes32 merkleRoot               │◀───────│ eventHashes[] (bound into traceHash) │
│ bytes32 traceHash                │        │ signatures (excluded from event hash)│
│ string  metadataURI              │        │ confidential C / rangeProof / opening│
│ address anchoredBy, uint64 time  │        │ VerificationCertificate hash         │
└──────────────────────────────────┘        └──────────────────────────────────────┘
   ⚠ verifier-core never reads the anchor; no anchor tx/root in the certificate.
```

`computeTraceHash` (`anchor-core/src/index.ts:41-56`) binds the full ordered `eventHashes` list, so changing any event hash changes the anchored `traceHash` — **if** the anchor is actually consulted. It is not.

---

## 3. New adversarial test files and exact results

| File | Tests | Covers |
|---|---|---|
| `packages/evidence-core/test/evidence-integrity-adversarial.test.ts` | 14 | items 38–43: chain tamper classes, signature exclusion, recompute-heal, Merkle recomputation/oddpair/no-proof-API, anchor shape, end-to-end R1 |
| `packages/clb-core/test/confidential-adversarial.test.ts` | 19 | items 29–37: scheme/group params, CSPRNG freshness, bounds, GAP-1 negative acceptance, oversized rejection, commitment/bit/scalar tampering, payee binding, failure handling, version GAP |

Command and result (Bun 1.4.5):

```
bun test packages/evidence-core/test/evidence-integrity-adversarial.test.ts \
         packages/clb-core/test/confidential-adversarial.test.ts

 33 pass
 0 fail
 464 expect() calls
 Ran 33 tests across 2 files. [29.82s]

bun run typecheck   # tsc --build  → exit 0, no diagnostics
```

No source, manuscript, package.json, scripts, or existing test file was modified.

---

## 4. Findings — every GAP with severity

| ID | Severity | Finding | Evidence | Minimal remediation (not applied) |
|---|---|---|---|---|
| **GAP-1** | **HIGH** | **Negative `valueAtomic` produces a verifying range proof.** A prover can claim `value <= max` for a negative amount; the Pedersen commitment holds `value mod n`. Directly contradicts items 34–35 and the design claim at `confidential.ts:19-20`. | `confidential.ts:242,250,252-254,319`; test `GAP-1 (HIGH)` — `-1`, `-1000`, `-(2^32)` all return `true` | Reject `value < 0 ‖ value >= MAX_RANGE` in `commitConfidential` (and document that the 64-bit proof cannot itself encode sign). |
| **GAP-2** | **HIGH** | **The verified cap is bundle-supplied, not human-signed.** Confidential R11 uses `bundle.confidential.maxValueAtomic` while plaintext R11 uses `mandate.constraints.maxAmount`. A bundle author can inflate the cap and pass R11; the doc claim that max is "human-signed … supplied by the verifier" is unenforced. | `verifier-core/src/index.ts:339-350,356-367`; `types.ts:64-70`; `confidential.ts:20-21` | Derive `maxValueAtomic` from the signed mandate/predicate and require equality with `bundle.confidential.maxValueAtomic`. |
| **GAP-3** | **LOW** | `rangeProof.version` is declared but never checked; a proof relabelled `v999` still verifies. | `confidential.ts:304-324`; test in `confidential-adversarial.test.ts` | Compare `rangeProof.version === CONFIDENTIAL_VERSION` in `verifyConfidential`. |
| **GAP-4** | **MEDIUM** | **Evidence event signatures are outside the hash** and no verifier rule validates them. Changing an event's `signature` leaves the hash, chain and root unchanged; fixture signatures are dummy constants. | `evidence-core/src/index.ts:62-66`; `verifier-core/src/index.ts:40-58,162-185`; `attack-core/src/fixtures.ts:41`; test `GAP-DOC` | Include a signature digest in the hashed event or add an explicit per-event signature rule. |
| **GAP-5** | **MEDIUM** | **Hash chain + Merkle root are self-referential.** `recomputeEvidenceIntegrity` re-links and rebuilds hashes/root for any edited event set with no secret, after which R1 passes. R1 checks internal consistency only. | `attack-core/src/trace-utils.ts:4-14`; `verifier-core/src/index.ts:129-160`; test `GAP-DOC` | Verify the recomputed root against a trusted external anchor (see GAP-6). |
| **GAP-6** | **MEDIUM** | **No on-chain anchor verification in the verifier.** `verifier-core` never imports `anchor-core`; the certificate carries `traceMerkleRoot` but no anchor tx hash or anchored root. Anchoring is an opt-in client step, so a re-computed bundle (GAP-5) is accepted. Also, one-anchor-per-trace means a corrected trace cannot be re-anchored. | `verifier-core/src/index.ts:1-27,504-515`; `anchor-core/src/index.ts:125-204`; `AgenticAuditAnchor.sol:39-41`; test `GAP-DOC` | Fetch and compare the anchored root in verification; add anchor reference + version/update path to the certificate/contract. |
| **GAP-7** | **MEDIUM** | **No Merkle membership-proof API.** Neither proof generation nor verification exists; proving one event's inclusion requires the full leaf set. | `evidence-core/src/index.ts` exports only 6 symbols (`:11,49,62,68,91,196`); test asserting absence | Add `buildMerkleProof` / `verifyMerkleProof` with the same `keccak256(left‖right)` + duplicate-last encoding. |
| **GAP-8** | **LOW** | Public injectable RNG in `ConfidentialOptions` can silently produce predictable blindings in production; no guard/domain separation marker distinguishes demo RNG from CSPRNG. | `confidential.ts:99-110,194-199,247` | Restrict the `rng` option to test builds or require an explicit `unsafeTestRng` flag. |
| **GAP-9** | **LOW** | Research-prototype cost/size: 64 individual bit OR-proofs (linear-size, no Bulletproof aggregation) and no security audit or formal soundness proof; `H` is NUMS-by-hash, not a formally justified constant. | `confidential.ts:1-25,81-97,256-273` | Label as prototype in any production-facing claim; migrate to an audited range-proof library before production use. |

**Not gaps (explicit non-findings):** the curve is secp256k1 (not BN254), the commitment is a genuine Pedersen commitment, the OR-proofs are real Fiat–Shamir OR proofs with an aggregate soundness equation, hash-chain/Merkle internals are correctly recomputed, and verification failures return `false` instead of throwing. These are **not** DEMO code — but GAP-1 and GAP-2 mean the confidential path must not be treated as financially sound as written.
