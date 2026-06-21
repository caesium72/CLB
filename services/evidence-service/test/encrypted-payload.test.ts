import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  decrypt,
  encrypt,
  fetchBlob,
  ingest,
  resetDefaultBlobStore,
} from "../src/encrypted-payload";

const KEY = "0x" + "a1".repeat(32); // 32-byte hex demo key

beforeAll(() => {
  process.env.EVIDENCE_ENCRYPTION_KEY = KEY;
  resetDefaultBlobStore();
});

afterAll(() => {
  resetDefaultBlobStore();
});

describe("encrypted-payload selective-disclosure path", () => {
  it("private payload is encrypted off-chain; only a public digest is on the event", async () => {
    const ev = await ingest({
      traceId: "0xt",
      publicFields: { network: "base-sepolia" },
      privatePayload: { payTo: "0xBEEF", amount: "2.00" },
    });

    expect(ev.privateRef).toBeTruthy(); // pointer to the encrypted blob
    expect(ev.objectHash).toBeTruthy(); // public digest
    expect(JSON.stringify(ev.publicFields)).not.toContain("BEEF"); // payee not public

    const blob = await fetchBlob(ev.privateRef!);
    expect(blob).not.toContain("BEEF"); // ciphertext is opaque
    expect(decrypt(blob, process.env.EVIDENCE_ENCRYPTION_KEY!)).toContain("BEEF"); // round-trips
  });

  it("the public digest binds the exact private payload", async () => {
    const payload = { payTo: "0xBEEF", amount: "2.00" };
    const a = await ingest({ traceId: "0xt2", publicFields: {}, privatePayload: payload });
    const b = await ingest({ traceId: "0xt3", publicFields: {}, privatePayload: payload });
    const c = await ingest({
      traceId: "0xt4",
      publicFields: {},
      privatePayload: { ...payload, amount: "9.99" },
    });
    expect(a.objectHash).toBe(b.objectHash); // same payload → same digest
    expect(a.objectHash).not.toBe(c.objectHash); // changed amount → different digest
  });

  it("blob is opaque without the correct key", async () => {
    const blob = encrypt(JSON.stringify({ secret: "0xBEEF" }), KEY);
    expect(() => decrypt(blob, "0x" + "ff".repeat(32))).toThrow();
    expect(decrypt(blob, KEY)).toContain("BEEF");
  });

  it("never writes private fields into publicFields", async () => {
    const ev = await ingest({
      traceId: "0xt5",
      publicFields: { network: "base-sepolia", verdict: "PASS" },
      privatePayload: { payTo: "0xBEEF", cart: ["secret-item"], amount: "2.00" },
    });
    const publicStr = JSON.stringify(ev.publicFields);
    expect(publicStr).not.toContain("secret-item");
    expect(publicStr).not.toContain("BEEF");
    expect(publicStr).toContain("base-sepolia"); // public fields preserved
  });
});
