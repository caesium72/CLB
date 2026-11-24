# R4-C2 — Evidence trust model & prompt-injection detection: code-evidenced answer

Repository: `E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2`

Reviewer #4, Comment 2 asks two questions:

1. *"The evidence graph is produced by the untrusted agent, so explain how omitted or fabricated events are prevented."*
2. *"The prompt-injection detection method is not described."*

Status is assigned from **executed code**, not from names or comments. Every claim below is
backed by a test that ran successfully. The short answer is deliberately uncomfortable:
**omission/fabrication cannot be prevented by the verifier alone.** What was previously
logged as GAP-5/GAP-6 is only partly closed, and only when the caller supplies a trusted
root. This report says exactly what is and is not enforced.

---

## 0. Bottom line

```
  untrusted agent ──writes──▶ EvidenceEvent[] ──hashEvidenceEvent──▶ eventHashes
                                   │                                    │
                                   └──previousEventHash = H(prev)────────┤
                                                                         ▼
                                              buildMerkleRoot ──▶ merkleRoot
                                                                         │
             ┌───────────────────────────────────────────────────────────┤
             │  R1 internal consistency (chain links, hashes, root)      │
             │  ✔ detects edit / delete / reorder / swap vs DECLARED root│
             │  ✘ recomputeEvidenceIntegrity() heals ALL of the above   │
             │    for any rewritten event set — no secret required      │
             └───────────────────────────────────────────────────────────┘
                                                                         │
   NEW: expectedMerkleRoot (caller-supplied, from anchor) ──compare───────┤
   NEW: strictEvidenceIntegrity → fail closed when root absent           │
   NEW: requiredEventObjectTypes / unique ids → naive omission check      │
                                                                         ▼
                                                                    R1 verdict
```

- **Detection** of modification/deletion/reordering/fabrication works **only relative to a
  trusted declared root**. Without one, an agent that can write the event set can also
  recompute its links, hashes and Merkle root (`recomputeEvidenceIntegrity`) and R1 passes.
- **Prevention** requires an independent anchor. `AgenticAuditAnchor.sol` exists and
  `anchor-core` computes a `traceHash` binding `traceId + merkleRoot + ordered eventHashes`,
  but **`verifier-core` does not read the chain** (GAP-6). It cannot by itself: it has no RPC
  client and may run offline. The new option makes the trust boundary explicit — the caller
  must obtain the root from the anchor and hand it to the verifier.
- **Prompt injection** is detected as an *unauthorized selection effect*, by comparing the
  logged `selectedPayee` with the mandate allowlist using checksummed addresses. It is
  **not** natural-language analysis of the prompt, and it does not observe the injection
  itself. It is an audit check, not a deterministic verifier rule.

---

## 1. What the code actually does today

| Mechanism | Location | Guarantees | Does not guarantee |
|---|---|---|---|
| `hashEvidenceEvent` = `keccak256(canonicalJson(event))` | `packages/evidence-core/src/index.ts:67-69` | Whole event (now including `signature`) is bound to its hash; canonical key order, `undefined` dropped, arrays ordered | Authenticity of the actor/signature (fixtures use placeholder sigs; events carry no signer address) |
| `linkEvidenceEvents` sets `previousEventHash = H(previous)` | `evidence-core/src/index.ts:71-92` | Order and content are bound into a chain | That the first event or the set is genuine |
| `buildMerkleRoot` = binary `keccak256(left‖right)`, duplicate-last leaf | `evidence-core/src/index.ts:94-124` | One root commits the whole ordered leaf set; order-sensitive | That the committed set is the one the human authorized |
| R1 check | `packages/verifier-core/src/index.ts:163-237` | Recomputes links, checks optional declared `eventHashes`, recomputes root and compares with `bundle.merkleRoot`; rejects malformed signatures; **new**: trusted root, strict mode, completeness | Any of the above against an external/anchored baseline unless `expectedMerkleRoot` is supplied |
| `recomputeEvidenceIntegrity` | `packages/attack-core/src/trace-utils.ts:4-14` | (Attack utility) rebuilds links + hashes + root for any edited event set | Requires no secret — this is precisely why internal consistency is not integrity (GAP-5) |
| On-chain anchor | `contracts/src/AgenticAuditAnchor.sol`, `packages/anchor-core/src/index.ts:41-56` | Stores `(traceId, merkleRoot, traceHash, URI, sender, time)`; `traceHash` binds the full ordered `eventHashes` | Is **not consulted** by `verifyTrace`; anchoring is an opt-in client step; one anchor per trace (GAP-6) |

### Why self-consistent rewrites are invisible to R1

