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
  customerId: () => shopify.buyerIdentity?.customer.value?.id,
};

export default function extension() {
  render(<GuaranteeRow />, document.body);
}

/**
 * Narrow (mobile) layouts: text wraps unevenly, so columns are centred
 * vertically there. Wider layouts stay top-aligned so titles line up.
 * Resolved against the nearest container (the row), not the viewport.
 */
const MOBILE_CENTER = "@container (inline-size <= 480px) center, start" as const;

/**
 * Up to 3 equal columns. Each is a vertical stack: a fixed-size square slot
 * (Shopify icon or uploaded image), then title, then subtitle, so titles line
 * up across columns whatever the icon. Optional subtle card: subdued
 * background + large rounded corners, around the row or each column.
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
  const columnCards = config.card === "columns";
  const grid = (
    <s-grid
      gridTemplateColumns={config.items.map(() => "1fr").join(" ")}
      gap={columnCards ? "small-200" : "base"}
      // Column cards stay equal height; their content is centred inside instead.
      alignItems={columnCards ? "stretch" : MOBILE_CENTER}
      paddingBlock={config.card === "none" ? "small-200" : undefined}
    >
      {config.items.map((item) => {
        const { title, subtitle } = resolveGuaranteeText(item, language);
        return (
          <s-stack
            key={item.id}
            direction="block"
            alignItems="center"
            justifyContent={columnCards ? MOBILE_CENTER : undefined}
            gap="small-200"
            background={columnCards ? "subdued" : undefined}
            borderRadius={columnCards ? "large" : undefined}
            padding={columnCards ? "base small-200" : undefined}
          >
            <s-stack inlineSize={slot} blockSize={slot} alignItems="center" justifyContent="center">
              {item.media === "image" ? (
                <s-image src={item.imageUrl} alt="" inlineSize="fill" aspectRatio="1" objectFit="contain" />
              ) : (
                <s-icon type={item.icon} size={size.icon} />
              )}
            </s-stack>
            {/* Paragraphs, not bare text: wrapped lines (narrow columns, Thai copy) stay centred. */}
            {title ? (
              <s-paragraph textAlign="center">
                <s-text type="strong">{title}</s-text>
              </s-paragraph>
            ) : null}
            {subtitle ? (
              <s-paragraph type="small" color="subdued" textAlign="center">
                {subtitle}
              </s-paragraph>
            ) : null}
          </s-stack>
        );
      })}
    </s-grid>
  );

  if (config.card !== "row") return grid;
  return (
    <s-box background="subdued" borderRadius="large" padding="base small-200">
      {grid}
    </s-box>
  );
}
