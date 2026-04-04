"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconCirclePlus, IconLoader2, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";

const OSS_BASE = process.env.NEXT_PUBLIC_OSS_BASE_URL ?? "";

function ossUrl(path?: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${OSS_BASE}/${path}`;
}

export function ReferenceImageUploader({
  paths,
  onChange,
  addLabel = "添加参考图",
  maxCount = 6,
}: {
  paths: string[];
  onChange: (nextPaths: string[]) => void;
  addLabel?: string;
  maxCount?: number;
}) {
  const tc = useTranslations("common");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");

  useEffect(() => {
    return () => {
      if (localPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    };
  }, [localPreviewUrl]);

  const handleAdd = useCallback(
    async (file?: File) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.warning(tc("selectImageFile"));
        return;
      }
      if (paths.length >= maxCount) {
        toast.warning(tc("maxReferenceImages", { max: maxCount }));
        return;
      }
      const blobUrl = URL.createObjectURL(file);
      setLocalPreviewUrl(blobUrl);
      setUploading(true);
      try {
        const uploaded = await uploadWorkspaceFile(file, {
          uploadType: "PROJECT",
          sourceType: "LOCAL",
        });
        const uploadedPath = uploaded.path;
        onChange([...paths, uploadedPath].slice(0, maxCount));
        toast.success(tc("uploadSuccess"));
      } catch (error) {
        console.error("[ReferenceImageUploader] 上传失败:", error);
        toast.error(tc("uploadFailed"));
      } finally {
        setUploading(false);
        if (blobUrl.startsWith("blob:")) {
          URL.revokeObjectURL(blobUrl);
        }
        setLocalPreviewUrl("");
        if (inputRef.current) {
          inputRef.current.value = "";
        }
      }
    },
    [maxCount, onChange, paths]
  );

  const removeAt = useCallback(
    (index: number) => {
      onChange(paths.filter((_, itemIndex) => itemIndex !== index));
    },
    [onChange, paths]
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleAdd(event.target.files?.[0] ?? undefined)}
      />

      <div className="flex flex-wrap gap-3">
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

        {uploading && localPreviewUrl ? (
          <div className="relative h-[105px] w-[140px] overflow-hidden rounded-md">
            <img src={localPreviewUrl} alt="" className="h-full w-full object-cover opacity-60" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/45">
              <IconLoader2 className="size-5 animate-spin text-white" />
            </div>
          </div>
        ) : null}

        {!uploading && paths.length < maxCount ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-[105px] w-[140px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-primary bg-primary/10 text-primary transition-colors hover:bg-primary/15"
          >
            <IconCirclePlus className="size-5" />
            <span className="text-xs">{addLabel}</span>
          </button>
        ) : null}
      </div>

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
