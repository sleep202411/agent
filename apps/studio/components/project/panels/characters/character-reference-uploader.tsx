"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconCirclePlus, IconLoader2, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { uploadProjectImage } from "@/src/lib/uploads/workspace-upload";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";

export function CharacterReferenceUploader({
  paths,
  descriptions,
  onChange,
}: {
  paths: string[];
  descriptions: string[];
  onChange: (nextPaths: string[], nextDescriptions: string[]) => void;
}) {
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
        toast.warning("请选择图片文件");
        return;
      }
      const blobUrl = URL.createObjectURL(file);
      setLocalPreviewUrl(blobUrl);
      setUploading(true);
      try {
        const uploadedPath = await uploadProjectImage(file);
        onChange([...paths, uploadedPath], [...descriptions, ""]);
        toast.success("上传成功");
      } catch (error) {
        console.error("[CharacterReferenceUploader] 上传失败:", error);
        toast.error("上传失败");
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
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleAdd(event.target.files?.[0] ?? undefined)}
      />

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
                placeholder="参考图描述"
                rows={2}
                className="mt-1 h-[52px] resize-none text-xs"
              />
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

        {!uploading ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-[105px] w-[140px] items-center justify-center rounded-md border border-dashed border-primary bg-primary/10 text-primary transition-colors hover:bg-primary/15"
          >
            <IconCirclePlus className="size-5" />
          </button>
        ) : null}
      </div>

      <MediaPreviewModal
        open={Boolean(previewUrl)}
        onOpenChange={(open) => !open && setPreviewUrl("")}
        type="image"
        src={previewUrl}
        name="角色参考图预览"
        link={previewUrl}
      />
    </>
  );
}
