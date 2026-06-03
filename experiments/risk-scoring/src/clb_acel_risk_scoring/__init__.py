"""Deterministic heuristic token-risk scoring for CLB-ACEL.

This is a faithful Python mirror of ``scoreToken`` in
``packages/delivery-core`` (TypeScript). It produces byte-identical signals,
risk scores, and ``inputDataHash`` values so the same scoring can be used from
Colab notebooks and evaluation pipelines without diverging from the merchant
agent's on-line scorer.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from Crypto.Hash import keccak

RISK_MODEL_VERSION = "heuristic-v1"

_WEIGHTS = {
    "liquidityRisk": 0.25,
    "holderConcentrationRisk": 0.25,
    "contractRisk": 0.30,
    "marketVolatilityRisk": 0.15,
    "socialNarrativeRisk": 0.05,
}


def canonical_json(value: Any) -> str:
    """Match the TS ``canonicalJson``: sorted keys, no whitespace."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def keccak256_hex(data: str) -> str:
    digest = keccak.new(digest_bits=256)
    digest.update(data.encode("utf-8"))
    return "0x" + digest.hexdigest()


def _signal_from_byte(byte: int) -> float:
    return round((byte / 255) * 1000) / 1000


@dataclass(frozen=True)
class RiskScore:
    signals: dict[str, float]
    risk_score: float
    input_data_hash: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "signals": self.signals,
            "riskScore": self.risk_score,
            "inputDataHash": self.input_data_hash,
        }


def score_token(token: str, chain: str) -> RiskScore:
    seed_hex = keccak256_hex(canonical_json({"token": token, "chain": chain, "model": RISK_MODEL_VERSION}))
    seed_bytes = bytes.fromhex(seed_hex[2:])

    signals = {
        "liquidityRisk": _signal_from_byte(seed_bytes[0]),
        "holderConcentrationRisk": _signal_from_byte(seed_bytes[1]),
        "contractRisk": _signal_from_byte(seed_bytes[2]),
        "marketVolatilityRisk": _signal_from_byte(seed_bytes[3]),
        "socialNarrativeRisk": _signal_from_byte(seed_bytes[4]),
    }

    weighted = sum(signals[name] * weight for name, weight in _WEIGHTS.items())
    risk_score = round(weighted * 1000) / 1000
    input_data_hash = keccak256_hex(canonical_json({"token": token, "chain": chain, "signals": signals}))

    return RiskScore(signals=signals, risk_score=risk_score, input_data_hash=input_data_hash)


__all__ = ["RISK_MODEL_VERSION", "RiskScore", "canonical_json", "keccak256_hex", "score_token"]
