import type { ConditionContext, ConditionRequirements } from "./conditions";
import { normalizeRankedList, pickRanked, rankedRequirements, type RankedItem } from "./ranked";
import { clampInt as intIn, clampText, normalizeEndpoint, normalizeTextTranslations, pickLanguage } from "./util";

/** Shop metafield (app-owned, `$app` namespace) that stores this widget's config. */
export const DELIVERY_METAFIELD_KEY = "widget_delivery_estimate";

export const DATE_TOKEN = "{date}";

export const DELIVERY_LIMITS = {
  maxRules: 5,
  maxDays: 60,
  maxMessageLength: 200,
  maxNameLength: 60,
  maxHolidays: 100,
};

/**
 * Colour of the banner (or of the icon and text in compact). "auto" keeps the
 * original look: blue info banner / normal text. "neutral" is a grey box,
 * because checkout banners have no grey tone.
 */
export type DeliveryTone = "auto" | "success" | "info" | "warning" | "critical" | "neutral";

export const DELIVERY_TONES: Record<DeliveryTone, string> = {
  auto: "Default (blue banner / normal text)",
  success: "Green (success)",
  info: "Blue (info)",
  warning: "Yellow (warning)",
  critical: "Red (critical)",
  neutral: "Grey",
};

const isDeliveryTone = (v: unknown): v is DeliveryTone => typeof v === "string" && v in DELIVERY_TONES;

/** Delivery time in working days, counted from the day the order is processed. */
export interface DeliveryWindow {
  minDays: number;
  maxDays: number;
}

export interface DeliveryRule extends DeliveryWindow, RankedItem {
  /** Overrides the widget message when this rule wins. Blank = use the widget message. */
  message: string;
  /** Per-language overrides of `message`, keyed by ISO code. */
  translations: Record<string, string>;
  /** Colour when this rule wins. "" = use the widget colour. */
  tone: DeliveryTone | "";
}

export interface DeliverySchedule {
  /** IANA time zone the cutoff and "today" are measured in. */
  timeZone: string;
  /** Orders at or after this hour start counting from the next working day. 24 = no cutoff. */
  cutoffHour: number;
  /** Days that count toward delivery time, 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  /** YYYY-MM-DD dates that never count (public holidays, warehouse closures). */
  holidays: string[];
}

export interface DeliveryConfig {
  version: 1;
  enabled: boolean;
  appearance: "compact" | "banner";
  /** Default colour; rules can override it. */
  tone: DeliveryTone;
  /** Default-language copy. {date} is replaced by the date range. */
  message: string;
  /** Per-language overrides keyed by ISO code, e.g. { en: "..." }. */
  translations: Record<string, string>;
  /** Used when no rule matches. Disable to show nothing in that case. */
  fallback: DeliveryWindow & { enabled: boolean };
  /** Ranked: the first enabled rule whose conditions match wins. */
  rules: DeliveryRule[];
  schedule: DeliverySchedule;
  /** App backend origin, written by the admin on save. Needed for customer-tag rules. */
  endpoint?: string;
}

export const DEFAULT_DELIVERY_SCHEDULE: DeliverySchedule = {
  timeZone: "Asia/Bangkok",
  cutoffHour: 14,
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
};

export const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = {
  version: 1,
  enabled: false,
  appearance: "compact",
  tone: "auto",
  message: "คาดว่าจะได้รับสินค้า {date}",
  translations: { en: "Estimated delivery {date}" },
  fallback: { enabled: true, minDays: 2, maxDays: 4 },
  rules: [],
  schedule: DEFAULT_DELIVERY_SCHEDULE,
};

