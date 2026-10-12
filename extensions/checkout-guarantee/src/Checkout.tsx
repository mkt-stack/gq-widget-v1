import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useMemo } from "preact/hooks";
import {
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

/** Up to 3 equal columns, each a centred icon + title + optional subtitle. */
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
  return (
    <s-grid gridTemplateColumns={config.items.map(() => "1fr").join(" ")} gap="base" paddingBlock="small-200">
      {config.items.map((item) => {
        const { title, subtitle } = resolveGuaranteeText(item, language);
        return (
          <s-stack key={item.id} alignItems="center" gap="small-300">
            <s-icon type={item.icon} />
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
