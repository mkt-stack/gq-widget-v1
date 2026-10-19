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
  DEFAULT_REFERRAL_CONFIG,
  REFERRAL_COPY_FIELDS,
  REFERRAL_LIMITS,
  REFERRAL_METAFIELD_KEY,
  REFERRAL_SHARE_CHANNELS,
  displayLink,
  normalizeReferralConfig,
  resolveReferralCopy,
  type ReferralConfig,
  type ReferralCopyKey,
  type ReferralProgram,
  type ReferralShareChannel,
} from "@gq/widget-core";
import { authenticate } from "../shopify.server";
import { appEndpoint, readWidgetConfigs, writeWidgetConfig } from "../widgets/metafields.server";
import { SAMPLE_PROGRAM, bloopConfigured } from "../referral/bloop.server";
import { inputChecked, inputValue } from "../components/form-utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { configs } = await readWidgetConfigs(admin, [REFERRAL_METAFIELD_KEY]);
  const stored = configs[REFERRAL_METAFIELD_KEY];
  return {
    config: stored.value ? normalizeReferralConfig(stored.value) : DEFAULT_REFERRAL_CONFIG,
    isNew: !stored.value,
    updatedAt: stored.updatedAt,
    hasEndpoint: Boolean(appEndpoint()),
    bloopConnected: bloopConfigured(),
    sample: SAMPLE_PROGRAM,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const body = (await request.json()) as { config?: unknown };
  const config: ReferralConfig = { ...normalizeReferralConfig(body.config), endpoint: appEndpoint() };
  const { shopId } = await readWidgetConfigs(admin, []);
  const result = await writeWidgetConfig(admin, shopId, REFERRAL_METAFIELD_KEY, config);
  return result.ok ? { ok: true as const } : { ok: false as const, errors: result.errors };
};

const CHANNELS = Object.keys(REFERRAL_SHARE_CHANNELS) as ReferralShareChannel[];

