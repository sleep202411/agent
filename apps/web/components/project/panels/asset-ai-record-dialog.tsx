import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCheck, IconLoader2, IconWand, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { backendApi } from "@/src/lib/api";
import { env } from "@/src/env";

const OSS_BASE = env.OSS_BASE_URL;

type LoadingItem = {
  id: string;
  loading?: boolean;
  failed?: boolean;
  path?: string;
};

type SessionEntry = {
  loadingItems: LoadingItem[];
  localCompleted: string[];
};

const assetAiSessionCache = new Map<string, SessionEntry>();

function getSessionEntry(key: string) {
  const current = assetAiSessionCache.get(key);
  if (current) return current;
  const next: SessionEntry = { loadingItems: [], localCompleted: [] };
  assetAiSessionCache.set(key, next);
  return next;
}

function ossUrl(path?: string | null) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

function normalizeStoragePath(path?: string | null) {
  const raw = String(path ?? "").trim();
  if (!raw) return "";
  const prefix = `${OSS_BASE}/`;
  if (raw.startsWith(prefix)) {
    return raw.slice(prefix.length);
  }
  return raw;
}

function getDisplayPath(item: string | LoadingItem) {
  if (!item) return "";
  if (typeof item === "string") return item;
  return normalizeStoragePath(item.path);
}

function isPlaceholder(item: string | LoadingItem) {
  return typeof item === "object" && Boolean(item?.loading);
}

function isFailed(item: string | LoadingItem) {
  return typeof item === "object" && Boolean(item?.failed);
}

function makeSessionKey(shotId: string, shotColumnId: string) {
  return `${shotId || "unknown"}:${shotColumnId || "unknown"}`;
}

