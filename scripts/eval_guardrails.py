#!/usr/bin/env python3
"""
Reference evaluator for Guardrail.condition (violation predicates over CaseFacts) + the Teach test cases.
Teach should port `evaluate` to TS and keep these cases green.

    python3 scripts/eval_guardrails.py [path/to/workmap.json]
"""
import json
import sys


def get(facts, path):
    cur = facts
    for p in path.split("."):
        if not isinstance(cur, dict) or p not in cur:
            return None
        cur = cur[p]
    return cur


def evaluate(c, facts):
    op = c["op"]
    if op == "and":
        return all(evaluate(x, facts) for x in c["all"])
    if op == "or":
        return any(evaluate(x, facts) for x in c["all"])
    if op == "not":
        return not evaluate(c["c"], facts)
    v, want = get(facts, c["field"]), c.get("value")
    if op == "missing":
        return v is None or v == ""
    if v is None:
        return False
    return {
        "eq": lambda: v == want, "neq": lambda: v != want, "gt": lambda: v > want, "gte": lambda: v >= want,
        "lt": lambda: v < want, "lte": lambda: v <= want, "in": lambda: v in want,
        "contains": lambda: want in v,
    }[op]()


def violations(workmap, facts):
    return sorted(g["id"] for g in workmap["guardrails"] if g.get("condition") and evaluate(g["condition"], facts))


def inv(**kw):
    base = dict(key="", amount=0, currency="EUR", date="2026-12-04", month=12, category="consumables", costCenter="4711",
                assetNo=None, status="open", approver=None, comment="", duplicateDeliveryNote=False)
    base.update(kw)
    return base


SUP = lambda name, group="External", new=False: {"name": name, "group": group, "isNew": new}

# (name, facts at the moment the new hire presses Save, expected violated guardrails)
CASES = [
    ("T1a new supplier, 7,200 EUR equipment, left on opex 4711",
     {"invoice": inv(key="4490", amount=7200, category="equipment"), "supplier": SUP("Gerätebau Schmidt KG", new=True)},
     ["gr_capex_threshold"]),
    ("T1b same, re-coded to 0400 but no asset number",
     {"invoice": inv(key="4490", amount=7200, category="equipment", costCenter="0400"), "supplier": SUP("Gerätebau Schmidt KG", new=True)},
     ["gr_asset_number"]),
    ("T1c same, 0400 + asset number",
     {"invoice": inv(key="4490", amount=7200, category="equipment", costCenter="0400", assetNo="AN-2026-131"), "supplier": SUP("Gerätebau Schmidt KG", new=True)},
     []),
    ("T2a Brno 9,800 EUR equipment, approved directly on opex",
     {"invoice": inv(key="4491", amount=9800, category="equipment", status="approved"), "supplier": SUP("Brno Precision s.r.o.", "Intercompany CZ")},
     ["gr_capex_threshold", "gr_intercompany_approval"]),
    ("T2b Brno, capex + asset + Weber as 2nd approver",
     {"invoice": inv(key="4491", amount=9800, category="equipment", costCenter="0400", assetNo="AN-2026-132", status="awaiting_approval",
                     approver="M. Weber (Controlling)"), "supplier": SUP("Brno Precision s.r.o.", "Intercompany CZ")},
     []),
    ("T3a Hofmann December duplicate, approved",
     {"invoice": inv(key="4492", amount=1240, status="approved", duplicateDeliveryNote=True), "supplier": SUP("Hofmann Industriebedarf")},
     ["gr_december_hold"]),
    ("T3b Hofmann December duplicate, on hold",
     {"invoice": inv(key="4492", amount=1240, status="on_hold", duplicateDeliveryNote=True), "supplier": SUP("Hofmann Industriebedarf")},
     []),
    ("T5a Brno 2,400 EUR spare parts, approved without a second approver (only the intercompany rule)",
     {"invoice": inv(key="4494", amount=2400, category="spare_parts", status="approved"), "supplier": SUP("Brno Precision s.r.o.", "Intercompany CZ")},
     ["gr_intercompany_approval"]),
    ("T5b Brno spare parts, sent to Weber as 2nd approver",
     {"invoice": inv(key="4494", amount=2400, category="spare_parts", status="awaiting_approval", approver="M. Weber (Controlling)"),
      "supplier": SUP("Brno Precision s.r.o.", "Intercompany CZ")},
     []),
    ("T4 Würth 312 EUR consumables, booked (no false positives)",
     {"invoice": inv(key="4493", amount=312.4, status="coded"), "supplier": SUP("Würth")},
     []),
]

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "fixtures/demo-session/expected_workmap.json"
    with open(path) as f:
        wm = json.load(f)
    failed = 0
    for name, facts, expected in CASES:
        got = violations(wm, facts)
        ok = got == sorted(expected)
        failed += not ok
        print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  expected {expected} got {got}"))
    sys.exit(1 if failed else 0)
