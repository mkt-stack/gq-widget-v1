import type { ConditionContext } from "./conditions";
import { normalizeRules } from "./normalize";
import { normalizeRankedList, pickRanked, rankedRequirements, type RankedItem } from "./ranked";
import { clampInt, clampText, isLanguageCode, normalizeEndpoint, pickLanguage } from "./util";

/** Shop metafield (app-owned, `$app` namespace) that stores this widget's config. */
export const COUNTDOWN_METAFIELD_KEY = "widget_countdown";

export const TIME_TOKEN = "{time}";

export interface CountdownMessages {
  /** Shown while the countdown is running. Use {time} where the clock goes. */
  message: string;
  /** Replaces `message` once remaining time drops under the warning threshold. */
  warningMessage: string;
  /** Shown after the timer hits zero (when `onExpire` is "message"). */
  expiredMessage: string;
}

/** One ranked countdown: the first enabled variant whose conditions match is shown. */
export interface CountdownVariant extends RankedItem {
  durationSeconds: number;
  /** Switch to the warning message + critical tone under this many seconds. */
  warningThresholdSeconds: number;
  onExpire: "message" | "hide" | "restart";
  /** Default-language copy (the store's primary language). */
  messages: CountdownMessages;
  /** Per-language overrides keyed by ISO code, e.g. { en: {...} }. Blank fields fall back. */
  translations: Record<string, Partial<CountdownMessages>>;
}

/** Visual style per stage. "neutral" is a grey box (checkout banners have no grey tone). */
export type CountdownStageStyle = "success" | "info" | "warning" | "critical" | "neutral";
export type CountdownStage = "running" | "warning" | "expired";

export const COUNTDOWN_STAGE_STYLES: Record<CountdownStageStyle, string> = {
  success: "Green (success)",
  info: "Blue (info)",
  warning: "Yellow (warning)",
  critical: "Red (critical)",
  neutral: "Grey",
};

export interface CountdownConfig {
  version: 2;
  enabled: boolean;
  appearance: "compact" | "banner";
  /** Style for each stage, used by both appearances. */
  styles: Record<CountdownStage, CountdownStageStyle>;
  /** Ranked, at most `COUNTDOWN_LIMITS.maxVariants`. */
  variants: CountdownVariant[];
  /** App backend origin, written by the admin on save. Needed for customer-tag rules. */
  endpoint?: string;
}

export const COUNTDOWN_LIMITS = {
  minDuration: 30,
  maxDuration: 24 * 60 * 60,
  maxMessageLength: 200,
  maxVariants: 5,
};

const MESSAGE_KEYS = ["message", "warningMessage", "expiredMessage"] as const;

export const DEFAULT_COUNTDOWN_VARIANT: CountdownVariant = {
  id: "default",
  name: "Everyone",
  enabled: true,
  durationSeconds: 10 * 60,
  warningThresholdSeconds: 2 * 60,
  onExpire: "message",
  messages: {
    message: "ชำระเงินภายใน {time} เพื่อไม่ให้พลาดสินค้าที่คุณเลือก",
    warningMessage: "ใกล้หมดเวลาแล้ว! เหลือเพียง {time}",
    expiredMessage: "หมดเวลาแล้ว สินค้าบางรายการอาจหมดได้ทุกเมื่อ",
  },
  translations: {
    en: {
      message: "Complete checkout within {time} so you don't miss out",
      warningMessage: "Almost out of time — only {time} left",
      expiredMessage: "Time's up — items in your cart may sell out soon",
    },
  },
  conditions: { match: "all", conditions: [] },
};

export const DEFAULT_COUNTDOWN_STYLES: CountdownConfig["styles"] = {
  running: "success",
  warning: "warning",
  expired: "neutral",
};

export const DEFAULT_COUNTDOWN_CONFIG: CountdownConfig = {
  version: 2,
  enabled: false,
  appearance: "banner",
  styles: DEFAULT_COUNTDOWN_STYLES,
  variants: [DEFAULT_COUNTDOWN_VARIANT],
};

const isStageStyle = (v: unknown): v is CountdownStageStyle => typeof v === "string" && v in COUNTDOWN_STAGE_STYLES;

function normalizeStyles(raw: unknown): CountdownConfig["styles"] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_COUNTDOWN_STYLES;
  return {
    running: isStageStyle(r.running) ? r.running : d.running,
    warning: isStageStyle(r.warning) ? r.warning : d.warning,
    expired: isStageStyle(r.expired) ? r.expired : d.expired,
  };
}

const text = (v: unknown, fallback: string) => clampText(v, fallback, COUNTDOWN_LIMITS.maxMessageLength);