```
original:    e1 ──▶ e2 ──▶ e3      root = R0      anchored on-chain = R0
attack:      e1 ──▶ e2'──▶ e3      R1 FAILS (declared hashes/root still R0)
heal:        strip links, re-link, re-hash, re-root ──▶ root = R1'
verify:      bundle declares R1' → R1 PASSES (all internal checks self-consistent)
detect:      compare recomputed root against anchored R0 → R0 ≠ R1' → REJECT
```

The last line is the only trustworthy discriminator, and it needs a root obtained
**outside the bundle**. That is what the new control enforces.

---

## 2. Controls implemented in this revision (what is now actually closed)

All changes are confined to the owned files:
`packages/evidence-core/src/index.ts`, the **R1 / options / certificate-adjacent** region of
`packages/verifier-core/src/index.ts`, and the two new test files. R2/R5 anchor handling,
R10, R11, `modeBCommitmentInputOf`, the manuscript, and all other tests were untouched.

### 2.1 Trusted expected root + strict fail-closed mode (primary control)

`packages/verifier-core/src/index.ts`

- `VerifyTraceOptionsWithPrincipal` now accepts:
  - `expectedMerkleRoot?: Hex` (line 54) — root obtained **out of band** (e.g. read from
    `AgenticAuditAnchor` by the caller, or from a signed attestation).
  - `strictEvidenceIntegrity?: boolean` (line 60) — refuse an integrity PASS without a
    trusted root.
  - `requiredEventObjectTypes?: readonly string[]` (line 66) — caller-supplied, mandate-derived
    completeness policy (never read from the bundle under test).
- `checkHashChain` (R1, lines 163-237):
  - recomputed root is compared case-insensitively with `expectedMerkleRoot`
    (lines 222-229); mismatch ⇒ `R1 = false`, detail `Evidence Merkle root does not match
    trusted expected root (...)`.
  - strict mode with no root ⇒ `R1 = false`, detail
    `STRICT_EVIDENCE_INTEGRITY_REQUIRES_TRUSTED_ROOT` (lines 218-220) — the verifier refuses
    to attest integrity it cannot check.
  - this defeats `recomputeEvidenceIntegrity`: the attacker can heal the chain and root, but
    cannot make the root equal the independently anchored `R0`.

**Test proof** (`verifier-core/test/evidence-trust-model.test.ts`): an honest bundle is
tampered, `R1` fails; `recomputeEvidenceIntegrity` heals it and `R1` passes with no root;
with `expectedMerkleRoot = originalRoot`, `R1` fails and the whole verdict is `FAIL`.

### 2.2 Structural completeness rule (secondary control)

- `checkHashChain` rejects duplicate `eventId`s (line 178) and, when
  `requiredEventObjectTypes` is supplied, rejects a set missing any required object type
  (lines 231-235). The required list comes from the **caller/mandate**, not the bundle.
- New pure helper `auditEvidenceEventSet` (`evidence-core/src/index.ts:212`) does the same
  structural check off-line (`NO_EVENTS`, `DUPLICATE_EVENT_ID:*`,
  `MISSING_REQUIRED_OBJECT_TYPE:*`) so orchestrators can fail early.

**Limit, stated honestly:** an attacker who controls the event set can insert a *fabricated*
event of every required type and pass this check. It closes naive omission and duplicate-id
fabrication only; authenticity still requires the trusted root. Test `LIMIT: fabricated
placeholder events satisfy the type check` records this.

### 2.3 Malformed signature rejection (already present, now documented)

R1 rejects signatures not matching `0x[0-9a-fA-F]{130}` (`verifier-core/src/index.ts:191-192`).
The signature is included in the event hash (`evidence-core/src/index.ts:67-69`), so a swap
also breaks the chain/root. There is still **no ECDSA recovery against an actor key** —
fixture signatures are placeholders and events carry no signer address. This is a
*format* check, not *authenticity*.

---

## 3. Residual trust gaps (NOT closed — do not overclaim)