/** Starter rules offered on a fresh config (disabled until the merchant checks the tags). */
export const EXAMPLE_DELIVERY_RULES: DeliveryRule[] = [
  {
    id: "vip",
    name: "VIP fast shipping",
    enabled: false,
    minDays: 1,
    maxDays: 2,
    message: "",
    translations: {},
    tone: "success",
    conditions: {
      match: "any",
      conditions: [
        { id: "vip-ship", type: "shipping_method", operator: "any", values: ["VIP"] },
        { id: "vip-tag", type: "customer_tag", operator: "any", values: ["VIP"] },
      ],
    },
  },
  {
    id: "embroidery",
    name: "Scrub embroidery",
    enabled: false,
    minDays: 7,
    maxDays: 10,
    message: "สินค้าปักชื่อ คาดว่าจะได้รับ {date}",
    translations: { en: "Embroidered items arrive {date}" },
    tone: "",
    conditions: {
      match: "all",
      conditions: [{ id: "emb-tag", type: "product_tag", operator: "any", values: ["embroidery"] }],
    },
  },
];

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const text = (v: unknown, fallback: string) => clampText(v, fallback, DELIVERY_LIMITS.maxMessageLength);

function normalizeWindow(raw: Partial<DeliveryWindow> | undefined, fallback: DeliveryWindow): DeliveryWindow {
  const minDays = intIn(raw?.minDays, 0, DELIVERY_LIMITS.maxDays, fallback.minDays);
  return { minDays, maxDays: intIn(raw?.maxDays, minDays, DELIVERY_LIMITS.maxDays, Math.max(minDays, fallback.maxDays)) };
}

function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s: string) => ISO_DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

