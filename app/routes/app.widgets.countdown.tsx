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
  COUNTDOWN_LIMITS,
  COUNTDOWN_METAFIELD_KEY,
  COUNTDOWN_STAGE_STYLES,
  DEFAULT_COUNTDOWN_CONFIG,
  DEFAULT_COUNTDOWN_VARIANT,
  catchAllIndex,
  countdownRequirements,
  normalizeCountdownConfig,
  type CountdownConfig,
  type CountdownStage,
  type CountdownStageStyle,
  type CountdownVariant,
} from "@gq/widget-core";
import { authenticate } from "../shopify.server";
import { appEndpoint, readWidgetConfigs, writeWidgetConfig } from "../widgets/metafields.server";
import { ConditionBuilder } from "../components/ConditionBuilder";
import { CountdownPreview } from "../components/CountdownPreview";
import { RankedCard, RankedIntro, ranked } from "../components/RankedCard";
import { inputChecked, inputValue, splitSeconds } from "../components/form-utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { configs, currencyCode } = await readWidgetConfigs(admin, [COUNTDOWN_METAFIELD_KEY]);
  const stored = configs[COUNTDOWN_METAFIELD_KEY];
  return {
    // Also migrates a v1 (single countdown) config into one variant.
    config: stored.value ? normalizeCountdownConfig(stored.value) : DEFAULT_COUNTDOWN_CONFIG,
    isNew: !stored.value,
    updatedAt: stored.updatedAt,
    currencyCode,
    hasEndpoint: Boolean(appEndpoint()),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const body = (await request.json()) as { config?: unknown };
  const config: CountdownConfig = {
    ...normalizeCountdownConfig(body.config),
    endpoint: appEndpoint(),
  };
  const { shopId } = await readWidgetConfigs(admin, []);
  const result = await writeWidgetConfig(admin, shopId, COUNTDOWN_METAFIELD_KEY, config);
  return result.ok ? { ok: true as const } : { ok: false as const, errors: result.errors };
};

type MessageKey = "message" | "warningMessage" | "expiredMessage";

const MESSAGE_FIELDS: Array<{ key: MessageKey; label: string; details: string }> = [
  { key: "message", label: "Countdown message", details: "Shown while the timer runs. Put {time} where the clock should appear." },
  { key: "warningMessage", label: "Warning message", details: "Replaces the countdown message once time drops under the warning threshold." },
  { key: "expiredMessage", label: "Expired message", details: "Shown when the timer reaches zero." },
];

const STAGES: Array<{ key: CountdownStage; label: string; details: string }> = [
  { key: "running", label: "While counting down", details: "Default: green" },
  { key: "warning", label: "Below the warning threshold", details: "Default: yellow warning, for urgency" },
  { key: "expired", label: "After time runs out", details: "Default: grey" },
];

const durationError = (v: CountdownVariant) =>
  v.durationSeconds < COUNTDOWN_LIMITS.minDuration
    ? `Minimum ${COUNTDOWN_LIMITS.minDuration} seconds`
    : v.durationSeconds > COUNTDOWN_LIMITS.maxDuration
      ? "Maximum 24 hours"
      : undefined;

const num = (e: Event) => Number(inputValue(e)) || 0;

