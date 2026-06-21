---
name: Phase 7F — Confidential Commit-and-Prove Variant (OPTIONAL)
overview: "Answer the on-chain metadata-leakage critique (raised by Five-Attacks and A402) with elegance, not a heavy TEE vault. On-chain = digest of C + a range proof that value <= maxValue; payee/amount/cart encrypted off-chain (S3) with only a public digest; the verifier checks the predicate against the commitment WITHOUT learning the params. Finally delivers the deferred selective-disclosure encryption (ACEL.md §4). OPTIONAL / HIGH CRYPTO RISK — degrade path: if the range-proof library is too heavy, ship the selective-disclosure evidence path ALONE (encrypted off-chain + public digest) and label the range proof a documented extension. Do NOT block 7G on this. Spec §5 (7F)."
todos:
  - id: 7f-range-proof-adapter
    content: "clb-core: confidential mode — commitment + range proof (value <= maxValue) behind a swappable proof adapter (Pedersen/Bulletproof lib); keep the prove/verify interface tiny so the lib is replaceable"
    status: pending
  - id: 7f-encrypted-evidence
    content: "evidence-service: encrypted-payload path — public digest on the event, private encrypted blob to S3 (EVIDENCE_ENCRYPTION_KEY); delivers the deferred selective-disclosure design"
    status: pending
  - id: 7f-confidential-verify
    content: "verifier-core: confidential verification path consuming the range proof + commitment (not plaintext payee/amount); predicate checked without revealing params"
    status: pending
  - id: 7f-e2e-confidential
    content: "scripts/e2e-phase7-confidential.ts + e2e:phase7-confidential: PASS where on-chain reveals neither payee nor exact amount; OR degrade to selective-disclosure-only with range proof documented as future"
    status: pending
isProject: false
---

# Phase 7F — Confidential Commit-and-Prove Implementation Plan (OPTIONAL)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **This sub-phase is OPTIONAL and high-risk.** Honor the degrade path at the bottom: if the range-proof tooling is too heavy, ship the selective-disclosure evidence path alone and document the range proof as future work. Never block 7G (paper) on this.

**Goal:** A verified trace where the **on-chain data reveals neither the payee nor the exact amount** — the commitment is a digest, and a range proof attests `value ≤ maxValue`; payee/amount/cart live encrypted off-chain with only a public digest; the verifier checks the predicate against the commitment without learning the params.

**Architecture:** Add a `confidential` mode to `clb-core` that produces `{ commitment, rangeProof }` behind a **tiny, swappable proof adapter** (a Pedersen-commitment + Bulletproof-style range proof library, isolated so it can be replaced). `evidence-service` gains an encrypted-payload path: each event stores a public digest on-chain/in-graph and an encrypted blob in S3 (the deferred selective-disclosure work from ACEL.md §4). `verifier-core` gains a confidential verification path that consumes the proof + commitment rather than plaintext. This wins on elegance vs. A402's TEE Liquidity Vault.

**Tech Stack:** TypeScript (Bun) · a range-proof library behind an adapter (e.g. a Bulletproofs/Pedersen WASM or pure-TS lib — pick one, isolate it) · S3 (`S3_BUCKET`, `AWS_REGION`) + `EVIDENCE_ENCRYPTION_KEY` (AES-GCM) · existing `clb-core`, `evidence-service`, `evidence-core`, `verifier-core`.

**Repo grounding (verify before editing):**
- `ACEL.md` §4 (selective disclosure: public hashes/range vs. encrypted cart/identity/amount) — the design this implements.
- `CLB.md` §12 [Q2] (metadata privacy / commit-and-prove as a possible second paper) — the motivation.
- `packages/evidence-core` — `EvidenceEvent` (`objectHash`, `publicFields`, `privateRef`) already reserves `privateRef` for an encrypted-payload pointer.
- `services/evidence-service` — event ingestion; DECISIONS notes encryption was deferred (the gap this closes).
- Env already present: `EVIDENCE_ENCRYPTION_KEY`, `S3_*`.

