export * from "./conditions";
export * from "./normalize";
export * from "./util";
export * from "./ranked";
export * from "./countdown";
export * from "./delivery";
export * from "./callout";
export * from "./guarantee";
export * from "./points";
export * from "./referral";

/** Every widget stores its config in a shop metafield under this app-owned namespace. */
export const WIDGET_METAFIELD_NAMESPACE = "$app";

/** Customer-facts endpoint on the app backend, relative to `endpoint`. */
export const CUSTOMER_FACTS_PATH = "/api/storefront/customer-facts";
