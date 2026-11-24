import { describe, expect, test } from "bun:test";
import { TEST_KEYS, buildValidModeBBundle } from "@clb-acel/attack-core";
import { commitConfidential } from "@clb-acel/clb-core";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTrace, type TraceBundle } from "../src/index";

/** G4 (Mode B domain chain) and GAP-2 (signed cap provenance) regressions. */

const HUMAN = privateKeyToAccount(TEST_KEYS.userKey).address;
const SIGNED_CAP_ATOMIC = 5_000000n; // defaultPredicate().maxValue = "5.00"

async function honestBundle(): Promise<TraceBundle> {
  return (await buildValidModeBBundle({ traceId: "trace-r10-security-fix" })).bundle;
}

function confidentialTrace(bundle: TraceBundle, valueAtomic: bigint, declaredCap: bigint): TraceBundle {
  const c = commitConfidential({
    valueAtomic,
    maxValueAtomic: declaredCap,
    payTo: bundle.settlement.payTo,
  });
  return {
    ...bundle,
    confidential: {
      valueCommitment: c.commitment,
      rangeProof: c.rangeProof,
      maxValueAtomic: declaredCap.toString(),
    },
  };
}

describe("G4: Mode B R10 binds the EIP-712 domain chain", () => {
  test("an honest Mode B trace passes R10", async () => {
    const result = await verifyTrace(await honestBundle(), {
      expectedHumanPrincipal: HUMAN,
    });
    expect(result.outcomes.R10_CHAIN_DOMAIN_MATCHES).toEqual({ ok: true });
    expect(result.result.failedRules).not.toContain("R10_CHAIN_DOMAIN_MATCHES");
  });

  test("transplanting bundle.clb.domain.chainId fails R10", async () => {
    const original = await honestBundle();
    const transplanted: TraceBundle = {
      ...original,
      clb: { ...original.clb, domain: { ...original.clb.domain, chainId: 8453 } },
    };
    const result = await verifyTrace(transplanted, { expectedHumanPrincipal: HUMAN });
    expect(result.outcomes.R10_CHAIN_DOMAIN_MATCHES.ok).toBe(false);
    expect(result.outcomes.R10_CHAIN_DOMAIN_MATCHES.detail).toContain("domain");
    expect(result.result.failedRules).toContain("R10_CHAIN_DOMAIN_MATCHES");
  });
});

describe("GAP-2: confidential R11 cap comes from the signed mandate", () => {
  test("a proof within the signed cap passes R11", async () => {
    const bundle = confidentialTrace(await honestBundle(), 2_000000n, 2_000000n);
    const result = await verifyTrace(bundle, { confidential: true, expectedHumanPrincipal: HUMAN });
    expect(result.outcomes.R11_AMOUNT_WITHIN_MANDATE).toEqual({ ok: true });
    expect(result.readPlaintextAmount).toBeUndefined();
  });

  test("a bundle-authored inflated cap cannot raise the signed cap", async () => {
    const bundle = confidentialTrace(await honestBundle(), 9_000000n, 90_000000n);
    // The predicate/mandate cap is 5.00 (= 5_000000 atomic units).
    expect(SIGNED_CAP_ATOMIC).toBe(5_000000n);
    const result = await verifyTrace(bundle, { confidential: true, expectedHumanPrincipal: HUMAN });
    expect(result.outcomes.R11_AMOUNT_WITHIN_MANDATE.ok).toBe(false);
    expect(result.result.failedRules).toContain("R11_AMOUNT_WITHIN_MANDATE");
  });

  test("a proof generated directly at the signed cap passes R11", async () => {
    const bundle = confidentialTrace(await honestBundle(), 4_000000n, SIGNED_CAP_ATOMIC);
    const result = await verifyTrace(bundle, { confidential: true, expectedHumanPrincipal: HUMAN });
    expect(result.outcomes.R11_AMOUNT_WITHIN_MANDATE).toEqual({ ok: true });
  });

  test("R11 fails closed when the signed cap is absent", async () => {
    const bundle = confidentialTrace(await honestBundle(), 2_000000n, 2_000000n);
    bundle.mandate = {
      ...bundle.mandate,
      constraints: { ...bundle.mandate.constraints, maxAmount: undefined },
    };
    const result = await verifyTrace(bundle, { confidential: true, expectedHumanPrincipal: HUMAN });
    expect(result.outcomes.R11_AMOUNT_WITHIN_MANDATE.ok).toBe(false);
    expect(result.outcomes.R11_AMOUNT_WITHIN_MANDATE.detail).toContain("human-signed");
  });
});
