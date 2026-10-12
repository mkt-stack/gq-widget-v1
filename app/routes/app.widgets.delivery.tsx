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
  DEFAULT_DELIVERY_CONFIG,
  DELIVERY_LIMITS,
  DELIVERY_METAFIELD_KEY,
  EXAMPLE_DELIVERY_RULES,
  catchAllIndex,
  deliveryRequirements,
  normalizeDeliveryConfig,
  type DeliveryConfig,
  type DeliveryRule,
  type DeliveryWindow,
} from "@gq/widget-core";
import { authenticate } from "../shopify.server";
import { appEndpoint, readWidgetConfigs, writeWidgetConfig } from "../widgets/metafields.server";
import { ConditionBuilder } from "../components/ConditionBuilder";
import { DeliveryPreview } from "../components/DeliveryPreview";
import { RankedCard, RankedIntro, ranked } from "../components/RankedCard";
import { inputChecked, inputValue } from "../components/form-utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { configs, currencyCode } = await readWidgetConfigs(admin, [DELIVERY_METAFIELD_KEY]);
  const stored = configs[DELIVERY_METAFIELD_KEY];
  return {
    // A fresh config starts with the two example rules, switched off.
    config: stored.value
      ? normalizeDeliveryConfig(stored.value)
      : { ...DEFAULT_DELIVERY_CONFIG, rules: EXAMPLE_DELIVERY_RULES },
    isNew: !stored.value,
    updatedAt: stored.updatedAt,
    currencyCode,
    hasEndpoint: Boolean(appEndpoint()),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const body = (await request.json()) as { config?: unknown };
  const config: DeliveryConfig = {
    ...normalizeDeliveryConfig(body.config),
    endpoint: appEndpoint(),
  };
  const { shopId } = await readWidgetConfigs(admin, []);
  const result = await writeWidgetConfig(admin, shopId, DELIVERY_METAFIELD_KEY, config);
  return result.ok ? { ok: true as const } : { ok: false as const, errors: result.errors };
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const days = (e: Event) => Math.max(0, Math.min(DELIVERY_LIMITS.maxDays, Math.round(Number(inputValue(e)) || 0)));
const windowError = (w: DeliveryWindow) => (w.maxDays < w.minDays ? "Must be at least the minimum" : undefined);
const timeZoneError = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return undefined;
  } catch {
    return "Unknown time zone";
  }
};

