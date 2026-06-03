"""CLI entry point so the merchant agent (or notebooks) can call the scorer.

Usage:
    risk-score --token XYZ --chain base-sepolia
    echo '{"token":"XYZ","chain":"base-sepolia"}' | risk-score
"""

from __future__ import annotations

import argparse
import json
import sys

from . import score_token


def main() -> int:
    parser = argparse.ArgumentParser(description="Deterministic token-risk scoring (CLB-ACEL).")
    parser.add_argument("--token")
    parser.add_argument("--chain", default="base-sepolia")
    args = parser.parse_args()

    if args.token is None and not sys.stdin.isatty():
        payload = json.loads(sys.stdin.read() or "{}")
        token = payload.get("token")
        chain = payload.get("chain", args.chain)
    else:
        token = args.token
        chain = args.chain

    if not token:
        parser.error("a token is required (via --token or JSON stdin)")

    print(json.dumps(score_token(token, chain).to_dict(), separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
