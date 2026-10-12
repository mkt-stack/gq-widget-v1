import {
  CALLOUT_METAFIELD_KEY,
  COUNTDOWN_METAFIELD_KEY,
  DELIVERY_METAFIELD_KEY,
  GUARANTEE_METAFIELD_KEY,
  normalizeCalloutConfig,
  normalizeCountdownConfig,
  normalizeDeliveryConfig,
  normalizeGuaranteeConfig,
} from "@gq/widget-core";

/**
 * One entry per widget. To add a widget:
 *   1. Put its config type + normalizer in packages/widget-core.
 *   2. Scaffold the extension under extensions/ (declare its metafield key).
 *   3. Add an admin route app/routes/app.widgets.<id>.tsx.
 *   4. Register it here so it shows on the dashboard.
 */
export type WidgetSurface = "checkout" | "thank-you" | "customer-account";

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  surface: WidgetSurface;
  metafieldKey: string;
  /** Extension handle (matches shopify.extension.toml) the merchant adds in the editor. */
  extensionHandle: string;
  normalize: (raw: unknown) => { enabled: boolean };
}

export const WIDGETS: WidgetDefinition[] = [
  {
    id: "countdown",
    name: "Checkout countdown",
    description:
      "A small timer that starts when the customer begins checkout. Up to 5 ranked countdowns with their own timers, messages and conditions.",
    surface: "checkout",
    metafieldKey: COUNTDOWN_METAFIELD_KEY,
    extensionHandle: "checkout-countdown",
    normalize: normalizeCountdownConfig,
  },
  {
    id: "delivery",
    name: "Estimate delivery date",
    description:
      "Estimated delivery dates under the shipping options, with up to 5 ranked rules (e.g. VIP fast shipping, embroidery).",
    surface: "checkout",
    metafieldKey: DELIVERY_METAFIELD_KEY,
    extensionHandle: "checkout-delivery-estimate",
    normalize: normalizeDeliveryConfig,
  },
  {
    id: "callout",
    name: "Membership callout",
    description:
      "Up arrow + short green message (e.g. กดรับสิทธิ์ส่งฟรีด้านบน) pointing to the member signup above. Up to 3 ranked callouts by login status or tag.",
    surface: "checkout",
    metafieldKey: CALLOUT_METAFIELD_KEY,
    extensionHandle: "checkout-member-callout",
    normalize: normalizeCalloutConfig,
  },
  {
    id: "guarantee",
    name: "Guarantee row",
    description: "Trust signals below the Pay now button: up to 3 centred columns of icon + text.",
    surface: "checkout",
    metafieldKey: GUARANTEE_METAFIELD_KEY,
    extensionHandle: "checkout-guarantee",
    normalize: normalizeGuaranteeConfig,
  },
];

export const SURFACE_LABELS: Record<WidgetSurface, string> = {
  checkout: "Checkout",
  "thank-you": "Thank you page",
  "customer-account": "Customer account",
};

export function getWidget(id: string): WidgetDefinition | undefined {
  return WIDGETS.find((w) => w.id === id);
}
