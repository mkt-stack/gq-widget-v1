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
  DEFAULT_GUARANTEE_CONFIG,
  GUARANTEE_ICON_SIZES,
  GUARANTEE_ICONS,
  GUARANTEE_LIMITS,
  GUARANTEE_METAFIELD_KEY,
  conditionRequirements,
  normalizeGuaranteeConfig,
  resolveGuaranteeText,
  type GuaranteeConfig,
  type GuaranteeIcon,
  type GuaranteeIconSize,
  type GuaranteeItem,
} from "@gq/widget-core";
import { authenticate } from "../shopify.server";
import { appEndpoint, readWidgetConfigs, writeWidgetConfig } from "../widgets/metafields.server";
import { ConditionBuilder } from "../components/ConditionBuilder";
import { ImageUpload } from "../components/ImageUpload";
import { ranked } from "../components/RankedCard";
import { inputChecked, inputValue } from "../components/form-utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { configs, currencyCode } = await readWidgetConfigs(admin, [GUARANTEE_METAFIELD_KEY]);
  const stored = configs[GUARANTEE_METAFIELD_KEY];
  return {
    config: stored.value ? normalizeGuaranteeConfig(stored.value) : DEFAULT_GUARANTEE_CONFIG,
    isNew: !stored.value,
    updatedAt: stored.updatedAt,
    currencyCode,
    hasEndpoint: Boolean(appEndpoint()),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const body = (await request.json()) as { config?: unknown };
  const config: GuaranteeConfig = { ...normalizeGuaranteeConfig(body.config), endpoint: appEndpoint() };
  const { shopId } = await readWidgetConfigs(admin, []);
  const result = await writeWidgetConfig(admin, shopId, GUARANTEE_METAFIELD_KEY, config);
  return result.ok ? { ok: true as const } : { ok: false as const, errors: result.errors };
};

const ICON_OPTIONS = Object.entries(GUARANTEE_ICONS) as Array<[GuaranteeIcon, string]>;

