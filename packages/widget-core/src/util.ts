/** Small coercion helpers shared by the widget normalizers. */

export const MAX_MESSAGE_LENGTH = 200;

export const clampInt = (n: unknown, min: number, max: number, fallback: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(max, Math.max(min, v));
};

export const clampText = (v: unknown, fallback: string, max = MAX_MESSAGE_LENGTH) =>
  typeof v === "string" ? v.slice(0, max) : fallback;

export const isLanguageCode = (lang: string) => /^[a-z]{2}(-[a-z]{2})?$/i.test(lang);

/** `{ en: "..." }` maps: valid language keys, non-blank strings only. */
export function normalizeTextTranslations(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [lang, v] of Object.entries(raw)) {
    if (!isLanguageCode(lang) || typeof v !== "string" || !v.trim()) continue;
    out[lang.toLowerCase()] = clampText(v, "");
  }
  return out;
}

/** Look up a language ("en-US" falls back to "en"). */
export function pickLanguage<T>(map: Record<string, T>, language: string | undefined): T | undefined {
  const lang = (language ?? "").toLowerCase();
  return map[lang] ?? map[lang.split("-")[0]];
}

export const normalizeEndpoint = (v: unknown) =>
  typeof v === "string" && /^https:\/\//.test(v) ? v : undefined;
