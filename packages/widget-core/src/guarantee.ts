import type { DisplayRules } from "./conditions";
import { normalizeRules } from "./normalize";
import { clampText, isLanguageCode, normalizeEndpoint, pickLanguage } from "./util";

/** Only https images (Shopify Files gives cdn.shopify.com URLs). */
export const normalizeImageUrl = (v: unknown) =>
  typeof v === "string" && /^https:\/\/\S+$/.test(v.trim()) ? v.trim().slice(0, 1000) : "";

/** Trust row under the Pay now button: up to 3 centred columns of icon + text. */
export const GUARANTEE_METAFIELD_KEY = "widget_guarantee";

export const GUARANTEE_LIMITS = { maxItems: 3, maxTitleLength: 40, maxSubtitleLength: 60 };

export type GuaranteeIconSize = "small" | "medium" | "large";

/** Subtle card: light (subdued) background with large rounded corners. */
export type GuaranteeCard = "row" | "columns" | "none";

export const GUARANTEE_CARD_STYLES: Record<GuaranteeCard, string> = {
  row: "One card around the row",
  columns: "A card per column",
  none: "No card",
};

/**
 * `icon` is the checkout s-icon size; `px` is the square slot every column's
 * icon or image sits in, so titles line up across columns.
 */
export const GUARANTEE_ICON_SIZES: Record<GuaranteeIconSize, { label: string; icon: "small" | "base" | "large-100"; px: number }> = {
  small: { label: "Small", icon: "small", px: 20 },
  medium: { label: "Medium", icon: "base", px: 28 },
  large: { label: "Large", icon: "large-100", px: 40 },
};

/** Checkout icons that suit trust signals (all in the 2026-07 checkout icon set). */
export const GUARANTEE_ICONS = {
  return: "Return / exchange",
  reset: "Refresh / exchange",
  lock: "Lock (secure payment)",
  "credit-card": "Credit card",
  "cash-dollar": "Cash",
  savings: "Savings",
  profile: "Person (real people)",
  email: "Email",
  mobile: "Phone",
  "question-circle": "Help",
  truck: "Truck",
  delivery: "Delivery box",
  delivered: "Delivered",
  discount: "Discount tag",
  star: "Star",
  "star-filled": "Star (filled)",
  "check-circle": "Check circle",
  "check-circle-filled": "Check circle (filled)",
  store: "Store",
  clock: "Clock",
  calendar: "Calendar",
  globe: "Globe",
  bag: "Bag",
  order: "Order",
} as const;
export type GuaranteeIcon = keyof typeof GUARANTEE_ICONS;

export interface GuaranteeText {
  title: string;
  /** Optional smaller second line. */
  subtitle: string;
}

export interface GuaranteeItem extends GuaranteeText {
  id: string;
  /** Show a Shopify checkout icon, or an uploaded image. */
  media: "icon" | "image";
  icon: GuaranteeIcon;
  /** https URL, usually a Shopify Files cdn.shopify.com URL. Used when `media` is "image". */
  imageUrl: string;
  /** Per-language overrides; blank fields fall back. */
  translations: Record<string, Partial<GuaranteeText>>;
}

export interface GuaranteeConfig {
  version: 1;
  enabled: boolean;
  iconSize: GuaranteeIconSize;
  card: GuaranteeCard;
  items: GuaranteeItem[];
  rules: DisplayRules;
  /** App backend origin, written by the admin on save. Needed for customer rules. */
  endpoint?: string;
}

export const DEFAULT_GUARANTEE_CONFIG: GuaranteeConfig = {
  version: 1,
  enabled: false,
  iconSize: "medium",
  card: "row",
  items: [
    {
      id: "exchange",
      media: "icon",
      icon: "return",
      imageUrl: "",
      title: "เปลี่ยนไซซ์ฟรี",
      subtitle: "ภายใน 30 วัน",
      translations: { en: { title: "Free exchange", subtitle: "up to 30 days" } },
    },
    {
      id: "secure",
      media: "icon",
      icon: "lock",
      imageUrl: "",
      title: "ชำระเงินปลอดภัย",
      subtitle: "เข้ารหัสทุกรายการ",
      translations: { en: { title: "Secure payment", subtitle: "fully encrypted" } },
    },
    {
      id: "people",
      media: "icon",
      icon: "profile",
      imageUrl: "",
      title: "ติดต่อทีมงานจริง",
      subtitle: "ตอบทุกคำถาม",
      translations: { en: { title: "Real people", subtitle: "here to help" } },
    },
  ],
  rules: { match: "all", conditions: [] },
};

const isIcon = (v: unknown): v is GuaranteeIcon => typeof v === "string" && v in GUARANTEE_ICONS;

function normalizeText(raw: unknown): Partial<GuaranteeText> {
  const t = (raw && typeof raw === "object" ? raw : {}) as Partial<GuaranteeText>;
  const out: Partial<GuaranteeText> = {};
  if (typeof t.title === "string" && t.title.trim()) out.title = clampText(t.title, "", GUARANTEE_LIMITS.maxTitleLength);
  if (typeof t.subtitle === "string" && t.subtitle.trim()) {
    out.subtitle = clampText(t.subtitle, "", GUARANTEE_LIMITS.maxSubtitleLength);
  }
  return out;
}

function normalizeItem(raw: unknown, index: number): GuaranteeItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<GuaranteeItem>;
  const imageUrl = normalizeImageUrl(r.imageUrl);
  const translations: GuaranteeItem["translations"] = {};
  for (const [lang, t] of Object.entries(r.translations ?? {})) {
    const entry = normalizeText(t);
    if (isLanguageCode(lang) && Object.keys(entry).length) translations[lang.toLowerCase()] = entry;
  }
  return {
    id: typeof r.id === "string" && r.id ? r.id : `item${index}`,
    icon: isIcon(r.icon) ? r.icon : "check-circle",
    imageUrl,
    // Fall back to the icon if "image" was chosen but no valid URL is set.
    media: r.media === "image" && imageUrl ? "image" : "icon",
    title: clampText(r.title, "", GUARANTEE_LIMITS.maxTitleLength),
    subtitle: clampText(r.subtitle, "", GUARANTEE_LIMITS.maxSubtitleLength),
    translations,
  };
}

/** Coerce anything (stored JSON, form input) into a valid config. Never throws. */
export function normalizeGuaranteeConfig(raw: unknown): GuaranteeConfig {
  const d = DEFAULT_GUARANTEE_CONFIG;
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<GuaranteeConfig>;
  const items = Array.isArray(r.items)
    ? r.items
        .map(normalizeItem)
        .filter((i): i is GuaranteeItem => i !== null)
        .slice(0, GUARANTEE_LIMITS.maxItems)
    : d.items;
  return {
    version: 1,
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    iconSize: r.iconSize === "small" || r.iconSize === "large" ? r.iconSize : "medium",
    // Configs saved before this option existed get the row card.
    card: r.card === "columns" || r.card === "none" ? r.card : "row",
    items,
    rules: normalizeRules(r.rules),
    endpoint: normalizeEndpoint(r.endpoint),
  };
}

export function resolveGuaranteeText(item: GuaranteeItem, language: string | undefined): GuaranteeText {
  const o = pickLanguage(item.translations, language) ?? {};
  return { title: o.title || item.title, subtitle: o.subtitle || item.subtitle };
}
