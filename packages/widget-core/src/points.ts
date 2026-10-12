import type { ConditionContext } from "./conditions";
import { normalizeRankedList, pickRanked, rankedRequirements, type RankedItem } from "./ranked";
import { clampText, normalizeEndpoint, normalizeTextTranslations, pickLanguage } from "./util";

/**
 * Points earn callout: "You will earn 236 points from this order", calculated
 * from the cart. Ranked variants let members, tiers and non-members see
 * different rates and copy (e.g. non-members: "sign up above to earn …").
 */
export const POINTS_METAFIELD_KEY = "widget_points";

export const POINTS_TOKEN = "{points}";

export const POINTS_LIMITS = { maxVariants: 5, maxMessageLength: 150, maxSpend: 1_000_000, maxPoints: 100_000 };

/** Which amount the points are calculated from. */
export type PointsBase = "subtotal" | "paid";

export const POINTS_BASES: Record<PointsBase, string> = {
  subtotal: "Cart subtotal (items, before order discounts and shipping)",
  paid: "Amount paid excluding shipping (after all discounts)",
};

/** Checkout icons offered for the callout ("plus" by default). */
export const POINTS_ICONS = {
  plus: "Plus",
  "arrow-up": "Up arrow (points to sign-in above)",
  star: "Star",
  "star-filled": "Star (filled)",
  savings: "Savings",
  discount: "Discount tag",
  "check-circle": "Check circle",
} as const;
export type PointsIcon = keyof typeof POINTS_ICONS;

export const POINTS_TONES = ["success", "info", "critical", "auto"] as const;
export type PointsTone = (typeof POINTS_TONES)[number];

export interface PointsVariant extends RankedItem {
  /** Earn `points` for every `spend` of the base amount (whole steps only). */
  spend: number;
  points: number;
  /** {points} is replaced by the formatted number. */
  message: string;
  translations: Record<string, string>;
  icon: PointsIcon;
  tone: PointsTone;
}

export interface PointsConfig {
  version: 1;
  enabled: boolean;
  base: PointsBase;
  /** Ranked: the first enabled variant whose conditions match is shown. */
  variants: PointsVariant[];
  /** App backend origin, written by the admin on save. Needed for customer rules. */
  endpoint?: string;
}

export const EXAMPLE_POINTS_VARIANTS: PointsVariant[] = [
  {
    id: "member",
    name: "Members",
    enabled: true,
    spend: 10,
    points: 1,
    message: "คุณจะได้รับ {points} คะแนนจากคำสั่งซื้อนี้",
    translations: { en: "You will earn {points} points from this order" },
    icon: "plus",
    tone: "success",
    conditions: { match: "all", conditions: [{ id: "tag", type: "customer_tag", operator: "any", values: ["member"] }] },
  },
  {
    id: "non-member",
    name: "Not a member yet",
    enabled: true,
    spend: 10,
    points: 1,
    message: "สมัครสมาชิกด้านบน รับ {points} คะแนนจากคำสั่งซื้อนี้",
    translations: { en: "Sign up above to earn {points} points from this order" },
    icon: "arrow-up",
    tone: "success",
    conditions: { match: "all", conditions: [] },
  },
];

export const DEFAULT_POINTS_CONFIG: PointsConfig = { version: 1, enabled: false, base: "subtotal", variants: [] };

const positive = (v: unknown, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(max, Math.round(v * 100) / 100) : fallback;

function normalizeVariantFields(r: Record<string, unknown>): Omit<PointsVariant, keyof RankedItem> {
  return {
    spend: positive(r.spend, POINTS_LIMITS.maxSpend, 10),
    points: positive(r.points, POINTS_LIMITS.maxPoints, 1),
    message: clampText(r.message, "", POINTS_LIMITS.maxMessageLength),
    translations: normalizeTextTranslations(r.translations),
    icon: typeof r.icon === "string" && r.icon in POINTS_ICONS ? (r.icon as PointsIcon) : "plus",
    tone: POINTS_TONES.includes(r.tone as PointsTone) ? (r.tone as PointsTone) : "success",
  };
}

/** Coerce anything (stored JSON, form input) into a valid config. Never throws. */
export function normalizePointsConfig(raw: unknown): PointsConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    version: 1,
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_POINTS_CONFIG.enabled,
    base: r.base === "paid" ? "paid" : "subtotal",
    variants: normalizeRankedList<PointsVariant>(r.variants, POINTS_LIMITS.maxVariants, "Variant", normalizeVariantFields),
    endpoint: normalizeEndpoint(r.endpoint),
  };
}

export const pointsRequirements = (config: PointsConfig) => rankedRequirements(config.variants);

export const pickPointsVariant = (config: PointsConfig, ctx: ConditionContext) => pickRanked(config.variants, ctx);

/** Whole steps only: spend 10 → 1 point means ฿1,449 earns 144. */
export function calculatePoints(amount: number, variant: Pick<PointsVariant, "spend" | "points">): number {
  if (!(amount > 0) || !(variant.spend > 0)) return 0;
  // Small epsilon guards float error, e.g. 0.3 / 0.1 = 2.9999…
  return Math.floor(Math.floor(amount / variant.spend + 1e-9) * variant.points);
}

/** Base amount from checkout money values. `paid` = total − shipping, never below 0. */
export function pointsBaseAmount(base: PointsBase, cost: { subtotal: number; total: number; shipping?: number }): number {
  return base === "paid" ? Math.max(0, cost.total - (cost.shipping ?? 0)) : cost.subtotal;
}

export const formatPoints = (n: number) => new Intl.NumberFormat("en-US").format(n);

export const resolvePointsMessage = (variant: PointsVariant, language: string | undefined) =>
  pickLanguage(variant.translations, language) || variant.message;
