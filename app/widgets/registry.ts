import {
  COUNTDOWN_METAFIELD_KEY,
  normalizeCountdownConfig,
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
      "A small timer that starts when the customer begins checkout, with a warning message as time runs out.",
    surface: "checkout",
    metafieldKey: COUNTDOWN_METAFIELD_KEY,
    extensionHandle: "checkout-countdown",
    normalize: normalizeCountdownConfig,
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