export default function ReferralSettings() {
  const { config: saved, isNew, updatedAt, hasEndpoint, bloopConnected, sample } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [config, setConfig] = useState<ReferralConfig>(saved);
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
    if (fetcher.data.ok) shopify.toast.show("Referral widget saved");
    else shopify.toast.show(`Save failed: ${fetcher.data.errors.join(", ")}`, { isError: true });
  }, [fetcher.data, fetcher.state, shopify]);

  const setCopy = (key: ReferralCopyKey, value: string) =>
    setConfig((c) => ({ ...c, copy: { ...c.copy, [key]: value } }));
  const setEn = (key: ReferralCopyKey, value: string) =>
    setConfig((c) => ({ ...c, translations: { ...c.translations, en: { ...c.translations.en, [key]: value } } }));

  const save = () => fetcher.submit({ config } as never, { method: "POST", encType: "application/json" });
  const discard = () => setConfig(saved);

  const preview = useMemo(() => normalizeReferralConfig(config), [config]);

  return (
    <s-page heading="Referral thank-you" inlineSize="base">
      <SaveBar id="referral-save-bar" open={dirty}>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined}></button>
        <button onClick={discard} disabled={saving}></button>
      </SaveBar>

      <s-button slot="primary-action" variant="primary" onClick={save} loading={saving} disabled={!dirty && !isNew}>
        Save
      </s-button>

      {!bloopConnected && (
        <s-banner tone="info" heading="Bloop isn’t connected yet">
          The rewards, referral link and code come from Bloop. Until it’s connected the widget uses sample data, which
          only shows in the checkout editor. Buyers see nothing.
        </s-banner>
      )}
      {isNew && (
        <s-banner tone="info" heading="Not configured yet">
          Default copy is loaded below. Edit it, save, then add the “GQ Referral Thank-you” block to the Thank you page
          in the checkout editor.
        </s-banner>
      )}
      {!hasEndpoint && (
        <s-banner tone="warning" heading="The widget needs a public HTTPS app URL">
          SHOPIFY_APP_URL isn’t set to an https:// address, so the widget can’t load the referral program.
        </s-banner>
      )}

      <s-section heading="Status">
        <s-stack gap="base">
          <s-switch
            label="Show referral widget on the thank-you page"
            details={updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString()}` : "Never saved"}
            checked={config.enabled}
            onChange={(e) => {
              // Read the event now; the updater runs later, after currentTarget is cleared.
              const value = inputChecked(e);
              setConfig((c) => ({ ...c, enabled: value }));
            }}
          />
          <s-switch
            label="Show the referral code section"
            details="A collapsible “use a code instead” section. Hidden when Bloop returns no code."
            checked={config.showCode}
            onChange={(e) => {
              const value = inputChecked(e);
              setConfig((c) => ({ ...c, showCode: value }));
            }}
          />
          <s-switch
            label="Show “Powered by BLOOP”"
            checked={config.showPoweredBy}
            onChange={(e) => {
              const value = inputChecked(e);
              setConfig((c) => ({ ...c, showPoweredBy: value }));
            }}
          />
          <s-stack gap="small-200">
            <s-text type="strong">Share buttons</s-text>
            {CHANNELS.map((ch) => (
              <s-checkbox
                key={ch}
                label={REFERRAL_SHARE_CHANNELS[ch]}
                checked={config.share[ch]}
                onChange={(e) => {
                  const value = inputChecked(e);
                  setConfig((c) => ({ ...c, share: { ...c.share, [ch]: value } }));
                }}
              />
            ))}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Copy">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Any field can use {"{friend_reward}"}, {"{your_reward}"}, {"{link}"} and {"{code}"}, which are filled in from
            Bloop. The reward values in the two tiles come from Bloop automatically. A blank EN field uses the Thai text.
          </s-paragraph>
          {REFERRAL_COPY_FIELDS.map(({ key, label, long }) => {
            const max = long ? REFERRAL_LIMITS.maxLongLength : REFERRAL_LIMITS.maxShortLength;
            const Field = long ? "s-text-area" : "s-text-field";
            return (
              <s-grid key={key} gridTemplateColumns="1fr 1fr" gap="base">
                <Field label={label} maxLength={max} value={config.copy[key]} onInput={(e) => setCopy(key, inputValue(e))} />
                <Field
                  label={`${label} (EN)`}
                  placeholder="Blank = use the Thai text"
                  maxLength={max}
                  value={config.translations.en?.[key] ?? ""}
                  onInput={(e) => setEn(key, inputValue(e))}
                />
              </s-grid>
            );
          })}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Preview">
        <ReferralPreview config={preview} program={sample} />
      </s-section>
    </s-page>
  );
}

/** Approximates the thank-you card with sample data; colours follow checkout branding. */
function ReferralPreview({ config, program }: { config: ReferralConfig; program: ReferralProgram }) {
  const [language, setLanguage] = useState("th");
  const copy = resolveReferralCopy(config, language, program);
  const channels = CHANNELS.filter((c) => config.share[c]);
  return (
    <s-stack gap="base">
      <s-select label="Language" value={language} onChange={(e) => setLanguage(inputValue(e))}>
        <s-option value="th">TH (default)</s-option>
        <s-option value="en">EN</s-option>
      </s-select>
      <s-box padding="base" border="base" borderRadius="base">
        <s-stack gap="base">
          <s-stack gap="small-200">
            {copy.eyebrow && <s-text tone="critical">{copy.eyebrow}</s-text>}
            {copy.heading && <s-heading>{copy.heading}</s-heading>}
            {copy.body && <s-text color="subdued">{copy.body}</s-text>}
          </s-stack>
          <s-grid gridTemplateColumns="1fr 1fr" gap="small-200">
            {[
              [copy.friendLabel, program.friendReward, copy.friendNote],
              [copy.yourLabel, program.yourReward, copy.yourNote],
            ].map(([label, reward, note]) => (
              <s-box key={label} background="subdued" borderRadius="base" padding="small-200">
                <s-stack gap="none">
                  <s-text color="subdued">{label}</s-text>
                  <s-text type="strong">{reward}</s-text>
                  <s-text color="subdued">{note}</s-text>
                </s-stack>
              </s-box>
            ))}
          </s-grid>
          <s-text-field label={copy.linkLabel} value={displayLink(program.link)} readOnly />
          <s-button variant="primary">{copy.copyLink}</s-button>
          {channels.length > 0 && (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">{copy.shareLabel}</s-text>
              {channels.map((c) => (
                <s-button key={c}>{c === "email" ? copy.shareEmail : REFERRAL_SHARE_CHANNELS[c]}</s-button>
              ))}
            </s-stack>
          )}
          {config.showCode && program.code && (
            <s-stack gap="small-200">
              <s-divider />
              <s-text type="strong">{copy.codeToggle}</s-text>
              <s-text color="subdued">{`${program.code} · ${copy.codeHint}`}</s-text>
            </s-stack>
          )}
          {config.showPoweredBy && <s-text color="subdued">Powered by BLOOP</s-text>}
        </s-stack>
      </s-box>
      <s-text color="subdued">Sample data. The real rewards, link and code come from Bloop.</s-text>
      {!config.enabled && <s-badge tone="warning">Disabled: not shown on the thank-you page</s-badge>}
    </s-stack>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
