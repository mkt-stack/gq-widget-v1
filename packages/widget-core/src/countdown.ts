import type { DisplayRules } from "./conditions";
import { normalizeRules } from "./normalize";

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

export interface CountdownConfig {
  version: 1;
  enabled: boolean;
  durationSeconds: number;
  /** Switch to the warning message + critical tone under this many seconds. */
  warningThresholdSeconds: number;
  appearance: "compact" | "banner";
  onExpire: "message" | "hide" | "restart";
  /** Default-language copy (the store's primary language). */
  messages: CountdownMessages;
  /** Per-language overrides keyed by ISO code, e.g. { en: {...} }. Blank fields fall back. */
  translations: Record<string, Partial<CountdownMessages>>;
  rules: DisplayRules;
  /** App backend origin, written by the admin on save. Needed for customer-tag rules. */
  endpoint?: string;
}

export const COUNTDOWN_LIMITS = {
  minDuration: 30,
  maxDuration: 24 * 60 * 60,
  maxMessageLength: 200,
};

export const DEFAULT_COUNTDOWN_CONFIG: CountdownConfig = {
  version: 1,
  enabled: false,
  durationSeconds: 10 * 60,
  warningThresholdSeconds: 2 * 60,
  appearance: "compact",
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
  rules: { match: "all", conditions: [] },
};

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(max, Math.max(min, v));
};

const text = (v: unknown, fallback: string) =>
  typeof v === "string" ? v.slice(0, COUNTDOWN_LIMITS.maxMessageLength) : fallback;

function normalizeMessages(raw: unknown, fallback: CountdownMessages): CountdownMessages {
  const m = (raw ?? {}) as Partial<CountdownMessages>;
  return {
    message: text(m.message, fallback.message),
    warningMessage: text(m.warningMessage, fallback.warningMessage),
    expiredMessage: text(m.expiredMessage, fallback.expiredMessage),
  };
}

/** Coerce anything (stored JSON, form input) into a valid config. Never throws. */
export function normalizeCountdownConfig(raw: unknown): CountdownConfig {
  const d = DEFAULT_COUNTDOWN_CONFIG;
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<CountdownConfig>;
  const durationSeconds = clamp(
    r.durationSeconds,
    COUNTDOWN_LIMITS.minDuration,
    COUNTDOWN_LIMITS.maxDuration,
    d.durationSeconds,
  );

  const translations: CountdownConfig["translations"] = {};
  const rawTranslations = r.translations ?? d.translations;
  for (const [lang, msgs] of Object.entries(rawTranslations)) {
    if (!/^[a-z]{2}(-[a-z]{2})?$/i.test(lang) || !msgs) continue;
    const entry: Partial<CountdownMessages> = {};
    for (const k of ["message", "warningMessage", "expiredMessage"] as const) {
      const v = (msgs as Partial<CountdownMessages>)[k];
      if (typeof v === "string" && v.trim()) entry[k] = text(v, "");
    }
    translations[lang.toLowerCase()] = entry;
  }

  return {
    version: 1,
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    durationSeconds,
    warningThresholdSeconds: clamp(r.warningThresholdSeconds, 0, durationSeconds, d.warningThresholdSeconds),
    appearance: r.appearance === "banner" ? "banner" : "compact",
    onExpire: r.onExpire === "hide" || r.onExpire === "restart" ? r.onExpire : "message",
    messages: normalizeMessages(r.messages, d.messages),
    translations,
    rules: normalizeRules(r.rules),
    endpoint: typeof r.endpoint === "string" && /^https:\/\//.test(r.endpoint) ? r.endpoint : undefined,
  };
}

/** Pick copy for a buyer language ("en", "en-US"), falling back field by field. */
export function resolveCountdownMessages(
  config: CountdownConfig,
  language: string | undefined,
): CountdownMessages {
  const lang = (language ?? "").toLowerCase();
  const override = config.translations[lang] ?? config.translations[lang.split("-")[0]] ?? {};
  return {
    message: override.message || config.messages.message,
    warningMessage: override.warningMessage || config.messages.warningMessage,
    expiredMessage: override.expiredMessage || config.messages.expiredMessage,
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

/** Split a message around {time} so the clock can be styled separately. */
export function splitOnTime(message: string): { before: string; after: string; hasTime: boolean } {
  const i = message.indexOf(TIME_TOKEN);
  if (i === -1) return { before: message, after: "", hasTime: false };
  return { before: message.slice(0, i), after: message.slice(i + TIME_TOKEN.length), hasTime: true };
}
