# Reviewer #3, Comment 4 — Formal security verification

**Comment:** "Lack of formal security verification."

**Finding:** the verification already exists. The manuscript's claim that it is future work is stale. Status: **RESOLVED** (evidence inventoried and verified; manuscript claim corrected).

## Evidence inventory

| Artifact | Path | Result |
|---|---|---|
| Main Tamarin model | `formal/tamarin/clb.spthy` | 5 security lemmas + 2 `exists-trace` sanity lemmas |
| Main proof | `formal/tamarin/proofs/clb.proof` | Tamarin 1.12.0; 82 `qed` closures; P1–P5 `all-traces` proved; 2 traces found for the honesty lemmas |
| Mode A ablation | `formal/tamarin/clb-naive.spthy` + `clb-naive.proof` + attack graph | P4 counterexample found (`SOLVED // trace found`) |
| Mode B ablation | `formal/tamarin/clb-naive-modeb.spthy` + `clb-naive-modeb.proof` + attack graph | P5 counterexample found (`SOLVED // trace found`) |
| Attack figures | `proofs/clb-naive-P4-attack.{pdf,svg,png,@300dpi.png}`, `proofs/clb-naive-modeb-P5-attack.{pdf,svg,png,@300dpi.png}` | vector + raster versions ready |
| ProVerif cross-check | `formal/proverif/clb-offchain.pv` + `clb-offchain.result.txt` | non-injective correspondence true; injective correspondence false (expected) |

## Verified properties

| Lemma | Property | Outcome |
|---|---|---|
| P1 | Identity binding | proved (`all-traces`, closes with `qed`) |
| P2 | Authorization integrity | proved (`all-traces`, closes with `qed`) |
| P3 | Freshness / no replay | proved (`all-traces`) |
| P4 | Non-transferability | proved; falsified in the naive model without cross-layer binding |
| P5 | Predicate soundness | proved; falsified in the naive model without the on-chain guard |
| `exec_modeA`, `exec_modeB` | honest traces exist | trace found — prevents vacuous success |

## ProVerif nuance (do not overstate)

`clb-offchain.result.txt` reports:

```
Query event(Settled(p)) ==> event(Authorized(p)) is true.
Query inj-event(Settled(p)) ==> inj-event(Authorized(p)) is false.
```

The injective failure is **expected and documented in the model itself** (`clb-offchain.pv` lines 15–16: off-chain messages alone do not prevent replay). That is precisely why nonce consumption is enforced on-chain. Any manuscript text must state both results, not just the true one.

## Scope limits (must be stated)

- Dolev–Yao attacker with **perfect symbolic cryptography**; not computational hardness.
- Proofs cover the **abstract protocol logic**, not line-by-line TypeScript/Solidity. Code-level agreement is covered separately by the TS↔Solidity `C'` parity tests and the deterministic verifier.
- Tamarin/ProVerif binaries are **not installed** in this environment. The `.proof`/`.result.txt` files are the record of a prior completed run (Tamarin 1.12.0, Maude 3.5.1). Re-running requires the install steps in `formal/tamarin/README.md` (macOS: brew/opam; Windows: WSL or Docker). This is a reproducibility caveat, not missing verification.

## Manuscript corrections applied

- Theory/Practical Analysis: added a paragraph stating P1–P5, the ablation counterexamples, and the ProVerif nuance.
- Discussion: removed "formal protocol verification ... remain necessary".
- Conclusion: removed "Future work should machine-check the security properties with tools such as Tamarin".

Paste-ready source: `manuscript-fix.tex` in this directory.
