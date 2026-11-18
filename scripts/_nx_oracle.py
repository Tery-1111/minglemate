"""NetworkX oracle for max-weight general-graph matching.

Reads JSON on stdin and writes JSON on stdout.

  {"cases": [{"nodes": n, "edges": [[u, v, w], ...], "maxcardinality": bool}, ...]}
  -> {"results": [{"pairs": [[u, v], ...], "weight": int, "cardinality": int}, ...]}

Used only by scripts/test-max-weight-matching.mjs as an independent reference.
"""
import json
import sys

import networkx as nx


def solve(case):
    n = case["nodes"]
    maxcardinality = case.get("maxcardinality", False)
    g = nx.Graph()
    g.add_nodes_from(range(n))
    for u, v, w in case.get("edges", []):
        g.add_edge(u, v, weight=w)
    matching = nx.max_weight_matching(g, maxcardinality=maxcardinality, weight="weight")
    pairs = sorted([min(a, b), max(a, b)] for a, b in matching)
    total = sum(g[a][b]["weight"] for a, b in matching)
    return {"pairs": pairs, "weight": int(total), "cardinality": len(pairs)}


def main() -> None:
    payload = json.load(sys.stdin)
    cases = payload.get("cases")
    if cases is None:
        cases = [payload]
    print(json.dumps({"results": [solve(c) for c in cases]}))


if __name__ == "__main__":
    main()
