"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconCheck, IconLoader2, IconWand } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { AssetRecord } from "@/src/types/workspace";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { getRecordPath, normalizeStoragePath, ROLE_RECORD_COLUMN_ID } from "./character-utils";

// ─── Loading placeholder type ──────────────────────────
type LoadingPlaceholder = {
  id: string;
  loading: boolean;
  failed: boolean;
};

type GridItem = string | LoadingPlaceholder;

function isPlaceholder(item: GridItem): item is LoadingPlaceholder {
  return typeof item === "object" && item.loading;
}

function isFailed(item: GridItem): item is LoadingPlaceholder {
  return typeof item === "object" && item.failed;
}

function getItemPath(item: GridItem): string {
  return typeof item === "string" ? item : "";
}

// ─── Component ─────────────────────────────────────────
export function CharacterAiRecordDialog({
  open,
  onOpenChange,
  characterId,
  prompt,
  referenceImageUrl,
  selectedPath,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterId: string;
  prompt: string;
  referenceImageUrl?: string;
  selectedPath?: string;
  onSelect: (path: string) => void;
}) {
  const t = useTranslations("character");
  const tc = useTranslations("common");

  // Loading placeholders (generating in progress)
  const [loadingItems, setLoadingItems] = useState<LoadingPlaceholder[]>([]);
  // Locally completed images (generated in this session, not yet in history)
  const [localCompleted, setLocalCompleted] = useState<string[]>([]);
  // History images from API
  const [historyImages, setHistoryImages] = useState<string[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Preview & selection
  const [previewPath, setPreviewPath] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const idCounter = useRef(0);

  // All images: loading placeholders + local completed + history
  const allImages: GridItem[] = [...loadingItems, ...localCompleted, ...historyImages];

  // ─── Load history ────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!characterId) {
      setHistoryImages([]);
      return;
    }
    try {
      setIsLoadingHistory(true);
      const data = await backendApi.post<Paginated<AssetRecord>>("/api/ai/record/role/list", {
        data: { page: 1, pageSize: 50, roleId: characterId, type: "img", sort: 0 },
      });
      const list = (data?.list ?? [])
        .map((item) => normalizeStoragePath(getRecordPath(item)))
        .filter(Boolean);
      setHistoryImages(list);

      // Remove local completed items that now appear in history
      setLocalCompleted((prev) => {
        const historySet = new Set(list);
        return prev.filter((p) => !historySet.has(p));
      });
    } catch (error) {
      console.error("[CharacterAiRecordDialog] 获取历史失败:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [characterId]);

  // ─── Generate ────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!characterId || !prompt?.trim()) {
      toast.warning(t("pleaseEnterPrompt"));
      return;
    }

    // Insert loading placeholder at the front
    const placeholderId = `gen_${Date.now()}_${++idCounter.current}`;
    const placeholder: LoadingPlaceholder = {
      id: placeholderId,
      loading: true,
      failed: false,
    };
    setLoadingItems((prev) => [placeholder, ...prev]);

    // Adjust selectedIndex since we prepended an item
    setSelectedIndex((prev) => (prev !== null ? prev + 1 : null));

    try {
      const result = await backendApi.post<string>("/api/ai/image/generate/basic", {
        data: {
          shotId: characterId,
          shotColumnId: ROLE_RECORD_COLUMN_ID,
          prompt: prompt.trim(),
          referenceImageUrl: referenceImageUrl ? buildOssUrl(referenceImageUrl) : undefined,
          watermark: false,
        },
        timeout: 360_000,
      });

      const imagePath = normalizeStoragePath(String(result ?? ""));

      // Remove loading placeholder
      setLoadingItems((prev) => {
        const idx = prev.findIndex((item) => item.id === placeholderId);
        if (idx === -1) return prev;
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      });

      if (imagePath) {
        // Insert into local completed
        setLocalCompleted((prev) => [imagePath, ...prev]);
        // Auto-preview the new image
        setPreviewPath(imagePath);
        toast.success(t("generateSuccess"));
      }
    } catch (error) {
      console.error("[CharacterAiRecordDialog] 生成失败:", error);
      toast.error(t("generateFailed"));

      // Mark placeholder as failed
      setLoadingItems((prev) =>
        prev.map((item) =>
          item.id === placeholderId ? { ...item, loading: false, failed: true } : item
        )
      );
    }
  }, [characterId, prompt, referenceImageUrl, t]);

  // ─── Open/close effects ──────────────────────────────
  useEffect(() => {
    if (!open) return;
    setPreviewPath("");
    setSelectedIndex(null);
    setLoadingItems([]);
    setLocalCompleted([]);
    void loadHistory();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync selectedIndex when preview changes
  useEffect(() => {
    if (!previewPath) return;
    const idx = allImages.findIndex((item) => getItemPath(item) === previewPath);
    setSelectedIndex(idx !== -1 ? idx : null);
  }, [previewPath, allImages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Handlers ────────────────────────────────────────
  const handleClickImage = (item: GridItem) => {
    if (isPlaceholder(item) || isFailed(item)) return;
    const path = getItemPath(item);
    if (path) setPreviewPath(path);
  };

  const handleToggleSelect = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const item = allImages[index];
    if (!item || isPlaceholder(item) || isFailed(item)) return;
    setSelectedIndex((prev) => (prev === index ? null : index));
  };

  const handleConfirm = () => {
    let path = "";
    if (selectedIndex !== null) {
      const item = allImages[selectedIndex];
      path = getItemPath(item);
    } else if (previewPath) {
      path = previewPath;
    }
    if (!path) return;
    onSelect(path);
    onOpenChange(false);
  };

  const previewUrl = buildOssUrl(previewPath);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-[1000px]">
        <DialogHeader>
          <DialogTitle>{t("aiGenerateImage")}</DialogTitle>
        </DialogHeader>

        <div className="flex h-[500px] gap-5 overflow-hidden p-4">
          {/* ─── Left: image grid ─── */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            <div className="grid grid-cols-4 gap-3 rounded-lg border border-dashed border-border/60 bg-muted/5 p-3">
              {/* Generate button */}
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={!prompt?.trim()}
                className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/5 text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex flex-col items-center gap-2 text-xs">
                  <IconWand className="size-5" />
                  <span>{t("aiGenerateImage")}</span>
                </div>
              </button>

              {/* Loading placeholders + completed + history */}
              {allImages.map((item, index) => {
                if (isPlaceholder(item)) {
                  return (
                    <div
                      key={item.id}
                      className="flex aspect-square items-center justify-center rounded-lg border border-border/40 bg-muted/10"
                    >
                      {item.failed ? (
                        <span className="text-[10px] text-destructive">{t("generateFailed")}</span>
                      ) : (
                        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  );
                }

                const path = getItemPath(item);
                const isSelected = selectedIndex === index;
                const isPreviewing = previewPath === path;

                return (
                  <button
                    key={`img-${index}-${path}`}
                    type="button"
                    onClick={() => handleClickImage(item)}
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-lg border-2 bg-muted/10 transition-colors",
                      isSelected
                        ? "border-primary"
                        : isPreviewing
                          ? "border-primary/40"
                          : "border-transparent hover:border-primary/30"
                    )}
                  >
                    <img src={buildOssUrl(path)} alt="" className="h-full w-full object-cover" />
                    {/* Checkbox */}
                    <div
                      onClick={(e) => handleToggleSelect(index, e)}
                      className={cn(
                        "absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded border-2 transition-colors",
                        isSelected
                          ? "border-primary bg-primary"
                          : "border-white/40 bg-black/30 hover:border-primary/60 hover:bg-primary/20"
                      )}
                    >
                      {isSelected ? <IconCheck className="size-3 text-white" /> : null}
                    </div>
                  </button>
                );
              })}

              {/* Empty state */}
              {allImages.length === 0 && !isLoadingHistory ? (
                <div className="col-span-3 flex aspect-[3/1] items-center justify-center text-sm text-muted-foreground">
                  {t("clickGenerateHint")}
                </div>
              ) : null}
            </div>
          </div>

          {/* ─── Right: preview ─── */}
          <div className="flex w-[350px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border/60 bg-muted/5">
            {previewUrl ? (
              <img src={previewUrl} alt="" className="max-h-full max-w-full object-contain p-4" />
            ) : (
              <span className="text-sm text-muted-foreground">{t("clickToPreviewImage")}</span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={selectedIndex === null && !previewPath}>
            {tc("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
