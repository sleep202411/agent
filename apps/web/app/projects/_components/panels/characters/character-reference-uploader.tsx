"use client";

import { useCallback, useState } from "react";
import { IconCirclePlus, IconX } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Textarea } from "@/components/ui/textarea";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";

/**
 * Character reference images + per-image description. Picking goes
 * through the shared AssetPickerDialog (img, multiple) so users can
 * reuse existing workspace assets; new selections append to the paths
 * list with empty descriptions.
 */
export function CharacterReferenceUploader({
  paths,
  descriptions,
  onChange,
}: {
  paths: string[];
  descriptions: string[];
  onChange: (nextPaths: string[], nextDescriptions: string[]) => void;
}) {
  const t = useTranslations("character");
  const [previewUrl, setPreviewUrl] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleSelect = useCallback(
    (picked: string[]) => {
      const nextPaths = [...paths, ...picked];
      const nextDescriptions = [...descriptions, ...picked.map(() => "")];
      onChange(nextPaths, nextDescriptions);
      setPickerOpen(false);
    },
    [descriptions, onChange, paths]
  );

  const updateDescription = useCallback(
    (index: number, value: string) => {
      const nextDescriptions = [...descriptions];
      nextDescriptions[index] = value;
      onChange([...paths], nextDescriptions);
    },
    [descriptions, onChange, paths]
  );

  const removeAt = useCallback(
    (index: number) => {
      onChange(
        paths.filter((_, itemIndex) => itemIndex !== index),
        descriptions.filter((_, itemIndex) => itemIndex !== index)
      );
    },
    [descriptions, onChange, paths]
  );

  return (
    <>
      <div className="flex flex-wrap gap-3">
        {paths.map((path, index) => {
          const src = buildOssUrl(path);
          return (
            <div key={`${path}_${index}`} className="w-[140px]">
              <div className="group relative h-[105px] overflow-hidden rounded-md">
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
              <Textarea
                value={descriptions[index] ?? ""}
                onChange={(event) => updateDescription(index, event.target.value)}
                placeholder={t("referenceImageDescPlaceholder")}
                rows={2}
                className="mt-1 h-[52px] resize-none text-xs"
              />
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex h-[105px] w-[140px] items-center justify-center rounded-md border border-dashed border-primary bg-primary/10 text-primary transition-colors hover:bg-primary/15"
        >
          <IconCirclePlus className="size-5" />
        </button>
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
        name={t("characterReferencePreview")}
        link={previewUrl}
      />
    </>
  );
}
