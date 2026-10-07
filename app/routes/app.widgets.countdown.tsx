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
  DEFAULT_COUNTDOWN_CONFIG,
  conditionRequirements,
  normalizeCountdownConfig,
  type CountdownConfig,
} from "@gq/widget-core";
import { authenticate } from "../shopify.server";
import { appEndpoint, readWidgetConfigs, writeWidgetConfig } from "../widgets/metafields.server";
import { ConditionBuilder } from "../components/ConditionBuilder";
import { CountdownPreview } from "../components/CountdownPreview";
import { inputChecked, inputValue, splitSeconds } from "../components/form-utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { configs, currencyCode } = await readWidgetConfigs(admin, [COUNTDOWN_METAFIELD_KEY]);
  const stored = configs[COUNTDOWN_METAFIELD_KEY];
  return {
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
    if (fetcher.data.ok) shopify.toast.show("Countdown saved");
    else shopify.toast.show(`Save failed: ${fetcher.data.errors.join(", ")}`, { isError: true });
  }, [fetcher.data, fetcher.state, shopify]);

  const set = <K extends keyof CountdownConfig>(key: K, value: CountdownConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  const setMessage = (lang: string | null, key: MessageKey, value: string) =>
    setConfig((c) =>
      lang === null
        ? { ...c, messages: { ...c.messages, [key]: value } }
        : { ...c, translations: { ...c.translations, [lang]: { ...c.translations[lang], [key]: value } } },
    );

  const save = () => fetcher.submit({ config } as never, { method: "POST", encType: "application/json" });
  const discard = () => setConfig(saved);

  const duration = splitSeconds(config.durationSeconds);
  const threshold = splitSeconds(config.warningThresholdSeconds);
  const needsBackend = conditionRequirements(config.rules).customer;
  const durationError =
    config.durationSeconds < COUNTDOWN_LIMITS.minDuration
      ? `Minimum ${COUNTDOWN_LIMITS.minDuration} seconds`
      : config.durationSeconds > COUNTDOWN_LIMITS.maxDuration
        ? "Maximum 24 hours"
        : undefined;

  return (
    <s-page heading="Checkout countdown" inlineSize="base">
      <SaveBar id="countdown-save-bar" open={dirty}>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined} disabled={Boolean(durationError)}></button>
        <button onClick={discard} disabled={saving}></button>
      </SaveBar>

      <s-button slot="primary-action" variant="primary" onClick={save} loading={saving} disabled={!dirty || Boolean(durationError)}>
        Save
      </s-button>

      {isNew && (
        <s-banner tone="info" heading="Not configured yet">
          Defaults are loaded below. Save once, then add the “GQ Checkout Countdown” block in the checkout editor.
        </s-banner>
      )}
      {needsBackend && !hasEndpoint && (
        <s-banner tone="warning" heading="Customer conditions need a public HTTPS app URL">
          SHOPIFY_APP_URL isn’t set to an https:// address, so customer-tag and customer-status conditions will treat every buyer as a guest.
        </s-banner>
      )}

      <s-section heading="Status">
        <s-switch
          label="Show countdown in checkout"
          details={updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString()}` : "Never saved"}
          checked={config.enabled}
          onChange={(e) => set("enabled", inputChecked(e))}
        />
      </s-section>

      <s-section heading="Timer">
        <s-stack gap="base">
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-number-field
              label="Duration — minutes"
              min={0}
              max={1440}
              step={1}
              value={String(duration.minutes)}
              error={durationError}
              onChange={(e) => set("durationSeconds", (Number(inputValue(e)) || 0) * 60 + duration.seconds)}
            />
            <s-number-field
              label="Duration — seconds"
              min={0}
              max={59}
              step={5}
              value={String(duration.seconds)}
              onChange={(e) => set("durationSeconds", duration.minutes * 60 + Math.min(59, Number(inputValue(e)) || 0))}
            />
          </s-grid>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-number-field
              label="Warning when below — minutes"
              min={0}
              step={1}
              value={String(threshold.minutes)}
              onChange={(e) =>
                set("warningThresholdSeconds", Math.min(config.durationSeconds, (Number(inputValue(e)) || 0) * 60 + threshold.seconds))
              }
            />
            <s-number-field
              label="Warning when below — seconds"
              min={0}
              max={59}
              step={5}
              value={String(threshold.seconds)}
              onChange={(e) =>
                set("warningThresholdSeconds", Math.min(config.durationSeconds, threshold.minutes * 60 + Math.min(59, Number(inputValue(e)) || 0)))
              }
            />
          </s-grid>
          <s-paragraph color="subdued">
            The timer starts the first time the widget is shown in a checkout and keeps running across reloads and
            checkout steps. A new checkout starts a fresh timer.
          </s-paragraph>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-select label="When time runs out" value={config.onExpire} onChange={(e) => set("onExpire", inputValue(e) as CountdownConfig["onExpire"])}>
              <s-option value="message">Show expired message</s-option>
              <s-option value="hide">Hide the widget</s-option>
              <s-option value="restart">Restart the timer</s-option>
            </s-select>
            <s-select label="Appearance" value={config.appearance} onChange={(e) => set("appearance", inputValue(e) as CountdownConfig["appearance"])}>
              <s-option value="compact">Compact (icon + text)</s-option>
              <s-option value="banner">Banner</s-option>
            </s-select>
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Messages">
        <s-stack gap="base">
          {MESSAGE_FIELDS.map((f) => (
            <s-text-field
              key={f.key}
              label={f.label}
              details={f.details}
              maxLength={COUNTDOWN_LIMITS.maxMessageLength}
              value={config.messages[f.key]}
              onInput={(e) => setMessage(null, f.key, inputValue(e))}
            />
          ))}
          <s-divider />
          <s-heading>English (shown when checkout language is English)</s-heading>
          {MESSAGE_FIELDS.map((f) => (
            <s-text-field
              key={`en-${f.key}`}
              label={`${f.label} (EN)`}
              placeholder="Leave blank to use the default message"
              maxLength={COUNTDOWN_LIMITS.maxMessageLength}
              value={config.translations.en?.[f.key] ?? ""}
              onInput={(e) => setMessage("en", f.key, inputValue(e))}
            />
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Display conditions">
        <ConditionBuilder rules={config.rules} onChange={(rules) => set("rules", rules)} currencyCode={currencyCode} />
      </s-section>

      <s-section slot="aside" heading="Preview">
        <CountdownPreview config={normalizeCountdownConfig(config)} />
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
