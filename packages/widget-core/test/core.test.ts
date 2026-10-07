import { describe, expect, it } from "vitest";
import {
  conditionRequirements,
  evaluateRules,
  formatRemaining,
  normalizeCountdownConfig,
  normalizeRules,
  resolveCountdownMessages,
  splitOnTime,
  type ConditionContext,
  type DisplayRules,
} from "../src";

const P1 = "gid://shopify/Product/1";
const P2 = "gid://shopify/Product/2";

const ctx: ConditionContext = {
  lines: [
    { productId: P1, variantId: "v1", quantity: 2 },
    { productId: P2, variantId: "v2", quantity: 1 },
  ],
  subtotal: 1500,
};

const rules = (match: "all" | "any", ...conditions: DisplayRules["conditions"]): DisplayRules => ({
  match,
  conditions,
});

describe("evaluateRules", () => {
  it("shows when there are no conditions", () => {
    expect(evaluateRules(rules("all"), ctx)).toBe(true);
  });

  it("matches products with any / none", () => {
    expect(evaluateRules(rules("all", { id: "a", type: "product", operator: "any", values: [P1] }), ctx)).toBe(true);
    expect(evaluateRules(rules("all", { id: "a", type: "product", operator: "none", values: [P1] }), ctx)).toBe(false);
    expect(evaluateRules(rules("all", { id: "a", type: "product", operator: "any", values: ["gid://shopify/Product/9"] }), ctx)).toBe(false);
  });

  it("compares subtotal and item count", () => {
    expect(evaluateRules(rules("all", { id: "a", type: "subtotal", operator: "gte", values: [], number: 1000 }), ctx)).toBe(true);
    expect(evaluateRules(rules("all", { id: "a", type: "item_count", operator: "lte", values: [], number: 2 }), ctx)).toBe(false);
  });

  it("is undecided until product facts load, then matches tags case-insensitively", () => {
    const r = rules("all", { id: "a", type: "product_tag", operator: "any", values: ["ProMed"] });
    expect(evaluateRules(r, ctx)).toBeUndefined();
    const loaded = { ...ctx, products: { [P1]: { tags: ["promed"], collectionIds: [] } } };
    expect(evaluateRules(r, loaded)).toBe(true);
  });

  it("short-circuits: 'any' passes on a cheap match while customer facts are pending", () => {
    const r = rules(
      "any",
      { id: "a", type: "customer_tag", operator: "any", values: ["vip"] },
      { id: "b", type: "subtotal", operator: "gte", values: [], number: 100 },
    );
    expect(evaluateRules(r, ctx)).toBe(true);
  });

  it("short-circuits: 'all' fails on a cheap miss while customer facts are pending", () => {
    const r = rules(
      "all",
      { id: "a", type: "customer_tag", operator: "any", values: ["vip"] },
      { id: "b", type: "subtotal", operator: "gte", values: [], number: 99999 },
    );
    expect(evaluateRules(r, ctx)).toBe(false);
  });

  it("evaluates customer tags and status", () => {
    const vip = { ...ctx, customer: { loggedIn: true, tags: ["vip"] } };
    const guest = { ...ctx, customer: { loggedIn: false, tags: [] } };
    const tagRule = rules("all", { id: "a", type: "customer_tag", operator: "any", values: ["VIP"] });
    expect(evaluateRules(tagRule, vip)).toBe(true);
    expect(evaluateRules(tagRule, guest)).toBe(false);
    const guestRule = rules("all", { id: "a", type: "customer_status", operator: "guest", values: [] });
    expect(evaluateRules(guestRule, guest)).toBe(true);
    expect(evaluateRules(guestRule, vip)).toBe(false);
  });
});

describe("conditionRequirements", () => {
  it("only asks for the expensive facts the rules need", () => {
    expect(conditionRequirements(rules("all", { id: "a", type: "subtotal", operator: "gte", values: [], number: 1 }))).toEqual({
      productFacts: false,
      customer: false,
      customerTags: [],
    });
    const r = conditionRequirements(
      rules(
        "all",
        { id: "a", type: "collection", operator: "any", values: ["gid://shopify/Collection/1"] },
        { id: "b", type: "customer_tag", operator: "any", values: ["VIP", "vip", "Staff"] },
      ),
    );
    expect(r).toEqual({ productFacts: true, customer: true, customerTags: ["vip", "staff"] });
  });
});

describe("normalizeRules", () => {
  it("drops unknown types and list rules with no values, fixes bad operators", () => {
    const r = normalizeRules({
      match: "weird",
      conditions: [
        { id: "a", type: "nope", operator: "any", values: ["x"] },
        { id: "b", type: "product_tag", operator: "any", values: [] },
        { id: "c", type: "subtotal", operator: "bogus", number: -5 },
        { id: "d", type: "customer_tag", operator: "none", values: [" vip ", "vip", 3] },
      ],
    });
    expect(r.match).toBe("all");
    expect(r.conditions).toEqual([
      { id: "c", type: "subtotal", operator: "gte", values: [], number: 0 },
      { id: "d", type: "customer_tag", operator: "none", values: ["vip"] },
    ]);
  });
});

describe("countdown config", () => {
  it("falls back to defaults and clamps values", () => {
    const c = normalizeCountdownConfig({ durationSeconds: 5, warningThresholdSeconds: 9999, appearance: "x", endpoint: "http://insecure" });
    expect(c.durationSeconds).toBe(30);
    expect(c.warningThresholdSeconds).toBe(30);
    expect(c.appearance).toBe("compact");
    expect(c.endpoint).toBeUndefined();
    expect(c.enabled).toBe(false);
  });

  it("is stable when normalized twice", () => {
    const once = normalizeCountdownConfig({ enabled: true, translations: { en: { message: "Hi {time}", warningMessage: "" } } });
    expect(normalizeCountdownConfig(once)).toEqual(once);
  });

  it("resolves translations field by field with region fallback", () => {
    const c = normalizeCountdownConfig({ translations: { en: { message: "EN {time}" } } });
    const en = resolveCountdownMessages(c, "en-US");
    expect(en.message).toBe("EN {time}");
    expect(en.warningMessage).toBe(c.messages.warningMessage);
    expect(resolveCountdownMessages(c, "th").message).toBe(c.messages.message);
  });

  it("formats and splits time", () => {
    expect(formatRemaining(125)).toBe("02:05");
    expect(formatRemaining(3725)).toBe("1:02:05");
    expect(formatRemaining(-3)).toBe("00:00");
    expect(splitOnTime("Pay within {time} now")).toEqual({ before: "Pay within ", after: " now", hasTime: true });
    expect(splitOnTime("No token").hasTime).toBe(false);
  });
});
