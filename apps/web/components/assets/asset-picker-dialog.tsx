import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconCheck,
  IconLoader2,
  IconMusic,
  IconPhoto,
  IconPlayerPlay,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildOssUrl, uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";
import { getVideoThumbnail } from "@/components/storyboard/cells/cell-utils";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { AssetRecordType, AssetRecord } from "@/src/types/workspace";

type PickerTab = "uploads" | "ai";

function ossUrl(path?: string) {
  return buildOssUrl(path);
}

function defaultAccept(assetType: AssetRecordType) {
  if (assetType === "video") return "video/*";
  if (assetType === "audio") return "audio/*";
  return ".jpg,.jpeg,.png,.webp";
}

function defaultUploadType(assetType: AssetRecordType) {
  if (assetType === "video") return "SHOT_VALUE_VIDEO";
  if (assetType === "audio") return "SHOT_VALUE_AUDIO";
  return "SHOT_VALUE_IMAGE";
}

function assetTypeLabelKey(assetType: AssetRecordType) {
  if (assetType === "video") return "typeLabel_video" as const;
  if (assetType === "audio") return "typeLabel_audio" as const;
  return "typeLabel_image" as const;
}

function acceptHintKey(assetType: AssetRecordType) {
  if (assetType === "video") return "acceptHint_video" as const;
  if (assetType === "audio") return "acceptHint_audio" as const;
  return "acceptHint_image" as const;
}

// ─── Props ──────────────────────────────────────────────

interface AssetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetType: AssetRecordType;
  uploadType?: string;
  accept?: string;
  maxSize?: number;
  multiple?: boolean;
  onSelect: (paths: string[]) => void;
}

