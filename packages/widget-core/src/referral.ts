import { clampText, isLanguageCode, normalizeEndpoint, pickLanguage } from "./util";

/**
 * Referral card on the thank-you page (Bloop referral program).
 *
 * The copy lives in this config. The program details (both rewards, the
 * buyer's referral link and code) come from Bloop through the app backend at
 * render time, so the Bloop credentials never reach the browser.
 */
export const REFERRAL_METAFIELD_KEY = "widget_referral";

/** Referral endpoint on the app backend, relative to `endpoint`. */
export const REFERRAL_PATH = "/api/storefront/referral";

export const REFERRAL_LIMITS = { maxShortLength: 60, maxLongLength: 300 };

/**
 * Every piece of customer-facing copy. Any of them can use the tokens
 * `{friend_reward}`, `{your_reward}`, `{link}` and `{code}`, filled from the
 * Bloop program.
 */
export interface ReferralCopy {
  eyebrow: string;
  heading: string;
  body: string;
  friendLabel: string;
  friendNote: string;
  yourLabel: string;
  yourNote: string;
  linkLabel: string;
  copyLink: string;
  copied: string;
  shareLabel: string;
  /** Email share button (LINE and Facebook keep their brand names). */
  shareEmail: string;
  codeToggle: string;
  copyCode: string;
  codeHint: string;
  /** Text sent with LINE and email shares. */
  shareMessage: string;
}
export type ReferralCopyKey = keyof ReferralCopy;

/** Admin labels and max lengths, in display order. */
export const REFERRAL_COPY_FIELDS: Array<{ key: ReferralCopyKey; label: string; long?: boolean }> = [
  { key: "eyebrow", label: "Eyebrow" },
  { key: "heading", label: "Heading" },
  { key: "body", label: "Body", long: true },
  { key: "friendLabel", label: "Friend reward label" },
  { key: "friendNote", label: "Friend reward note" },
  { key: "yourLabel", label: "Your reward label" },
  { key: "yourNote", label: "Your reward note" },
  { key: "linkLabel", label: "Link field label" },
  { key: "copyLink", label: "Copy link button" },
  { key: "copied", label: "Copied confirmation" },
  { key: "shareLabel", label: "Share label" },
  { key: "shareEmail", label: "Email share button" },
  { key: "codeToggle", label: "Referral code toggle" },
  { key: "copyCode", label: "Copy code button" },
  { key: "codeHint", label: "Referral code hint" },
  { key: "shareMessage", label: "Share message (LINE, email)", long: true },
];

export type ReferralShareChannel = "line" | "facebook" | "email";
export const REFERRAL_SHARE_CHANNELS: Record<ReferralShareChannel, string> = {
  line: "LINE",
  facebook: "Facebook",
  email: "Email",
};

export interface ReferralConfig {
  version: 1;
  enabled: boolean;
  share: Record<ReferralShareChannel, boolean>;
  /** Collapsible "use a code instead" section. */
  showCode: boolean;
  /** "Powered by BLOOP" footer line. */
  showPoweredBy: boolean;
  copy: ReferralCopy;
  /** Per-language overrides; blank fields fall back to `copy`. */
  translations: Record<string, Partial<ReferralCopy>>;
  /** App backend origin, written by the admin on save. */
  endpoint?: string;
}

export const DEFAULT_REFERRAL_COPY: ReferralCopy = {
  eyebrow: "โปรแกรมชวนเพื่อน",
  heading: "ชวนเพื่อน ได้ส่วนลดทั้งคู่",
  body: "ส่งลิงก์ให้เพื่อนรับส่วนลดออเดอร์แรก เมื่อเพื่อนสั่งซื้อสำเร็จ คุณจะได้รับส่วนลดสำหรับออเดอร์ถัดไป",
  friendLabel: "เพื่อนได้รับ",
  friendNote: "สำหรับออเดอร์แรก",
  yourLabel: "คุณได้รับ",
  yourNote: "เมื่อเพื่อนสั่งซื้อสำเร็จ",
  linkLabel: "ลิงก์ชวนเพื่อนของคุณ",
  copyLink: "คัดลอกลิงก์",
  copied: "คัดลอกแล้ว",
  shareLabel: "แชร์ผ่าน",
  shareEmail: "อีเมล",
  codeToggle: "ใช้รหัสแนะนำแทนลิงก์",
  copyCode: "คัดลอกรหัส",
  codeHint: "ให้เพื่อนกรอกรหัสนี้ตอนชำระเงิน",
  shareMessage: "รับส่วนลด {friend_reward} สำหรับออเดอร์แรกที่ GQ ผ่านลิงก์นี้: {link}",
};

export const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
  version: 1,
  enabled: false,
  share: { line: true, facebook: true, email: true },
  showCode: true,
  showPoweredBy: true,
  copy: DEFAULT_REFERRAL_COPY,
  translations: {
    en: {
      eyebrow: "Refer a friend",
      heading: "Give a discount, get a discount",
      body: "Send your link so a friend gets money off their first order. When they order, you get a discount on your next one.",
      friendLabel: "Your friend gets",
      friendNote: "on their first order",
      yourLabel: "You get",
      yourNote: "when they place an order",
      linkLabel: "Your referral link",
      copyLink: "Copy link",
      copied: "Copied",
      shareLabel: "Share via",
      shareEmail: "Email",
      codeToggle: "Use a referral code instead",
      copyCode: "Copy code",
      codeHint: "Your friend enters this code at checkout",
      shareMessage: "Get {friend_reward} off your first GQ order with my link: {link}",
    },
  },
};