export default function CountdownSettings() {
  const { config: saved, isNew, updatedAt, currencyCode, hasEndpoint } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [config, setConfig] = useState<CountdownConfig>(saved);
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
    if (fetcher.data.ok) shopify.toast.show("Checkout countdown saved");
    else shopify.toast.show(`Save failed: ${fetcher.data.errors.join(", ")}`, { isError: true });
  }, [fetcher.data, fetcher.state, shopify]);

  const set = <K extends keyof CountdownConfig>(key: K, value: CountdownConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));
  const setVariant = (id: string, patch: Partial<CountdownVariant>) =>
    setConfig((c) => ({ ...c, variants: ranked.patch(c.variants, id, patch) }));
  const setMessage = (v: CountdownVariant, lang: string | null, key: MessageKey, value: string) =>
    setVariant(
      v.id,
      lang === null
        ? { messages: { ...v.messages, [key]: value } }
        : { translations: { ...v.translations, [lang]: { ...v.translations[lang], [key]: value } } },
    );
  const addVariant = () =>
    setConfig((c) => ({
      ...c,
      variants: [
        ...c.variants,
        {
          ...DEFAULT_COUNTDOWN_VARIANT,
          id: ranked.newId(),
          name: `Countdown ${c.variants.length + 1}`,
          conditions: { match: "all", conditions: [] },
        },
      ],
    }));

  const save = () => fetcher.submit({ config } as never, { method: "POST", encType: "application/json" });
  const discard = () => setConfig(saved);

  const hasErrors = config.variants.some((v) => durationError(v));
  const preview = useMemo(() => normalizeCountdownConfig(config), [config]);
  const needsBackend = countdownRequirements(preview).customer;
  const catchAll = catchAllIndex(config.variants);

  return (
    <s-page heading="Checkout countdown" inlineSize="base">
      <SaveBar id="countdown-save-bar" open={dirty}>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined} disabled={hasErrors}></button>
        <button onClick={discard} disabled={saving}></button>
      </SaveBar>

      <s-button slot="primary-action" variant="primary" onClick={save} loading={saving} disabled={(!dirty && !isNew) || hasErrors}>
        Save
      </s-button>

      {isNew && (
        <s-banner tone="info" heading="Not configured yet">
          Defaults are loaded below. Save once, then add the “GQ Checkout Countdown” block in the checkout editor.
        </s-banner>
      )}
      {needsBackend && !hasEndpoint && (
        <s-banner tone="warning" heading="Customer conditions need a public HTTPS app URL">
          SHOPIFY_APP_URL isn’t set to an https:// address, so customer-tag and customer-status conditions will treat
          every buyer as a guest.
        </s-banner>
      )}

      <s-section heading="Status">
        <s-stack gap="base">
          <s-switch
            label="Show countdown in checkout"
            details={updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString()}` : "Never saved"}
            checked={config.enabled}
            onChange={(e) => set("enabled", inputChecked(e))}
          />
          <s-select
            label="Appearance"
            value={config.appearance}
            onChange={(e) => set("appearance", inputValue(e) === "banner" ? "banner" : "compact")}
          >
            <s-option value="banner">Banner (more urgency)</s-option>
            <s-option value="compact">Compact (icon + coloured text)</s-option>
          </s-select>
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            {STAGES.map((stage) => (
              <s-select
                key={stage.key}
                label={stage.label}
                details={stage.details}
                value={config.styles[stage.key]}
                onChange={(e) =>
                  set("styles", { ...config.styles, [stage.key]: inputValue(e) as CountdownStageStyle })
                }
              >
                {(Object.keys(COUNTDOWN_STAGE_STYLES) as CountdownStageStyle[]).map((s) => (
                  <s-option key={s} value={s}>
                    {COUNTDOWN_STAGE_STYLES[s]}
                  </s-option>
                ))}
              </s-select>
            ))}
          </s-grid>
          <s-paragraph color="subdued">
            The timer starts the first time a countdown is shown in a checkout and keeps running across reloads and
            checkout steps. A new checkout starts a fresh timer.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Countdowns">
        <s-stack gap="base">
          <RankedIntro>Each countdown has its own timer length, messages and conditions.</RankedIntro>

          {config.variants.map((v, i) => {
            const duration = splitSeconds(v.durationSeconds);
            const threshold = splitSeconds(v.warningThresholdSeconds);
            const setThreshold = (seconds: number) =>
              setVariant(v.id, { warningThresholdSeconds: Math.min(v.durationSeconds, seconds) });
            return (
              <RankedCard
                key={v.id}
                index={i}
                count={config.variants.length}
                name={v.name}
                enabled={v.enabled}
                catchAll={catchAll}
                noun="Countdown"
                onChange={(patch) => setVariant(v.id, patch)}
                onMove={(by) => set("variants", ranked.move(config.variants, i, by))}
                onRemove={() => set("variants", ranked.remove(config.variants, v.id))}
              >
                <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                  <s-number-field
                    label="Duration — minutes"
                    min={0}
                    max={1440}
                    step={1}
                    value={String(duration.minutes)}
                    error={durationError(v)}
                    onChange={(e) => setVariant(v.id, { durationSeconds: num(e) * 60 + duration.seconds })}
                  />
                  <s-number-field
                    label="Duration — seconds"
                    min={0}
                    max={59}
                    step={5}
                    value={String(duration.seconds)}
                    onChange={(e) => setVariant(v.id, { durationSeconds: duration.minutes * 60 + Math.min(59, num(e)) })}
                  />
                  <s-number-field
                    label="Warning when below — minutes"
                    min={0}
                    step={1}
                    value={String(threshold.minutes)}
                    onChange={(e) => setThreshold(num(e) * 60 + threshold.seconds)}
                  />
                  <s-number-field
                    label="Warning when below — seconds"
                    min={0}
                    max={59}
                    step={5}
                    value={String(threshold.seconds)}
                    onChange={(e) => setThreshold(threshold.minutes * 60 + Math.min(59, num(e)))}
                  />
                </s-grid>
                <s-select
                  label="When time runs out"
                  value={v.onExpire}
                  onChange={(e) => setVariant(v.id, { onExpire: inputValue(e) as CountdownVariant["onExpire"] })}
                >
                  <s-option value="message">Show expired message</s-option>
                  <s-option value="hide">Hide the widget</s-option>
                  <s-option value="restart">Restart the timer</s-option>
                </s-select>

                <s-divider />
                {MESSAGE_FIELDS.map((f) => (
                  <s-grid key={f.key} gridTemplateColumns="1fr 1fr" gap="base">
                    <s-text-field
                      label={f.label}
                      details={f.details}
                      maxLength={COUNTDOWN_LIMITS.maxMessageLength}
                      value={v.messages[f.key]}
                      onInput={(e) => setMessage(v, null, f.key, inputValue(e))}
                    />
                    <s-text-field
                      label={`${f.label} (EN)`}
                      placeholder="Blank = use the default message"
                      maxLength={COUNTDOWN_LIMITS.maxMessageLength}
                      value={v.translations.en?.[f.key] ?? ""}
                      onInput={(e) => setMessage(v, "en", f.key, inputValue(e))}
                    />
                  </s-grid>
                ))}

                <s-divider />
                <ConditionBuilder
                  rules={v.conditions}
                  onChange={(conditions) => setVariant(v.id, { conditions })}
                  currencyCode={currencyCode}
                  matchLabel="Show this countdown when"
                  emptyText="No conditions: this countdown matches every checkout."
                />
              </RankedCard>
            );
          })}

          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button icon="plus" onClick={addVariant} disabled={config.variants.length >= COUNTDOWN_LIMITS.maxVariants}>
              Add countdown
            </s-button>
            <s-text color="subdued">{`${config.variants.length} of ${COUNTDOWN_LIMITS.maxVariants}`}</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Preview">
        <CountdownPreview config={preview} />
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
