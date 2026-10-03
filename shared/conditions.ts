/**
 * Deterministic guardrail engine (TS port of scripts/eval_guardrails.py).
 * Guardrail.condition is a VIOLATION predicate over CaseFacts: true = saving now breaks the guardrail.
 */
import type { CaseFacts, Condition, Guardrail, WorkMap } from "./schema";

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(p in (cur as object))) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function evaluate(c: Condition, facts: CaseFacts | Record<string, unknown>): boolean {
  switch (c.op) {
    case "and":
      return c.all.every((x) => evaluate(x, facts));
    case "or":
      return c.all.some((x) => evaluate(x, facts));
    case "not":
      return !evaluate(c.c, facts);
  }
  const v = getPath(facts, c.field);
  const want = c.value;
  if (c.op === "missing") return v === undefined || v === null || v === "";
  if (v === undefined || v === null) return false;
  switch (c.op) {
    case "eq":
      return v === want;
    case "neq":
      return v !== want;
    case "gt":
      return (v as number) > (want as number);
    case "gte":
      return (v as number) >= (want as number);
    case "lt":
      return (v as number) < (want as number);
    case "lte":
      return (v as number) <= (want as number);
    case "in":
      return Array.isArray(want) && want.includes(v);
    case "contains":
      return typeof v === "string" ? v.includes(String(want)) : Array.isArray(v) && v.includes(want);
  }
}

/** Guardrails the given facts would violate, most severe first. */
export function violations(map: Pick<WorkMap, "guardrails">, facts: CaseFacts): Guardrail[] {
  const rank = { block: 0, warn: 1, info: 2 } as const;
  return map.guardrails
    .filter((g) => g.condition && evaluate(g.condition, facts))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Human-readable condition, for UIs and agent prompts. */
export function describe(c: Condition): string {
  switch (c.op) {
    case "and":
      return c.all.map(describe).join(" AND ");
    case "or":
      return "(" + c.all.map(describe).join(" OR ") + ")";
    case "not":
      return `NOT (${describe(c.c)})`;
    case "missing":
      return `${c.field} is missing`;
    default:
      return `${c.field} ${c.op} ${JSON.stringify(c.value)}`;
  }
}
