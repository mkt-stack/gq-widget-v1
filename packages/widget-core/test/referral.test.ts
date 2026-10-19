import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFERRAL_CONFIG,
  displayLink,
  normalizeReferralConfig,
  normalizeReferralResponse,
  referralShareUrl,
  resolveReferralCopy,
  type ReferralProgram,
} from "../src";

const program: ReferralProgram = {
  friendReward: "ลด 10%",
  yourReward: "ลด ฿100",
  link: "https://gqsize.com/r/ABC",
  code: "ABC",
};

describe("referral config", () => {
  it("fills defaults from garbage", () => {
    expect(normalizeReferralConfig(null)).toEqual({ ...DEFAULT_REFERRAL_CONFIG, endpoint: undefined });
    expect(normalizeReferralConfig("x").copy.heading).toBe(DEFAULT_REFERRAL_CONFIG.copy.heading);
  });

  it("keeps a cleared field, drops blank translations and bad languages", () => {
    const c = normalizeReferralConfig({
      copy: { eyebrow: "" },
      translations: { en: { heading: "  " }, "not a lang": { heading: "x" }, EN: { body: "Hi" } },
      share: { line: false },
    });
    expect(c.copy.eyebrow).toBe("");
    expect(c.translations).toEqual({ en: { body: "Hi" } });
    expect(c.share).toEqual({ line: false, facebook: true, email: true });
  });

  it("resolves language overrides and tokens", () => {
    const en = resolveReferralCopy(DEFAULT_REFERRAL_CONFIG, "en-US", program);
    expect(en.copyLink).toBe("Copy link");
    expect(en.shareMessage).toBe("Get ลด 10% off your first GQ order with my link: https://gqsize.com/r/ABC");
    const th = resolveReferralCopy(DEFAULT_REFERRAL_CONFIG, "th", program);
    expect(th.copyLink).toBe("คัดลอกลิงก์");
    const custom = normalizeReferralConfig({ copy: { heading: "{your_reward} {unknown}" }, translations: {} });
    expect(resolveReferralCopy(custom, "th", program).heading).toBe("ลด ฿100 {unknown}");
  });
});

describe("referral response", () => {
  it("rejects non-https links and malformed bodies", () => {
    expect(normalizeReferralResponse(null)).toBeNull();
    expect(normalizeReferralResponse({ source: "bloop", program: { ...program, link: "javascript:alert(1)" } })).toEqual({
      source: "bloop",
      program: null,
    });
    expect(normalizeReferralResponse({ source: "weird", program })?.source).toBe("sample");
    expect(normalizeReferralResponse({ source: "bloop", program })?.program).toEqual(program);
  });

  it("builds share URLs and display links", () => {
    const copy = { shareMessage: "Hi https://gqsize.com/r/ABC", heading: "Refer" };
    expect(referralShareUrl("line", program, copy)).toBe("https://line.me/R/share?text=Hi%20https%3A%2F%2Fgqsize.com%2Fr%2FABC");
    expect(referralShareUrl("facebook", program, copy)).toBe(
      "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fgqsize.com%2Fr%2FABC",
    );
    expect(referralShareUrl("email", program, copy)).toMatch(/^mailto:\?subject=Refer&body=Hi%20/);
    expect(displayLink("https://gqsize.com/r/ABC/")).toBe("gqsize.com/r/ABC");
  });
});
