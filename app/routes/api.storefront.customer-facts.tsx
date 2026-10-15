import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";

/**
 * POST /api/storefront/customer-facts   { tags: string[], segments: string[] }
 *   → { loggedIn: boolean, tags: string[], segments: string[] }
 *
 * Called by checkout extensions to evaluate customer-tag / customer-segment /
 * customer-status display rules. The customer is identified only by the `sub`
 * claim of the Shopify-signed session token (never by request input), and the
 * response only echoes back which of the *requested* tags and segments apply
 * to the customer, so internal tags and segment names never leak to the browser.
 */

const MAX_TAGS = 50;
const MAX_SEGMENTS = 50;
const SEGMENT_GID = /^gid:\/\/shopify\/Segment\/\d+$/;

const CUSTOMER_FACTS_QUERY = `#graphql
  query CustomerFacts($id: ID!, $segmentIds: [ID!]!, $withSegments: Boolean!) {
    customer(id: $id) { tags }
    customerSegmentMembership(customerId: $id, segmentIds: $segmentIds) @include(if: $withSegments) {
      memberships { segmentId isMember }
    }
  }`;

/** Checkout tokens carry `dest` as a bare shop domain; other surfaces send a URL. */
const shopDomain = (dest: string) => dest.replace(/^https?:\/\//, "").split("/")[0];

const stringList = (raw: unknown, max: number) =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).slice(0, max) : [];

async function handle(request: Request) {
  // Also answers the CORS preflight (OPTIONS) by throwing a response.
  const { sessionToken, cors } = await authenticate.public.checkout(request);

  const customerId = sessionToken.sub;
  if (!customerId?.startsWith("gid://shopify/Customer/")) {
    return cors(Response.json({ loggedIn: false, tags: [], segments: [] }));
  }

  let tags: string[] = [];
  let segments: string[] = [];
  if (request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { tags?: unknown; segments?: unknown };
    tags = stringList(body.tags, MAX_TAGS).map((t) => t.toLowerCase());
    segments = stringList(body.segments, MAX_SEGMENTS).filter((s) => SEGMENT_GID.test(s));
  }
  if (tags.length === 0 && segments.length === 0) {
    return cors(Response.json({ loggedIn: true, tags: [], segments: [] }));
  }

  const shop = shopDomain(sessionToken.dest);
  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(CUSTOMER_FACTS_QUERY, {
      variables: { id: customerId, segmentIds: segments, withSegments: segments.length > 0 },
    });
    const json = await res.json();
    const have = new Set<string>(((json.data?.customer?.tags ?? []) as string[]).map((t) => t.toLowerCase()));
    const memberships = (json.data?.customerSegmentMembership?.memberships ?? []) as Array<{
      segmentId: string;
      isMember: boolean;
    }>;
    const inSegments = new Set(memberships.filter((m) => m.isMember).map((m) => m.segmentId));
    return cors(
      Response.json({
        loggedIn: true,
        tags: tags.filter((t) => have.has(t)),
        segments: segments.filter((s) => inSegments.has(s)),
      }),
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("customer-facts lookup failed", { shop, error });
    return cors(Response.json({ error: "lookup_failed" }, { status: 502 }));
  }
}

export const loader = ({ request }: LoaderFunctionArgs) => handle(request);
export const action = ({ request }: ActionFunctionArgs) => handle(request);
