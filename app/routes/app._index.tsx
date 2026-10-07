import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { appEndpoint, readWidgetConfigs, writeWidgetConfig } from "../widgets/metafields.server";
import { SURFACE_LABELS, WIDGETS } from "../widgets/registry";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { configs } = await readWidgetConfigs(admin, WIDGETS.map((w) => w.metafieldKey));
  const endpoint = appEndpoint();

  const widgets = WIDGETS.map((w) => {
    const stored = configs[w.metafieldKey];
    const storedEndpoint = (stored.value as { endpoint?: string } | null)?.endpoint;
    return {
      id: w.id,
      name: w.name,
      description: w.description,
      surface: SURFACE_LABELS[w.surface],
      configured: stored.value !== null,
      enabled: stored.value ? w.normalize(stored.value).enabled : false,
      updatedAt: stored.updatedAt,
      // e.g. a new tunnel URL during `shopify app dev`, or a production domain change.
      staleEndpoint: stored.value !== null && Boolean(endpoint) && storedEndpoint !== endpoint,
    };
  });

  return { widgets };
};

/** Re-stamp the current app URL into every saved widget config. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const endpoint = appEndpoint();
  const { shopId, configs } = await readWidgetConfigs(admin, WIDGETS.map((w) => w.metafieldKey));
  const errors: string[] = [];
  for (const w of WIDGETS) {
    const value = configs[w.metafieldKey].value;
    if (!value) continue;
    const result = await writeWidgetConfig(admin, shopId, w.metafieldKey, { ...w.normalize(value), endpoint });
    if (!result.ok) errors.push(...result.errors);
  }
  return { ok: errors.length === 0, errors };
};

export default function Dashboard() {
  const { widgets } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const stale = widgets.some((w) => w.staleEndpoint);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    shopify.toast.show(fetcher.data.ok ? "App URL updated" : "Update failed", { isError: !fetcher.data.ok });
  }, [fetcher.data, fetcher.state, shopify]);

  return (
    <s-page heading="GQ Widgets">
      {stale && (
        <s-banner tone="warning" heading="App URL changed">
          Some widgets point to an old app URL, so customer-based conditions can’t reach the backend.
          <s-button
            slot="secondary-actions"
            onClick={() => fetcher.submit({}, { method: "POST" })}
            loading={fetcher.state !== "idle"}
          >
            Update widgets
          </s-button>
        </s-banner>
      )}

      <s-section heading="Widgets" padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Widget</s-table-header>
            <s-table-header listSlot="labeled">Surface</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header></s-table-header>
          </s-table-header-row>
          <s-table-body>
            {widgets.map((w) => (
              <s-table-row key={w.id}>
                <s-table-cell>
                  <s-stack gap="small-100">
                    <s-text type="strong">{w.name}</s-text>
                    <s-text color="subdued">{w.description}</s-text>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{w.surface}</s-table-cell>
                <s-table-cell>
                  {!w.configured ? (
                    <s-badge>Not set up</s-badge>
                  ) : w.enabled ? (
                    <s-badge tone="success">On</s-badge>
                  ) : (
                    <s-badge tone="neutral">Off</s-badge>
                  )}
                </s-table-cell>
                <s-table-cell>
                  <s-button href={`/app/widgets/${w.id}`} variant="secondary">
                    Configure
                  </s-button>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section slot="aside" heading="Going live">
        <s-ordered-list>
          <s-list-item>Configure the widget here and turn it on.</s-list-item>
          <s-list-item>
            Open the{" "}
            <s-link href="shopify://admin/settings/checkout/editor" target="_blank">
              checkout editor
            </s-link>{" "}
            and add the widget’s app block.
          </s-list-item>
          <s-list-item>Settings changes go live on save. No redeploy needed.</s-list-item>
        </s-ordered-list>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
