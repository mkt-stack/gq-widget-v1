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
  DEFAULT_POINTS_CONFIG,
  EXAMPLE_POINTS_VARIANTS,
  POINTS_BASES,
  POINTS_ICONS,
  POINTS_LIMITS,
  POINTS_METAFIELD_KEY,
  POINTS_TOKEN,
  calculatePoints,
  catchAllIndex,
  formatPoints,
  normalizePointsConfig,
  pointsRequirements,
  resolvePointsMessage,
  splitOnToken,
  type PointsBase,
  type PointsConfig,
  type PointsIcon,
  type PointsTone,
  type PointsVariant,
} from "@gq/widget-core";
import { authenticate } from "../shopify.server";
import { appEndpoint, readWidgetConfigs, writeWidgetConfig } from "../widgets/metafields.server";
import { ConditionBuilder } from "../components/ConditionBuilder";
import { RankedCard, RankedIntro, ranked } from "../components/RankedCard";
import { inputChecked, inputValue } from "../components/form-utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { configs, currencyCode } = await readWidgetConfigs(admin, [POINTS_METAFIELD_KEY]);
  const stored = configs[POINTS_METAFIELD_KEY];
  return {
    // A fresh config starts with a member variant and a catch-all "sign up above" variant.
    config: stored.value ? normalizePointsConfig(stored.value) : { ...DEFAULT_POINTS_CONFIG, variants: EXAMPLE_POINTS_VARIANTS },
    isNew: !stored.value,
    updatedAt: stored.updatedAt,
    currencyCode,
    hasEndpoint: Boolean(appEndpoint()),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const body = (await request.json()) as { config?: unknown };
  const config: PointsConfig = { ...normalizePointsConfig(body.config), endpoint: appEndpoint() };
  const { shopId } = await readWidgetConfigs(admin, []);
  const result = await writeWidgetConfig(admin, shopId, POINTS_METAFIELD_KEY, config);
  return result.ok ? { ok: true as const } : { ok: false as const, errors: result.errors };
};

const TONE_LABELS: Record<PointsTone, string> = {
  success: "Green (success)",
  info: "Blue (info)",
  critical: "Red (critical)",
  auto: "Normal text colour",
};

const positive = (e: Event) => Math.max(0, Number(inputValue(e)) || 0);
const rateError = (n: number) => (n > 0 ? undefined : "Must be more than 0");

