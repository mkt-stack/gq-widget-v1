import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { WIDGET_METAFIELD_NAMESPACE } from "@gq/widget-core";

/**
 * Widget configs are JSON in app-owned shop metafields ($app namespace).
 * Checkout / customer-account extensions read them natively through
 * `[[extensions.metafields]]`, so the storefront never calls our server just
 * to render a widget.
 */

const READ_QUERY = `#graphql
  query WidgetConfigs {
    shop {
      id
      currencyCode
      metafields(first: 50, namespace: "${WIDGET_METAFIELD_NAMESPACE}") {
        nodes { key jsonValue updatedAt }
      }
    }
  }`;

const WRITE_MUTATION = `#graphql
  mutation SetWidgetConfig($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key updatedAt }
      userErrors { field message code }
    }
  }`;

export interface StoredConfig {
  value: unknown;
  updatedAt: string | null;
}

export async function readWidgetConfigs(
  admin: AdminApiContext,
  keys: string[],
): Promise<{ shopId: string; currencyCode: string; configs: Record<string, StoredConfig> }> {
  const res = await admin.graphql(READ_QUERY);
  const json = await res.json();
  const shop = json.data!.shop;
  const configs: Record<string, StoredConfig> = {};
  for (const key of keys) configs[key] = { value: null, updatedAt: null };
  for (const node of shop.metafields.nodes as Array<{ key: string; jsonValue: unknown; updatedAt: string }>) {
    if (node.key in configs) configs[node.key] = { value: node.jsonValue, updatedAt: node.updatedAt };
  }
  return { shopId: shop.id, currencyCode: shop.currencyCode, configs };
}

export async function writeWidgetConfig(
  admin: AdminApiContext,
  shopId: string,
  key: string,
  value: unknown,
): Promise<{ ok: true; updatedAt: string } | { ok: false; errors: string[] }> {
  const res = await admin.graphql(WRITE_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId: shopId,
          namespace: WIDGET_METAFIELD_NAMESPACE,
          key,
          type: "json",
          value: JSON.stringify(value),
        },
      ],
    },
  });
  const json = await res.json();
  const result = json.data!.metafieldsSet!;
  if (result.userErrors.length) {
    return { ok: false, errors: result.userErrors.map((e: { message: string }) => e.message) };
  }
  return { ok: true, updatedAt: result.metafields![0]!.updatedAt };
}

/** Public origin of this app, baked into configs so extensions can reach the backend. */
export function appEndpoint(): string | undefined {
  const url = process.env.SHOPIFY_APP_URL;
  return url?.startsWith("https://") ? url.replace(/\/+$/, "") : undefined;
}