export function AssetAiRecordDialog({
  open,
  onOpenChange,
  title,
  shotId,
  shotColumnId,
  prompt,
  referenceImageUrl,
  selectedPath,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  shotId: string;
  shotColumnId: string;
  prompt: string;
  referenceImageUrl?: string;
  selectedPath?: string;
  onSelect: (path: string) => void;
}) {
  const tc = useTranslations("common");
  const sessionKey = useMemo(() => makeSessionKey(shotId, shotColumnId), [shotColumnId, shotId]);
  const [sessionState, setSessionState] = useState<SessionEntry>(() => getSessionEntry(sessionKey));
  const [previewPath, setPreviewPath] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const normalizedSelectedPath = useMemo(() => normalizeStoragePath(selectedPath), [selectedPath]);

  const allImages = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<string | LoadingItem> = [];

    for (const item of sessionState.loadingItems) {
      items.push(item);
      const path = normalizeStoragePath(item.path);
      if (path) {
        seen.add(path);
      }
    }

    for (const item of sessionState.localCompleted) {
      const path = normalizeStoragePath(item);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      items.push(path);
    }

    if (normalizedSelectedPath && !seen.has(normalizedSelectedPath)) {
      items.push(normalizedSelectedPath);
    }

    return items;
  }, [normalizedSelectedPath, sessionState.loadingItems, sessionState.localCompleted]);

  const syncSessionState = useCallback(
    (updater: (current: SessionEntry) => SessionEntry) => {
      setSessionState((current) => {
        const next = updater(current);
        assetAiSessionCache.set(sessionKey, next);
        return next;
      });
    },
    [sessionKey]
  );

  const syncSelectedIndex = useCallback(
    (targetPreviewPath: string, items: Array<string | LoadingItem>) => {
      if (!targetPreviewPath) {
        setSelectedIndex(null);
        return;
      }
      const normalizedTarget = normalizeStoragePath(targetPreviewPath);
      const nextIndex = items.findIndex(
        (item) =>
          !isPlaceholder(item) &&
          !isFailed(item) &&
          normalizeStoragePath(getDisplayPath(item)) === normalizedTarget
      );
      setSelectedIndex(nextIndex >= 0 ? nextIndex : null);
    },
    []
  );

  useEffect(() => {
    setSessionState(getSessionEntry(sessionKey));
  }, [sessionKey]);

  useEffect(() => {
    if (!open) return;
    if (normalizedSelectedPath) {
      setPreviewPath(normalizedSelectedPath);
      return;
    }
    const fallback =
      sessionState.localCompleted[0] ?? normalizeStoragePath(sessionState.loadingItems[0]?.path);
    setPreviewPath(fallback ?? "");
  }, [normalizedSelectedPath, open, sessionState.loadingItems, sessionState.localCompleted]);

  useEffect(() => {
    syncSelectedIndex(previewPath, allImages);
  }, [allImages, previewPath, syncSelectedIndex]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      toast.warning("请先填写描述或提示词");
      return;
    }
    const placeholderId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const placeholder: LoadingItem = {
      id: placeholderId,
      path: "",
      loading: true,
      failed: false,
    };

    syncSessionState((current) => ({
      ...current,
      loadingItems: [placeholder, ...current.loadingItems],
    }));
    if (selectedIndex !== null) {
      setSelectedIndex(selectedIndex + 1);
    }

    try {
      const result = await backendApi.post<string>("/api/ai/image/generate/basic", {
        data: {
          prompt,
          shotId,
          shotColumnId,
          referenceImageUrl: referenceImageUrl || undefined,
        },
        timeout: 360_000,
      });
      const nextPath = normalizeStoragePath(String(result ?? ""));
      if (!nextPath) {
        throw new Error("未生成有效图片");
      }

      syncSessionState((current) => ({
        loadingItems: current.loadingItems.filter((item) => item.id !== placeholderId),
        localCompleted: [
          nextPath,
          ...current.localCompleted.filter((item) => normalizeStoragePath(item) !== nextPath),
        ],
      }));
      setPreviewPath(nextPath);
      toast.success(tc("generateSuccess"));
    } catch (error) {
      console.error("[AssetAiRecordDialog] AI 生成失败:", error);
      syncSessionState((current) => ({
        ...current,
        loadingItems: current.loadingItems.map((item) =>
          item.id === placeholderId
            ? {
                ...item,
                loading: false,
                failed: true,
              }
            : item
        ),
      }));
      toast.error(error instanceof Error ? error.message : tc("generateFailed"));
    }
  }, [prompt, referenceImageUrl, selectedIndex, shotColumnId, shotId, syncSessionState]);

  const handleConfirm = useCallback(() => {
    if (selectedIndex !== null) {
      const current = allImages[selectedIndex];
      const nextPath = getDisplayPath(current);
      if (nextPath) {
        onSelect(nextPath);
        onOpenChange(false);
        return;
      }
    }
    if (previewPath) {
      onSelect(previewPath);
      onOpenChange(false);
      return;
    }
    toast.warning("请选择一张图片");
  }, [allImages, onOpenChange, onSelect, previewPath, selectedIndex]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[1000px] max-w-[calc(100vw-2rem)] overflow-hidden p-0 sm:max-w-[1000px]"
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex h-[520px] gap-5 p-5">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="grid flex-1 auto-rows-[1fr] grid-cols-4 content-start gap-3 overflow-y-auto rounded-lg border border-dashed border-border bg-muted/10 p-3">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border bg-background/30 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
              >
                <div className="flex flex-col items-center gap-2 text-xs">
                  <IconWand className="size-5" />
                  <span>{tc("aiGenerate")}</span>
                </div>
              </button>

              {allImages.map((item, index) => {
                const path = getDisplayPath(item);
                const active = normalizeStoragePath(previewPath) === normalizeStoragePath(path);
                const checked = selectedIndex === index;
                return (
                  <button
                    key={typeof item === "string" ? `${item}_${index}` : item.id}
                    type="button"
                    onClick={() => {
                      if (isPlaceholder(item) || isFailed(item)) return;
                      if (path) setPreviewPath(path);
                    }}
                    className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-colors ${
                      active
                        ? "border-primary"
                        : "border-transparent bg-muted/30 hover:border-primary/40"
                    }`}
                  >
                    {isPlaceholder(item) ? (
                      <div className="flex h-full w-full items-center justify-center bg-black/20">
                        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : isFailed(item) ? (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black/30 text-[11px] text-muted-foreground">
                        <IconX className="size-5 text-destructive" />
                        <span>Failed</span>
                      </div>
                    ) : (
                      <>
                        <img src={ossUrl(path)} alt="" className="h-full w-full object-cover" />
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedIndex((current) => (current === index ? null : index));
                            if (path) {
                              setPreviewPath(path);
                            }
                          }}
                          className={`absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full border transition-colors ${
                            checked
                              ? "border-primary bg-primary text-white"
                              : "border-white/30 bg-black/55 text-transparent hover:border-primary hover:bg-primary/35"
                          }`}
                        >
                          <IconCheck className="size-3" />
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="w-[360px] shrink-0 rounded-lg border border-border bg-black">
            {previewPath ? (
              <img
                src={ossUrl(previewPath)}
                alt=""
                className="h-full w-full rounded-lg object-contain p-4"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                点击左侧图片预览
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-0">
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