export default function PointsSettings() {
  const { config: saved, isNew, updatedAt, currencyCode, hasEndpoint } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [config, setConfig] = useState<PointsConfig>(saved);
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
    if (fetcher.data.ok) shopify.toast.show("Points earn callout saved");
    else shopify.toast.show(`Save failed: ${fetcher.data.errors.join(", ")}`, { isError: true });
  }, [fetcher.data, fetcher.state, shopify]);

  const setVariant = (id: string, patch: Partial<PointsVariant>) =>
    setConfig((c) => ({ ...c, variants: ranked.patch(c.variants, id, patch) }));
  const setVariants = (variants: PointsVariant[]) => setConfig((c) => ({ ...c, variants }));
  const addVariant = () =>
    setVariants([
      ...config.variants,
      {
        id: ranked.newId(),
        name: `Variant ${config.variants.length + 1}`,
        enabled: true,
        spend: 10,
        points: 1,
        message: "",
        translations: {},
        icon: "plus",
        tone: "success",
        conditions: { match: "all", conditions: [] },
      },
    ]);

  const save = () => fetcher.submit({ config } as never, { method: "POST", encType: "application/json" });
  const discard = () => setConfig(saved);

  const hasErrors = config.variants.some((v) => rateError(v.spend) || rateError(v.points));
  const preview = useMemo(() => normalizePointsConfig(config), [config]);
  const needsBackend = pointsRequirements(preview).customer;
  const catchAll = catchAllIndex(config.variants);

  return (
    <s-page heading="Points earn callout" inlineSize="base">
      <SaveBar id="points-save-bar" open={dirty}>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined} disabled={hasErrors}></button>
        <button onClick={discard} disabled={saving}></button>
      </SaveBar>

      <s-button slot="primary-action" variant="primary" onClick={save} loading={saving} disabled={(!dirty && !isNew) || hasErrors}>
        Save
      </s-button>

      {isNew && (
        <s-banner tone="info" heading="Not configured yet">
          Two example variants are loaded: customers tagged “member”, then everyone else (a “sign up above” message).
          Check the tag and rate, save, then add the “GQ Points Earn” block above the Pay now button in the checkout
          editor.
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
            label="Show points earn callout in checkout"
            details={updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString()}` : "Never saved"}
            checked={config.enabled}
            onChange={(e) => setConfig((c) => ({ ...c, enabled: inputChecked(e) }))}
          />
          <s-select
            label="Calculate points from"
            value={config.base}
            onChange={(e) => setConfig((c) => ({ ...c, base: inputValue(e) as PointsBase }))}
          >
            {(Object.keys(POINTS_BASES) as PointsBase[]).map((b) => (
              <s-option key={b} value={b}>
                {POINTS_BASES[b]}
              </s-option>
            ))}
          </s-select>
          <s-paragraph color="subdued">
            Points update live as the cart changes and are rounded down to whole steps (spend {currencyCode} 10 → 1
            point means {currencyCode} 1,449 earns 144). It’s hidden when the order earns 0 points. The callout can’t
            be tapped: checkout extensions can’t scroll the page, so use the up-arrow icon to point non-members to
            sign-in.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Variants">
        <s-stack gap="base">
          <RankedIntro>
            Use conditions such as Customer tag (e.g. member, Gold) to give tiers a different rate or message.
          </RankedIntro>

          {config.variants.map((v, i) => (
            <RankedCard
              key={v.id}
              index={i}
              count={config.variants.length}
              name={v.name}
              enabled={v.enabled}
              catchAll={catchAll}
              noun="Variant"
              onChange={(patch) => setVariant(v.id, patch)}
              onMove={(by) => setVariants(ranked.move(config.variants, i, by))}
              onRemove={() => setVariants(ranked.remove(config.variants, v.id))}
            >
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-number-field
                  label="For every"
                  suffix={currencyCode}
                  min={0}
                  step={1}
                  value={String(v.spend)}
                  error={rateError(v.spend)}
                  onChange={(e) => setVariant(v.id, { spend: positive(e) })}
                />
                <s-number-field
                  label="Earn points"
                  min={0}
                  step={1}
                  value={String(v.points)}
                  error={rateError(v.points)}
                  onChange={(e) => setVariant(v.id, { points: positive(e) })}
                />
                <s-text-field
                  label="Message"
                  details={`Put ${POINTS_TOKEN} where the number goes. You can add extra benefits, e.g. “ส่งฟรี + รับ {points} คะแนน”.`}
                  maxLength={POINTS_LIMITS.maxMessageLength}
                  error={v.enabled && !v.message.trim() ? "Add a message" : undefined}
                  value={v.message}
                  onInput={(e) => setVariant(v.id, { message: inputValue(e) })}
                />
                <s-text-field
                  label="Message (EN)"
                  placeholder="Blank = use the message"
                  maxLength={POINTS_LIMITS.maxMessageLength}
                  value={v.translations.en ?? ""}
                  onInput={(e) => setVariant(v.id, { translations: { ...v.translations, en: inputValue(e) } })}
                />
                <s-select label="Icon" value={v.icon} onChange={(e) => setVariant(v.id, { icon: inputValue(e) as PointsIcon })}>
                  {(Object.keys(POINTS_ICONS) as PointsIcon[]).map((icon) => (
                    <s-option key={icon} value={icon}>
                      {POINTS_ICONS[icon]}
                    </s-option>
                  ))}
                </s-select>
                <s-select label="Colour" value={v.tone} onChange={(e) => setVariant(v.id, { tone: inputValue(e) as PointsTone })}>
                  {(Object.keys(TONE_LABELS) as PointsTone[]).map((t) => (
                    <s-option key={t} value={t}>
                      {TONE_LABELS[t]}
                    </s-option>
                  ))}
                </s-select>
              </s-grid>

              <s-divider />
              <ConditionBuilder
                rules={v.conditions}
                onChange={(conditions) => setVariant(v.id, { conditions })}
                currencyCode={currencyCode}
                matchLabel="Show this variant when"
                emptyText="No conditions: this variant matches every checkout."
              />
            </RankedCard>
          ))}

          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button icon="plus" onClick={addVariant} disabled={config.variants.length >= POINTS_LIMITS.maxVariants}>
              Add variant
            </s-button>
            <s-text color="subdued">{`${config.variants.length} of ${POINTS_LIMITS.maxVariants}`}</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Preview">
        <PointsPreview config={preview} currencyCode={currencyCode} />
      </s-section>
    </s-page>
  );
}

/** Each variant for a sample amount, as checkout would render it. */
function PointsPreview({ config, currencyCode }: { config: PointsConfig; currencyCode: string }) {
  const [language, setLanguage] = useState("th");
  const [amount, setAmount] = useState(1449);
  return (
    <s-stack gap="base">
      <s-grid gridTemplateColumns="1fr 1fr" gap="small-200">
        <s-number-field
          label="Sample amount"
          suffix={currencyCode}
          min={0}
          value={String(amount)}
          onInput={(e) => setAmount(Math.max(0, Number(inputValue(e)) || 0))}
        />
        <s-select label="Language" value={language} onChange={(e) => setLanguage(inputValue(e))}>
          <s-option value="th">TH (default)</s-option>
          <s-option value="en">EN</s-option>
        </s-select>
      </s-grid>
      {config.variants.length === 0 && <s-text color="subdued">Add a variant to preview it.</s-text>}
      {config.variants.map((v, i) => {
        const points = calculatePoints(amount, v);
        const { before, after, hasToken } = splitOnToken(resolvePointsMessage(v, language), POINTS_TOKEN);
        const value = formatPoints(points);
        return (
          <s-stack key={v.id} gap="small-100">
            <s-text color="subdued">{`${i + 1}. ${v.name}${v.enabled ? "" : " (off)"}`}</s-text>
            {points > 0 ? (
              <s-box padding="small-200 base" border="base" borderRadius="base">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  {/* Admin and checkout share these icon names; cast because the admin set is typed separately. */}
                  <s-icon type={v.icon as never} tone={v.tone} />
                  <s-paragraph tone={v.tone}>
                    {before}
                    <s-text type="strong">{hasToken ? value : ` ${value}`}</s-text>
                    {after}
                  </s-paragraph>
                </s-stack>
              </s-box>
            ) : (
              <s-text color="subdued">Hidden: earns 0 points.</s-text>
            )}
          </s-stack>
        );
      })}
      {!config.enabled && <s-badge tone="warning">Disabled: not shown in checkout</s-badge>}
    </s-stack>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