export default function GuaranteeSettings() {
  const { config: saved, isNew, updatedAt, currencyCode, hasEndpoint } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [config, setConfig] = useState<GuaranteeConfig>(saved);
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
    if (fetcher.data.ok) shopify.toast.show("Guarantee row saved");
    else shopify.toast.show(`Save failed: ${fetcher.data.errors.join(", ")}`, { isError: true });
  }, [fetcher.data, fetcher.state, shopify]);

  const setItems = (items: GuaranteeItem[]) => setConfig((c) => ({ ...c, items }));
  const setItem = (id: string, patch: Partial<GuaranteeItem>) =>
    setConfig((c) => ({ ...c, items: ranked.patch(c.items, id, patch) }));
  const setEn = (item: GuaranteeItem, field: "title" | "subtitle", value: string) =>
    setItem(item.id, { translations: { ...item.translations, en: { ...item.translations.en, [field]: value } } });
  const addItem = () =>
    setItems([
      ...config.items,
      { id: ranked.newId(), media: "icon", icon: "check-circle", imageUrl: "", title: "", subtitle: "", translations: {} },
    ]);

  const save = () => fetcher.submit({ config } as never, { method: "POST", encType: "application/json" });
  const discard = () => setConfig(saved);

  const preview = useMemo(() => normalizeGuaranteeConfig(config), [config]);
  const needsBackend = conditionRequirements(preview.rules).customer;

  return (
    <s-page heading="Guarantee row" inlineSize="base">
      <SaveBar id="guarantee-save-bar" open={dirty}>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined}></button>
        <button onClick={discard} disabled={saving}></button>
      </SaveBar>

      <s-button slot="primary-action" variant="primary" onClick={save} loading={saving} disabled={!dirty && !isNew}>
        Save
      </s-button>

      {isNew && (
        <s-banner tone="info" heading="Not configured yet">
          Three example guarantees are loaded below. Edit them, save, then add the “GQ Guarantee Row” block below the
          Pay now button (checkout footer) in the checkout editor.
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
            label="Show guarantee row in checkout"
            details={updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString()}` : "Never saved"}
            checked={config.enabled}
            onChange={(e) => {
              // Read the event now; the updater runs later, after currentTarget is cleared.
              const value = inputChecked(e);
              setConfig((c) => ({ ...c, enabled: value }));
            }}
          />
          <s-select
            label="Icon size"
            details="Applies to Shopify icons and uploaded images in every column."
            value={config.iconSize}
            onChange={(e) => {
              // Read the event now; the updater runs later, after currentTarget is cleared.
              const value = inputValue(e) as GuaranteeIconSize;
              setConfig((c) => ({ ...c, iconSize: value }));
            }}
          >
            {(Object.keys(GUARANTEE_ICON_SIZES) as GuaranteeIconSize[]).map((s) => (
              <s-option key={s} value={s}>
                {`${GUARANTEE_ICON_SIZES[s].label} (${GUARANTEE_ICON_SIZES[s].px}px)`}
              </s-option>
            ))}
          </s-select>
        </s-stack>
      </s-section>

      <s-section heading="Columns">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Up to {GUARANTEE_LIMITS.maxItems} columns side by side. In each column the icon, title and subtitle are
            stacked and centred, and every icon sits in the same-size slot so titles line up. Keep text short (about 2–3
            words per line) so it fits on phones.
          </s-paragraph>
          {config.items.map((item, i) => (
            <s-box key={item.id} padding="base" border="base" borderRadius="base">
              <s-stack gap="base">
                <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="center">
                  <s-badge>{`Column ${i + 1}`}</s-badge>
                  <s-stack direction="inline" gap="small-100">
                    <s-button icon="arrow-left" variant="tertiary" accessibilityLabel="Move left" disabled={i === 0} onClick={() => setItems(ranked.move(config.items, i, -1))} />
                    <s-button
                      icon="arrow-right"
                      variant="tertiary"
                      accessibilityLabel="Move right"
                      disabled={i === config.items.length - 1}
                      onClick={() => setItems(ranked.move(config.items, i, 1))}
                    />
                    <s-button icon="delete" variant="tertiary" tone="critical" accessibilityLabel="Delete column" onClick={() => setItems(ranked.remove(config.items, item.id))} />
                  </s-stack>
                </s-grid>
                <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                  <s-select
                    label="Icon type"
                    value={item.media}
                    onChange={(e) => setItem(item.id, { media: inputValue(e) === "image" ? "image" : "icon" })}
                  >
                    <s-option value="icon">Shopify icon</s-option>
                    <s-option value="image">Uploaded image</s-option>
                  </s-select>
                  {item.media === "icon" ? (
                    <s-select
                      label="Icon"
                      value={item.icon}
                      onChange={(e) => setItem(item.id, { icon: inputValue(e) as GuaranteeIcon })}
                    >
                      {ICON_OPTIONS.map(([value, label]) => (
                        <s-option key={value} value={value}>
                          {label}
                        </s-option>
                      ))}
                    </s-select>
                  ) : (
                    <s-select
                      label="Fallback icon"
                      details="Shown if no image is set."
                      value={item.icon}
                      onChange={(e) => setItem(item.id, { icon: inputValue(e) as GuaranteeIcon })}
                    >
                      {ICON_OPTIONS.map(([value, label]) => (
                        <s-option key={value} value={value}>
                          {label}
                        </s-option>
                      ))}
                    </s-select>
                  )}
                </s-grid>
                {item.media === "image" && (
                  <ImageUpload url={item.imageUrl} alt={item.title} onChange={(imageUrl) => setItem(item.id, { imageUrl })} />
                )}
                <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                  <s-text-field
                    label="Title"
                    placeholder="e.g. เปลี่ยนไซซ์ฟรี"
                    maxLength={GUARANTEE_LIMITS.maxTitleLength}
                    value={item.title}
                    onInput={(e) => setItem(item.id, { title: inputValue(e) })}
                  />
                  <s-text-field
                    label="Subtitle (optional)"
                    placeholder="e.g. ภายใน 30 วัน"
                    maxLength={GUARANTEE_LIMITS.maxSubtitleLength}
                    value={item.subtitle}
                    onInput={(e) => setItem(item.id, { subtitle: inputValue(e) })}
                  />
                  <s-text-field
                    label="Title (EN)"
                    placeholder="Blank = use the title"
                    maxLength={GUARANTEE_LIMITS.maxTitleLength}
                    value={item.translations.en?.title ?? ""}
                    onInput={(e) => setEn(item, "title", inputValue(e))}
                  />
                  <s-text-field
                    label="Subtitle (EN)"
                    placeholder="Blank = use the subtitle"
                    maxLength={GUARANTEE_LIMITS.maxSubtitleLength}
                    value={item.translations.en?.subtitle ?? ""}
                    onInput={(e) => setEn(item, "subtitle", inputValue(e))}
                  />
                </s-grid>
              </s-stack>
            </s-box>
          ))}
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button icon="plus" onClick={addItem} disabled={config.items.length >= GUARANTEE_LIMITS.maxItems}>
              Add column
            </s-button>
            <s-text color="subdued">{`${config.items.length} of ${GUARANTEE_LIMITS.maxItems}`}</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Display conditions">
        <ConditionBuilder rules={config.rules} onChange={(rules) => setConfig((c) => ({ ...c, rules }))} currencyCode={currencyCode} />
      </s-section>

      <s-section slot="aside" heading="Preview">
        <GuaranteePreview config={preview} />
      </s-section>
    </s-page>
  );
}

/** Approximates the checkout row; icons and colours follow checkout branding. */
function GuaranteePreview({ config }: { config: GuaranteeConfig }) {
  const [language, setLanguage] = useState("th");
  return (
    <s-stack gap="base">
      <s-select label="Language" value={language} onChange={(e) => setLanguage(inputValue(e))}>
        <s-option value="th">TH (default)</s-option>
        <s-option value="en">EN</s-option>
      </s-select>
      {config.items.length === 0 ? (
        <s-text color="subdued">Add a column to preview it.</s-text>
      ) : (
        <s-box padding="small-200" border="base" borderRadius="base">
          <s-grid gridTemplateColumns={config.items.map(() => "1fr").join(" ")} gap="small-200" alignItems="start">
            {config.items.map((item) => {
              const { title, subtitle } = resolveGuaranteeText(item, language);
              const slot = `${GUARANTEE_ICON_SIZES[config.iconSize].px}px` as const;
              return (
                <s-stack key={item.id} direction="block" alignItems="center" gap="small-200">
                  <s-stack inlineSize={slot} blockSize={slot} alignItems="center" justifyContent="center">
                    {item.media === "image" ? (
                      <s-image src={item.imageUrl} alt="" inlineSize="fill" aspectRatio="1" objectFit="contain" />
                    ) : (
                      // Admin and checkout share these icon names; cast because the admin set is typed separately.
                      <s-icon type={item.icon as never} size={config.iconSize === "small" ? "small" : "base"} />
                    )}
                  </s-stack>
                  {title && <s-text type="strong">{title}</s-text>}
                  {subtitle && <s-text color="subdued">{subtitle}</s-text>}
                </s-stack>
              );
            })}
          </s-grid>
        </s-box>
      )}
      {!config.enabled && <s-badge tone="warning">Disabled: not shown in checkout</s-badge>}
    </s-stack>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