const fieldMax = (key: ReferralCopyKey) =>
  REFERRAL_COPY_FIELDS.find((f) => f.key === key)?.long ? REFERRAL_LIMITS.maxLongLength : REFERRAL_LIMITS.maxShortLength;

function normalizeCopy(raw: unknown, fallback: ReferralCopy): ReferralCopy;
function normalizeCopy(raw: unknown): Partial<ReferralCopy>;
function normalizeCopy(raw: unknown, fallback?: ReferralCopy): Partial<ReferralCopy> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Partial<ReferralCopy> = {};
  for (const { key } of REFERRAL_COPY_FIELDS) {
    const v = r[key];
    if (typeof v === "string" && (fallback || v.trim())) out[key] = clampText(v, "", fieldMax(key));
    else if (fallback) out[key] = fallback[key];
  }
  return out;
}

/** Coerce anything (stored JSON, form input) into a valid config. Never throws. */
export function normalizeReferralConfig(raw: unknown): ReferralConfig {
  const d = DEFAULT_REFERRAL_CONFIG;
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<ReferralConfig>;
  const share = (r.share && typeof r.share === "object" ? r.share : {}) as Partial<Record<ReferralShareChannel, unknown>>;
  const translations: ReferralConfig["translations"] = {};
  for (const [lang, t] of Object.entries(r.translations ?? d.translations)) {
    const entry = normalizeCopy(t);
    if (isLanguageCode(lang) && Object.keys(entry).length) translations[lang.toLowerCase()] = entry;
  }
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    version: 1,
    enabled: bool(r.enabled, d.enabled),
    share: {
      line: bool(share.line, d.share.line),
      facebook: bool(share.facebook, d.share.facebook),
      email: bool(share.email, d.share.email),
    },
    showCode: bool(r.showCode, d.showCode),
    showPoweredBy: bool(r.showPoweredBy, d.showPoweredBy),
    copy: normalizeCopy(r.copy, d.copy),
    translations,
    endpoint: normalizeEndpoint(r.endpoint),
  };
}

/** The buyer's referral program, as returned by Bloop (via the app backend). */
export interface ReferralProgram {
  /** Display text of what the friend (referee) gets, e.g. "ลด 10%". */
  friendReward: string;
  /** Display text of what the buyer (referrer) gets. */
  yourReward: string;
  /** The buyer's share link (https). */
  link: string;
  /** The buyer's referral code. Blank hides the code section. */
  code: string;
}

/** `sample` = Bloop isn't connected yet; the widget shows it only in the checkout editor. */
export type ReferralSource = "bloop" | "sample";

export interface ReferralResponse {
  source: ReferralSource;
  /** `null` = no program for this buyer; the widget hides. */
  program: ReferralProgram | null;
}

/** Validate a backend response before rendering it. Never throws. */
export function normalizeReferralResponse(raw: unknown): ReferralResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { source?: unknown; program?: unknown };
  const source: ReferralSource = r.source === "bloop" ? "bloop" : "sample";
  const p = (r.program && typeof r.program === "object" ? r.program : null) as Partial<ReferralProgram> | null;
  const link = typeof p?.link === "string" && /^https:\/\/\S+$/.test(p.link.trim()) ? p.link.trim() : "";
  if (!p || !link) return { source, program: null };
  return {
    source,
    program: {
      friendReward: clampText(p.friendReward, "", REFERRAL_LIMITS.maxShortLength),
      yourReward: clampText(p.yourReward, "", REFERRAL_LIMITS.maxShortLength),
      link: link.slice(0, 500),
      code: clampText(p.code, "", REFERRAL_LIMITS.maxShortLength).trim(),
    },
  };
}

/** Copy for a language, with `{tokens}` filled from the program. */
export function resolveReferralCopy(
  config: ReferralConfig,
  language: string | undefined,
  program: ReferralProgram,
): ReferralCopy {
  const o = pickLanguage(config.translations, language) ?? {};
  const tokens: Record<string, string> = {
    friend_reward: program.friendReward,
    your_reward: program.yourReward,
    link: program.link,
    code: program.code,
  };
  const out = {} as ReferralCopy;
  for (const { key } of REFERRAL_COPY_FIELDS) {
    out[key] = (o[key] || config.copy[key]).replace(/\{(\w+)\}/g, (m, t: string) => tokens[t] ?? m);
  }
  return out;
}

/** "https://gqsize.com/r/X" → "gqsize.com/r/X" for the read-only link field. */
export const displayLink = (link: string) => link.replace(/^https?:\/\//, "").replace(/\/$/, "");

export function referralShareUrl(
  channel: ReferralShareChannel,
  program: ReferralProgram,
  copy: Pick<ReferralCopy, "shareMessage" | "heading">,
): string {
  const text = encodeURIComponent(copy.shareMessage);
  switch (channel) {
    case "line":
      return `https://line.me/R/share?text=${text}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(program.link)}`;
    case "email":
      return `mailto:?subject=${encodeURIComponent(copy.heading)}&body=${text}`;
  }
}
