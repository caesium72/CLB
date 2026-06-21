import { describe, expect, it } from "bun:test";
import { createValidationRegistry } from "../src/validation-registry";

describe("validation-registry adapter", () => {
  it("mock round-trips a validation by traceId", async () => {
    const a = createValidationRegistry({}); // mock
    await a.record({
      traceId: "0xt",
      certificateHash: "0xc",
      result: true,
      merkleRoot: "0xr",
      settlementTxHash: "0xtx",
    });
    expect((await a.get("0xt"))?.result).toBe(true);
  });

  it("mock returns null for an unknown traceId", async () => {
    const a = createValidationRegistry({});
    expect(await a.get("0xmissing")).toBeNull();
  });

  it("defaults to mock when no validator address is configured", () => {
    expect(createValidationRegistry({}).kind).toBe("mock");
  });

  it("selects onchain when a validator address + RPC are set", () => {
    const a = createValidationRegistry({
      rpcUrl: "https://example.test",
      validatorAddr: "0x000000000000000000000000000000000000dEaD",
    });
    expect(a.kind).toBe("onchain");
  });

  it("canonical mode is gated off until O1 is resolved", () => {
    expect(() =>
      createValidationRegistry({
        mode: "canonical",
        rpcUrl: "https://x",
        validationRegistryAddr: "0x000000000000000000000000000000000000abcd",
      }),
    ).toThrow(/gated|O1|not confirmed/i);
  });

  it("canonical mode is reachable once explicitly confirmed (factory does not throw)", () => {
    const a = createValidationRegistry({
      mode: "canonical",
      rpcUrl: "https://x",
      validationRegistryAddr: "0x000000000000000000000000000000000000abcd",
      canonicalValidationConfirmed: true,
    });
    expect(a.kind).toBe("canonical");
  });
});
