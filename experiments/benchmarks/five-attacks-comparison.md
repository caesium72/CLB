# Phase 7D — Five Attacks on x402: Honest Reproduction

We reference the local committed artifact at
`reference-papers/Five Attacks on x402/x402-attack-FDF1 (attack simulation)/`
(arXiv:2605.11781) and reproduce **only the defense** in our CLB-ACEL stack.
Their offense numbers come from their committed `attack2_real.json`
(experiment: "Attack II Replay — Real Chain", chain: "Hardhat local",
artifact timestamp: 2026-04-08T05:00:24.181Z); we do not re-run their Hardhat testbed.
The table below is an honest mapping — partial mitigations and out-of-scope items
are called out explicitly; we do not overclaim.

## Attack comparison

| Their attack | Our result | Mechanism |
| --- | --- | --- |
| I-A revert-grant / I-B settlement preemption | **Partially mitigated** | nonce = H(C) + R8/R9 pin a settlement to one commitment, so a granted resource cannot be re-bound to a different settlement; the optimistic-grant timing window itself is a web-/facilitator-layer issue we do not remove. |
| II replay / missing idempotency | **Eliminated** | single-use nonce derived from the commitment C; R9 consume-once. Their committed `attack2_real.json` (artifact timestamp: 2026-04-08T05:00:24.181Z) shows DGR = n without idempotency (n=1→DGR 1; n=5→DGR 5; n=10→DGR 10; n=50→DGR 50); our stack rejects the replayed settlement (facilitator `prevented = true` + verifier R9 fails), i.e. DGR collapses to 1. |
| III proxy/cache header manipulation | **Out of scope (cite their fix)** | a web-/HTTP-layer attack outside the payment-binding model; we cite the authors' own `Cache-Control: no-store, private` mitigation and do not claim to address it. |
| IV server-selection manipulation | **Mitigated when discovery is bound** | ERC-8004 identity binding (Phase 7B) plus decision-layer instrumentation (Phase 7D Task 6) makes the merchant choice auditable against the human's allowedPayees; we instrument the decision, we do not claim to enforce agent "competence". |

The paper's "five" attacks are I-A, I-B, II, III, and IV (Attack I has two settlement-path variants); all are mapped above.

## Attack II reproduction

The live reproduction asserts two properties:

1. **Facilitator prevented = true** — the local x402 facilitator rejected the
   second settlement attempt on the same nonce with `NonceAlreadyConsumedError`.
2. **Verifier R9 fails** — `verifyTrace` returns
   `failedRules: ["R9_NONCE_CONSUMED_EXACTLY_ONCE"]` for the replayed bundle,
   because `bundle.nonceReplayAttempt === true`.

Both assertions passed. The vanilla x402 DGR series from their artifact
(n=1→DGR 1; n=5→DGR 5; n=10→DGR 10; n=50→DGR 50) collapses to DGR = 1 under our R9 consume-once enforcement.

## What we do NOT claim

- We do not eliminate the optimistic-grant timing window of Attack I (web-layer).
- We do not address Attack III (HTTP cache headers) — that is a web-server concern.
- For Attack IV, "mitigation when discovery is bound" means the decision is
  auditable; it does not enforce that the agent's merchant ranking is optimal.
