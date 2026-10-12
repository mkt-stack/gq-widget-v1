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
  const [variantId, setVariantId] = useState("");
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

  const variant = config.variants.find((v) => v.id === variantId) ?? config.variants[0];
  if (!variant) return <s-text color="subdued">Add a countdown to preview it.</s-text>;

  const start =
    state === "running"
      ? variant.durationSeconds
      : state === "warning"
        ? Math.max(1, variant.warningThresholdSeconds)
        : 0;
  const remaining = state === "expired" ? 0 : Math.max(0, start - elapsed);
  const expired = remaining <= 0;
  const warning = !expired && remaining <= variant.warningThresholdSeconds;
  const copy = resolveCountdownMessages(variant, language);
  const message = expired ? copy.expiredMessage : warning ? copy.warningMessage : copy.message;
  const { before, after, hasTime } = splitOnTime(message);
  const clock = expired ? "" : formatRemaining(remaining);
  // Same stage styles as the extension; "neutral" is a grey box.
  const style = config.styles[expired ? "expired" : warning ? "warning" : "running"];
  const grey = style === "neutral";
  const body = (
    <s-paragraph tone={config.appearance === "compact" && !grey ? style : "auto"} color={grey ? "subdued" : "base"}>
      {before}
      {clock ? <s-text type="strong">{hasTime ? clock : ` ${clock}`}</s-text> : null}
      {after}
    </s-paragraph>
  );
  const hidden = expired && variant.onExpire === "hide";
  const languages = Object.keys(variant.translations);

  return (
    <s-stack gap="base">
      {config.variants.length > 1 && (
        <s-select label="Countdown" value={variant.id} onChange={(e) => setVariantId(inputValue(e))}>
          {config.variants.map((v, i) => (
            <s-option key={v.id} value={v.id}>
              {`${i + 1}. ${v.name}`}
            </s-option>
          ))}
        </s-select>
      )}
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
      ) : config.appearance === "banner" && !grey ? (
        <s-banner tone={style}>{body}</s-banner>
      ) : (
        <s-box
          padding={config.appearance === "banner" ? "base" : "small-200 base"}
          border="base"
          borderRadius="base"
          background={grey ? "subdued" : "transparent"}
        >
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type={warning ? "alert-triangle" : "clock"} tone={grey ? "neutral" : style} />
            {body}
          </s-stack>
        </s-box>
      )}
      {!config.enabled && <s-badge tone="warning">Disabled: not shown in checkout</s-badge>}
    </s-stack>
  );
}