export default function DeliverySettings() {
  const { config: saved, isNew, updatedAt, currencyCode, hasEndpoint } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [config, setConfig] = useState<DeliveryConfig>(saved);
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
    if (fetcher.data.ok) shopify.toast.show("Estimate delivery date saved");
    else shopify.toast.show(`Save failed: ${fetcher.data.errors.join(", ")}`, { isError: true });
  }, [fetcher.data, fetcher.state, shopify]);

  const set = <K extends keyof DeliveryConfig>(key: K, value: DeliveryConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));
  const setSchedule = (patch: Partial<DeliveryConfig["schedule"]>) =>
    setConfig((c) => ({ ...c, schedule: { ...c.schedule, ...patch } }));
  const setFallback = (patch: Partial<DeliveryConfig["fallback"]>) =>
    setConfig((c) => ({ ...c, fallback: { ...c.fallback, ...patch } }));
  const setRule = (id: string, patch: Partial<DeliveryRule>) =>
    setConfig((c) => ({ ...c, rules: ranked.patch(c.rules, id, patch) }));
  const addRule = () =>
    setConfig((c) => ({
      ...c,
      rules: [
        ...c.rules,
        {
          id: ranked.newId(),
          name: `Rule ${c.rules.length + 1}`,
          enabled: true,
          minDays: c.fallback.minDays,
          maxDays: c.fallback.maxDays,
          message: "",
          translations: {},
          conditions: { match: "all", conditions: [] },
        },
      ],
    }));

  const invalidHolidays = config.schedule.holidays.filter((h) => !ISO_DATE.test(h));
  const hasErrors =
    Boolean(windowError(config.fallback)) ||
    config.rules.some((r) => windowError(r)) ||
    config.schedule.workingDays.length === 0 ||
    Boolean(timeZoneError(config.schedule.timeZone));
  const preview = useMemo(() => normalizeDeliveryConfig(config), [config]);
  const needsBackend = deliveryRequirements(preview).customer;
  // A rule with no conditions matches everyone, so rules ranked below it never apply.
  const catchAll = catchAllIndex(config.rules);

  const save = () => fetcher.submit({ config } as never, { method: "POST", encType: "application/json" });
  const discard = () => setConfig(saved);

  return (
    <s-page heading="Estimate delivery date" inlineSize="base">
      <SaveBar id="delivery-save-bar" open={dirty}>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined} disabled={hasErrors}></button>
        <button onClick={discard} disabled={saving}></button>
      </SaveBar>

      <s-button slot="primary-action" variant="primary" onClick={save} loading={saving} disabled={(!dirty && !isNew) || hasErrors}>
        Save
      </s-button>

      {isNew && (
        <s-banner tone="info" heading="Not configured yet">
          Defaults and two example rules (switched off) are loaded below. Check the tags and shipping names, save,
          then add the “GQ Estimate Delivery Date” block under the shipping options in the checkout editor.
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
            label="Show estimated delivery date in checkout"
            details={updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString()}` : "Never saved"}
            checked={config.enabled}
            onChange={(e) => set("enabled", inputChecked(e))}
          />
          <s-select
            label="Appearance"
            value={config.appearance}
            onChange={(e) => set("appearance", inputValue(e) === "banner" ? "banner" : "compact")}
          >
            <s-option value="compact">Compact (icon + text)</s-option>
            <s-option value="banner">Banner</s-option>
          </s-select>
        </s-stack>
      </s-section>

      <s-section heading="Message">
        <s-stack gap="base">
          <s-text-field
            label="Message"
            details="Put {date} where the date range goes, e.g. “Thu 4th - Fri 5th Oct”. Rules can override it."
            maxLength={DELIVERY_LIMITS.maxMessageLength}
            value={config.message}
            onInput={(e) => set("message", inputValue(e))}
          />
          <s-text-field
            label="Message (EN)"
            details="Shown when the checkout language is English."
            placeholder="Leave blank to use the message above"
            maxLength={DELIVERY_LIMITS.maxMessageLength}
            value={config.translations.en ?? ""}
            onInput={(e) => set("translations", { ...config.translations, en: inputValue(e) })}
          />
        </s-stack>
      </s-section>

      <s-section heading="Rules">
        <s-stack gap="base">
          <RankedIntro>
            Put the most specific rule first (for example, embroidery above VIP if embroidered items always take
            longer). Days are working days, counted from when the order is processed.
          </RankedIntro>

          {config.rules.map((rule, i) => (
            <RankedCard
              key={rule.id}
              index={i}
              count={config.rules.length}
              name={rule.name}
              enabled={rule.enabled}
              catchAll={catchAll}
              noun="Rule"
              onChange={(patch) => setRule(rule.id, patch)}
              onMove={(by) => set("rules", ranked.move(config.rules, i, by))}
              onRemove={() => set("rules", ranked.remove(config.rules, rule.id))}
            >
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-number-field
                  label="Delivery from (working days)"
                  min={0}
                  max={DELIVERY_LIMITS.maxDays}
                  step={1}
                  value={String(rule.minDays)}
                  onChange={(e) => setRule(rule.id, { minDays: days(e) })}
                />
                <s-number-field
                  label="Delivery to (working days)"
                  min={0}
                  max={DELIVERY_LIMITS.maxDays}
                  step={1}
                  value={String(rule.maxDays)}
                  error={windowError(rule)}
                  onChange={(e) => setRule(rule.id, { maxDays: days(e) })}
                />
              </s-grid>

              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-text-field
                  label="Message override"
                  placeholder="Blank = use the main message"
                  maxLength={DELIVERY_LIMITS.maxMessageLength}
                  value={rule.message}
                  onInput={(e) => setRule(rule.id, { message: inputValue(e) })}
                />
                <s-text-field
                  label="Message override (EN)"
                  placeholder="Blank = use the main EN message"
                  maxLength={DELIVERY_LIMITS.maxMessageLength}
                  value={rule.translations.en ?? ""}
                  onInput={(e) => setRule(rule.id, { translations: { ...rule.translations, en: inputValue(e) } })}
                />
              </s-grid>

              <s-divider />
              <ConditionBuilder
                rules={rule.conditions}
                onChange={(conditions) => setRule(rule.id, { conditions })}
                currencyCode={currencyCode}
                matchLabel="Apply this rule when"
                emptyText="No conditions: this rule matches every checkout."
              />
            </RankedCard>
          ))}

          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button icon="plus" onClick={addRule} disabled={config.rules.length >= DELIVERY_LIMITS.maxRules}>
              Add rule
            </s-button>
            <s-text color="subdued">{`${config.rules.length} of ${DELIVERY_LIMITS.maxRules} rules`}</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="When no rule matches">
        <s-stack gap="base">
          <s-switch
            label="Show a default estimate"
            details="Turn off to show nothing unless a rule matches."
            checked={config.fallback.enabled}
            onChange={(e) => setFallback({ enabled: inputChecked(e) })}
          />
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-number-field
              label="Delivery from (working days)"
              min={0}
              max={DELIVERY_LIMITS.maxDays}
              step={1}
              disabled={!config.fallback.enabled}
              value={String(config.fallback.minDays)}
              onChange={(e) => setFallback({ minDays: days(e) })}
            />
            <s-number-field
              label="Delivery to (working days)"
              min={0}
              max={DELIVERY_LIMITS.maxDays}
              step={1}
              disabled={!config.fallback.enabled}
              value={String(config.fallback.maxDays)}
              error={windowError(config.fallback)}
              onChange={(e) => setFallback({ maxDays: days(e) })}
            />
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Working days and cutoff">
        <s-stack gap="base">
          <s-stack gap="small-200">
            <s-text type="strong">Days that count toward delivery</s-text>
            <s-stack direction="inline" gap="base">
              {WEEKDAYS.map((label, day) => (
                <s-checkbox
                  key={label}
                  label={label}
                  checked={config.schedule.workingDays.includes(day)}
                  onChange={(e) =>
                    setSchedule({
                      workingDays: inputChecked(e)
                        ? [...config.schedule.workingDays, day].sort()
                        : config.schedule.workingDays.filter((d) => d !== day),
                    })
                  }
                />
              ))}
            </s-stack>
            {config.schedule.workingDays.length === 0 && <s-text tone="critical">Pick at least one day.</s-text>}
          </s-stack>

          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-select
              label="Order cutoff time"
              details="Orders at or after this time are processed the next working day."
              value={String(config.schedule.cutoffHour)}
              onChange={(e) => setSchedule({ cutoffHour: Number(inputValue(e)) })}
            >
              {HOURS.map((h) => (
                <s-option key={h} value={String(h)}>
                  {`${String(h).padStart(2, "0")}:00`}
                </s-option>
              ))}
              <s-option value="24">No cutoff</s-option>
            </s-select>
            <s-text-field
              label="Time zone"
              details="IANA name, e.g. Asia/Bangkok."
              value={config.schedule.timeZone}
              error={timeZoneError(config.schedule.timeZone)}
              onChange={(e) => setSchedule({ timeZone: inputValue(e).trim() })}
            />
          </s-grid>

          <s-text-area
            label="Holidays and closures"
            details="One date per line (YYYY-MM-DD). These days never count toward delivery."
            rows={4}
            value={config.schedule.holidays.join("\n")}
            error={invalidHolidays.length ? `Not a date: ${invalidHolidays.join(", ")}. These are dropped on save.` : undefined}
            onChange={(e) =>
              setSchedule({
                holidays: inputValue(e)
                  .split(/[\n,]/)
                  .map((h) => h.trim())
                  .filter(Boolean),
              })
            }
          />
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Preview">
        <DeliveryPreview config={preview} />
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
