import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useMemo } from "preact/hooks";
import {
  POINTS_METAFIELD_KEY,
  POINTS_TOKEN,
  calculatePoints,
  formatPoints,
  normalizePointsConfig,
  pickPointsVariant,
  pointsBaseAmount,
  pointsRequirements,
  resolvePointsMessage,
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

export default function extension() {
  render(<PointsEarn />, document.body);
}

/**
 * "+ You will earn 236 points from this order". Recalculates live as the cart
 * changes. Not clickable: checkout extensions can't scroll the page, so the
 * non-member variant uses an up arrow to point at sign-in instead.
 */
function PointsEarn() {
  const config = useWidgetConfig(shopify.appMetafields.value, POINTS_METAFIELD_KEY, normalizePointsConfig);
  const needs = useMemo(() => (config ? pointsRequirements(config) : null), [config]);
  const subtotal = Number(shopify.cost.subtotalAmount.value.amount);
  const ctx = useConditionContext(
    needs,
    {
      lines: toConditionLines(shopify.lines.value),
      subtotal,
      shippingMethods: selectedDeliveryOptions(shopify.deliveryGroups.value).map((o) => o.title),
    },
    config?.endpoint,
    api,
  );

  if (!config?.enabled) return null;
  const variant = pickPointsVariant(config, ctx);
  if (!variant) return null;

  const shipping = shopify.cost.totalShippingAmount.value;
  const amount = pointsBaseAmount(config.base, {
    subtotal,
    total: Number(shopify.cost.totalAmount.value.amount),
    shipping: shipping ? Number(shipping.amount) : undefined,
  });
  const points = calculatePoints(amount, variant);
  if (points <= 0) return null;

  const message = resolvePointsMessage(variant, shopify.localization.language.value.isoCode);
  const { before, after, hasToken } = splitOnToken(message, POINTS_TOKEN);
  const value = formatPoints(points);

  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-icon type={variant.icon} tone={variant.tone} size="small" />
      <s-paragraph tone={variant.tone}>
        {before}
        <s-text type="strong">{hasToken ? value : ` ${value}`}</s-text>
        {after}
      </s-paragraph>
    </s-stack>
  );
}
