import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getReferralProgram } from "../referral/bloop.server";

/**
 * POST /api/storefront/referral   { orderId?: string }
 *   → { source: "bloop" | "sample", program: ReferralProgram | null }
 *
 * Called by the thank-you referral widget. The customer is identified only by
 * the `sub` claim of the Shopify-signed session token; Bloop is called from
 * here so its credentials never reach the browser.
 */

const ORDER_GID = /^gid:\/\/shopify\/(OrderIdentity|Order)\/\d+$/;

/** Checkout tokens carry `dest` as a bare shop domain; other surfaces send a URL. */
const shopDomain = (dest: string) => dest.replace(/^https?:\/\//, "").split("/")[0];

async function handle(request: Request) {
  // Also answers the CORS preflight (OPTIONS) by throwing a response.
  const { sessionToken, cors } = await authenticate.public.checkout(request);

  const sub = sessionToken.sub;
  const customerId = sub?.startsWith("gid://shopify/Customer/") ? sub : undefined;
  let orderId: string | undefined;
  if (request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { orderId?: unknown };
    if (typeof body.orderId === "string" && ORDER_GID.test(body.orderId)) orderId = body.orderId;
  }

  const shop = shopDomain(sessionToken.dest);
  try {
    return cors(Response.json(await getReferralProgram({ shop, customerId, orderId })));
  } catch (error) {
    console.error("referral lookup failed", { shop, error });
    return cors(Response.json({ error: "lookup_failed" }, { status: 502 }));
  }
}

export const loader = ({ request }: LoaderFunctionArgs) => handle(request);
export const action = ({ request }: ActionFunctionArgs) => handle(request);
