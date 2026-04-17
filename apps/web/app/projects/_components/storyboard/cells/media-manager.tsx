"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  IconCheck,
  IconCircleCheck,
  IconDownload,
  IconExternalLink,
  IconLoader2,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
  IconUser,
  IconVideo,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";
import { backendApi } from "@/src/lib/api";
import type { FileDetail } from "@/src/types/workspace";
import { ossUrl, getVideoThumbnail, type MediaFile } from "./cell-utils";
import { MediaReviewPanel, formatMediaTime, formatMediaBytes } from "./media-review-panel";

type MediaManagerMode = "edit" | "review";

type UploadPreviewItem = {
  id: string;
  previewUrl: string;
  uploading: boolean;
  uploadedPath?: string;
};

export function MediaManagerDialog({
  open,
  onOpenChange,
  mediaType,
  title,
  projectId,
  files,
  preferredPath,
  onUploaded,
  onDeletePath,
  onSetPreferred,
  onUnsetPreferred,
  onPromptSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediaType: "image" | "video";
  title: string;
  projectId: string;
  files: MediaFile[];
  preferredPath: string;
  onUploaded: (path: string) => void | Promise<void>;
  onDeletePath: (path: string) => void | Promise<void>;
  onSetPreferred: (path: string) => Promise<void>;
  onUnsetPreferred: (path: string) => Promise<void>;
  onPromptSave: (fileId: string, prompt: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<MediaManagerMode>("edit");
  const [activePath, setActivePath] = useState("");
  const [fileDetails, setFileDetails] = useState<FileDetail | null>(null);
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [uploadingItems, setUploadingItems] = useState<UploadPreviewItem[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [preferredLoading, setPreferredLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadingItemsRef = useRef<UploadPreviewItem[]>([]);
  const isVideo = mediaType === "video";

  const effectiveActivePath =
    activePath && files.some((file) => file.path === activePath)
      ? activePath
      : preferredPath || files[0]?.path || "";
  const activeFile = files.find((file) => file.path === effectiveActivePath) ?? files[0];
  const activeSrc = activeFile ? ossUrl(activeFile.url || activeFile.path) : "";
  const hasPreferred = files.some((file) => file.preferred);
  const maxReached = files.length >= 10;
  const activeFileId = String(activeFile?.id ?? "");
  const detailMatchesActiveFile = String(fileDetails?.id ?? "") === activeFileId;
  const originalPrompt = String(
    (detailMatchesActiveFile ? fileDetails?.prompt : undefined) ?? activeFile?.prompt ?? ""
  );

  useEffect(() => {
    if (!open) {
      setMode("edit");
      setDeleteOpen(false);
      setPreferredLoading(false);
    }
  }, [open]);

  useEffect(() => {
    setPrompt(originalPrompt);
  }, [originalPrompt, activeFileId]);

  useEffect(() => {
    if (!activeFileId || !open) {
      setFileDetails(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoadingDetails(true);
      try {
        const data = await backendApi.post<FileDetail>(`/api/user/file/detail/${activeFileId}`);
        if (!cancelled) {
          setFileDetails(data);
        }
      } catch (error) {
        console.error("[MediaManagerDialog] 获取文件详情失败:", error);
        if (!cancelled) {
          setFileDetails(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingDetails(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeFileId, open]);

  useEffect(() => {
    if (files.length === 0) {
      setActivePath("");
    }
  }, [files.length]);

  useEffect(() => {
    if (!files.length) return;
    setUploadingItems((current) =>
      current.filter((item) => {
        if (item.uploading) return true;
        if (item.uploadedPath && files.some((file) => file.path === item.uploadedPath)) {
          URL.revokeObjectURL(item.previewUrl);
          return false;
        }
        return true;
      })
    );
  }, [files]);

  useEffect(() => {
    uploadingItemsRef.current = uploadingItems;
  }, [uploadingItems]);

  useEffect(() => {
    return () => {
      for (const item of uploadingItemsRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  const handlePromptBlur = useCallback(async () => {
    if (!activeFileId || savingPrompt || prompt === originalPrompt) return;
    try {
      setSavingPrompt(true);
      await onPromptSave(activeFileId, prompt);
      setFileDetails((current) => (current ? { ...current, prompt } : current));
      toast.success(tc("saveSuccess"));
    } catch (error) {
      console.error("[MediaManagerDialog] 保存提示词失败:", error);
      toast.error(tc("saveFailed"));
    } finally {
      setSavingPrompt(false);
    }
  }, [activeFileId, onPromptSave, originalPrompt, prompt, savingPrompt]);

  const handleShare = useCallback(async () => {
    if (!activeSrc) return;
    try {
      await navigator.clipboard.writeText(activeSrc);
      toast.success(tc("copySuccess"));
    } catch (error) {
      console.error("[MediaManagerDialog] 复制链接失败:", error);
      toast.error(tc("copyFailed"));
    }
  }, [activeSrc, isVideo]);

  const handleDownload = useCallback(() => {
    if (!activeSrc) return;
    const link = document.createElement("a");
    link.href = activeSrc;
    link.download = activeFile?.name || "";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [activeFile?.name, activeSrc]);

  const handlePreferredToggle = useCallback(async () => {
    const targetPath = activeFile?.path ?? "";
    if (!targetPath || preferredLoading) return;

    try {
      setPreferredLoading(true);
      if (activeFile?.preferred) {
        await onUnsetPreferred(targetPath);
      } else {
        await onSetPreferred(targetPath);
      }
    } finally {
      setPreferredLoading(false);
    }
  }, [activeFile?.path, activeFile?.preferred, onSetPreferred, onUnsetPreferred, preferredLoading]);

  const handleLocalUpload = useCallback(
    async (rawFile: File) => {
      if (maxReached) {
        toast.warning(t("maxMaterials", { max: 10 }));
        return;
      }
      const isValidType = isVideo
        ? rawFile.type.startsWith("video/")
        : rawFile.type.startsWith("image/");
      if (!isValidType) {
        toast.warning(isVideo ? t("pleaseSelectVideoFile") : t("pleaseSelectImageFile"));
        return;
      }

      const maxSize = isVideo ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
      if (rawFile.size > maxSize) {
        toast.warning(t("fileSizeExceed", { size: maxSize / (1024 * 1024) }));
        return;
      }

      const tempId = `uploading_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const previewUrl = URL.createObjectURL(rawFile);
      setUploadingItems((current) => [...current, { id: tempId, previewUrl, uploading: true }]);

      try {
        const uploaded = await uploadWorkspaceFile(rawFile, {
          uploadType: isVideo ? "SHOT_VALUE_VIDEO" : "SHOT_VALUE_IMAGE",
          sourceType: "LOCAL",
          maxSize,
          accept: isVideo ? "video/*" : "image/*",
        });
        const storagePath = uploaded.path;

        setUploadingItems((current) =>
          current.map((item) =>
            item.id === tempId ? { ...item, uploading: false, uploadedPath: storagePath } : item
          )
        );
        setActivePath(storagePath);
        await onUploaded(storagePath);
        toast.success(tc("uploadSuccess"));
      } catch (error) {
        console.error("[MediaManagerDialog] 上传失败:", error);
        toast.error(tc("uploadFailed"));
        setUploadingItems((current) => {
          const target = current.find((item) => item.id === tempId);
          if (target) {
            URL.revokeObjectURL(target.previewUrl);
          }
          return current.filter((item) => item.id !== tempId);
        });
      }
    },
    [isVideo, maxReached, onUploaded]
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="h-[85vh] w-[90vw] max-w-[1400px] overflow-hidden border-none bg-[#1A1A1A] p-0 text-white sm:max-w-[1400px]">
          <div className="relative flex h-full min-h-0">
            <span className="sr-only">{title}</span>

            <div className="flex min-h-0 flex-1 flex-col">
              <div
                className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-5 py-5"
                id="mediaPreviewContainer"
              >
                {activeSrc ? (
                  <>
                    {isVideo ? (
                      <video
                        key={activeSrc}
                        src={activeSrc}
                        controls
                        playsInline
                        className="max-h-full max-w-full rounded-lg object-contain"
                      />
                    ) : (
                      <img
                        src={activeSrc}
                        alt=""
                        className="max-h-full max-w-full cursor-zoom-in rounded-lg object-contain"
                        onClick={() => window.open(activeSrc, "_blank")}
                      />
                    )}

                    <div className="absolute right-5 top-5 z-10 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-2 backdrop-blur-sm">
                      {activeFile?.preferred ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          color="muted"
                          className="h-8 bg-primary text-white hover:bg-primary/90"
                          onClick={() => void handlePreferredToggle()}
                          disabled={preferredLoading}
                        >
                          {preferredLoading ? (
                            <IconLoader2 className="size-3.5 animate-spin" />
                          ) : (
                            <IconCircleCheck className="size-3.5" />
                          )}
                          {preferredLoading ? t("processingPreferred") : t("finalizedVersion")}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          color="muted"
                          className="h-8 text-white hover:bg-white/10 hover:text-white"
                          onClick={() => void handlePreferredToggle()}
                          disabled={preferredLoading}
                        >
                          {preferredLoading ? (
                            <IconLoader2 className="size-3.5 animate-spin" />
                          ) : (
                            <IconCircleCheck className="size-3.5" />
                          )}
                          {preferredLoading ? t("processingPreferred") : t("setAsFinalized")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        color="muted"
                        className="size-8 text-white hover:bg-white/10 hover:text-white"
                        onClick={handleDownload}
                      >
                        <IconDownload className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        color="muted"
                        className="size-8 text-white hover:bg-white/10 hover:text-white"
                        onClick={() => setDeleteOpen(true)}
                        disabled={preferredLoading}
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-white/35">
                    {isVideo ? (
                      <IconVideo className="size-12" />
                    ) : (
                      <IconPhoto className="size-12" />
                    )}
                    <span className="text-sm">{t("noMaterials")}</span>
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 bg-[#1A1A1A] px-5 py-4">
                <div className="overflow-x-auto">
                  <div className="flex min-w-max items-center justify-center gap-3">
                    {!hasPreferred ? (
                      <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg bg-[#2A2A2A] px-2 text-center text-xs text-white/55">
                        {t("notFinalized")}
                      </div>
                    ) : null}

                    {files.map((file) => {
                      const filePath = file.path ?? "";
                      const active = filePath === (activeFile?.path ?? "");
                      const thumbnail = isVideo
                        ? getVideoThumbnail(file.url || file.path)
                        : ossUrl(file.url || file.path);
                      return (
                        <button
                          key={filePath}
                          type="button"
                          onClick={() => setActivePath(filePath)}
                          className={cn(
                            "relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg border-2 border-transparent bg-[#2A2A2A] transition-colors hover:border-white/30",
                            (active || file.preferred) && "border-primary"
                          )}
                        >
                          {thumbnail ? (
                            <img src={thumbnail} alt="" className="h-full w-full object-cover" />
                          ) : isVideo ? (
                            <div className="flex h-full w-full items-center justify-center text-white/45">
                              <IconPlayerPlay className="size-5" />
                            </div>
                          ) : null}
                          {file.preferred ? (
                            <div className="absolute right-1 top-1 flex size-[18px] items-center justify-center rounded-full bg-primary text-white">
                              <IconCheck className="size-3" />
                            </div>
                          ) : null}
                        </button>
                      );
                    })}

                    {uploadingItems.map((item) => (
                      <div
                        key={item.id}
                        className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg bg-[#2A2A2A]"
                      >
                        {!isVideo ? (
                          <img
                            src={item.previewUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-white/45">
                            <IconPlayerPlay className="size-5" />
                          </div>
                        )}
                        {item.uploading ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <IconLoader2 className="size-4 animate-spin text-white" />
                          </div>
                        ) : null}
                      </div>
                    ))}

                    <button
                      type="button"
                      disabled={maxReached}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-white/15 text-white/55 transition-colors hover:border-primary hover:text-primary",
                        maxReached &&
                          "cursor-not-allowed opacity-50 hover:border-white/15 hover:text-white/55"
                      )}
                    >
                      <IconPlus className="size-6" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={isVideo ? "video/*" : "image/*"}
                      className="hidden"
                      onChange={(event) => {
                        const selectedFiles = Array.from(event.target.files ?? []);
                        for (const item of selectedFiles) {
                          void handleLocalUpload(item);
                        }
                        event.target.value = "";
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex w-[440px] min-h-0 shrink-0 flex-col border-l border-white/10 bg-[#1A1A1A]">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 pr-14">
                <div className="flex overflow-hidden rounded-md bg-[#2A2A2A]">
                  <button
                    type="button"
                    onClick={() => setMode("edit")}
                    className={cn(
                      "px-4 py-2 text-[13px] transition-colors",
                      mode === "edit" ? "bg-primary text-white" : "text-white/55 hover:text-white"
                    )}
                  >
                    {t("editTab")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("review")}
                    className={cn(
                      "px-4 py-2 text-[13px] transition-colors",
                      mode === "review" ? "bg-primary text-white" : "text-white/55 hover:text-white"
                    )}
                  >
                    {t("reviewTab")}
                  </button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  color="muted"
                  className="h-8 text-white/75 hover:bg-white/10 hover:text-white"
                  onClick={handleShare}
                >
                  <IconExternalLink className="size-4" />
                  {isVideo ? t("shareVideo") : t("shareImage")}
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {mode === "review" ? (
                  <MediaReviewPanel
                    projectId={projectId}
                    targetType={isVideo ? "VIDEO" : "IMAGE"}
                    targetId={activeFileId || undefined}
                  />
                ) : (
                  <div className="space-y-6 px-5 py-5">
                    {loadingDetails ? (
                      <div className="space-y-3">
                        <div className="h-5 w-2/3 animate-pulse rounded bg-white/10" />
                        <div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
                        <div className="h-4 w-1/3 animate-pulse rounded bg-white/10" />
                      </div>
                    ) : activeFile ? (
                      <div>
                        <div className="break-all text-[15px] font-medium text-white">
                          {String(
                            (detailMatchesActiveFile ? fileDetails?.name : undefined) ??
                              activeFile.name ??
                              activeFile.path?.split("/").pop() ??
                              t("unknownFile")
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs text-white/45">
                          {String(
                            detailMatchesActiveFile ? (fileDetails?.userAvatarImagePath ?? "") : ""
                          ) ? (
                            <img
                              src={ossUrl(String(fileDetails?.userAvatarImagePath))}
                              alt=""
                              className="size-4 rounded-full object-cover"
                            />
                          ) : (
                            <IconUser className="size-4" />
                          )}
                          <span className="text-white/70">
                            {String(
                              (detailMatchesActiveFile ? fileDetails?.userName : undefined) ??
                                (detailMatchesActiveFile ? fileDetails?.nickname : undefined) ??
                                t("unknownUser")
                            )}
                          </span>
                          <span className="text-white/20">·</span>
                          <span>
                            {t("updatedAt")}{" "}
                            {formatMediaTime(
                              String(
                                (detailMatchesActiveFile ? fileDetails?.updateTime : undefined) ??
                                  activeFile.updateTime ??
                                  activeFile.createTime ??
                                  ""
                              )
                            )}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/45">
                          <span>
                            {String(
                              (detailMatchesActiveFile ? fileDetails?.type : undefined) ??
                                (isVideo ? "mp4" : "jpg")
                            )}
                          </span>
                          {(detailMatchesActiveFile ? fileDetails?.width : undefined) &&
                          (detailMatchesActiveFile ? fileDetails?.height : undefined) ? (
                            <>
                              <span className="text-white/20">|</span>
                              <span>
                                {fileDetails?.width}×{fileDetails?.height}px
                              </span>
                            </>
                          ) : null}
                          <span className="text-white/20">|</span>
                          <span>
                            {formatMediaBytes(
                              Number((detailMatchesActiveFile ? fileDetails?.size : undefined) ?? 0)
                            )}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="py-10 text-center text-sm text-white/35">
                        {t("selectMaterial")}
                      </div>
                    )}

                    <div>
                      <div className="mb-3 text-sm font-medium text-white/85">
                        {t("promptLabelField")}
                      </div>
                      <Textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        onBlur={() => void handlePromptBlur()}
                        rows={8}
                        placeholder={t("promptFieldPlaceholder")}
                        className="border-white/10 bg-black/20 text-white/90 placeholder:text-white/35"
                      />
                      <div className="mt-2 text-right text-xs text-white/35">
                        {savingPrompt ? t("savingPrompt") : `${prompt.length}/3000`}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {isVideo ? t("confirmDeleteVideo") : t("confirmDeleteImage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (activeFile?.path) {
                  void onDeletePath(activeFile.path);
                }
              }}
            >
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
