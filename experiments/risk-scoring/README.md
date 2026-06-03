# clb-acel-risk-scoring (uv)

Deterministic heuristic token-risk scoring, a faithful Python mirror of
`scoreToken` in `packages/delivery-core`. Used for evaluation notebooks (Colab)
and as an optional out-of-process scorer for the merchant agent. The verifier
stays TypeScript and deterministic; Python is for scoring/evaluation only.

## Setup

```bash
cd experiments/risk-scoring
uv sync
```

## Run

```bash
uv run risk-score --token XYZ --chain base-sepolia
echo '{"token":"XYZ","chain":"base-sepolia"}' | uv run risk-score
```

## Test (cross-language parity with the TypeScript scorer)

```bash
uv run pytest
```

The test vectors are generated from `@clb-acel/delivery-core` so the Python and
TypeScript scorers are guaranteed to produce identical signals, risk scores, and
`inputDataHash` values.
