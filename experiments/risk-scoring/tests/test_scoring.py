"""Cross-language parity tests.

The expected vectors are produced by the TypeScript scorer in
`packages/delivery-core` (scoreToken). They guarantee the Python and TS
implementations stay byte-identical.
"""

from clb_acel_risk_scoring import RISK_MODEL_VERSION, score_token

XYZ_VECTOR = {
    "signals": {
        "liquidityRisk": 0.031,
        "holderConcentrationRisk": 0.482,
        "contractRisk": 0.592,
        "marketVolatilityRisk": 0.227,
        "socialNarrativeRisk": 0.388,
    },
    "riskScore": 0.359,
    "inputDataHash": "0x91130b15d98d334d0c0cfcc24887d1232bd297f39dfccb786e9fcd79fd64d39d",
}

PEPE_VECTOR = {
    "signals": {
        "liquidityRisk": 0.408,
        "holderConcentrationRisk": 0.624,
        "contractRisk": 0.169,
        "marketVolatilityRisk": 0.729,
        "socialNarrativeRisk": 0.992,
    },
    "riskScore": 0.468,
    "inputDataHash": "0xb7ca131f047d9cc9917b01af589e09fb87e902ebdd40b270786f814215511faf",
}


def test_model_version():
    assert RISK_MODEL_VERSION == "heuristic-v1"


def test_matches_typescript_vector_xyz():
    assert score_token("XYZ", "base-sepolia").to_dict() == XYZ_VECTOR


def test_matches_typescript_vector_pepe():
    assert score_token("PEPE", "base-sepolia").to_dict() == PEPE_VECTOR


def test_is_deterministic():
    assert score_token("ABC", "base-sepolia").to_dict() == score_token("ABC", "base-sepolia").to_dict()
