import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  REFERRAL_METAFIELD_KEY,
  REFERRAL_PATH,
  REFERRAL_SHARE_CHANNELS,
  displayLink,
  normalizeReferralConfig,
  normalizeReferralResponse,
  referralShareUrl,
  resolveReferralCopy,
  type ReferralResponse,
  type ReferralShareChannel,
} from "@gq/widget-core";
import { useWidgetConfig } from "@gq/checkout-kit";

export default function extension() {
  render(<ReferralCard />, document.body);
}

const LINK_ID = "gq-referral-link";
const CODE_ID = "gq-referral-code";

/** Fetch the buyer's program from the app backend (which calls Bloop). `null` = hide. */
function useReferralProgram(endpoint: string | undefined): ReferralResponse | null | undefined {
  const orderId = shopify.orderConfirmation.value.order.id;
  const [result, setResult] = useState<ReferralResponse | null | undefined>(undefined);
  useEffect(() => {
    if (!endpoint) {
      setResult(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await shopify.sessionToken.get();
        const res = await fetch(`${endpoint}${REFERRAL_PATH}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        const body = res.ok ? normalizeReferralResponse(await res.json()) : null;
        if (!cancelled) setResult(body);
      } catch {
        if (!cancelled) setResult(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint, orderId]);
  return result;
}

/**
 * Header (eyebrow, heading, body), two reward tiles, the referral link with a
 * copy button, share buttons, and an optional collapsible referral code.
 */
function ReferralCard() {
  const config = useWidgetConfig(shopify.appMetafields.value, REFERRAL_METAFIELD_KEY, normalizeReferralConfig);
  const response = useReferralProgram(config?.enabled ? config.endpoint : undefined);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  if (!config?.enabled || !response?.program) return null;
  // Sample data (Bloop not connected yet) is only shown in the checkout editor.
  if (response.source === "sample" && !shopify.extension.editor) return null;

  const program = response.program;
  const copy = resolveReferralCopy(config, shopify.localization.language.value.isoCode, program);
  const channels = (Object.keys(REFERRAL_SHARE_CHANNELS) as ReferralShareChannel[]).filter((c) => config.share[c]);

  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack gap="base">
        <s-stack gap="small-200">
          {copy.eyebrow ? (
            <s-text type="strong" tone="critical">
              {copy.eyebrow}
            </s-text>
          ) : null}
          {copy.heading ? <s-heading>{copy.heading}</s-heading> : null}
          {copy.body ? <s-paragraph color="subdued">{copy.body}</s-paragraph> : null}
        </s-stack>

        <s-grid gridTemplateColumns="1fr 1fr" gap="small-200">
          <RewardTile icon="profile" label={copy.friendLabel} reward={program.friendReward} note={copy.friendNote} />
          <RewardTile icon="gift-card" label={copy.yourLabel} reward={program.yourReward} note={copy.yourNote} />
        </s-grid>

        <s-stack gap="small-200">
          <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="end">
            <s-text-field label={copy.linkLabel} value={displayLink(program.link)} readOnly />
            <s-button variant="primary" command="--copy" commandFor={LINK_ID}>
              {copied ? copy.copied : copy.copyLink}
            </s-button>
          </s-grid>
          <s-clipboard-item id={LINK_ID} text={program.link} onCopy={() => setCopied(true)} />
        </s-stack>

        {channels.length ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text color="subdued">{copy.shareLabel}</s-text>
            {channels.map((c) => (
              <s-button key={c} variant="secondary" href={referralShareUrl(c, program, copy)} target="_blank">
                {c === "email" ? copy.shareEmail : REFERRAL_SHARE_CHANNELS[c]}
              </s-button>
            ))}
          </s-stack>
        ) : null}

        {config.showCode && program.code ? (
          <>
            <s-divider />
            <s-details>
              <s-summary>{copy.codeToggle}</s-summary>
              <s-stack gap="small-200" paddingBlockStart="small-200">
                <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="center">
                  <s-box background="subdued" border="base" borderStyle="dashed" borderRadius="base" padding="small-200 base">
                    <s-text type="strong">{program.code}</s-text>
                  </s-box>
                  <s-button variant="secondary" command="--copy" commandFor={CODE_ID}>
                    {copy.copyCode}
                  </s-button>
                </s-grid>
                <s-clipboard-item id={CODE_ID} text={program.code} />
                {copy.codeHint ? (
                  <s-text type="small" color="subdued">
                    {copy.codeHint}
                  </s-text>
                ) : null}
              </s-stack>
            </s-details>
          </>
        ) : null}

        {config.showPoweredBy ? (
          <s-paragraph type="small" color="subdued" textAlign="center">
            Powered by BLOOP
          </s-paragraph>
        ) : null}
      </s-stack>
    </s-box>
  );
}

function RewardTile(props: { icon: "profile" | "gift-card"; label: string; reward: string; note: string }) {
  return (
    <s-box background="subdued" borderRadius="base" padding="base">
      <s-stack direction="inline" gap="small-200">
        <s-icon type={props.icon} />
        <s-stack gap="none">
          <s-text color="subdued">{props.label}</s-text>
          <s-text type="strong">{props.reward}</s-text>
          {props.note ? (
            <s-text type="small" color="subdued">
              {props.note}
            </s-text>
          ) : null}
        </s-stack>
      </s-stack>
    </s-box>
  );
}
