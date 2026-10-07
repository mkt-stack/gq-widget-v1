import {
  CONDITION_TYPES,
  type Condition,
  type ConditionType,
  type DisplayRules,
} from "./conditions";

export const MAX_CONDITIONS = 20;
const MAX_VALUES = 100;

function normalizeCondition(raw: unknown, index: number): Condition | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<Condition>;
  const type = c.type as ConditionType;
  const spec = CONDITION_TYPES[type];
  if (!spec) return null;
  const operator = spec.operators.includes(c.operator!) ? c.operator! : spec.operators[0];
  const values = Array.isArray(c.values)
    ? [...new Set(c.values.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()))].slice(0, MAX_VALUES)
    : [];
  const number = typeof c.number === "number" && Number.isFinite(c.number) ? Math.max(0, c.number) : 0;
  const labels =
    c.labels && typeof c.labels === "object"
      ? Object.fromEntries(Object.entries(c.labels).filter(([k]) => values.includes(k)))
      : undefined;

  return {
    id: typeof c.id === "string" && c.id ? c.id : `c${index}`,
    type,
    operator,
    values,
    ...(type === "subtotal" || type === "item_count" ? { number } : {}),
    ...(labels && Object.keys(labels).length ? { labels } : {}),
  };
}

/**
 * Drop malformed rules. List rules with no values are dropped too: an empty
 * "includes any of" would otherwise silently hide the widget.
 */
export function normalizeRules(raw: unknown): DisplayRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<DisplayRules>;
  const conditions = (Array.isArray(r.conditions) ? r.conditions : [])
    .map(normalizeCondition)
    .filter((c): c is Condition => {
      if (!c) return false;
      const needsValues = CONDITION_TYPES[c.type].operators.includes("any");
      return !needsValues || c.values.length > 0;
    })
    .slice(0, MAX_CONDITIONS);
  return { match: r.match === "any" ? "any" : "all", conditions };
}
