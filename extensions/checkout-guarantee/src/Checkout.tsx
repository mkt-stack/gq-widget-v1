import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useMemo } from "preact/hooks";
import {
  GUARANTEE_ICON_SIZES,
  GUARANTEE_METAFIELD_KEY,
  conditionRequirements,
  evaluateRules,
  normalizeGuaranteeConfig,
  resolveGuaranteeText,
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
  render(<GuaranteeRow />, document.body);
}

/**
 * Up to 3 equal, top-aligned columns. Each is a vertical stack: a fixed-size
 * square slot (Shopify icon or uploaded image), then title, then subtitle, so
 * titles line up across columns whatever the icon.
 */
function GuaranteeRow() {
  const config = useWidgetConfig(shopify.appMetafields.value, GUARANTEE_METAFIELD_KEY, normalizeGuaranteeConfig);
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

  if (!config?.enabled || config.items.length === 0) return null;
  if (evaluateRules(config.rules, ctx) !== true) return null;

  const language = shopify.localization.language.value.isoCode;
  const size = GUARANTEE_ICON_SIZES[config.iconSize];
  const slot = `${size.px}px` as const;
  return (
    <s-grid
      gridTemplateColumns={config.items.map(() => "1fr").join(" ")}
      gap="base"
      alignItems="start"
      paddingBlock="small-200"
    >
      {config.items.map((item) => {
        const { title, subtitle } = resolveGuaranteeText(item, language);
        return (
          <s-stack key={item.id} direction="block" alignItems="center" gap="small-200">
            <s-stack inlineSize={slot} blockSize={slot} alignItems="center" justifyContent="center">
              {item.media === "image" ? (
                <s-image src={item.imageUrl} alt="" inlineSize="fill" aspectRatio="1" objectFit="contain" />
              ) : (
                <s-icon type={item.icon} size={size.icon} />
              )}
            </s-stack>
            {title ? <s-text type="strong">{title}</s-text> : null}
            {subtitle ? (
              <s-text type="small" color="subdued">
                {subtitle}
              </s-text>
            ) : null}
          </s-stack>
        );
      })}
    </s-grid>
  );
}