function normalizeSchedule(raw: unknown): DeliverySchedule {
  const d = DEFAULT_DELIVERY_SCHEDULE;
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<DeliverySchedule>;
  const workingDays = Array.isArray(r.workingDays)
    ? [...new Set(r.workingDays.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
    : [];
  const holidays = Array.isArray(r.holidays)
    ? [...new Set(r.holidays.filter((h): h is string => typeof h === "string").map((h) => h.trim()).filter(isRealDate))]
        .sort()
        .slice(0, DELIVERY_LIMITS.maxHolidays)
    : [];
  return {
    timeZone: validTimeZone(r.timeZone) ? r.timeZone : d.timeZone,
    cutoffHour: intIn(r.cutoffHour, 0, 24, d.cutoffHour),
    // No working days would mean no delivery date ever; fall back to the default week.
    workingDays: workingDays.length ? workingDays : [...d.workingDays],
    holidays,
  };
}

function normalizeRuleFields(r: Record<string, unknown>): Omit<DeliveryRule, keyof RankedItem> {
  return {
    ...normalizeWindow(r as Partial<DeliveryWindow>, DEFAULT_DELIVERY_CONFIG.fallback),
    message: text(r.message, ""),
    translations: normalizeTextTranslations(r.translations),
    tone: isDeliveryTone(r.tone) ? r.tone : "",
  };
}

/** Coerce anything (stored JSON, form input) into a valid config. Never throws. */
export function normalizeDeliveryConfig(raw: unknown): DeliveryConfig {
  const d = DEFAULT_DELIVERY_CONFIG;
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<DeliveryConfig>;
  const rules = normalizeRankedList<DeliveryRule>(r.rules, DELIVERY_LIMITS.maxRules, "Rule", normalizeRuleFields);
  return {
    version: 1,
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    appearance: r.appearance === "banner" ? "banner" : "compact",
    tone: isDeliveryTone(r.tone) ? r.tone : "auto",
    message: text(r.message, d.message),
    translations: r.translations === undefined ? { ...d.translations } : normalizeTextTranslations(r.translations),
    fallback: {
      enabled: typeof r.fallback?.enabled === "boolean" ? r.fallback.enabled : d.fallback.enabled,
      ...normalizeWindow(r.fallback, d.fallback),
    },
    rules,
    schedule: normalizeSchedule(r.schedule),
    endpoint: normalizeEndpoint(r.endpoint),
  };
}

// ---------------------------------------------------------------------------
// Rule ranking
// ---------------------------------------------------------------------------

/** Everything any enabled rule needs, so the extension fetches only that. */
export function deliveryRequirements(config: DeliveryConfig): ConditionRequirements {
  return rankedRequirements(config.rules);
}

export interface DeliveryChoice {
  window: DeliveryWindow;
  /** The winning rule, or null for the fallback estimate. */
  rule: DeliveryRule | null;
}

/**
 * Walks the rules in rank order and returns the first enabled one that matches.
 * Returns `undefined` while a higher-ranked rule is still waiting on facts
 * (so a lower rule never flashes first), and `null` when nothing applies.
 */
export function pickDeliveryWindow(
  config: DeliveryConfig,
  ctx: ConditionContext,
): DeliveryChoice | null | undefined {
  const rule = pickRanked(config.rules, ctx);
  if (rule === undefined) return undefined;
  if (rule) return { window: rule, rule };
  return config.fallback.enabled ? { window: config.fallback, rule: null } : null;
}

/** Message for the winning rule in the buyer's language, falling back to the widget message. */
export function resolveDeliveryMessage(
  config: DeliveryConfig,
  rule: DeliveryRule | null,
  language: string | undefined,
): string {
  const pick = (t: Record<string, string>) => pickLanguage(t, language);
  return (
    (rule && pick(rule.translations)) ||
    pick(config.translations) ||
    rule?.message ||
    config.message
  );
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Today's calendar date (as a UTC-midnight day number) and hour in the shop's time zone. */
function shopToday(now: Date, timeZone: string): { day: number; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return { day: Math.floor(now.getTime() / DAY_MS), hour: now.getUTCHours() };
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { day: Date.UTC(get("year"), get("month") - 1, get("day")) / DAY_MS, hour: get("hour") % 24 };
}

export interface DeliveryRange {
  /** Calendar dates at UTC midnight; format them with timeZone "UTC". */
  start: Date;
  end: Date;
}

/**
 * Working days are counted from the processing day: today if it's a working
 * day and before the cutoff, otherwise the next working day. 0 days = arrives
 * on the processing day. Weekends and holidays never count, so both ends of
 * the range always land on a working day.
 */
export function estimateDeliveryRange(
  window: DeliveryWindow,
  schedule: DeliverySchedule,
  now: Date = new Date(),
): DeliveryRange {
  const holidays = new Set(schedule.holidays);
  const workingDays = schedule.workingDays.length ? schedule.workingDays : DEFAULT_DELIVERY_SCHEDULE.workingDays;
  const isWorking = (day: number) =>
    workingDays.includes(new Date(day * DAY_MS).getUTCDay()) &&
    !holidays.has(new Date(day * DAY_MS).toISOString().slice(0, 10));
  const next = (day: number) => {
    // Bounded: at most a year of holidays/closed days in a row.
    for (let d = day + 1; d < day + 400; d++) if (isWorking(d)) return d;
    return day + 1;
  };
  const addWorkingDays = (from: number, n: number) => {
    let d = from;
    for (let i = 0; i < n; i++) d = next(d);
    return d;
  };

  const { day, hour } = shopToday(now, schedule.timeZone);
  const processing = isWorking(day) && hour < schedule.cutoffHour ? day : next(day);
  return {
    start: new Date(addWorkingDays(processing, window.minDays) * DAY_MS),
    end: new Date(addWorkingDays(processing, window.maxDays) * DAY_MS),
  };
}

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

function formatter(language: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(language || "en", { timeZone: "UTC", ...options });
  } catch {
    return new Intl.DateTimeFormat("en", { timeZone: "UTC", ...options });
  }
}

/**
 * "Thu 4th - Fri 5th Oct", "Tue 30th Sep - Fri 3rd Oct", "Thu 4th Oct" (en);
 * "พฤ. 4 - ศ. 5 ต.ค." (th; short weekday names vary by browser). Other languages follow the Thai pattern without ordinals.
 */
export function formatDeliveryRange(range: DeliveryRange, language: string | undefined): string {
  const lang = language || "en";
  const english = lang.toLowerCase().startsWith("en");
  const weekday = formatter(lang, { weekday: "short" });
  const month = formatter(lang, { month: "short" });
  const day = (d: Date) => `${weekday.format(d)} ${english ? ordinal(d.getUTCDate()) : d.getUTCDate()}`;
  const { start, end } = range;

  if (start.getTime() === end.getTime()) return `${day(start)} ${month.format(start)}`;
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  return sameMonth
    ? `${day(start)} - ${day(end)} ${month.format(end)}`
    : `${day(start)} ${month.format(start)} - ${day(end)} ${month.format(end)}`;
}
