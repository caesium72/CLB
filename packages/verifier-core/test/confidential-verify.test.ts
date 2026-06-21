import { describe, expect, it } from "bun:test";
import { buildValidModeBBundle } from "@clb-acel/attack-core";
import { commitConfidential } from "@clb-acel/clb-core";
import { verifyTrace, type TraceBundle } from "../src/index";

/** A Mode B trace whose amount is bound by a confidential commitment + range proof. */
async function confidentialTrace(input: {
  valueAtomic: bigint;
  maxValueAtomic: bigint;
}): Promise<TraceBundle> {
  const { bundle } = await buildValidModeBBundle();
  const c = commitConfidential({
    valueAtomic: input.valueAtomic,
    maxValueAtomic: input.maxValueAtomic,
    payTo: bundle.settlement.payTo,
  });
  bundle.confidential = {
    valueCommitment: c.commitment,
    rangeProof: c.rangeProof,
    maxValueAtomic: input.maxValueAtomic.toString(),
  };
  return bundle;
}

describe("confidential verification path", () => {
  it("confidential verify passes the amount predicate via the range proof, not plaintext", async () => {
    const res = await verifyTrace(
      await confidentialTrace({ valueAtomic: 2_000000n, maxValueAtomic: 2_000000n }),
      { confidential: true },
    );
    expect(res.result.failedRules).not.toContain("R11_AMOUNT_WITHIN_MANDATE");
    expect(res.readPlaintextAmount).toBeUndefined(); // proof-only path
  });

  it("confidential verify FAILS R11 when the committed value exceeds maxValue", async () => {
    const res = await verifyTrace(
      await confidentialTrace({ valueAtomic: 9_000000n, maxValueAtomic: 2_000000n }),
      { confidential: true },
    );
    expect(res.result.failedRules).toContain("R11_AMOUNT_WITHIN_MANDATE");
  });

  it("standard plaintext path is unchanged and still reads the amount", async () => {
    const { bundle } = await buildValidModeBBundle();
    const res = await verifyTrace(bundle);
    expect(res.readPlaintextAmount).toBe(true);
    expect(res.result.status).toBe("PASS");
    expect(res.result.failedRules).not.toContain("R11_AMOUNT_WITHIN_MANDATE");
  });
});
