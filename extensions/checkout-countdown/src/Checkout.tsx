import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  COUNTDOWN_METAFIELD_KEY,
  countdownRequirements,
  formatRemaining,
  normalizeCountdownConfig,
  pickCountdownVariant,
  resolveCountdownMessages,
  splitOnTime,
  type CountdownConfig,
  type CountdownVariant,
} from "@gq/widget-core";
import {
  selectedDeliveryOptions,
  toConditionLines,
  useConditionContext,
  useWidgetConfig,
  type CheckoutFactsApi,
} from "@gq/checkout-kit";

const START_KEY = "countdown:startedAt";

const api: CheckoutFactsApi = {
  query: (query, options) => shopify.query(query, options),
  getSessionToken: () => shopify.sessionToken.get(),
};

export default function extension() {
  render(<Countdown />, document.body);
}

function Countdown() {
  const config = useWidgetConfig(shopify.appMetafields.value, COUNTDOWN_METAFIELD_KEY, normalizeCountdownConfig);
  const variant = useVariant(config);
  const remaining = useRemainingSeconds(variant);

  if (!config?.enabled || !variant || remaining === null) return null;

  const expired = remaining <= 0;
  if (expired && variant.onExpire === "hide") return null;

  const copy = resolveCountdownMessages(variant, shopify.localization.language.value.isoCode);
  const warning = !expired && remaining <= variant.warningThresholdSeconds;
  const message = expired ? copy.expiredMessage : warning ? copy.warningMessage : copy.message;
  const { before, after, hasTime } = splitOnTime(message);
  const clock = expired ? "" : formatRemaining(remaining);

  // Each stage has its own style: by default green while running, warning
  // after the threshold, grey once expired.
  const style = config.styles[expired ? "expired" : warning ? "warning" : "running"];
  const grey = style === "neutral";
  const icon = warning ? "alert-triangle" : "clock";

  const body = (
    <s-paragraph tone={config.appearance === "compact" && !grey ? style : "auto"} color={grey ? "subdued" : "base"}>
      {before}
      {clock ? <s-text type="strong">{hasTime ? clock : ` ${clock}`}</s-text> : null}
      {after}
    </s-paragraph>
  );

  // Checkout banners have no grey tone, so "neutral" renders as a subdued box.
  if (config.appearance === "banner" && !grey) return <s-banner tone={style}>{body}</s-banner>;

  return (
    <s-box
      padding={config.appearance === "banner" ? "base" : "small-200 base"}
      border="base"
      borderRadius="base"
      background={grey ? "subdued" : "transparent"}
    >
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-icon type={icon} tone={grey ? "neutral" : style} size="small" />
        {body}
      </s-stack>
    </s-box>
  );
}

/**
 * The first ranked variant whose conditions match; null while undecided or
 * when none match. Cart and shipping facts are live; product and customer
 * facts are fetched on demand.
 */
function useVariant(config: CountdownConfig | null): CountdownVariant | null {
  const needs = useMemo(() => (config ? countdownRequirements(config) : null), [config]);
  const ctx = useConditionContext(
    needs,
    {
      lines: toConditionLines(shopify.lines.value),
      subtotal: Number(shopify.cost.subtotalAmount.value.amount),
      shippingMethods: selectedDeliveryOptions(shopify.deliveryGroups.value).map((o) => o.title),
    },
    config?.endpoint,
    api,
  );
  if (!config?.enabled) return null;
  return pickCountdownVariant(config, ctx) ?? null;
}

/**
 * The clock starts the first time the widget becomes visible in this checkout.
 * shopify.storage is scoped to the checkout session, so a new checkout starts
 * a fresh countdown while reloads and step changes keep the same one. The
 * start time is shared by all variants, so switching variant keeps the clock.
 */
function useRemainingSeconds(variant: CountdownVariant | null): number | null {
  const active = variant !== null;
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
    variant && startedAt !== null
      ? variant.durationSeconds - Math.floor((now - startedAt) / 1000)
      : null;
  const shouldRestart = remaining !== null && remaining <= 0 && variant?.onExpire === "restart";

  useEffect(() => {
    if (!shouldRestart) return;
    const restart = Date.now();
    shopify.storage.write(START_KEY, restart).catch(() => {});
    setStartedAt(restart);
    setNow(restart);
  }, [shouldRestart]);

  return shouldRestart && variant ? variant.durationSeconds : remaining;
}
