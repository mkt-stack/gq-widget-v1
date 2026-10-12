import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  CALLOUT_LIMITS,
  CALLOUT_METAFIELD_KEY,
  DEFAULT_CALLOUT_CONFIG,
  EXAMPLE_CALLOUTS,
  calloutRequirements,
  catchAllIndex,
  normalizeCalloutConfig,
  resolveCalloutMessage,
  type CalloutConfig,
  type CalloutItem,
  type CalloutTone,
} from "@gq/widget-core";
import { authenticate } from "../shopify.server";
import { appEndpoint, readWidgetConfigs, writeWidgetConfig } from "../widgets/metafields.server";
import { ConditionBuilder } from "../components/ConditionBuilder";
import { RankedCard, RankedIntro, ranked } from "../components/RankedCard";
import { inputChecked, inputValue } from "../components/form-utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { configs, currencyCode } = await readWidgetConfigs(admin, [CALLOUT_METAFIELD_KEY]);
  const stored = configs[CALLOUT_METAFIELD_KEY];
  return {
    // A fresh config starts with example callouts for guests and logged-in non-members.
    config: stored.value ? normalizeCalloutConfig(stored.value) : { ...DEFAULT_CALLOUT_CONFIG, callouts: EXAMPLE_CALLOUTS },
    isNew: !stored.value,
    updatedAt: stored.updatedAt,
    currencyCode,
    hasEndpoint: Boolean(appEndpoint()),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const body = (await request.json()) as { config?: unknown };
  const config: CalloutConfig = { ...normalizeCalloutConfig(body.config), endpoint: appEndpoint() };
  const { shopId } = await readWidgetConfigs(admin, []);
  const result = await writeWidgetConfig(admin, shopId, CALLOUT_METAFIELD_KEY, config);
  return result.ok ? { ok: true as const } : { ok: false as const, errors: result.errors };
};

const TONE_LABELS: Record<CalloutTone, string> = {
  success: "Green (success)",
  info: "Blue (info)",
  critical: "Red (critical)",
  auto: "Normal text colour",
};