function normalizeMessages(raw: unknown, fallback: CountdownMessages): CountdownMessages {
  const m = (raw ?? {}) as Partial<CountdownMessages>;
  return {
    message: text(m.message, fallback.message),
    warningMessage: text(m.warningMessage, fallback.warningMessage),
    expiredMessage: text(m.expiredMessage, fallback.expiredMessage),
  };
}

function normalizeMessageTranslations(raw: unknown): CountdownVariant["translations"] {
  const out: CountdownVariant["translations"] = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [lang, msgs] of Object.entries(raw)) {
    if (!isLanguageCode(lang) || !msgs || typeof msgs !== "object") continue;
    const entry: Partial<CountdownMessages> = {};
    for (const k of MESSAGE_KEYS) {
      const v = (msgs as Partial<CountdownMessages>)[k];
      if (typeof v === "string" && v.trim()) entry[k] = text(v, "");
    }
    out[lang.toLowerCase()] = entry;
  }
  return out;
}

function normalizeVariantFields(r: Record<string, unknown>): Omit<CountdownVariant, keyof RankedItem> {
  const d = DEFAULT_COUNTDOWN_VARIANT;
  const durationSeconds = clampInt(r.durationSeconds, COUNTDOWN_LIMITS.minDuration, COUNTDOWN_LIMITS.maxDuration, d.durationSeconds);
  return {
    durationSeconds,
    warningThresholdSeconds: clampInt(r.warningThresholdSeconds, 0, durationSeconds, d.warningThresholdSeconds),
    onExpire: r.onExpire === "hide" || r.onExpire === "restart" ? r.onExpire : "message",
    messages: normalizeMessages(r.messages, d.messages),
    translations: r.translations === undefined ? { ...d.translations } : normalizeMessageTranslations(r.translations),
  };
}

/** Coerce anything (stored JSON incl. the v1 single-countdown shape, form input) into a valid config. Never throws. */
export function normalizeCountdownConfig(raw: unknown): CountdownConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let rawVariants = r.variants;
  // v1 stored a single countdown at the top level, with its conditions under `rules`.
  if (!Array.isArray(rawVariants) && (r.version === 1 || "durationSeconds" in r || "messages" in r)) {
    rawVariants = [{ ...r, id: "default", name: "Everyone", enabled: true, conditions: normalizeRules(r.rules) }];
  }
  const variants = Array.isArray(rawVariants)
    ? normalizeRankedList<CountdownVariant>(rawVariants, COUNTDOWN_LIMITS.maxVariants, "Countdown", normalizeVariantFields)
    : [DEFAULT_COUNTDOWN_VARIANT];
  return {
    version: 2,
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_COUNTDOWN_CONFIG.enabled,
    // Configs saved before `appearance` defaulted to banner keep their choice.
    appearance: r.appearance === "compact" ? "compact" : r.appearance === "banner" ? "banner" : DEFAULT_COUNTDOWN_CONFIG.appearance,
    styles: normalizeStyles(r.styles),
    variants,
    endpoint: normalizeEndpoint(r.endpoint),
  };
}

export const countdownRequirements = (config: CountdownConfig) => rankedRequirements(config.variants);

/** The variant to show: undefined while undecided, null when none match. */
export const pickCountdownVariant = (config: CountdownConfig, ctx: ConditionContext) =>
  pickRanked(config.variants, ctx);

/** Pick copy for a buyer language ("en", "en-US"), falling back field by field. */
export function resolveCountdownMessages(
  variant: CountdownVariant,
  language: string | undefined,
): CountdownMessages {
  const override = pickLanguage(variant.translations, language) ?? {};
  return {
    message: override.message || variant.messages.message,
    warningMessage: override.warningMessage || variant.messages.warningMessage,
    expiredMessage: override.expiredMessage || variant.messages.expiredMessage,
  };
}

/** 125 → "02:05", 3725 → "1:02:05". */
export function formatRemaining(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Split a message around a token like {time} so the value can be styled separately. */
export function splitOnToken(message: string, token: string): { before: string; after: string; hasToken: boolean } {
  const i = message.indexOf(token);
  if (i === -1) return { before: message, after: "", hasToken: false };
  return { before: message.slice(0, i), after: message.slice(i + token.length), hasToken: true };
}

/** Split a message around {time} so the clock can be styled separately. */
export function splitOnTime(message: string): { before: string; after: string; hasTime: boolean } {
  const { before, after, hasToken } = splitOnToken(message, TIME_TOKEN);
  return { before, after, hasTime: hasToken };
}
