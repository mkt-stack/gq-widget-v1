import { useEffect, useMemo, useState } from "preact/hooks";
import {
  CUSTOMER_FACTS_PATH,
  type ConditionContext,
  type ConditionLine,
  type ConditionRequirements,
  type CustomerFacts,
  type ProductFacts,
} from "@gq/widget-core";

/**
 * The checkout APIs these hooks need. Extensions pass a module-level object
 * that forwards to their `shopify` global, which keeps this package free of
 * per-target global typings:
 *
 *   const api: CheckoutFactsApi = {
 *     query: (q, o) => shopify.query(q, o),
 *     getSessionToken: () => shopify.sessionToken.get(),
 *     customerId: () => shopify.buyerIdentity?.customer.value?.id,
 *   };
 */
export interface CheckoutFactsApi {
  query(query: string, options: { variables: Record<string, unknown> }): Promise<unknown>;
  getSessionToken(): Promise<string>;
  /**
   * The logged-in customer's GID, read from a checkout signal so the hook
   * re-renders and re-fetches customer facts when the buyer signs in or out.
   * `undefined` for guests, and always `undefined` without protected customer
   * data access (then facts are fetched once per checkout load).
   */
  customerId?(): string | undefined;
}

interface AppMetafieldEntryLike {
  target: { type: string };
  metafield: { key: string; value: unknown };
}

/** Parse + normalize a widget config from `shopify.appMetafields.value`. `null` = not configured. */
export function useWidgetConfig<T>(
  entries: readonly AppMetafieldEntryLike[],
  key: string,
  normalize: (raw: unknown) => T,
): T | null {
  const raw = entries.find((e) => e.target.type === "shop" && e.metafield.key === key)?.metafield.value;
  return useMemo(() => {
    if (typeof raw !== "string") return null;
    try {
      return normalize(JSON.parse(raw));
    } catch {
      return null;
    }
  }, [raw, normalize]);
}

interface CartLineLike {
  quantity: number;
  merchandise: { id: string; product: { id: string } };
}

export function toConditionLines(lines: readonly CartLineLike[]): ConditionLine[] {
  return lines.map((l) => ({ productId: l.merchandise.product.id, variantId: l.merchandise.id, quantity: l.quantity }));
}

interface DeliveryGroupLike {
  selectedDeliveryOption?: { handle: string };
  deliveryOptions: ReadonlyArray<{ handle: string; title?: string; type: string }>;
}

/** Titles and types of the delivery options the buyer has selected, across all delivery groups. */
export function selectedDeliveryOptions(groups: readonly DeliveryGroupLike[]): Array<{ title: string; type: string }> {
  return groups.flatMap((g) => {
    const option = g.deliveryOptions.find((o) => o.handle === g.selectedDeliveryOption?.handle);
    return option ? [{ title: option.title ?? "", type: option.type }] : [];
  });
}

/**
 * Builds the condition context, fetching the expensive facts only when
 * `needs` asks for them: product tags/collections via the Storefront API
 * (per distinct product set) and customer tags/segments via the app backend
 * (again whenever the signed-in customer changes).
 * Missing facts stay `undefined` until loaded, so rules can short-circuit.
 */
export function useConditionContext(
  needs: ConditionRequirements | null,
  base: Omit<ConditionContext, "products" | "customer">,
  endpoint: string | undefined,
  api: CheckoutFactsApi,
): ConditionContext {
  const productKey = [...new Set(base.lines.map((l) => l.productId))].sort().join(",");
  const tagKey = needs?.customerTags.join(",") ?? "";
  const segmentKey = needs?.customerSegments.join(",") ?? "";
  const customerKey = readCustomerId(api);
  const wantsProducts = Boolean(needs?.productFacts);
  const wantsCustomer = Boolean(needs?.customer);

  const [products, setProducts] = useState<Record<string, ProductFacts>>();
  const [customer, setCustomer] = useState<CustomerFacts>();

  useEffect(() => {
    if (!wantsProducts || !productKey) return;
    let cancelled = false;
    fetchProductFacts(api, productKey.split(",")).then((facts) => {
      if (!cancelled) setProducts(facts);
    });
    return () => {
      cancelled = true;
    };
  }, [api, wantsProducts, productKey]);

  useEffect(() => {
    if (!wantsCustomer) return;
    let cancelled = false;
    // Drop stale facts so a variant for the previous identity never lingers.
    setCustomer(undefined);
    fetchCustomerFacts(api, endpoint, tagKey ? tagKey.split(",") : [], segmentKey ? segmentKey.split(",") : []).then(
      (facts) => {
        if (!cancelled) setCustomer(facts);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, wantsCustomer, tagKey, segmentKey, endpoint, customerKey]);

  return { ...base, products, customer };
}

/** Never throws: the buyerIdentity API is absent without protected customer data access. */
function readCustomerId(api: CheckoutFactsApi): string {
  try {
    return api.customerId?.() ?? "";
  } catch {
    return "";
  }
}

const PRODUCT_FACTS_QUERY = `query ProductFacts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product { id tags collections(first: 100) { nodes { id } } }
  }
}`;

type ProductFactsResponse = {
  data?: {
    nodes: Array<{ id: string; tags: string[]; collections: { nodes: { id: string }[] } } | null>;
  };
};

async function fetchProductFacts(api: CheckoutFactsApi, ids: string[]): Promise<Record<string, ProductFacts>> {
  const facts: Record<string, ProductFacts> = {};
  try {
    const { data } = (await api.query(PRODUCT_FACTS_QUERY, { variables: { ids } })) as ProductFactsResponse;
    for (const node of data?.nodes ?? []) {
      if (!node) continue;
      facts[node.id] = { tags: node.tags, collectionIds: node.collections.nodes.map((c) => c.id) };
    }
  } catch {
    // Unknown products simply don't match tag/collection rules.
  }
  return facts;
}

/**
 * Customer tags and segments aren't exposed to checkout, so the app backend
 * looks them up using the customer GID from the verified session token. Only
 * the tags and segments the rules ask about come back. On failure we treat the buyer as a guest with no
 * tags, so "includes any" rules fail and "includes none" rules pass.
 */
async function fetchCustomerFacts(
  api: CheckoutFactsApi,
  endpoint: string | undefined,
  tags: string[],
  segments: string[],
): Promise<CustomerFacts> {
  const fallback: CustomerFacts = { loggedIn: false, tags: [], segments: [] };
  if (!endpoint) return fallback;
  try {
    const token = await api.getSessionToken();
    const res = await fetch(`${endpoint}${CUSTOMER_FACTS_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tags, segments }),
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as Partial<CustomerFacts>;
    return {
      loggedIn: body.loggedIn === true,
      tags: Array.isArray(body.tags) ? body.tags : [],
      segments: Array.isArray(body.segments) ? body.segments : [],
    };
  } catch {
    return fallback;
  }
}