export default function CalloutSettings() {
  const { config: saved, isNew, updatedAt, currencyCode, hasEndpoint } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [config, setConfig] = useState<CalloutConfig>(saved);
  // After a save the loader revalidates; adopt the normalized, stored config.
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) {
    setLastSaved(saved);
    setConfig(saved);
  }
  const saving = fetcher.state !== "idle";
  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(saved), [config, saved]);

  useEffect(() => {
    if (!fetcher.data || fetcher.state !== "idle") return;
    if (fetcher.data.ok) shopify.toast.show("Membership callout saved");
    else shopify.toast.show(`Save failed: ${fetcher.data.errors.join(", ")}`, { isError: true });
  }, [fetcher.data, fetcher.state, shopify]);

  const setCallout = (id: string, patch: Partial<CalloutItem>) =>
    setConfig((c) => ({ ...c, callouts: ranked.patch(c.callouts, id, patch) }));
  const setCallouts = (callouts: CalloutItem[]) => setConfig((c) => ({ ...c, callouts }));
  const addCallout = () =>
    setCallouts([
      ...config.callouts,
      {
        id: ranked.newId(),
        name: `Callout ${config.callouts.length + 1}`,
        enabled: true,
        message: "",
        translations: {},
        tone: "success",
        strong: true,
        conditions: { match: "all", conditions: [] },
      },
    ]);

  const save = () => fetcher.submit({ config } as never, { method: "POST", encType: "application/json" });
  const discard = () => setConfig(saved);

  const preview = useMemo(() => normalizeCalloutConfig(config), [config]);
  const needsBackend = calloutRequirements(preview).customer;
  const catchAll = catchAllIndex(config.callouts);

  return (
    <s-page heading="Membership callout" inlineSize="base">
      <SaveBar id="callout-save-bar" open={dirty}>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined}></button>
        <button onClick={discard} disabled={saving}></button>
      </SaveBar>

      <s-button slot="primary-action" variant="primary" onClick={save} loading={saving} disabled={!dirty && !isNew}>
        Save
      </s-button>

      {isNew && (
        <s-banner tone="info" heading="Not configured yet">
          Two example callouts are loaded below (guests, and logged-in customers without the “member” tag). Check the
          tag, save, then add the “GQ Member Callout” block above the Pay now button in the checkout editor.
        </s-banner>
      )}
      {needsBackend && !hasEndpoint && (
        <s-banner tone="warning" heading="Customer conditions need a public HTTPS app URL">
          SHOPIFY_APP_URL isn’t set to an https:// address, so every buyer will be treated as a guest.
        </s-banner>
      )}

      <s-section heading="Status">
        <s-stack gap="base">
          <s-switch
            label="Show membership callout in checkout"
            details={updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString()}` : "Never saved"}
            checked={config.enabled}
            onChange={(e) => setConfig((c) => ({ ...c, enabled: inputChecked(e) }))}
          />
          <s-paragraph color="subdued">
            Shows an up arrow with a short message pointing to the member signup widget at the top of checkout.
            Checkout extensions can’t scroll the page, so the callout is a visual pointer, not a button.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Callouts">
        <s-stack gap="base">
          <RankedIntro>
            Use conditions such as Customer status (logged in / guest) and Customer tag (e.g. none of “member”).
          </RankedIntro>

          {config.callouts.map((c, i) => (
            <RankedCard
              key={c.id}
              index={i}
              count={config.callouts.length}
              name={c.name}
              enabled={c.enabled}
              catchAll={catchAll}
              noun="Callout"
              onChange={(patch) => setCallout(c.id, patch)}
              onMove={(by) => setCallouts(ranked.move(config.callouts, i, by))}
              onRemove={() => setCallouts(ranked.remove(config.callouts, c.id))}
            >
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-text-field
                  label="Message"
                  placeholder="e.g. กดรับสิทธิ์ส่งฟรีด้านบน"
                  maxLength={CALLOUT_LIMITS.maxMessageLength}
                  error={c.enabled && !c.message.trim() ? "Add a message" : undefined}
                  value={c.message}
                  onInput={(e) => setCallout(c.id, { message: inputValue(e) })}
                />
                <s-text-field
                  label="Message (EN)"
                  placeholder="Blank = use the message"
                  maxLength={CALLOUT_LIMITS.maxMessageLength}
                  value={c.translations.en ?? ""}
                  onInput={(e) => setCallout(c.id, { translations: { ...c.translations, en: inputValue(e) } })}
                />
                <s-select
                  label="Colour"
                  details="Uses your checkout branding colours."
                  value={c.tone}
                  onChange={(e) => setCallout(c.id, { tone: inputValue(e) as CalloutTone })}
                >
                  {(Object.keys(TONE_LABELS) as CalloutTone[]).map((t) => (
                    <s-option key={t} value={t}>
                      {TONE_LABELS[t]}
                    </s-option>
                  ))}
                </s-select>
                <s-checkbox
                  label="Bold text"
                  checked={c.strong}
                  onChange={(e) => setCallout(c.id, { strong: inputChecked(e) })}
                />
              </s-grid>

              <s-divider />
              <ConditionBuilder
                rules={c.conditions}
                onChange={(conditions) => setCallout(c.id, { conditions })}
                currencyCode={currencyCode}
                matchLabel="Show this callout when"
                emptyText="No conditions: this callout matches every checkout."
              />
            </RankedCard>
          ))}

          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button icon="plus" onClick={addCallout} disabled={config.callouts.length >= CALLOUT_LIMITS.maxCallouts}>
              Add callout
            </s-button>
            <s-text color="subdued">{`${config.callouts.length} of ${CALLOUT_LIMITS.maxCallouts}`}</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Preview">
        <CalloutPreview config={preview} />
      </s-section>
    </s-page>
  );
}

/** Each callout as checkout would render it (colours follow checkout branding). */
function CalloutPreview({ config }: { config: CalloutConfig }) {
  const [language, setLanguage] = useState("th");
  return (
    <s-stack gap="base">
      <s-select label="Language" value={language} onChange={(e) => setLanguage(inputValue(e))}>
        <s-option value="th">TH (default)</s-option>
        <s-option value="en">EN</s-option>
      </s-select>
      {config.callouts.length === 0 && <s-text color="subdued">Add a callout to preview it.</s-text>}
      {config.callouts.map((c, i) => (
        <s-stack key={c.id} gap="small-100">
          <s-text color="subdued">{`${i + 1}. ${c.name}${c.enabled ? "" : " (off)"}`}</s-text>
          <s-box padding="small-200 base" border="base" borderRadius="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type="arrow-up" tone={c.tone} />
              <s-text tone={c.tone} type={c.strong ? "strong" : undefined}>
                {resolveCalloutMessage(c, language) || "—"}
              </s-text>
            </s-stack>
          </s-box>
        </s-stack>
      ))}
      {!config.enabled && <s-badge tone="warning">Disabled: not shown in checkout</s-badge>}
    </s-stack>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
