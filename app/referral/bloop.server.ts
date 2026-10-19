import type { ReferralProgram, ReferralResponse } from "@gq/widget-core";

/**
 * Bloop referral program client.
 *
 * PLACEHOLDER: the Bloop API isn't wired up yet. Until `BLOOP_API_KEY` is set,
 * every lookup returns SAMPLE_PROGRAM with `source: "sample"`, which the
 * thank-you widget only renders in the checkout editor, never to buyers.
 *
 * TODO(bloop): once the developer docs and credentials arrive:
 *   1. Add the Railway service variables (BLOOP_API_KEY, plus BLOOP_API_URL or
 *      a shop/program id if Bloop needs them).
 *   2. Implement `fetchFromBloop`: find or create the buyer as a referrer
 *      (by customer id, or by the order's email for guests) and map the
 *      response to ReferralProgram (format both rewards as display text).
 *   3. If guests are looked up by order, verify the order belongs to this
 *      checkout (e.g. Admin API with read_orders) instead of trusting orderId.
 */

export const SAMPLE_PROGRAM: ReferralProgram = {
  friendReward: "ลด 10%",
  yourReward: "ลด 10%",
  link: "https://gqsize.com/r/BLOOP_abcd888",
  code: "BLOOP_abcd888",
};

export interface ReferralLookup {
  shop: string;
  /** Logged-in buyer, from the session token `sub`. Undefined for guests. */
  customerId?: string;
  /** Order identity GID from the thank-you page. Client-supplied: not verified yet. */
  orderId?: string;
}

export function bloopConfigured(): boolean {
  return Boolean(process.env.BLOOP_API_KEY);
}

export async function getReferralProgram(lookup: ReferralLookup): Promise<ReferralResponse> {
  if (!bloopConfigured()) return { source: "sample", program: SAMPLE_PROGRAM };
  return { source: "bloop", program: await fetchFromBloop(lookup) };
}

async function fetchFromBloop(lookup: ReferralLookup): Promise<ReferralProgram | null> {
  // TODO(bloop): call the Bloop API. Returning null hides the widget.
  void lookup;
  return null;
}
