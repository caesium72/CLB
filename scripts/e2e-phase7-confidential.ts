/**
 * Phase 7F confidential commit-and-prove e2e.
 *
 * Usage:
 *   bun run e2e:phase7-confidential
 *
 * Self-contained (no HTTP services, no on-chain interaction). Demonstrates a
 * verified delegated (Mode B) trace where the PUBLIC / on-chain artifact reveals
 * neither the payee nor the exact amount:
 *   - the settlement value is bound by a Pedersen commitment + a range proof that
 *     `value <= maxValue` (clb-core confidential);
 *   - payee/amount/cart are AES-256-GCM encrypted off-chain, leaving only a
 *     public digest + privateRef on the evidence event (selective disclosure);
 *   - the verifier discharges R11 from the range proof, never reading a plaintext
 *     amount (verifier-core confidential path).
 *
 * Writes experiments/benchmarks/phase7-confidential.json. The demo uses a seeded
 * RNG + fixed salt so the committed artifact is deterministic (the CI drift guard
 * can diff it); production callers use the secure default CSPRNG.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildValidModeBBundle, verifyTrace } from "@clb-acel/attack-core";
import {
  commitConfidential,
  verifyConfidential,
  verifyPayeeCommitment,
} from "@clb-acel/clb-core";
import { type Hex, parseUnits } from "viem";
import {
  createInMemoryBlobStore,
  decrypt,
  fetchBlob,
  ingest,
  setDefaultBlobStore,
} from "../services/evidence-service/src/encrypted-payload";

const OUT_DIR = resolve(import.meta.dir, "../experiments/benchmarks");
const GENERATED_AT = "2026-06-06T00:00:00.000Z";
const DECIMALS = 6;

/** Deterministic PRNG so the proof artifact is reproducible (demo only). */
function seededRng(seed: bigint): () => bigint {
  let state = seed & ((1n << 256n) - 1n);
  return () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 256n) - 1n);
    return state;
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  console.log("CLB-ACEL Phase 7F — confidential commit-and-prove e2e\n");

  // Deterministic demo key + in-memory blob store (no AWS/MinIO required).
  // `.env` may auto-load an empty EVIDENCE_ENCRYPTION_KEY, so override when blank.
  if (!process.env.EVIDENCE_ENCRYPTION_KEY?.trim()) {
    process.env.EVIDENCE_ENCRYPTION_KEY = `0x${"ab".repeat(32)}`;
  }
  setDefaultBlobStore(createInMemoryBlobStore());

  // 1. Honest delegated (Mode B) trace.
  const { bundle } = await buildValidModeBBundle({ traceId: "trace-phase7f-confidential" });
  const payTo = bundle.settlement.payTo;
  const amountDecimal = bundle.settlement.value; // e.g. "2.00"
  const valueAtomic = parseUnits(amountDecimal, DECIMALS); // 2_000000n
  const maxValueDecimal = "5.00"; // public, human-signed spending cap
  const maxValueAtomic = parseUnits(maxValueDecimal, DECIMALS); // 5_000000n

  // 2. Confidential commitment + range proof (value <= maxValue).
  const confidential = commitConfidential(
    { valueAtomic, maxValueAtomic, payTo },
    { rng: seededRng(0x7f_c0ffeen), payeeSalt: `0x${"11".repeat(32)}` as Hex },
  );
  bundle.confidential = {
    valueCommitment: confidential.commitment,
    rangeProof: confidential.rangeProof,
    maxValueAtomic: maxValueAtomic.toString(),
  };

  // 3. Selective disclosure: encrypt payee/amount/cart off-chain; keep a digest.
  const evidence = await ingest({
    traceId: bundle.traceId,
    protocol: "X402",
    objectType: "X402_PAYMENT_PAYLOAD",
    publicFields: { network: bundle.settlement.network, layer: "confidential" },
    privatePayload: { payTo, amount: amountDecimal, cart: ["token-risk-report:XYZ"] },
  });

  // 4. Verify the trace via the confidential (proof-only) path.
  const verification = await verifyTrace(bundle, { confidential: true });
  assert(
    verification.result.status === "PASS",
    `verifier should PASS, got ${verification.result.status} (${verification.result.failedRules.join(", ")})`,
  );
  assert(
    verification.readPlaintextAmount === undefined,
    "verifier must not read a plaintext amount in confidential mode",
  );
  assert(
    !verification.result.failedRules.includes("R11_AMOUNT_WITHIN_MANDATE"),
    "R11 must pass via the range proof",
  );
  console.log("✓ Verifier PASS via range proof (R11 discharged without a plaintext amount)");

  // 5. Privacy: the public/on-chain artifact reveals neither payee nor amount.
  const blob = await fetchBlob(evidence.privateRef!);
  const publicArtifact = {
    confidentialOnchain: confidential.onchain,
    evidenceEvent: {
      objectHash: evidence.objectHash,
      publicFields: evidence.publicFields,
      privateRef: evidence.privateRef,
    },
    encryptedBlob: blob,
  };
  const publicStr = JSON.stringify(publicArtifact).toLowerCase();
  assert(!publicStr.includes(payTo.toLowerCase()), "payee address must not appear in the public artifact");
  assert(!publicStr.includes(amountDecimal.toLowerCase()), "decimal amount must not appear in the public artifact");
  assert(!publicStr.includes(valueAtomic.toString()), "atomic amount must not appear in the public artifact");
  console.log(
    `✓ Public/on-chain artifact hides payee (${payTo.slice(0, 10)}…) and amount (${amountDecimal} / ${valueAtomic} atomic)`,
  );

  // 6. Selective disclosure round-trips for an authorized holder of the key.
  const revealed = JSON.parse(decrypt(blob, process.env.EVIDENCE_ENCRYPTION_KEY!)) as {
    payTo: string;
    amount: string;
  };
  assert(
    revealed.payTo === payTo && revealed.amount === amountDecimal,
    "decrypted payload must round-trip to the original payee/amount",
  );
  assert(
    verifyPayeeCommitment(confidential.payeeCommitment, confidential.opening.payTo, confidential.opening.payeeSalt),
    "payee commitment must open to the disclosed payee",
  );
  console.log("✓ Selective disclosure: blob decrypts with the key; payee commitment opens");

  // 7. Soundness sanity: an over-budget confidential commitment fails the proof.
  const overBudget = commitConfidential({ valueAtomic: parseUnits("9.00", DECIMALS), maxValueAtomic, payTo });
  const overBudgetAccepted = verifyConfidential(overBudget.commitment, overBudget.rangeProof, {
    maxValueAtomic: maxValueAtomic.toString(),
  });
  assert(overBudgetAccepted === false, "over-budget value must fail the range proof");
  console.log("✓ Soundness: over-budget (9.00 > 5.00) confidential commitment REJECTED by the range proof");

  // 8. Proof-of-privacy artifact (deterministic fields only).
  const artifact = {
    phase: "7F",
    mode: "confidential-commit-and-prove",
    traceId: bundle.traceId,
    verifier: {
      status: verification.result.status,
      failedRules: verification.result.failedRules,
      readPlaintextAmount: verification.readPlaintextAmount ?? null,
      r11DischargedBy: "range-proof",
    },
    privacy: {
      payeeRevealedOnChain: false,
      amountRevealedOnChain: false,
      valueCommitment: confidential.commitment,
      payeeCommitment: confidential.payeeCommitment,
      rangeProofVersion: confidential.rangeProof.version,
      rangeProofBits: confidential.rangeProof.bitLength,
      rangeProofByteSize: Buffer.byteLength(JSON.stringify(confidential.rangeProof), "utf8"),
      evidenceObjectHash: evidence.objectHash,
      encryptedBlobByteSize: Buffer.byteLength(blob, "utf8"),
      selectiveDisclosureDecrypts: true,
    },
    soundness: {
      inRangeAccepted: true,
      overBudgetRejected: overBudgetAccepted === false,
    },
    generatedAt: GENERATED_AT,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    resolve(OUT_DIR, "phase7-confidential.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  console.log("\n✓ Wrote experiments/benchmarks/phase7-confidential.json");
  console.log("\nCONFIDENTIAL PASS — payee/amount not revealed on-chain");
}

main().catch((error) => {
  console.error(`\n✗ e2e:phase7-confidential failed: ${error.message}`);
  process.exit(1);
});
