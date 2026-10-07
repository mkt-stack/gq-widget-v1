import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";

/**
 * POST /api/storefront/customer-facts   { tags: string[] }
 *   → { loggedIn: boolean, tags: string[] }
 *
 * Called by checkout extensions to evaluate customer-tag / customer-status
 * display rules. The customer is identified only by the `sub` claim of the
 * Shopify-signed session token (never by request input), and the response
 * only echoes back which of the *requested* tags the customer has, so
 * internal tags never leak to the browser.
 */

const MAX_TAGS = 50;

const CUSTOMER_TAGS_QUERY = `#graphql
  query CustomerTags($id: ID!) {
    customer(id: $id) { tags }
  }`;

async function handle(request: Request) {
  // Also answers the CORS preflight (OPTIONS) by throwing a response.
  const { sessionToken, cors } = await authenticate.public.checkout(request);

  const customerId = sessionToken.sub;
  if (!customerId?.startsWith("gid://shopify/Customer/")) {
    return cors(Response.json({ loggedIn: false, tags: [] }));
  }

  let requested: string[] = [];
  if (request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { tags?: unknown };
    if (Array.isArray(body.tags)) {
      requested = body.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, MAX_TAGS);
    }
  }
  if (requested.length === 0) {
    return cors(Response.json({ loggedIn: true, tags: [] }));
  }

  const shop = new URL(sessionToken.dest).hostname;
  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(CUSTOMER_TAGS_QUERY, { variables: { id: customerId } });
    const json = await res.json();
    const have = new Set<string>(
      ((json.data?.customer?.tags ?? []) as string[]).map((t) => t.toLowerCase()),
    );
    return cors(Response.json({ loggedIn: true, tags: requested.filter((t) => have.has(t)) }));
  } catch (error) {
    console.error("customer-facts lookup failed", { shop, error });
    return cors(Response.json({ error: "lookup_failed" }, { status: 502 }));
  }
}

export const loader = ({ request }: LoaderFunctionArgs) => handle(request);
export const action = ({ request }: ActionFunctionArgs) => handle(request);
