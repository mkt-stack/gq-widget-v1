import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  COUNTDOWN_METAFIELD_KEY,
  CUSTOMER_FACTS_PATH,
  conditionRequirements,
  evaluateRules,
  formatRemaining,
  normalizeCountdownConfig,
  resolveCountdownMessages,
  splitOnTime,
  type CountdownConfig,
  type CustomerFacts,
  type ProductFacts,
} from "@gq/widget-core";

const START_KEY = "countdown:startedAt";

export default function extension() {
  render(<Countdown />, document.body);
}

function Countdown() {
  const config = useConfig();
  const visible = useDisplayRules(config);
  const remaining = useRemainingSeconds(config, visible === true);

  if (!config?.enabled || visible !== true || remaining === null) return null;

  const expired = remaining <= 0;
  if (expired && config.onExpire === "hide") return null;

  const copy = resolveCountdownMessages(config, shopify.localization.language.value.isoCode);
  const warning = !expired && remaining <= config.warningThresholdSeconds;
  const message = expired ? copy.expiredMessage : warning ? copy.warningMessage : copy.message;
  const { before, after, hasTime } = splitOnTime(message);
  const clock = expired ? "" : formatRemaining(remaining);

  const body = (
    <s-paragraph>
      {before}
      {clock ? <s-text type="strong">{hasTime ? clock : ` ${clock}`}</s-text> : null}
      {after}
    </s-paragraph>
  );

  if (config.appearance === "banner") {
    return <s-banner tone={expired || warning ? "critical" : "info"}>{body}</s-banner>;
  }

  return (
    <s-box
      padding="small-200 base"
      border="base"
      borderRadius="base"
      background={expired || warning ? "subdued" : "transparent"}
    >
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-icon type={expired || warning ? "alert-triangle" : "clock"} size="small" />
        {body}
      </s-stack>
    </s-box>
  );
}

/** Config lives in an app-owned shop metafield that the admin writes. */
function useConfig(): CountdownConfig | null {
  const entry = shopify.appMetafields.value.find(
    (e) => e.target.type === "shop" && e.metafield.key === COUNTDOWN_METAFIELD_KEY,
  );
  const raw = entry?.metafield.value;
  return useMemo(() => {
    if (typeof raw !== "string") return null;
    try {
      return normalizeCountdownConfig(JSON.parse(raw));
    } catch {
      return null;
    }
  }, [raw]);
}

/**
 * true/false once decided, undefined while facts are loading. Cart facts are
 * live; product facts are fetched per distinct product set; customer facts once.
 */
function useDisplayRules(config: CountdownConfig | null): boolean | undefined {
  const lines = shopify.lines.value;
  const subtotal = Number(shopify.cost.subtotalAmount.value.amount);
  const needs = useMemo(
    () => (config ? conditionRequirements(config.rules) : null),
    [config],
  );

  const ctxLines = lines.map((l) => ({
    productId: l.merchandise.product.id,
    variantId: l.merchandise.id,
    quantity: l.quantity,
  }));
  const productKey = [...new Set(ctxLines.map((l) => l.productId))].sort().join(",");

  const [products, setProducts] = useState<Record<string, ProductFacts>>();
  const [customer, setCustomer] = useState<CustomerFacts>();

  useEffect(() => {
    if (!needs?.productFacts || !productKey) return;
    let cancelled = false;
    fetchProductFacts(productKey.split(",")).then((facts) => {
      if (!cancelled) setProducts(facts);
    });
    return () => {
      cancelled = true;
    };
  }, [needs?.productFacts, productKey]);

  const endpoint = config?.endpoint;
  useEffect(() => {
    if (!needs?.customer) return;
    let cancelled = false;
    fetchCustomerFacts(endpoint, needs.customerTags).then((facts) => {
      if (!cancelled) setCustomer(facts);
    });
    return () => {
      cancelled = true;
    };
  }, [needs, endpoint]);

  if (!config?.enabled) return false;
  return evaluateRules(config.rules, { lines: ctxLines, subtotal, products, customer });
}

/**
 * The clock starts the first time the widget becomes visible in this checkout.
 * shopify.storage is scoped to the checkout session, so a new checkout starts
 * a fresh countdown while reloads and step changes keep the same one.
 */
function useRemainingSeconds(config: CountdownConfig | null, active: boolean): number | null {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || startedAt !== null) return;
    let cancelled = false;
    (async () => {
      let stored: unknown = null;
      try {
        stored = await shopify.storage.read(START_KEY);
      } catch {
        // Storage isn't guaranteed; fall back to an in-memory start.
      }
      const start = typeof stored === "number" ? stored : Date.now();
      if (stored == null) shopify.storage.write(START_KEY, start).catch(() => {});
      if (!cancelled) setStartedAt(start);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, startedAt]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const remaining =
    config && startedAt !== null
      ? config.durationSeconds - Math.floor((now - startedAt) / 1000)
      : null;
  const shouldRestart = remaining !== null && remaining <= 0 && config?.onExpire === "restart";

  useEffect(() => {
    if (!shouldRestart) return;
    const restart = Date.now();
    shopify.storage.write(START_KEY, restart).catch(() => {});
    setStartedAt(restart);
    setNow(restart);
  }, [shouldRestart]);

  return shouldRestart && config ? config.durationSeconds : remaining;
}

const PRODUCT_FACTS_QUERY = `query ProductFacts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product { id tags collections(first: 100) { nodes { id } } }
  }
}`;

type ProductFactsResponse = {
  nodes: Array<{ id: string; tags: string[]; collections: { nodes: { id: string }[] } } | null>;
};

async function fetchProductFacts(ids: string[]): Promise<Record<string, ProductFacts>> {
  const facts: Record<string, ProductFacts> = {};
  try {
    const { data } = (await shopify.query(PRODUCT_FACTS_QUERY, {
      variables: { ids },
    })) as { data?: ProductFactsResponse };
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
 * Customer tags aren't exposed to checkout, so the app backend looks them up
 * using the customer GID from the verified session token. Only the tags the
 * rules ask about come back. On failure we treat the buyer as a guest with no
 * tags, so "includes any" rules hide the widget and "includes none" rules show it.
 */
async function fetchCustomerFacts(
  endpoint: string | undefined,
  tags: string[],
): Promise<CustomerFacts> {
  const fallback: CustomerFacts = { loggedIn: false, tags: [] };
  if (!endpoint) return fallback;
  try {
    const token = await shopify.sessionToken.get();
    const res = await fetch(`${endpoint}${CUSTOMER_FACTS_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as Partial<CustomerFacts>;
    return { loggedIn: body.loggedIn === true, tags: Array.isArray(body.tags) ? body.tags : [] };
  } catch {
    return fallback;
  }
}
