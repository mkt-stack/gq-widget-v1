import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useMemo } from "preact/hooks";
import {
  DATE_TOKEN,
  DELIVERY_METAFIELD_KEY,
  deliveryRequirements,
  estimateDeliveryRange,
  formatDeliveryRange,
  normalizeDeliveryConfig,
  pickDeliveryWindow,
  resolveDeliveryMessage,
  splitOnToken,
} from "@gq/widget-core";
import {
  selectedDeliveryOptions,
  toConditionLines,
  useConditionContext,
  useWidgetConfig,
  type CheckoutFactsApi,
} from "@gq/checkout-kit";

const api: CheckoutFactsApi = {
  query: (query, options) => shopify.query(query, options),
  getSessionToken: () => shopify.sessionToken.get(),
};

const PICKUP_TYPES = new Set(["pickup", "pickupPoint"]);

export default function extension() {
  render(<DeliveryEstimate />, document.body);
}

function DeliveryEstimate() {
  const config = useWidgetConfig(shopify.appMetafields.value, DELIVERY_METAFIELD_KEY, normalizeDeliveryConfig);
  const needs = useMemo(() => (config ? deliveryRequirements(config) : null), [config]);
  const selected = selectedDeliveryOptions(shopify.deliveryGroups.value);
  const ctx = useConditionContext(
    needs,
    {
      lines: toConditionLines(shopify.lines.value),
      subtotal: Number(shopify.cost.subtotalAmount.value.amount),
      shippingMethods: selected.map((o) => o.title),
    },
    config?.endpoint,
    api,
  );

  if (!config?.enabled) return null;
  // Store pickup has no delivery date.
  if (selected.length > 0 && selected.every((o) => PICKUP_TYPES.has(o.type))) return null;

  // undefined = a higher-ranked rule is still loading; null = nothing applies.
  const choice = pickDeliveryWindow(config, ctx);
  if (!choice) return null;

  const language = shopify.localization.language.value.isoCode;
  const dates = formatDeliveryRange(estimateDeliveryRange(choice.window, config.schedule), language);
  const { before, after, hasToken } = splitOnToken(resolveDeliveryMessage(config, choice.rule, language), DATE_TOKEN);
  const body = (
    <s-paragraph>
      {before}
      <s-text type="strong">{hasToken ? dates : ` ${dates}`}</s-text>
      {after}
    </s-paragraph>
  );

  if (config.appearance === "banner") return <s-banner tone="info">{body}</s-banner>;

  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-icon type="truck" size="small" />
      {body}
    </s-stack>
  );
}
