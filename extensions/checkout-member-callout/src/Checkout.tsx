import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useMemo } from "preact/hooks";
import {
  CALLOUT_METAFIELD_KEY,
  calloutRequirements,
  normalizeCalloutConfig,
  pickCallout,
  resolveCalloutMessage,
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
  render(<MemberCallout />, document.body);
}

/**
 * Points the buyer up to the member signup widget. Checkout extensions can't
 * scroll the page, so this is a visual pointer (arrow + text), not a button.
 */
function MemberCallout() {
  const config = useWidgetConfig(shopify.appMetafields.value, CALLOUT_METAFIELD_KEY, normalizeCalloutConfig);
  const needs = useMemo(() => (config ? calloutRequirements(config) : null), [config]);
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
  const callout = pickCallout(config, ctx);
  if (!callout) return null;

  const message = resolveCalloutMessage(callout, shopify.localization.language.value.isoCode);
  if (!message.trim()) return null;

  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-icon type="arrow-up" tone={callout.tone} size="small" />
      <s-text tone={callout.tone} type={callout.strong ? "strong" : undefined}>
        {message}
      </s-text>
    </s-stack>
  );
}
