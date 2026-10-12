import { useEffect } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { action } from "../routes/app.api.upload-image";
import { inputValue } from "./form-utils";

interface Props {
  url: string;
  alt?: string;
  onChange: (url: string) => void;
}

/**
 * Drop an image to upload it to Shopify Files, or paste an https URL
 * (e.g. copied from Content → Files). Shows the current image.
 */
export function ImageUpload({ url, alt = "", onChange }: Props) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const uploading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) onChange(fetcher.data.url);
    else shopify.toast.show(fetcher.data.error, { isError: true });
    // onChange is a fresh closure each render; only react to new results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state, shopify]);

  const upload = (e: Event) => {
    const file = (e.currentTarget as unknown as { files?: File[] }).files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("alt", alt);
    fetcher.submit(form, { method: "POST", action: "/app/api/upload-image", encType: "multipart/form-data" });
  };

  return (
    <s-stack gap="small-200">
      <s-grid gridTemplateColumns={url ? "auto 1fr" : "1fr"} gap="base" alignItems="center">
        {url && <s-thumbnail src={url} alt={alt} size="small" />}
        <s-drop-zone
          label={uploading ? "Uploading…" : url ? "Replace image" : "Upload image"}
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={uploading}
          onInput={upload}
          onDropRejected={() => shopify.toast.show("Use a PNG, JPG, WebP or GIF image.", { isError: true })}
        />
      </s-grid>
      <s-text-field
        label="Image URL"
        details="Square PNG with a transparent background works best (2 MB max). Or paste a link from Content → Files."
        placeholder="https://cdn.shopify.com/…"
        value={url}
        onChange={(e) => onChange(inputValue(e).trim())}
      />
    </s-stack>
  );
}
