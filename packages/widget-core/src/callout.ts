import type { ConditionContext } from "./conditions";
import { normalizeRankedList, pickRanked, rankedRequirements, type RankedItem } from "./ranked";
import { clampText, normalizeEndpoint, normalizeTextTranslations, pickLanguage } from "./util";

/**
 * Membership callout: a one-line nudge with an up arrow that points the buyer
 * to the member signup widget higher up the checkout. Checkout extensions
 * can't scroll the page, so it's a visual pointer, not a button.
 */
export const CALLOUT_METAFIELD_KEY = "widget_member_callout";

export const CALLOUT_LIMITS = { maxCallouts: 3, maxMessageLength: 120 };

/** Checkout text tones; "success" renders green with default branding. */
export const CALLOUT_TONES = ["success", "info", "critical", "auto"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

export interface CalloutItem extends RankedItem {
  message: string;
  translations: Record<string, string>;
  tone: CalloutTone;
  /** Bold text. */
  strong: boolean;
}

export interface CalloutConfig {
  version: 1;
  enabled: boolean;
  /** Ranked: the first enabled callout whose conditions match is shown. */
  callouts: CalloutItem[];
  /** App backend origin, written by the admin on save. Needed for customer rules. */
  endpoint?: string;
}

export const EXAMPLE_CALLOUTS: CalloutItem[] = [
  {
    id: "guest",
    name: "Guests",
    enabled: true,
    message: "กดรับสิทธิ์ส่งฟรีด้านบน",
    translations: { en: "Get free shipping: sign up above" },
    tone: "success",
    strong: true,
    conditions: { match: "all", conditions: [{ id: "guest", type: "customer_status", operator: "guest", values: [] }] },
  },
  {
    id: "non-member",
    name: "Logged in, not a member",
    enabled: true,
    message: "สมัครสมาชิกด้านบน รับส่งฟรีและสะสมคะแนน",
    translations: { en: "Join GQ Member above for free shipping and points" },
    tone: "success",
    strong: true,
    conditions: {
      match: "all",
      conditions: [
        { id: "in", type: "customer_status", operator: "logged_in", values: [] },
        { id: "tag", type: "customer_tag", operator: "none", values: ["member"] },
      ],
    },
  },
];

export const DEFAULT_CALLOUT_CONFIG: CalloutConfig = { version: 1, enabled: false, callouts: [] };

function normalizeCalloutFields(r: Record<string, unknown>): Omit<CalloutItem, keyof RankedItem> {
  return {
    message: clampText(r.message, "", CALLOUT_LIMITS.maxMessageLength),
    translations: normalizeTextTranslations(r.translations),
    tone: CALLOUT_TONES.includes(r.tone as CalloutTone) ? (r.tone as CalloutTone) : "success",
    strong: r.strong !== false,
  };
}

/** Coerce anything (stored JSON, form input) into a valid config. Never throws. */
export function normalizeCalloutConfig(raw: unknown): CalloutConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    version: 1,
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_CALLOUT_CONFIG.enabled,
    callouts: normalizeRankedList<CalloutItem>(r.callouts, CALLOUT_LIMITS.maxCallouts, "Callout", normalizeCalloutFields),
    endpoint: normalizeEndpoint(r.endpoint),
  };
}

export const calloutRequirements = (config: CalloutConfig) => rankedRequirements(config.callouts);

export const pickCallout = (config: CalloutConfig, ctx: ConditionContext) => pickRanked(config.callouts, ctx);

export const resolveCalloutMessage = (callout: CalloutItem, language: string | undefined) =>
  pickLanguage(callout.translations, language) || callout.message;
