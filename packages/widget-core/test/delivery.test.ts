import { describe, expect, it } from "vitest";
import {
  DEFAULT_DELIVERY_SCHEDULE,
  EXAMPLE_DELIVERY_RULES,
  deliveryRequirements,
  estimateDeliveryRange,
  evaluateRules,
  formatDeliveryRange,
  normalizeDeliveryConfig,
  pickDeliveryWindow,
  resolveDeliveryMessage,
  type ConditionContext,
  type DeliveryRange,
} from "../src";

const iso = (r: DeliveryRange) => [r.start.toISOString().slice(0, 10), r.end.toISOString().slice(0, 10)];
// 2026-10-12 is a Monday. Bangkok is UTC+7.
const bkk = (local: string) => new Date(`${local}+07:00`);

describe("estimateDeliveryRange", () => {
  const schedule = DEFAULT_DELIVERY_SCHEDULE; // Mon–Fri, cutoff 14:00 Bangkok

  it("counts working days from today before the cutoff", () => {
    expect(iso(estimateDeliveryRange({ minDays: 2, maxDays: 3 }, schedule, bkk("2026-10-12T10:00:00")))).toEqual([
      "2026-10-14",
      "2026-10-15",
    ]);
  });

  it("starts from the next working day after the cutoff", () => {
    expect(iso(estimateDeliveryRange({ minDays: 2, maxDays: 3 }, schedule, bkk("2026-10-12T14:00:00")))).toEqual([
      "2026-10-15",
      "2026-10-16",
    ]);
  });

  it("uses the shop time zone, not UTC (Mon 01:00 Bangkok is still Sun in UTC)", () => {
    expect(iso(estimateDeliveryRange({ minDays: 1, maxDays: 1 }, schedule, bkk("2026-10-12T01:00:00")))).toEqual([
      "2026-10-13",
      "2026-10-13",
    ]);
  });

  it("skips weekends and holidays", () => {
    // Fri after cutoff → processed Mon; Tue is a holiday.
    const s = { ...schedule, holidays: ["2026-10-13"] };
    expect(iso(estimateDeliveryRange({ minDays: 1, maxDays: 3 }, s, bkk("2026-10-09T16:00:00")))).toEqual([
      "2026-10-14",
      "2026-10-16",
    ]);
  });

  it("supports Saturday delivery and no cutoff", () => {
    const s = { ...schedule, workingDays: [1, 2, 3, 4, 5, 6], cutoffHour: 24 };
    expect(iso(estimateDeliveryRange({ minDays: 0, maxDays: 1 }, s, bkk("2026-10-16T23:00:00")))).toEqual([
      "2026-10-16",
      "2026-10-17",
    ]);
  });
});

describe("formatDeliveryRange", () => {
  const range = (a: string, b: string): DeliveryRange => ({ start: new Date(`${a}T00:00:00Z`), end: new Date(`${b}T00:00:00Z`) });

  it("formats English with ordinals and one month", () => {
    expect(formatDeliveryRange(range("2026-10-01", "2026-10-02"), "en")).toBe("Thu 1st - Fri 2nd Oct");
    expect(formatDeliveryRange(range("2026-10-22", "2026-10-23"), "en-US")).toBe("Thu 22nd - Fri 23rd Oct");
    expect(formatDeliveryRange(range("2026-10-12", "2026-10-13"), "en")).toBe("Mon 12th - Tue 13th Oct");
  });

  it("shows both months across a month boundary and a single date when equal", () => {
    expect(formatDeliveryRange(range("2026-09-30", "2026-10-02"), "en")).toBe("Wed 30th Sep - Fri 2nd Oct");
    expect(formatDeliveryRange(range("2026-10-02", "2026-10-02"), "en")).toBe("Fri 2nd Oct");
  });

  it("formats Thai without ordinals", () => {
    // Short Thai weekday names vary by ICU build ("พฤ." vs "พฤหัส"), so check the shape.
    expect(formatDeliveryRange(range("2026-10-01", "2026-10-02"), "th")).toMatch(/^พฤ\S* 1 - ศ\S* 2 ต\.ค\.$/);
  });
});