---

## Task 1: Range-proof adapter + confidential commitment (clb-core)

**Files:**
- Create: `packages/clb-core/src/confidential.ts`
- Create: `packages/clb-core/test/confidential.test.ts`

- [ ] **Step 1: Write the failing test** — a confidential commitment to `value=2` with `maxValue=2` verifies; `value=3` with `maxValue=2` fails the range proof; the on-chain blob contains neither the cleartext value nor the payee.

```ts
// packages/clb-core/test/confidential.test.ts
import { describe, expect, it } from "bun:test";
import { commitConfidential, verifyConfidential } from "../src/confidential";

it("range proof verifies for value <= maxValue and hides the value", () => {
  const c = commitConfidential({ valueAtomic: 2_000000n, maxValueAtomic: 2_000000n, payTo: "0xBEEF" });
  expect(verifyConfidential(c.commitment, c.rangeProof, { maxValueAtomic: 2_000000n })).toBe(true);
  expect(JSON.stringify(c.onchain)).not.toContain("2000000"); // value hidden
  expect(JSON.stringify(c.onchain).toLowerCase()).not.toContain("beef"); // payee hidden
});

it("range proof fails for value > maxValue", () => {
  const c = commitConfidential({ valueAtomic: 3_000000n, maxValueAtomic: 2_000000n, payTo: "0xBEEF" });
  expect(verifyConfidential(c.commitment, c.rangeProof, { maxValueAtomic: 2_000000n })).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails** Run: `bun test packages/clb-core/test/confidential.test.ts` → FAIL.

- [ ] **Step 3: Implement** — a tiny adapter interface `RangeProver { prove(value, max): Proof; verify(commitment, proof, {max}): bool }` with one concrete impl backed by the chosen library; `commitConfidential` returns `{ commitment, rangeProof, onchain }` where `onchain` is only the commitment digest + proof (no cleartext). Keep the library import isolated in this file.

> **Decision gate:** spike the chosen range-proof library here FIRST (one throwaway script). If it does not run cleanly under Bun within a day of effort, STOP and take the degrade path (skip Tasks 1+3, do Task 2 selective-disclosure only).

- [ ] **Step 4: Run to verify it passes** Run: `bun test packages/clb-core/test/confidential.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/clb-core/src/confidential.ts packages/clb-core/test/confidential.test.ts
git commit -m "feat(clb-core): confidential commit + range proof (value <= maxValue) behind a swappable adapter"
```

---

## Task 2: Encrypted-payload evidence path (selective disclosure)

**Files:**
- Modify: `services/evidence-service/src/*` (encrypt blob → S3, store `privateRef` + public digest)
- Create: `services/evidence-service/test/encrypted-payload.test.ts`

- [ ] **Step 1: Write the failing test** — ingesting an event with a private payload stores a public digest on the event and an encrypted blob; the blob round-trips with the key and is opaque without it.

```ts
it("private payload is encrypted off-chain; only a public digest is on the event", async () => {
  const ev = await ingest({ traceId: "0xt", publicFields: { network: "base-sepolia" }, privatePayload: { payTo: "0xBEEF", amount: "2.00" } });
  expect(ev.privateRef).toBeTruthy();        // pointer to encrypted blob
  expect(ev.objectHash).toBeTruthy();        // public digest
  expect(JSON.stringify(ev.publicFields)).not.toContain("BEEF");
  const blob = await fetchBlob(ev.privateRef);
  expect(blob).not.toContain("BEEF");        // ciphertext
  expect(decrypt(blob, process.env.EVIDENCE_ENCRYPTION_KEY!)).toContain("BEEF");
});
```

- [ ] **Step 2: Run to verify it fails** Run: `bun test services/evidence-service/test/encrypted-payload.test.ts` → FAIL.

- [ ] **Step 3: Implement** — on ingest, if `privatePayload` is present: AES-GCM encrypt with `EVIDENCE_ENCRYPTION_KEY`, PUT to S3 (or local MinIO), set `event.privateRef` to the object URI and `event.objectHash` to the digest of the canonical payload; never write cleartext to `publicFields`. (This is the deferred ACEL.md §4 path.)

- [ ] **Step 4: Run to verify it passes** Run: `bun test services/evidence-service` → PASS.

- [ ] **Step 5: Commit**

```bash
git add services/evidence-service
git commit -m "feat(evidence-service): encrypted-payload selective-disclosure path (public digest + private blob)"
```

---

## Task 3: Confidential verification path (verifier-core)

**Files:**
- Modify: `packages/verifier-core/src/*` (a `confidential` mode that checks the predicate via the range proof)
- Create: `packages/verifier-core/test/confidential-verify.test.ts`

- [ ] **Step 1: Write the failing test** — given a confidential trace (commitment + range proof, no cleartext amount/payee), the verifier PASSes the amount predicate via the proof and never reads a cleartext amount.

```ts
it("confidential verify passes the amount predicate via the range proof, not plaintext", () => {
  const res = verifyTrace(confidentialTrace({ valueAtomic: 2_000000n, maxValueAtomic: 2_000000n }), { confidential: true });
  expect(res.failedRules).not.toContain("R11_AMOUNT_WITHIN_MANDATE");
  expect(res.readPlaintextAmount).toBeUndefined(); // proof-only path
});
```

- [ ] **Step 2: Run to verify it fails** Run: `bun test packages/verifier-core/test/confidential-verify.test.ts` → FAIL.

- [ ] **Step 3: Implement** — a `confidential` verification path: R11 (amount-within-mandate) is discharged by `verifyConfidential(commitment, rangeProof, {maxValueAtomic})` instead of comparing a plaintext amount; payee/asset checks use the committed digests + selectively-disclosed fields. Keep the standard plaintext path unchanged.

- [ ] **Step 4: Run to verify it passes** Run: `bun test packages/verifier-core` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/verifier-core
git commit -m "feat(verifier): confidential verification path (range proof, no plaintext amount)"
```

---

## Task 4: `e2e:phase7-confidential` (or documented degrade)

**Files:**
- Create: `scripts/e2e-phase7-confidential.ts`
- Modify: `package.json` (`"e2e:phase7-confidential": "bun run scripts/e2e-phase7-confidential.ts"`)
- Output: `experiments/benchmarks/phase7-confidential.json`

- [ ] **Step 1: Write the script** — run a full confidential trace end to end; assert the verifier PASSes and the on-chain/public artifact reveals neither payee nor exact amount; write the JSON proof-of-privacy artifact.

- [ ] **Step 2: Run it** Run: `bun run e2e:phase7-confidential`
Expected: exits 0; prints "CONFIDENTIAL PASS — payee/amount not revealed on-chain".

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-phase7-confidential.ts package.json experiments/benchmarks/phase7-confidential.json
git commit -m "feat(e2e): phase7-confidential proves privacy-preserving verification"
```

---

## Acceptance (7F complete when EITHER)

- **Full:** `bun run e2e:phase7-confidential` PASSes with payee + exact amount hidden on-chain; `bun test packages/clb-core packages/verifier-core services/evidence-service` green.
- **Degrade:** Task 2 (encrypted selective-disclosure evidence path) ships green; Tasks 1+3 are documented as a future extension in `docs/paper-outline.md` ("confidential range-proof variant — design + future work"), with the privacy story resting on selective disclosure. This is an acceptable, honest outcome.

## Self-review checklist

- [ ] The range-proof library is imported in exactly one file (swappable).
- [ ] No cleartext payee/amount appears in `publicFields` or on-chain in the confidential path.
- [ ] The standard (non-confidential) verification path is unchanged and still green.
- [ ] If degrading: the paper clearly scopes the range proof as future work; selective disclosure is the shipped privacy claim.
