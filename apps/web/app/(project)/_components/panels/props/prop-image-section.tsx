"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  IconDots,
  IconLoader2,
  IconMaximize,
  IconReplace,
  IconRotate360,
  IconTrash,
  IconUpload,
  IconWand,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { backendApi } from "@/src/lib/api";
import { uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import { AssetAiRecordDialog } from "../asset-ai-record-dialog";
import { env } from "@/src/env";

const OSS_BASE = env.OSS_BASE_URL;
const MAX_IMAGES = 6;

function ossUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${OSS_BASE}/${path}`;
}

export function PropImageSection({
  propId,
  images,
  prompt,
  threeViewImagePath,
  referenceImagePaths,
  onImagesChange,
  onThreeViewChange,
}: {
  propId?: string;
  images: string[];
  prompt: string;
  threeViewImagePath: string;
  referenceImagePaths: string[];
  onImagesChange: (nextImages: string[]) => void;
  onThreeViewChange: (nextPath: string) => void;
}) {
  const t = useTranslations("prop");
  const tc = useTranslations("common");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(-1);
  const [previewUrl, setPreviewUrl] = useState("");
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const [aiRecordOpen, setAiRecordOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [generatingThreeView, setGeneratingThreeView] = useState(false);
  const [menuOpenIndex, setMenuOpenIndex] = useState(-1);

  const threeViewUrl = ossUrl(threeViewImagePath);
  const referenceImageUrl = ossUrl(referenceImagePaths[0] ?? "") || ossUrl(images[0]);

  useEffect(() => {
    return () => {
      if (localPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    };
  }, [localPreviewUrl]);

  const openUpload = useCallback((nextReplaceIndex: number | null = null) => {
    setReplaceIndex(nextReplaceIndex);
    inputRef.current?.click();
  }, []);

  const handleUpload = useCallback(
    async (file?: File) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.warning(tc("selectImageFile"));
        return;
      }
      if (replaceIndex === null && images.length >= MAX_IMAGES) {
        toast.warning(t("maxPropImages", { max: MAX_IMAGES }));
        return;
      }

      const blobUrl = URL.createObjectURL(file);
      setLocalPreviewUrl(blobUrl);
      if (replaceIndex === null) {
        setUploading(true);
      } else {
        setLoadingIndex(replaceIndex);
      }

      try {
        const uploaded = await uploadWorkspaceFile(file, {
          uploadType: "PROJECT",
          sourceType: "LOCAL",
        });
        const uploadedPath = uploaded.path;
        if (replaceIndex === null) {
          onImagesChange([...images, uploadedPath].slice(0, MAX_IMAGES));
        } else {
          const nextImages = [...images];
          nextImages[replaceIndex] = uploadedPath;
          onImagesChange(nextImages);
        }
        toast.success(tc("uploadSuccess"));
      } catch (error) {
        console.error("[PropImageSection] 上传失败:", error);
        toast.error(tc("uploadFailed"));
      } finally {
        setUploading(false);
        setLoadingIndex(-1);
        setReplaceIndex(null);
        if (blobUrl.startsWith("blob:")) {
          URL.revokeObjectURL(blobUrl);
        }
        setLocalPreviewUrl("");
        if (inputRef.current) {
          inputRef.current.value = "";
        }
      }
    },
    [images, onImagesChange, replaceIndex]
  );

  const handleDelete = useCallback(
    (index: number) => {
      onImagesChange(images.filter((_, i) => i !== index));
    },
    [images, onImagesChange]
  );

  const handleRegenerate = useCallback(
    async (index: number) => {
      if (!prompt.trim()) {
        toast.warning(t("fillDescriptionFirst"));
        return;
      }
      setLoadingIndex(index);
      try {
        const result = await backendApi.post<string>("/api/ai/image/generate/basic", {
          data: {
            prompt,
            shotId: propId,
            shotColumnId: -2,
            referenceImageUrl: ossUrl(images[index]),
          },
          timeout: 360_000,
        });
        const nextPath =
          typeof result === "string" && result.startsWith(`${OSS_BASE}/`)
            ? result.replace(`${OSS_BASE}/`, "")
            : String(result ?? "");
        if (!nextPath) {
          throw new Error(tc("noValidImage"));
        }
        const nextImages = [...images];
        nextImages[index] = nextPath;
        onImagesChange(nextImages);
        toast.success(t("regeneratedImage"));
      } catch (error) {
        console.error("[PropImageSection] AI 重新生成失败:", error);
        toast.error(t("aiRegenerateFailed"));
      } finally {
        setLoadingIndex(-1);
      }
    },
    [images, onImagesChange, prompt, propId]
  );

  const handleGenerateThreeView = useCallback(async () => {
    if (!images.length) {
      toast.warning(t("addImageFirst"));
      return;
    }
    setGeneratingThreeView(true);
    try {
      const result = await backendApi.post<string>("/api/ai/image/generate/character-three-view", {
        data: {
          shotColumnId: -21,
          shotId: propId || undefined,
          characterImageUrl: ossUrl(images[0]),
          prompt,
        },
        timeout: 360_000,
      });
      const nextPath =
        typeof result === "string" && result.startsWith(`${OSS_BASE}/`)
          ? result.replace(`${OSS_BASE}/`, "")
          : String(result ?? "");
      if (!nextPath) {
        throw new Error(tc("noValidThreeView"));
      }
      onThreeViewChange(nextPath);
      toast.success(tc("threeViewSuccess"));
    } catch (error) {
      console.error("[PropImageSection] 生成三视图失败:", error);
      toast.error(tc("threeViewFailed"));
    } finally {
      setGeneratingThreeView(false);
    }
  }, [images, onThreeViewChange, prompt, propId]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleUpload(event.target.files?.[0] ?? undefined)}
      />

      <div className="space-y-3">
        {/* 道具图：3列 16:9 */}
        <div className="grid grid-cols-3 gap-2">
          {images.map((path, index) => {
            const src = ossUrl(path);
            return (
              <div
                key={`${path}_${index}`}
                className="group relative aspect-video overflow-hidden rounded-lg bg-muted"
              >
                <img src={src} alt="" className="h-full w-full object-cover" />
                {loadingIndex === index ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                    <IconLoader2 className="size-5 animate-spin text-white" />
                  </div>
                ) : (
                  <div
                    className={`absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-1 py-1.5 transition-opacity ${menuOpenIndex === index ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                  >
                    <Button
                      size="icon-xs"
                      variant="soft"
                      color="muted"
                      onClick={() => setPreviewUrl(src)}
                      title={tc("viewFullImage")}
                    >
                      <IconMaximize className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="soft"
                      color="muted"
                      onClick={() => openUpload(index)}
                      title={tc("replace")}
                    >
                      <IconReplace className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="soft"
                      color="muted"
                      title={tc("generateThreeView")}
                    >
                      <IconRotate360 className="size-3.5" />
                    </Button>
                    <DropdownMenu onOpenChange={(open) => setMenuOpenIndex(open ? index : -1)}>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-xs" variant="soft" color="muted">
                          <IconDots className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="center" side="top">
                        <DropdownMenuItem onClick={() => void handleRegenerate(index)}>
                          <IconWand className="size-3.5" />
                          {tc("regenerate")}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => handleDelete(index)}>
                          <IconTrash className="size-3.5" />
                          {tc("delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            );
          })}

          {uploading && localPreviewUrl ? (
            <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
              <img src={localPreviewUrl} alt="" className="h-full w-full object-cover opacity-60" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                <IconLoader2 className="size-5 animate-spin text-white" />
              </div>
            </div>
          ) : null}

          {!uploading && images.length < MAX_IMAGES ? (
            <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/10">
              <Button size="sm" variant="soft" color="muted" onClick={() => setPickerOpen(true)}>
                <IconUpload className="size-3.5" />
                {tc("upload")}
              </Button>
              <Button
                size="sm"
                variant="soft"
                color="muted"
                onClick={() => {
                  if (!propId) {
                    toast.warning(t("savePleaseFirst"));
                    return;
                  }
                  setAiRecordOpen(true);
                }}
              >
                <IconWand className="size-3.5" />
                {tc("aiGenerate")}
              </Button>
            </div>
          ) : null}
        </div>

        {/* 三视图：全宽 3:1 */}
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{t("threeViewHint")}</div>
          <div className="group relative aspect-[3/1] overflow-hidden rounded-lg border border-dashed border-border bg-muted/10">
            {threeViewUrl || generatingThreeView ? (
              <>
                <img
                  src={threeViewUrl || ossUrl(images[0])}
                  alt=""
                  className={`h-full w-full object-cover ${generatingThreeView ? "opacity-70" : ""}`}
                />
                {generatingThreeView ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                    <IconLoader2 className="size-5 animate-spin text-white" />
                  </div>
                ) : threeViewUrl ? (
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-1 py-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      size="icon-xs"
                      variant="soft"
                      color="muted"
                      onClick={() => setPreviewUrl(threeViewUrl)}
                      title={tc("viewFullImage")}
                    >
                      <IconMaximize className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="soft"
                      color="muted"
                      onClick={() => void handleGenerateThreeView()}
                      title={tc("regenerate")}
                    >
                      <IconWand className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="soft"
                      color="destructive"
                      onClick={() => onThreeViewChange("")}
                      title={tc("delete")}
                    >
                      <IconTrash className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex h-full items-center justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  color="muted"
                  onClick={() => void handleGenerateThreeView()}
                >
                  {t("generateThreeView")}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <AssetAiRecordDialog
        open={aiRecordOpen}
        onOpenChange={setAiRecordOpen}
        title={t("aiGenerateProp")}
        shotId={String(propId ?? "")}
        shotColumnId="-2"
        prompt={prompt}
        referenceImageUrl={referenceImageUrl}
        selectedPath={images[0] ?? ""}
        onSelect={(path: string) => {
          if (images.length >= MAX_IMAGES) {
            toast.warning(t("maxPropImages", { max: MAX_IMAGES }));
            return;
          }
          onImagesChange([...images, path].slice(0, MAX_IMAGES));
          toast.success(t("addedAiImage"));
        }}
      />

      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        assetType="img"
        multiple
        onSelect={(paths) => {
          const next = [...images, ...paths].slice(0, MAX_IMAGES);
          onImagesChange(next);
          setPickerOpen(false);
        }}
      />

      <MediaPreviewModal
        open={Boolean(previewUrl)}
        onOpenChange={(open) => !open && setPreviewUrl("")}
        type="image"
        src={previewUrl}
        name={t("propImagePreview")}
        link={previewUrl}
      />
    </>
  );
}
