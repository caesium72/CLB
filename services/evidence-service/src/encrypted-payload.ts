/**
 * Phase 7F — encrypted-payload selective-disclosure path (evidence-service).
 *
 * Delivers the deferred ACEL.md §4 design: each event keeps a PUBLIC digest
 * (`objectHash`) committing to the private payload, while the payload itself
 * (payee, amount, cart, identity, raw prompt) is AES-256-GCM encrypted and
 * stored off-chain as an opaque blob. Only a `privateRef` pointer goes on the
 * event; the cleartext never touches `publicFields` or the on-chain anchor.
 *
 * Storage is behind a tiny `BlobStore` interface so the encrypted blob can live
 * in memory (tests), on the local filesystem / MinIO (durable demo), or in S3
 * (production) without changing the ingest path. The encryption key comes from
 * `EVIDENCE_ENCRYPTION_KEY` and is hardened to 32 bytes via SHA-256, so any key
 * string works.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson } from "@clb-acel/evidence-core";
import type { EvidenceEvent } from "@clb-acel/schemas";
import { keccak256, toBytes } from "viem";

const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;

/** Derive a 32-byte AES key from any key string (hex or passphrase). */
function deriveKey(keyString: string): Buffer {
  return createHash("sha256").update(keyString, "utf8").digest();
}

/**
 * AES-256-GCM encrypt to a lowercase-hex blob: `iv || authTag || ciphertext`.
 * Hex (not base64) guarantees the ciphertext can never contain an uppercase
 * plaintext substring, so the blob is verifiably opaque.
 */
export function encrypt(plaintext: string, keyString: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(keyString), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("hex");
}

/** Decrypt a blob produced by {@link encrypt}. Throws on a wrong key/tamper. */
export function decrypt(blob: string, keyString: string): string {
  const bytes = Buffer.from(blob, "hex");
  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = bytes.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(keyString), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// --- blob stores -----------------------------------------------------------

export type BlobStore = {
  put(blob: string): Promise<string>;
  get(ref: string): Promise<string>;
};

/** In-memory store (default; used by tests and the self-contained e2e). */
export function createInMemoryBlobStore(): BlobStore {
  const blobs = new Map<string, string>();
  return {
    async put(blob) {
      const ref = `mem://${keccak256(toBytes(blob)).slice(2)}`;
      blobs.set(ref, blob);
      return ref;
    },
    async get(ref) {
      const blob = blobs.get(ref);
      if (blob === undefined) {
        throw new Error(`Blob not found: ${ref}`);
      }
      return blob;
    },
  };
}

/** Filesystem store (durable local / MinIO-style demo). */
export function createFilesystemBlobStore(dir: string): BlobStore {
  return {
    async put(blob) {
      await mkdir(dir, { recursive: true });
      const name = `${keccak256(toBytes(blob)).slice(2)}.blob`;
      await writeFile(resolve(dir, name), blob, "utf8");
      return `file://${resolve(dir, name)}`;
    },
    async get(ref) {
      return readFile(ref.replace(/^file:\/\//, ""), "utf8");
    },
  };
}

/**
 * Pick a store from the environment: filesystem when `EVIDENCE_BLOB_DIR` is set,
 * otherwise in-memory. (A production S3/MinIO adapter implements the same
 * `BlobStore` interface using `S3_BUCKET` / `AWS_REGION` / `S3_ENDPOINT` and can
 * be slotted in here without touching the ingest path.)
 */
export function createBlobStoreFromEnv(): BlobStore {
  const dir = process.env.EVIDENCE_BLOB_DIR?.trim();
  return dir ? createFilesystemBlobStore(dir) : createInMemoryBlobStore();
}

let defaultStore: BlobStore | null = null;

export function getDefaultBlobStore(): BlobStore {
  if (!defaultStore) {
    defaultStore = createBlobStoreFromEnv();
  }
  return defaultStore;
}

export function setDefaultBlobStore(store: BlobStore): void {
  defaultStore = store;
}

/** Reset the default store (test isolation). */
export function resetDefaultBlobStore(): void {
  defaultStore = null;
}

// --- ingest ----------------------------------------------------------------

export type IngestInput = {
  traceId: string;
  publicFields: Record<string, unknown>;
  privatePayload: Record<string, unknown>;
  eventId?: string;
  protocol?: EvidenceEvent["protocol"];
  objectType?: string;
  actor?: string;
  timestamp?: string;
  signature?: `0x${string}`;
};

export type IngestOptions = {
  store?: BlobStore;
  key?: string;
};

function requireKey(key: string | undefined): string {
  const resolved = key ?? process.env.EVIDENCE_ENCRYPTION_KEY?.trim();
  if (!resolved) {
    throw new Error(
      "EVIDENCE_ENCRYPTION_KEY is not set. Add it to the repo root .env to use the encrypted-payload path.",
    );
  }
  return resolved;
}

/**
 * Prepare an evidence event with selective disclosure: encrypt the private
 * payload, store it as an off-chain blob, and return an `EvidenceEvent` carrying
 * only the public digest (`objectHash`), the public fields, and the `privateRef`
 * pointer. The returned event is safe to POST to `/events` — it contains no
 * cleartext private data.
 */
export async function ingest(
  input: IngestInput,
  options: IngestOptions = {},
): Promise<EvidenceEvent> {
  const key = requireKey(options.key);
  const store = options.store ?? getDefaultBlobStore();

  // Public digest commits to the canonical private payload without revealing it.
  const objectHash = keccak256(toBytes(canonicalJson(input.privatePayload)));
  const blob = encrypt(canonicalJson(input.privatePayload), key);
  const privateRef = await store.put(blob);

  return {
    traceId: input.traceId,
    eventId: input.eventId ?? `evt-${objectHash.slice(2, 14)}`,
    protocol: input.protocol ?? "X402",
    objectType: input.objectType ?? "X402_PAYMENT_PAYLOAD",
    actor: input.actor ?? "orchestrator",
    timestamp: input.timestamp ?? new Date().toISOString(),
    objectHash,
    publicFields: input.publicFields,
    privateRef,
    signature: input.signature ?? (`0x${"0".repeat(130)}` as `0x${string}`),
  };
}

/** Read an encrypted blob by its `privateRef` from the given (or default) store. */
export async function fetchBlob(ref: string, store: BlobStore = getDefaultBlobStore()): Promise<string> {
  return store.get(ref);
}
