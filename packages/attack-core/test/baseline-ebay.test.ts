import { describe, expect, it } from "bun:test";
import { bEbayMonitor } from "../src/baselines/ebay-monitor";
import { buildValidBundle, markReplayAttempt } from "../src/index";
import { verifyTrace } from "@clb-acel/verifier-core";

describe("bEbayMonitor", () => {
  it("catches MANDATE_REPLAY via consume-once", async () => {
    const base = await buildValidBundle();
    const replayed = (await markReplayAttempt(base)).bundle; // nonceReplayAttempt = true
    expect(bEbayMonitor(replayed).accepted).toBe(false);
  });

  it("misses CHAIN_TRANSPLANT (no chain-domain binding) but CLB-ACEL catches it (R10)", async () => {
    const base = await buildValidBundle();
    const transplanted = { ...base, settlement: { ...base.settlement, chainId: 1 } };
    expect(bEbayMonitor(transplanted).accepted).toBe(true);            // no chain-domain check -> missed
    expect((await verifyTrace(transplanted)).result.status).toBe("FAIL"); // CLB catches it (R10)
  });

  it("accepts a fully valid bundle", async () => {
    expect(bEbayMonitor(await buildValidBundle()).accepted).toBe(true);
  });
});