| ID | Severity | Residual finding | Why it remains | Remediation outside this revision's scope |
|---|---|---|---|---|
| **GAP-5** | **MEDIUM** (open in default mode) | A caller that does not pass `expectedMerkleRoot` still gets a PASS for a self-consistent rewrite. | Compatibility: making the trusted root mandatory would break every existing offline test and all callers that verify unsigned local traces. Strict mode is opt-in. | Require `strictEvidenceIntegrity: true` in the production verifier service and supply the root from the anchor. |
| **GAP-6** | **MEDIUM** (open) | `verifyTrace` never reads `AgenticAuditAnchor`; the certificate carries `traceMerkleRoot` but no anchor tx hash / anchored root. | `verifier-core` has no RPC dependency and must work offline; adding an on-chain read touches files outside this revision's ownership and would make verification network-dependent. | Have the service read `getAnchor(traceId)` and pass `expectedMerkleRoot`; add `anchorTxHash`/`anchoredRoot` to the certificate and contract version/update path. |
| **GAP-5b** | **MEDIUM** (structural) | Required-type completeness can be satisfied by fabricated placeholder events. | Presence ≠ authenticity; structural checks cannot distinguish a genuine event from a well-shaped fake. | Bind each event to a signer/key and verify it (ECDSA), plus the anchored root. |
| **GAP-auth** | **MEDIUM** | R1 does not authenticate event signatures against an actor key. | No signer address in `EvidenceEvent`; dummy fixture signatures. | Extend schema with signer + real signature rule; verify against `ERC8004` agent keys. |
| **GAP-anchor** | **LOW** | One anchored root per trace ID; a corrected trace cannot be re-anchored. | Contract design (`TraceAlreadyAnchored`). | Add versioned anchors in `AgenticAuditAnchor.sol`. |

**Severity statement for the manuscript:** without a trusted anchor, *prevention* of
omitted/fabricated events is **impossible** for the verifier; only *detection by comparison*
is possible, and only when the trusted root is supplied. The implemented strict mode makes
the absence of that comparison a hard failure rather than a silent PASS.

---

## 4. Prompt-injection detection — exact algorithm

Source: `packages/attack-core/src/audit-checks.ts:26-38`, exported as `checkPromptInjection`
via `attack-core/src/index.ts:30`. Result type `AuditCheckResult = { ok: boolean; detail?: string }`.

```
1. discovery = first event with objectType === "ERC8004_AGENT_SELECTION"
2. selectedPayee = discovery?.publicFields.selectedPayee
3. if typeof selectedPayee !== "string":
       return { ok: false, detail: "No selectedPayee was logged in discovery evidence" }
4. allowedPayees = bundle.mandate.constraints.allowedPayees ?? []
5. selectedAllowed = allowedPayees.some(p => getAddress(p) === getAddress(selectedPayee))
       (viem.getAddress = EIP-55 checksum; a throw on malformed input ⇒ false)
6. selectedAllowed  ⇒ { ok: false, "Selected merchant was inside allowedPayees" }
   otherwise       ⇒ { ok: true,  "Discovery selected a merchant outside allowedPayees" }
```

**Critical semantic note:** `ok === true` means **"injection effect DETECTED"**, not "the
trace is safe". `runAttack` (`attack-core/src/index.ts:553`) treats `auditCheck.ok === true`
as `auditMatched` (a successful detection). This is an audit *finding* convention.

**What it does NOT do:**
- It does **not** parse, embed, or classify the prompt text. There is no NLP/LLM-based
  injection detector. It detects the *effect* of a suspected injection — an unauthorized
  payee selection recorded in the evidence graph — not the injection string itself.
- It trusts `selectedPayee` because that field was written by the untrusted agent. If the
  agent omits the selection event, or logs a benign payee while settling elsewhere, this
  check is silent (`ok:false` = no finding). The **deterministic verifier** independently
  checks the *actual* settlement payee in `R12_PAYEE_MATCHES_CHECKOUT_OR_TASK` against the
  mandate/predicate allowlist and registered merchant keys, so a payee substitution is
  still rejected at settlement even if the selection event is missing or dishonest.
- It is audit-only: `expectedFailedRules: []` for `PROMPT_INJECTION_SELECTION`; no verifier
  rule fails on the selection event alone.

**Tests added** (`evidence-core/test/evidence-trust-model.test.ts`):
missing selection event; inside allowlist; outside allowlist; lowercase/checksum-insensitive
variants; malformed `selectedPayee`; malformed allowlist entry. All pass.

---

## 5. Verification evidence (actually executed)

```
$ bun test packages/evidence-core/test/evidence-trust-model.test.ts \
           packages/verifier-core/test/evidence-trust-model.test.ts
bun test v1.4.5 (a7733435c)
 21 pass
 0 fail
 46 expect() calls
 Ran 21 tests across 2 files. [900.00ms]

$ bun test
bun test v1.4.5 (a7733435c)
 353 pass
 2 skip
 0 fail
 1916 expect() calls
 Ran 355 tests across 61 files. [47.62s]

$ bun run typecheck
$ tsc --build          # exit 0, no diagnostics
```

Baseline before this revision: 332 pass / 2 skip / 0 fail. Delta: +21 tests, still 0 fail.

No manuscript, `package.json`, `scripts/`, `REPRODUCIBILITY.md`, `presettlement.ts`,
`x402-adapter`, or non-owned test file was modified. Paste-ready manuscript text is in
`review-revision/reviewer-4/comment-2/manuscript-insert.md`.
