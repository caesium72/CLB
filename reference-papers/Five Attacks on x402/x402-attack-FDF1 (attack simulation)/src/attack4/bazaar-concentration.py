#!/usr/bin/env python3
import json
import os
import sys
from collections import Counter
from urllib.parse import urlparse


CATALOG_PATH = "results/attack4/cdp_bazaar_catalog_pretty.json"
SHOW_DOMAINS = os.getenv("SHOW_ATTACK4_DOMAINS") == "1"


def main() -> int:
    try:
        with open(CATALOG_PATH) as fh:
            bazaar = json.load(fh)
    except FileNotFoundError:
        print(f"error: {CATALOG_PATH} not found", file=sys.stderr)
        return 1

    records = bazaar.get("resources", [])
    total = len(records)

    domains = Counter()
    for r in records:
        url = r.get("resource") or ""
        try:
            host = urlparse(url).netloc or url
            if host:
                domains[host.lower()] += 1
        except Exception:
            pass

    unique_domains = len(domains)

    print(f"Catalog source     : {bazaar.get('source', 'unknown')}")
    print(f"Catalog fetched at : {bazaar.get('fetched_at', 'unknown')}")
    print(f"Total endpoints    : {total:,}")
    print(f"Unique domains     : {unique_domains:,}")
    print()

    print("Top 10 domains by endpoint count:")
    print(f"  {'Rank':>4}  {'Count':>6}  {'Pct':>6}  Domain (anonymized)")
    print(f"  {'----':>4}  {'-----':>6}  {'---':>6}  ------------------")
    letters = "ABCDEFGHIJKLMNOP"
    for i, (d, n) in enumerate(domains.most_common(10), 1):
        pct = 100 * n / total if total else 0.0
        anon = f"Domain-{letters[i - 1]}"
        suffix = f"  (actual: {d})" if SHOW_DOMAINS else ""
        print(f"  {i:>4}  {n:>6,}  {pct:>5.2f}%  {anon}{suffix}")
    print()

    top1 = domains.most_common(1)[0][1]
    top_k = {k: sum(n for _, n in domains.most_common(k)) for k in (3, 5, 9, 10)}

    print("Concentration:")
    print(f"  single largest domain : {top1:>6,}  ({100 * top1 / total:5.2f}%)")
    for k, tot in top_k.items():
        print(f"  top {k} domains{' ' * (6 - len(str(k)))}    : {tot:>6,}  ({100 * tot / total:5.2f}%)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
