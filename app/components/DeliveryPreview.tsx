import { useState } from "react";
import {
  DATE_TOKEN,
  estimateDeliveryRange,
  formatDeliveryRange,
  resolveDeliveryMessage,
  splitOnToken,
  type DeliveryConfig,
} from "@gq/widget-core";
import { inputValue } from "./form-utils";

const FALLBACK = "__fallback";

/**
 * Approximates the checkout rendering with admin components, using today's
 * date in the shop's time zone. Checkout uses the store's branding, so this
 * shows layout, copy and dates, not exact styling.
 */
export function DeliveryPreview({ config }: { config: DeliveryConfig }) {
  const [language, setLanguage] = useState("th");
  const [scenario, setScenario] = useState(FALLBACK);

  const now = new Date();
  const rule = config.rules.find((r) => r.id === scenario) ?? null;
  const window = rule ?? config.fallback;
  const showsNothing = !rule && !config.fallback.enabled;
  const dates = formatDeliveryRange(estimateDeliveryRange(window, config.schedule, now), language);
  const { before, after, hasToken } = splitOnToken(resolveDeliveryMessage(config, rule, language), DATE_TOKEN);
  const languages = ["th", ...Object.keys(config.translations).filter((l) => l !== "th")];

  return (
    <s-stack gap="base">
      <s-grid gridTemplateColumns="1fr 1fr" gap="small-200">
        <s-select label="Matched rule" value={rule ? scenario : FALLBACK} onChange={(e) => setScenario(inputValue(e))}>
          <s-option value={FALLBACK}>No rule (default)</s-option>
          {config.rules.map((r, i) => (
            <s-option key={r.id} value={r.id}>
              {`${i + 1}. ${r.name}`}
            </s-option>
          ))}
        </s-select>
        <s-select label="Language" value={language} onChange={(e) => setLanguage(inputValue(e))}>
          {languages.map((l) => (
            <s-option key={l} value={l}>
              {l === "th" ? "TH (default)" : l.toUpperCase()}
            </s-option>
          ))}
        </s-select>
      </s-grid>

      {showsNothing ? (
        <s-text color="subdued">Nothing is shown when no rule matches.</s-text>
      ) : (
        <s-box padding="small-200 base" border="base" borderRadius="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {config.appearance === "compact" && <s-icon type="delivery" />}
            <s-paragraph>
              {before}
              <s-text type="strong">{hasToken ? dates : ` ${dates}`}</s-text>
              {after}
            </s-paragraph>
          </s-stack>
        </s-box>
      )}

      <s-divider />
      <s-stack gap="small-100">
        <s-text type="strong">If ordered now</s-text>
        {config.rules.map((r, i) => (
          <s-text key={r.id} color={r.enabled ? "base" : "subdued"}>
            {`${i + 1}. ${r.name}: ${formatDeliveryRange(estimateDeliveryRange(r, config.schedule, now), "en")}`}
            {r.enabled ? "" : " (off)"}
          </s-text>
        ))}
        <s-text color={config.fallback.enabled ? "base" : "subdued"}>
          {`Default: ${formatDeliveryRange(estimateDeliveryRange(config.fallback, config.schedule, now), "en")}`}
          {config.fallback.enabled ? "" : " (off)"}
        </s-text>
      </s-stack>
      {!config.enabled && <s-badge tone="warning">Disabled: not shown in checkout</s-badge>}
    </s-stack>
  );
}
