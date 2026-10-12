import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

/**
 * Upload an image to the shop's Shopify Files (Content → Files) and return
 * its cdn.shopify.com URL, which checkout extensions can load in s-image.
 * Needs the write_files scope.
 */

export const UPLOAD_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  types: ["image/png", "image/jpeg", "image/webp", "image/gif"],
};

const STAGED_UPLOAD = `#graphql
  mutation StagedUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`;

const CREATE_FILE = `#graphql
  mutation CreateFile($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus ... on MediaImage { image { url } } }
      userErrors { field message }
    }
  }`;

const FILE_STATUS = `#graphql
  query FileStatus($id: ID!) {
    node(id: $id) {
      ... on MediaImage { fileStatus image { url } }
    }
  }`;

type UserError = { field?: string[] | null; message: string };
type FileNode = { id?: string; fileStatus?: string; image?: { url: string } | null } | null;

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

const errorText = (errors: UserError[]) => errors.map((e) => e.message).join(", ");

export async function uploadImageToFiles(admin: AdminApiContext, file: File, alt = ""): Promise<UploadResult> {
  if (!UPLOAD_LIMITS.types.includes(file.type)) return { ok: false, error: "Use a PNG, JPG, WebP or GIF image." };
  if (file.size > UPLOAD_LIMITS.maxBytes) return { ok: false, error: "Images must be 2 MB or smaller." };

  // 1. Ask Shopify for a staged upload target.
  const staged = await (
    await admin.graphql(STAGED_UPLOAD, {
      variables: {
        input: [{ filename: file.name, mimeType: file.type, httpMethod: "POST", resource: "IMAGE", fileSize: String(file.size) }],
      },
    })
  ).json();
  const stagedErrors: UserError[] = staged.data?.stagedUploadsCreate?.userErrors ?? [];
  const target = staged.data?.stagedUploadsCreate?.stagedTargets?.[0] as
    | { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }
    | undefined;
  if (stagedErrors.length || !target) return { ok: false, error: errorText(stagedErrors) || "Upload could not start." };

  // 2. Upload the bytes to the staged target (fields first, file last).
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", file);
  const uploaded = await fetch(target.url, { method: "POST", body: form });
  if (!uploaded.ok) return { ok: false, error: `Upload failed (${uploaded.status}).` };

  // 3. Register it as a file.
  const created = await (
    await admin.graphql(CREATE_FILE, {
      variables: { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", alt }] },
    })
  ).json();
  const createErrors: UserError[] = created.data?.fileCreate?.userErrors ?? [];
  let node: FileNode = created.data?.fileCreate?.files?.[0] ?? null;
  if (createErrors.length || !node?.id) return { ok: false, error: errorText(createErrors) || "Could not save the file." };

  // 4. Processing is async; poll briefly until the CDN URL exists.
  const id = node.id;
  for (let attempt = 0; attempt < 15 && !node?.image?.url; attempt++) {
    if (node?.fileStatus === "FAILED") return { ok: false, error: "Shopify could not process this image." };
    await new Promise((r) => setTimeout(r, 1000));
    node = (await (await admin.graphql(FILE_STATUS, { variables: { id } })).json()).data?.node ?? null;
  }
  return node?.image?.url
    ? { ok: true, url: node.image.url }
    : { ok: false, error: "Still processing. Try again in a moment, or paste the URL from Content → Files." };
}