export function AssetPickerDialog({
  open,
  onOpenChange,
  assetType,
  uploadType,
  accept,
  maxSize = 25 * 1024 * 1024,
  multiple = false,
  onSelect,
}: AssetPickerDialogProps) {
  const t = useTranslations("asset");
  const [tab, setTab] = useState<PickerTab>("uploads");
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploads, setUploads] = useState<AssetRecord[]>([]);
  const [aiAssets, setAiAssets] = useState<AssetRecord[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resolvedAccept = accept || defaultAccept(assetType);
  const resolvedUploadType = uploadType || defaultUploadType(assetType);

  // ─── Load assets ─────────────────────────────────────

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const apiUrl = tab === "ai" ? "/api/ai/record/ai/list" : "/api/ai/record/local/list";
      const res = await backendApi.post<Paginated<AssetRecord>>(apiUrl, {
        data: { page: 1, pageSize: 40, type: assetType, sort: 1 },
      });
      const list = res?.list ?? [];
      if (tab === "ai") {
        setAiAssets(list);
      } else {
        setUploads(list);
      }
    } catch (err) {
      console.error("[AssetPicker] 加载失败:", err);
    } finally {
      setLoading(false);
    }
  }, [assetType, tab]);

  useEffect(() => {
    if (!open) return;
    setSelectedPaths(new Set());
    void loadAssets();
  }, [loadAssets, open]);

  // ─── Upload ──────────────────────────────────────────

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArr = Array.from(files);
      if (fileArr.length === 0) return;

      setUploading(true);
      const paths: string[] = [];

      for (const file of fileArr) {
        if (file.size > maxSize) {
          toast.error(t("exceedSizeLimit", { name: file.name }));
          continue;
        }
        try {
          const uploaded = await uploadWorkspaceFile(file, {
            uploadType: resolvedUploadType,
            sourceType: "LOCAL",
            maxSize,
            accept: resolvedAccept,
          });
          paths.push(uploaded.path);
          if (!multiple) break;
        } catch (err) {
          console.error("[AssetPicker] 上传失败:", err);
          toast.error(err instanceof Error ? err.message : t("uploadFailed"));
        }
      }

      setUploading(false);

      if (paths.length > 0) {
        toast.success(
          t("uploadSuccessCount", { count: paths.length, type: t(assetTypeLabelKey(assetType)) })
        );
        onSelect(paths);
        onOpenChange(false);
      }
    },
    [assetType, maxSize, multiple, onOpenChange, onSelect, resolvedAccept, resolvedUploadType]
  );

  // ─── Drag & Drop ─────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
  };

  const handleClickUpload = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) void handleFiles(e.target.files);
    e.target.value = "";
  };

  // ─── Selection ───────────────────────────────────────

  const toggleSelect = (path: string) => {
    if (!path) return;
    const next = new Set(selectedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      if (!multiple) next.clear();
      next.add(path);
    }
    setSelectedPaths(next);
  };

  const handleConfirm = () => {
    if (selectedPaths.size === 0) return;
    onSelect(Array.from(selectedPaths));
    onOpenChange(false);
  };

  const currentList = tab === "ai" ? aiAssets : uploads;

  if (!open) return null;

  // ─── Render ──────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-180 max-w-[calc(100vw-2rem)] p-0 sm:max-w-180">
        <div className="flex h-180 flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl">
          {/* Header */}
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">{t("materialPreview")}</DialogTitle>
          </DialogHeader>

          {/* Upload area */}
          <div className="shrink-0 px-4 pt-4">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleClickUpload}
              className={cn(
                "flex h-42 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-colors",
                isDragging ? "border-primary bg-primary/5" : "border-border/60 hover:border-border"
              )}
            >
              {uploading ? (
                <IconLoader2 className="size-8 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <IconUpload className="size-7 text-muted-foreground/50" />
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">{t("clickUploadOrDrag")}</p>
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      {t(acceptHintKey(assetType), { size: Math.round(maxSize / 1024 / 1024) })}
                    </p>
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={resolvedAccept}
              multiple={multiple}
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Tabs */}
          <div className="flex shrink-0 items-center gap-2 px-4 pt-4">
            <TabButton active={tab === "uploads"} onClick={() => setTab("uploads")}>
              {t("recentUploads")}
            </TabButton>
            <TabButton active={tab === "ai"} onClick={() => setTab("ai")}>
              {t("aiGenerated")}
            </TabButton>
          </div>

          {/* List */}
          <div className="flex-1 overflow-auto px-4 my-4">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : currentList.length === 0 ? (
              <div className="flex h-32 items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {tab === "uploads" ? t("noUploadRecords") : t("noAiRecords")}
                </p>
              </div>
            ) : assetType === "audio" ? (
              <div className="space-y-2">
                {currentList.map((asset) => {
                  const path = String(
                    asset.path ?? asset.url ?? asset.filePath ?? asset.storagePath ?? ""
                  );
                  const selected = selectedPaths.has(path);
                  return (
                    <button
                      key={String(asset.id ?? path)}
                      type="button"
                      onClick={() => toggleSelect(path)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border/60 hover:border-primary/40"
                      )}
                    >
                      <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <IconMusic className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {String(asset.name ?? "") || t("audioAsset")}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {String(asset.createTime ?? "")}
                        </div>
                      </div>
                      {selected ? <IconCheck className="size-4 text-primary" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {currentList.map((asset) => {
                  const path = String(
                    asset.path ?? asset.url ?? asset.filePath ?? asset.storagePath ?? ""
                  );
                  const src = ossUrl(path);
                  const selected = selectedPaths.has(path);

                  return (
                    <div
                      key={String(asset.id ?? path)}
                      className={cn(
                        "group relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 transition-colors",
                        selected ? "border-primary" : "border-transparent hover:border-primary/40"
                      )}
                      onClick={() => toggleSelect(path)}
                    >
                      {assetType === "video" ? (
                        <div className="relative h-full w-full bg-muted">
                          <img
                            src={getVideoThumbnail(src)}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <IconPlayerPlay className="size-5 text-white drop-shadow" />
                          </div>
                        </div>
                      ) : src ? (
                        <img
                          src={src}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-muted">
                          <IconPhoto className="size-5 text-muted-foreground/30" />
                        </div>
                      )}

                      {selected && (
                        <div className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-white">
                          <IconCheck className="size-3" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end border-t border-border p-4">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selectedPaths.size === 0}
              className={cn(
                "rounded-lg px-5 py-2 text-sm font-medium transition-colors",
                selectedPaths.size > 0
                  ? "bg-primary text-primary-foreground hover:brightness-110"
                  : "cursor-not-allowed bg-muted text-muted-foreground"
              )}
            >
              {selectedPaths.size > 0
                ? `${t("useSelected")} (${selectedPaths.size})`
                : t("useSelected")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tab Button ─────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
