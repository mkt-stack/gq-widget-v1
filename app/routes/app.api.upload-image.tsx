import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { uploadImageToFiles, type UploadResult } from "../widgets/files.server";

/** POST multipart `file` (+ optional `alt`) → Shopify Files CDN URL. Used by ImageUpload. */
export const action = async ({ request }: ActionFunctionArgs): Promise<UploadResult> => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file received." };
  const alt = String(form.get("alt") ?? "").slice(0, 120);
  try {
    return await uploadImageToFiles(admin, file, alt);
  } catch (error) {
    // Most likely the store hasn't approved the write_files scope yet.
    if (error instanceof Response) throw error;
    return { ok: false, error: "Upload failed. If this keeps happening, reopen the app to approve file access." };
  }
};
