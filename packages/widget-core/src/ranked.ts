import { conditionRequirements, evaluateRules } from "./conditions";
import type { ConditionContext, ConditionRequirements, DisplayRules } from "./conditions";
import { normalizeRules } from "./normalize";
import { clampText } from "./util";

/**
 * Several widgets hold a short, ranked list of variants (delivery rules,
 * countdown variants, callouts). Each has its own display conditions and the
 * first enabled variant whose conditions match wins.
 */
export interface RankedItem {
  id: string;
  /** Admin-only label. */
  name: string;
  enabled: boolean;
  conditions: DisplayRules;
}

export const MAX_RANKED_NAME_LENGTH = 60;

/**
 * First enabled matching item. `undefined` while a higher-ranked item is still
 * waiting on facts (so a lower one never flashes first); `null` if none match.
 */
export function pickRanked<T extends RankedItem>(items: T[], ctx: ConditionContext): T | null | undefined {
  for (const item of items) {
    if (!item.enabled) continue;
    const match = evaluateRules(item.conditions, ctx);
    if (match === undefined) return undefined;
    if (match) return item;
  }
  return null;
}

/** Everything any enabled item needs, so extensions fetch only that. */
export function rankedRequirements(items: RankedItem[]): ConditionRequirements {
  return conditionRequirements(...items.filter((i) => i.enabled).map((i) => i.conditions));
}

/** Index of the first enabled item with no conditions: everything ranked below it never applies. */
export function catchAllIndex(items: RankedItem[]): number {
  return items.findIndex((i) => i.enabled && i.conditions.conditions.length === 0);
}

/** Normalize the shared fields; `rest` normalizes the item-specific ones. */
export function normalizeRankedList<T extends RankedItem>(
  raw: unknown,
  max: number,
  label: string,
  rest: (raw: Record<string, unknown>, index: number) => Omit<T, keyof RankedItem>,
): T[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .slice(0, max)
    .map((r, index) => {
      const name = clampText(r.name, "", MAX_RANKED_NAME_LENGTH).trim();
      return {
        id: typeof r.id === "string" && r.id ? r.id : `${label.toLowerCase()}${index}`,
        name: name || `${label} ${index + 1}`,
        enabled: r.enabled !== false,
        conditions: normalizeRules(r.conditions),
        ...rest(r, index),
      } as T;
    });
}
