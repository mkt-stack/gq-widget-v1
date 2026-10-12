import { describe, expect, it } from "vitest";
import {
  DEFAULT_COUNTDOWN_CONFIG,
  DEFAULT_GUARANTEE_CONFIG,
  EXAMPLE_CALLOUTS,
  calloutRequirements,
  conditionRequirements,
  normalizeCalloutConfig,
  normalizeGuaranteeConfig,
  pickCallout,
  pickCountdownVariant,
  resolveCalloutMessage,
  resolveGuaranteeText,
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
    const c = normalizeCountdownConfig({ variants: [{ durationSeconds: 5, warningThresholdSeconds: 9999 }], appearance: "x", endpoint: "http://insecure" });
    expect(c.variants[0].durationSeconds).toBe(30);
    expect(c.variants[0].warningThresholdSeconds).toBe(30);
    expect(c.variants[0].name).toBe("Countdown 1");
    expect(c.appearance).toBe("banner");
    expect(c.styles).toEqual({ running: "success", warning: "warning", expired: "neutral" });
    expect(normalizeCountdownConfig({ appearance: "compact", styles: { warning: "critical", expired: "pink" } }).styles).toEqual({
      running: "success",
      warning: "critical",
      expired: "neutral",
    });
    expect(c.endpoint).toBeUndefined();
    expect(c.enabled).toBe(false);
  });

  it("migrates a v1 single countdown into one variant", () => {
    const v1 = {
      version: 1,
      enabled: true,
      durationSeconds: 300,
      warningThresholdSeconds: 60,
      appearance: "banner",
      onExpire: "restart",
      messages: { message: "A {time}", warningMessage: "B {time}", expiredMessage: "C" },
      translations: { en: { message: "EN {time}" } },
      rules: { match: "any", conditions: [{ id: "x", type: "customer_tag", operator: "any", values: ["vip"] }] },
      endpoint: "https://app.example.com",
    };
    const c = normalizeCountdownConfig(v1);
    expect(c).toMatchObject({ version: 2, enabled: true, appearance: "banner", endpoint: "https://app.example.com" });
    expect(c.variants).toHaveLength(1);
    expect(c.variants[0]).toMatchObject({
      id: "default",
      enabled: true,
      durationSeconds: 300,
      warningThresholdSeconds: 60,
      onExpire: "restart",
      messages: v1.messages,
      translations: { en: { message: "EN {time}" } },
      conditions: v1.rules,
    });
  });

  it("keeps at most 5 ranked variants and picks the first match", () => {
    const c = normalizeCountdownConfig({
      variants: Array.from({ length: 7 }, (_, i) => ({
        id: `v${i}`,
        conditions: { match: "all", conditions: [{ id: "s", type: "subtotal", operator: "gte", number: 1000 * (5 - i) }] },
      })),
    });
    expect(c.variants).toHaveLength(5);
    expect(pickCountdownVariant(c, ctx)?.id).toBe("v4"); // subtotal 1500 ≥ 1000
    expect(pickCountdownVariant(c, { ...ctx, subtotal: 0 })).toBeNull();
  });

  it("is stable when normalized twice", () => {
    const once = normalizeCountdownConfig({ enabled: true, variants: [{ translations: { en: { message: "Hi {time}", warningMessage: "" } } }] });
    expect(normalizeCountdownConfig(once)).toEqual(once);
    expect(normalizeCountdownConfig(DEFAULT_COUNTDOWN_CONFIG)).toEqual(DEFAULT_COUNTDOWN_CONFIG);
  });

  it("resolves translations field by field with region fallback", () => {
    const [v] = normalizeCountdownConfig({ variants: [{ translations: { en: { message: "EN {time}" } } }] }).variants;
    const en = resolveCountdownMessages(v, "en-US");
    expect(en.message).toBe("EN {time}");
    expect(en.warningMessage).toBe(v.messages.warningMessage);
    expect(resolveCountdownMessages(v, "th").message).toBe(v.messages.message);
  });

  it("formats and splits time", () => {
    expect(formatRemaining(125)).toBe("02:05");
    expect(formatRemaining(3725)).toBe("1:02:05");
    expect(formatRemaining(-3)).toBe("00:00");
    expect(splitOnTime("Pay within {time} now")).toEqual({ before: "Pay within ", after: " now", hasTime: true });
    expect(splitOnTime("No token").hasTime).toBe(false);
  });
});

describe("membership callout", () => {
  const config = normalizeCalloutConfig({ enabled: true, callouts: [...EXAMPLE_CALLOUTS, EXAMPLE_CALLOUTS[0], { message: "x" }] });

  it("keeps at most 3 callouts", () => {
    expect(config.callouts).toHaveLength(3);
    expect(normalizeCalloutConfig(config)).toEqual(config);
  });

  it("targets guests, logged-in non-members and hides for members", () => {
    expect(pickCallout(config, ctx)).toBeUndefined(); // customer facts not loaded yet
    expect(pickCallout(config, { ...ctx, customer: { loggedIn: false, tags: [] } })?.id).toBe("guest");
    expect(pickCallout(config, { ...ctx, customer: { loggedIn: true, tags: [] } })?.id).toBe("non-member");
    const members = normalizeCalloutConfig({ callouts: EXAMPLE_CALLOUTS });
    expect(pickCallout(members, { ...ctx, customer: { loggedIn: true, tags: ["Member"] } })).toBeNull();
    expect(calloutRequirements(members)).toEqual({ productFacts: false, customer: true, customerTags: ["member"] });
  });

  it("resolves the message per language", () => {
    expect(resolveCalloutMessage(config.callouts[0], "en")).toBe("Get free shipping: sign up above");
    expect(resolveCalloutMessage(config.callouts[0], "th")).toBe("กดรับสิทธิ์ส่งฟรีด้านบน");
  });
});

describe("guarantee row", () => {
  it("defaults to three items and caps at three", () => {
    expect(normalizeGuaranteeConfig(undefined).items).toHaveLength(3);
    const c = normalizeGuaranteeConfig({ items: Array.from({ length: 5 }, () => ({ icon: "nope", title: "T" })) });
    expect(c.items).toHaveLength(3);
    expect(c.items[0]).toMatchObject({ icon: "check-circle", title: "T", subtitle: "" });
    expect(normalizeGuaranteeConfig(c)).toEqual(c);
  });

  it("uses an uploaded image only with a valid https URL", () => {
    const c = normalizeGuaranteeConfig({
      iconSize: "huge",
      items: [
        { media: "image", imageUrl: "https://cdn.shopify.com/s/files/a.png", icon: "lock" },
        { media: "image", imageUrl: "javascript:alert(1)", icon: "lock" },
        { media: "image", icon: "lock" },
      ],
    });
    expect(c.iconSize).toBe("medium");
    expect(c.items.map((i) => [i.media, i.imageUrl])).toEqual([
      ["image", "https://cdn.shopify.com/s/files/a.png"],
      ["icon", ""],
      ["icon", ""],
    ]);
    expect(normalizeGuaranteeConfig(c)).toEqual(c);
  });

  it("resolves text field by field", () => {
    const [item] = DEFAULT_GUARANTEE_CONFIG.items;
    expect(resolveGuaranteeText(item, "en")).toEqual({ title: "Free exchange", subtitle: "up to 30 days" });
    expect(resolveGuaranteeText({ ...item, translations: { en: { title: "Swap" } } }, "en").subtitle).toBe(item.subtitle);
  });
});
