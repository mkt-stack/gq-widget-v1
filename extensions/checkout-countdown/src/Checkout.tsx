import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  COUNTDOWN_METAFIELD_KEY,
  conditionRequirements,
  evaluateRules,
  formatRemaining,
  normalizeCountdownConfig,
  resolveCountdownMessages,
  splitOnTime,
  type CountdownConfig,
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

/**
 * true/false once decided, undefined while facts are loading. Cart and
 * shipping facts are live; product and customer facts are fetched on demand.
 */
function useDisplayRules(config: CountdownConfig | null): boolean | undefined {
  const needs = useMemo(() => (config ? conditionRequirements(config.rules) : null), [config]);
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
  if (!config?.enabled) return false;
  return evaluateRules(config.rules, ctx);
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
