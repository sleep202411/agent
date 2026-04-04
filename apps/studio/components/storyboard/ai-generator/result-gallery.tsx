"use client";

import {
  IconDownload,
  IconLoader2,
  IconAlertCircle,
  IconInfoCircle,
  IconRefresh,
  IconReplace,
  IconCircleCheck,
  IconTrash,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { buildOssImageUrl } from "@/src/lib/uploads/workspace-upload";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ResultItem } from "@/src/store/slices/projectSlice";

interface ResultGalleryProps {
  items: ResultItem[];
  loading?: boolean;
  error?: string;
  appliedPaths?: string[];
  preferredPath?: string;
  onPreview?: (item: ResultItem) => void;
  onDelete?: (item: ResultItem) => void;
  onCollect?: (item: ResultItem) => void;
  onSetPreferred?: (item: ResultItem) => void;
  onSetReference?: (item: ResultItem) => void;
  onDownload?: (item: ResultItem) => void;
  onRetry?: (item: ResultItem) => void;
  previewItemId?: string;
  mediaType?: "image" | "video";
  columns?: 2 | 3 | 4;
  aspectRatio?: "square" | "video";
  emptyText?: string;
  showActions?: boolean;
  actions?: Array<"collect" | "setPreferred" | "setReference" | "download" | "delete">;
}

function getVideoThumbnail(url?: string) {
  if (!url) return "";
  if (url.startsWith("blob:")) return "";
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}x-oss-process=video/snapshot,t_0,m_fast`;
}

export function ResultGallery({
  items,
  loading,
  error,
  appliedPaths = [],
  preferredPath,
  onPreview,
  onDelete,
  onCollect,
  onSetPreferred,
  onSetReference,
  onDownload,
  onRetry,
  previewItemId,
  mediaType = "image",
  columns = 3,
  aspectRatio = "square",
  emptyText = "暂无生成记录",
  showActions = true,
  actions = ["collect", "setPreferred", "download", "delete"],
}: ResultGalleryProps) {
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <IconAlertCircle className="size-6 text-destructive/70" />
        <p className="max-w-[220px] text-center text-xs text-destructive/80">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <p className="text-xs">{emptyText}</p>
        <p className="text-[11px] text-muted-foreground/60">输入提示词开始生成</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid gap-2 p-0",
        columns === 2 ? "grid-cols-2" : columns === 4 ? "grid-cols-4" : "grid-cols-3"
      )}
    >
      {items.map((item) => {
        const isSelected = previewItemId === item.id;
        const isApplied = item.storagePath ? appliedPaths.includes(item.storagePath) : false;
        const isPreferred = item.storagePath === preferredPath;
        const mediaUrl = item.url ?? "";
        const thumbnailUrl =
          mediaType === "video"
            ? getVideoThumbnail(mediaUrl)
            : buildOssImageUrl(mediaUrl, { width: 300, height: 300, mode: "fill" });

        // Queue: waiting / generating
        if (item.status === "waiting" || item.status === "generating") {
          return (
            <div
              key={item.id}
              className={cn(
                "flex items-center justify-center rounded-lg bg-muted/50",
                aspectRatio === "video" ? "aspect-video" : "aspect-square"
              )}
            >
              <IconLoader2 className="size-5 animate-spin text-muted-foreground/50" />
            </div>
          );
        }

        // Queue: failed
        if (item.status === "failed") {
          return (
            <div
              key={item.id}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1.5 rounded-lg bg-muted/50",
                aspectRatio === "video" ? "aspect-video" : "aspect-square"
              )}
            >
              <IconAlertCircle className="size-4 text-destructive/60" />
              <p className="px-2 text-center text-[10px] text-destructive/60">
                {item.error ?? "失败"}
              </p>
              <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                {item.error ? (
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={(event) => event.stopPropagation()}
                          className="flex size-6 items-center justify-center rounded bg-black/40 text-white transition-colors hover:bg-white/10"
                        >
                          <IconInfoCircle className="size-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[240px] break-all text-xs">
                        {item.error}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
                {onRetry ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRetry(item);
                    }}
                    className="flex size-6 items-center justify-center rounded bg-black/40 text-white transition-colors hover:bg-primary"
                  >
                    <IconRefresh className="size-3" />
                  </button>
                ) : null}
                {onDelete ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(item);
                    }}
                    className="flex size-6 items-center justify-center rounded bg-black/40 text-white transition-colors hover:bg-destructive"
                  >
                    <IconTrash className="size-3" />
                  </button>
                ) : null}
              </div>
            </div>
          );
        }

        // Success / history — has image
        return (
          <div
            key={item.id}
            className={cn(
              "group relative cursor-pointer overflow-hidden rounded-lg border-2 transition-colors",
              aspectRatio === "video" ? "aspect-video" : "aspect-square",
              isSelected ? "border-primary" : "border-transparent hover:border-primary/40"
            )}
            onClick={() => onPreview?.(item)}
          >
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : mediaUrl ? (
              <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground/50">
                {mediaType === "video" ? <IconPlayerPlay className="size-5" /> : null}
              </div>
            ) : null}

            {/* Applied badge */}
            {isApplied && (
              <div className="absolute left-1 top-1 rounded bg-primary/90 px-1 py-0.5 text-[9px] font-medium text-white">
                {isPreferred ? "定稿" : "已用"}
              </div>
            )}

            {/* Hover actions */}
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              {showActions && actions.includes("collect") && onCollect ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCollect(item);
                  }}
                  className={cn(
                    "flex size-6 items-center justify-center rounded text-white transition-colors",
                    isApplied ? "bg-primary" : "bg-black/40 hover:bg-primary"
                  )}
                  title={isApplied ? "移除" : "添加到镜头"}
                >
                  <span className="text-[10px]">★</span>
                </button>
              ) : null}
              {showActions && actions.includes("setPreferred") && onSetPreferred ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetPreferred(item);
                  }}
                  className={cn(
                    "flex size-6 items-center justify-center rounded text-white transition-colors",
                    isPreferred ? "bg-primary" : "bg-black/40 hover:bg-primary"
                  )}
                  title={isPreferred ? "取消定稿" : "设为定稿"}
                >
                  <IconCircleCheck className="size-3" />
                </button>
              ) : null}
              {showActions && actions.includes("setReference") && onSetReference ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetReference(item);
                  }}
                  className="flex size-6 items-center justify-center rounded bg-black/40 text-white transition-colors hover:bg-primary"
                  title="设为参考"
                >
                  <IconReplace className="size-3" />
                </button>
              ) : null}
              {showActions && actions.includes("download") && onDownload ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownload(item);
                  }}
                  className="flex size-6 items-center justify-center rounded bg-black/40 text-white transition-colors hover:bg-primary"
                  title="下载"
                >
                  <IconDownload className="size-3" />
                </button>
              ) : null}
              {showActions && actions.includes("delete") && onDelete ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item);
                  }}
                  className="flex size-6 items-center justify-center rounded bg-black/40 text-white transition-colors hover:bg-destructive"
                >
                  <IconTrash className="size-3" />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