describe("delivery rules", () => {
  const P1 = "gid://shopify/Product/1";
  const base: ConditionContext = { lines: [{ productId: P1, variantId: "v", quantity: 1 }], subtotal: 500, shippingMethods: [] };
  const config = normalizeDeliveryConfig({
    enabled: true,
    rules: EXAMPLE_DELIVERY_RULES.map((r) => ({ ...r, enabled: true })),
  });

  it("normalizes to at most 5 rules and keeps min ≤ max", () => {
    const c = normalizeDeliveryConfig({ rules: Array.from({ length: 8 }, () => ({ minDays: 9, maxDays: 2 })) });
    expect(c.rules).toHaveLength(5);
    expect(c.rules[0]).toMatchObject({ minDays: 9, maxDays: 9, name: "Rule 1", enabled: true });
    expect(normalizeDeliveryConfig(c)).toEqual(c);
  });

  it("defaults colour to auto and keeps valid rule overrides", () => {
    const c = normalizeDeliveryConfig({ tone: "pink", rules: [{ tone: "success" }, { tone: "bad" }] });
    expect(c.tone).toBe("auto");
    expect(c.rules.map((r) => r.tone)).toEqual(["success", ""]);
    expect(normalizeDeliveryConfig({ tone: "neutral" }).tone).toBe("neutral");
  });

  it("drops invalid schedule values", () => {
    const c = normalizeDeliveryConfig({ schedule: { timeZone: "Mars/Base", workingDays: [], holidays: ["2026-02-30", "2026-12-31"], cutoffHour: 99 } });
    expect(c.schedule).toEqual({ timeZone: "Asia/Bangkok", cutoffHour: 24, workingDays: [1, 2, 3, 4, 5], holidays: ["2026-12-31"] });
  });

  it("waits for a higher-ranked rule before using a lower one", () => {
    // VIP rule needs customer facts; nothing loaded yet → undecided.
    expect(pickDeliveryWindow(config, base)).toBeUndefined();
  });

  it("first matching rule wins", () => {
    const vipShipping = { ...base, shippingMethods: ["VIP Fast Shipping"], customer: { loggedIn: true, tags: [] } };
    expect(pickDeliveryWindow(config, vipShipping)?.rule?.id).toBe("vip");

    const embroidery = { ...base, customer: { loggedIn: true, tags: [] }, products: { [P1]: { tags: ["Embroidery"], collectionIds: [] } } };
    expect(pickDeliveryWindow(config, embroidery)?.rule?.id).toBe("embroidery");

    const plain = { ...base, customer: { loggedIn: false, tags: [] }, products: {} };
    expect(pickDeliveryWindow(config, plain)).toEqual({ window: config.fallback, rule: null });
    expect(pickDeliveryWindow({ ...config, fallback: { ...config.fallback, enabled: false } }, plain)).toBeNull();
  });

  it("only asks for facts that enabled rules need", () => {
    expect(deliveryRequirements(config)).toEqual({ productFacts: true, customer: true, customerTags: ["vip"], customerSegments: [] });
    expect(deliveryRequirements({ ...config, rules: [] })).toEqual({ productFacts: false, customer: false, customerTags: [], customerSegments: [] });
  });

  it("resolves messages: rule language → widget language → rule default → widget default", () => {
    const [vip, emb] = config.rules;
    expect(resolveDeliveryMessage(config, emb, "en")).toBe("Embroidered items arrive {date}");
    expect(resolveDeliveryMessage(config, emb, "th")).toBe("สินค้าปักชื่อ คาดว่าจะได้รับ {date}");
    expect(resolveDeliveryMessage(config, vip, "en-GB")).toBe("Estimated delivery {date}");
    expect(resolveDeliveryMessage(config, null, "th")).toBe(config.message);
  });
});

describe("shipping_method condition", () => {
  const rule = { match: "all" as const, conditions: [{ id: "a", type: "shipping_method" as const, operator: "any" as const, values: ["vip"] }] };
  it("matches on a case-insensitive substring of the selected option title", () => {
    expect(evaluateRules(rule, { lines: [], subtotal: 0 })).toBeUndefined();
    expect(evaluateRules(rule, { lines: [], subtotal: 0, shippingMethods: ["VIP Fast Shipping (1-2 days)"] })).toBe(true);
    expect(evaluateRules(rule, { lines: [], subtotal: 0, shippingMethods: ["Standard"] })).toBe(false);
  });
});
