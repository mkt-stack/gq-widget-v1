import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export interface SegmentOption {
  id: string;
  name: string;
}

const SEGMENTS_QUERY = `#graphql
  query Segments {
    segments(first: 250) { nodes { id name } }
  }`;

/** GET → the shop's customer segments, for the "Customer segment" condition picker. */
export const loader = async ({ request }: LoaderFunctionArgs): Promise<{ segments: SegmentOption[]; error?: string }> => {
  const { admin } = await authenticate.admin(request);
  try {
    const res = await admin.graphql(SEGMENTS_QUERY);
    const json = await res.json();
    const segments = ((json.data?.segments?.nodes ?? []) as SegmentOption[])
      .map((s) => ({ id: s.id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { segments };
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("segments lookup failed", error);
    return { segments: [], error: "Couldn't load customer segments. Reopen the app and try again." };
  }
};
