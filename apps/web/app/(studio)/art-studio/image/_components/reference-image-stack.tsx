"use client";

/**
 * ReferenceImageStack — reference-image picker for the image-lab
 * compose bar. Thin adapter over the storyboard's `ReferenceGroup`
 * so the visual language (slight per-card rotation, inline `+` tile,
 * hover-to-remove ×) matches the rest of the studio. The only thing
 * this layer adds is the file-picker → `uploadBanner` flow that
 * turns local files into public banner-bucket URLs the model can
 * fetch — `ReferenceGroup` itself takes URLs already.
 *
 * `value` is a list of public URLs; uploads are appended on the
 * right, removals splice in place. gpt-image-2 caps reference inputs
 * at 16 so the cap is a hard ceiling, not a soft warning.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { env } from "@/src/env";
import { uploadBanner } from "@/src/services/user";
import {
  ReferenceGroup,
  type ReferenceItem,
} from "../../projects/_components/storyboard/ai-generator/reference-group";

const MAX_IMAGES_DEFAULT = 16;

export interface ReferenceImageStackProps {
  value: string[];
  onChange: (next: string[]) => void;
  maxImages?: number;
  disabled?: boolean;
  t: (key: string, fallback?: string) => string;
}

function toPublicUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const base = env.BANNER_BASE_URL.replace(/\/+$/, "");
  const key = path.replace(/^\/+/, "");
  return `${base}/${key}`;
}

export function ReferenceImageStack({
  value,
  onChange,
  maxImages = MAX_IMAGES_DEFAULT,
  disabled,
  t,
}: ReferenceImageStackProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const openFilePicker = () => {
    if (disabled || uploading || value.length >= maxImages) return;
    fileInputRef.current?.click();
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = Math.max(0, maxImages - value.length);
    const toUpload = Array.from(files).slice(0, remaining);
    if (toUpload.length === 0) {
      toast.warning(
        t("imageLab.compose.referenceMaxReached", "Maximum {n} reference images reached").replace(
          "{n}",
          String(maxImages)
        )
      );
      return;
    }
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of toUpload) {
        if (!file.type.startsWith("image/")) {
          toast.error(t("imageLab.compose.referenceImageOnly", "Reference must be an image file"));
          continue;
        }
        try {
          const path = await uploadBanner(file);
          if (typeof path === "string" && path.length > 0) {
            urls.push(toPublicUrl(path));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          toast.error(msg || t("imageLab.compose.referenceUploadFailed", "Upload failed"));
        }
      }
      if (urls.length > 0) onChange([...value, ...urls]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAt = (idx: number) => {
    const next = value.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  // `ReferenceGroup` takes `{path, url, label}` items. We only deal
  // in public URLs here, so `path === url` and the underlying
  // <img src> resolution is a no-op.
  const items: ReferenceItem[] = value.map((url) => ({ url, path: url }));

  return (
    <>
      <ReferenceGroup
        label={t("imageLab.compose.addReferences", "Reference")}
        items={items}
        maxCount={maxImages}
        onAdd={openFilePicker}
        onRemove={removeAt}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        disabled={disabled || uploading}
        onChange={(e) => {
          void handleFiles(e.target.files);
        }}
      />
    </>
  );
}
