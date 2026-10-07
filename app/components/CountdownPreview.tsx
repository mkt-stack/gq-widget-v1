import { useEffect, useState } from "react";
import {
  formatRemaining,
  resolveCountdownMessages,
  splitOnTime,
  type CountdownConfig,
} from "@gq/widget-core";
import { inputValue } from "./form-utils";

type PreviewState = "running" | "warning" | "expired";

/**
 * Approximates the checkout rendering with admin components. Checkout uses the
 * store's branding, so this preview shows layout and copy, not exact styling.
 */
export function CountdownPreview({ config }: { config: CountdownConfig }) {
  const [state, setState] = useState<PreviewState>("running");
  const [language, setLanguage] = useState("");
  const [anchor, setAnchor] = useState(() => Date.now());
  const [now, setNow] = useState(anchor);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.max(0, Math.floor((now - anchor) / 1000));
  const changeState = (next: PreviewState) => {
    const t = Date.now();
    setState(next);
    setAnchor(t);
    setNow(t);
  };

  const start =
    state === "running"
      ? config.durationSeconds
      : state === "warning"
        ? Math.max(1, config.warningThresholdSeconds)
        : 0;
  const remaining = state === "expired" ? 0 : Math.max(0, start - elapsed);
  const expired = remaining <= 0;
  const warning = !expired && remaining <= config.warningThresholdSeconds;
  const copy = resolveCountdownMessages(config, language);
  const message = expired ? copy.expiredMessage : warning ? copy.warningMessage : copy.message;
  const { before, after, hasTime } = splitOnTime(message);
  const clock = expired ? "" : formatRemaining(remaining);
  const hidden = expired && config.onExpire === "hide";
  const languages = Object.keys(config.translations);

  return (
    <s-stack gap="base">
      <s-grid gridTemplateColumns="1fr 1fr" gap="small-200">
        <s-select label="State" value={state} onChange={(e) => changeState(inputValue(e) as PreviewState)}>
          <s-option value="running">Running</s-option>
          <s-option value="warning">Warning</s-option>
          <s-option value="expired">Expired</s-option>
        </s-select>
        <s-select label="Language" value={language} onChange={(e) => setLanguage(inputValue(e))}>
          <s-option value="">Default</s-option>
          {languages.map((l) => (
            <s-option key={l} value={l}>
              {l.toUpperCase()}
            </s-option>
          ))}
        </s-select>
      </s-grid>

      {hidden ? (
        <s-text color="subdued">Hidden after expiry.</s-text>
      ) : (
        <s-box
          padding="small-200 base"
          border="base"
          borderRadius="base"
          background={expired || warning ? "subdued" : "transparent"}
        >
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {config.appearance === "compact" && (
              <s-icon type={expired || warning ? "alert-triangle" : "clock"} tone={expired || warning ? "critical" : "auto"} />
            )}
            <s-paragraph tone={config.appearance === "banner" && (expired || warning) ? "critical" : "auto"}>
              {before}
              {clock ? <s-text type="strong">{hasTime ? clock : ` ${clock}`}</s-text> : null}
              {after}
            </s-paragraph>
          </s-stack>
        </s-box>
      )}
      {!config.enabled && <s-badge tone="warning">Disabled: not shown in checkout</s-badge>}
    </s-stack>
  );
}
