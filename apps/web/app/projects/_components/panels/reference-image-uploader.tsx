"use client";

import { useCallback, useState } from "react";
import { IconCirclePlus, IconX } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import { env } from "@/src/env";

const OSS_BASE = env.OSS_BASE_URL;

function ossUrl(path?: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${OSS_BASE}/${path}`;
}

/**
 * Renders a row of reference-image thumbnails + an "add" tile. Adding
 * now goes through the shared AssetPickerDialog (upload tab + existing
 * workspace assets) instead of a bare `<input type="file">`, so users
 * can reuse images they've already generated/uploaded without
 * re-uploading.
 */
export function ReferenceImageUploader({
  paths,
  onChange,
  addLabel,
  maxCount = 6,
}: {
  paths: string[];
  onChange: (nextPaths: string[]) => void;
  addLabel?: string;
  maxCount?: number;
}) {
  const tc = useTranslations("common");
  const [previewUrl, setPreviewUrl] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const removeAt = useCallback(
    (index: number) => {
      onChange(paths.filter((_, itemIndex) => itemIndex !== index));
    },
    [onChange, paths]
  );

  const handleSelect = useCallback(
    (picked: string[]) => {
      const next = [...paths, ...picked].slice(0, maxCount);
      onChange(next);
      setPickerOpen(false);
    },
    [maxCount, onChange, paths]
  );

  const canAdd = paths.length < maxCount;

  return (
    <>
      <div className="flex flex-wrap gap-3 pb-2">
        {paths.map((path, index) => {
          const src = ossUrl(path);
          return (
            <div
              key={`${path}_${index}`}
              className="group relative h-[105px] w-[140px] overflow-hidden rounded-md"
            >
              <img
                src={src}
                alt=""
                className="h-full w-full cursor-zoom-in object-cover"
                onClick={() => setPreviewUrl(src)}
              />
              <button
                type="button"
                onClick={() => removeAt(index)}
                className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition-opacity hover:bg-primary group-hover:opacity-100"
              >
                <IconX className="size-3" />
              </button>
            </div>
          );
        })}

        {canAdd ? (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex h-[105px] w-[140px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-primary bg-primary/10 text-primary transition-colors hover:bg-primary/15"
          >
            <IconCirclePlus className="size-5" />
            <span className="text-xs">{addLabel || tc("addReferenceImage")}</span>
          </button>
        ) : null}
      </div>

      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        assetType="img"
        multiple
        onSelect={handleSelect}
      />

      <MediaPreviewModal
        open={Boolean(previewUrl)}
        onOpenChange={(open) => !open && setPreviewUrl("")}
        type="image"
        src={previewUrl}
        name={tc("referenceImagePreview")}
        link={previewUrl}
      />
    </>
  );
}
