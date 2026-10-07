/**
 * Display-condition engine shared by every widget.
 *
 * Rules are evaluated against a `ConditionContext` that the host (checkout or
 * customer-account extension) assembles. Some facts are cheap and always
 * available (cart lines, subtotal); others cost a request (product tags and
 * collections via the Storefront API, customer tags via the app backend). Use
 * `conditionRequirements()` to find out which expensive facts a rule set needs
 * before fetching them.
 */

export type ConditionType =
  | "product"
  | "product_tag"
  | "collection"
  | "subtotal"
  | "item_count"
  | "customer_tag"
  | "customer_status";

export type ConditionOperator =
  /** List rules: at least one value matches. */
  | "any"
  /** List rules: no value matches. */
  | "none"
  /** Numeric rules. */
  | "gte"
  | "lte"
  /** customer_status. */
  | "logged_in"
  | "guest";

export interface Condition {
  id: string;
  type: ConditionType;
  operator: ConditionOperator;
  /** Product/collection GIDs, or tag strings, depending on `type`. */
  values: string[];
  /** Threshold for `subtotal` (shop currency) and `item_count`. */
  number?: number;
  /** Admin-only display labels for GIDs (e.g. product titles). Ignored at runtime. */
  labels?: Record<string, string>;
}

export interface DisplayRules {
  /** `all` = every condition must pass, `any` = one is enough. Empty list always shows. */
  match: "all" | "any";
  conditions: Condition[];
}

export interface ConditionLine {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface ProductFacts {
  tags: string[];
  collectionIds: string[];
}

export interface CustomerFacts {
  loggedIn: boolean;
  /** Only the tags that were asked about and that the customer has. */
  tags: string[];
}

export interface ConditionContext {
  lines: ConditionLine[];
  subtotal: number;
  /** Keyed by product GID. Omit until loaded. */
  products?: Record<string, ProductFacts>;
  /** Omit until loaded. */
  customer?: CustomerFacts;
}

export interface ConditionRequirements {
  productFacts: boolean;
  customer: boolean;
  /** Customer tags to ask the backend about (lower-cased, de-duplicated). */
  customerTags: string[];
}

export const CONDITION_TYPES: Record<
  ConditionType,
  { label: string; operators: ConditionOperator[] }
> = {
  product: { label: "Cart contains product", operators: ["any", "none"] },
  product_tag: { label: "Cart contains product tag", operators: ["any", "none"] },
  collection: { label: "Cart contains product from collection", operators: ["any", "none"] },
  subtotal: { label: "Cart subtotal", operators: ["gte", "lte"] },
  item_count: { label: "Cart item quantity", operators: ["gte", "lte"] },
  customer_tag: { label: "Customer tag", operators: ["any", "none"] },
  customer_status: { label: "Customer status", operators: ["logged_in", "guest"] },
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  any: "includes any of",
  none: "includes none of",
  gte: "is at least",
  lte: "is at most",
  logged_in: "is logged in",
  guest: "is a guest",
};

const norm = (s: string) => s.trim().toLowerCase();

export function conditionRequirements(rules: DisplayRules): ConditionRequirements {
  const tags = new Set<string>();
  let productFacts = false;
  let customer = false;
  for (const c of rules.conditions) {
    if (c.type === "product_tag" || c.type === "collection") productFacts = true;
    if (c.type === "customer_tag" || c.type === "customer_status") customer = true;
    if (c.type === "customer_tag") c.values.forEach((v) => tags.add(norm(v)));
  }
  return { productFacts, customer, customerTags: [...tags] };
}

/** `undefined` means "not decidable yet" (facts still loading). */
function evaluateOne(c: Condition, ctx: ConditionContext): boolean | undefined {
  const listMatch = (hit: boolean) => (c.operator === "none" ? !hit : hit);
  const numMatch = (n: number) =>
    c.operator === "lte" ? n <= (c.number ?? 0) : n >= (c.number ?? 0);

  switch (c.type) {
    case "product": {
      const wanted = new Set(c.values);
      return listMatch(ctx.lines.some((l) => wanted.has(l.productId)));
    }
    case "product_tag": {
      if (!ctx.products) return undefined;
      const wanted = new Set(c.values.map(norm));
      return listMatch(
        ctx.lines.some((l) =>
          ctx.products![l.productId]?.tags.some((t) => wanted.has(norm(t))),
        ),
      );
    }
    case "collection": {
      if (!ctx.products) return undefined;
      const wanted = new Set(c.values);
      return listMatch(
        ctx.lines.some((l) =>
          ctx.products![l.productId]?.collectionIds.some((id) => wanted.has(id)),
        ),
      );
    }
    case "subtotal":
      return numMatch(ctx.subtotal);
    case "item_count":
      return numMatch(ctx.lines.reduce((sum, l) => sum + l.quantity, 0));
    case "customer_tag": {
      if (!ctx.customer) return undefined;
      const have = new Set(ctx.customer.tags.map(norm));
      return listMatch(c.values.some((v) => have.has(norm(v))));
    }
    case "customer_status":
      if (!ctx.customer) return undefined;
      return c.operator === "guest" ? !ctx.customer.loggedIn : ctx.customer.loggedIn;
  }
}

/**
 * Returns `true` / `false`, or `undefined` while required facts are missing and
 * the outcome can't be decided yet (short-circuits when it already can).
 */
export function evaluateRules(
  rules: DisplayRules,
  ctx: ConditionContext,
): boolean | undefined {
  if (rules.conditions.length === 0) return true;
  let pending = false;
  for (const c of rules.conditions) {
    const r = evaluateOne(c, ctx);
    if (r === undefined) pending = true;
    else if (rules.match === "any" && r) return true;
    else if (rules.match === "all" && !r) return false;
  }
  if (pending) return undefined;
  return rules.match === "all";
}
