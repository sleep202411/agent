"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconLoader2,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AudioPlayer } from "@/components/media/audio-player";
import { cn } from "@/lib/utils";

type MediaPreviewType = "image" | "video" | "audio";

interface MediaPreviewDetail {
  label: string;
  value?: React.ReactNode;
}

interface MediaPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: MediaPreviewType;
  src?: string | null;
  name?: string | null;
  link?: string | null;
  createdAt?: string | null;
  details?: MediaPreviewDetail[];
  onDownload?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}

function formatDateTime(value?: string | null, fallback = "Unknown") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function truncateMiddle(value: string, head = 36, tail = 16) {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function MediaPreviewModal({
  open,
  onOpenChange,
  type,
  src,
  name,
  link,
  createdAt,
  details = [],
  onDownload,
  onDelete,
}: MediaPreviewModalProps) {
  const t = useTranslations("asset");
  const tc = useTranslations("common");
  const [mounted, setMounted] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const copyTarget = link || src || "";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const originalOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  const resolvedName = useMemo(() => {
    if (name?.trim()) return name.trim();
    if (type === "image") return t("imagePreview");
    if (type === "video") return t("videoPreview");
    return t("audioPreview");
  }, [name, type]);

  const handleCopyLink = async () => {
    if (!copyTarget) {
      toast.error(t("noCopyLink"));
      return;
    }

    try {
      await navigator.clipboard.writeText(copyTarget);
      toast.success(tc("copySuccess"));
    } catch (error) {
      console.error("[MediaPreviewModal] 复制链接失败:", error);
      toast.error(tc("copyFailed"));
    }
  };

  const handleDownload = async () => {
    if (!src) return;
    if (onDownload) {
      await onDownload();
      return;
    }

    setDownloading(true);
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const linkElement = document.createElement("a");
      linkElement.href = blobUrl;
      linkElement.download = resolvedName;
      document.body.appendChild(linkElement);
      linkElement.click();
      document.body.removeChild(linkElement);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("[MediaPreviewModal] 下载失败:", error);
      window.open(src, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      onOpenChange(false);
    } finally {
      setDeleting(false);
    }
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[140] bg-background/58 backdrop-blur-2xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_color-mix(in_oklab,var(--foreground)_10%,transparent),_transparent_38%),radial-gradient(circle_at_bottom,_color-mix(in_oklab,var(--primary)_10%,transparent),_transparent_34%)]" />
      <div className="absolute inset-0" onClick={() => onOpenChange(false)} aria-hidden="true" />

      <div className="relative mx-auto flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[1800px] gap-4 px-2 py-4">
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col px-3 py-2"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex flex-1 items-center justify-center overflow-hidden p-2">
            {src ? (
              type === "image" ? (
                <img
                  src={src}
                  alt={resolvedName}
                  className="max-h-full max-w-full rounded-2xl object-contain"
                />
              ) : type === "video" ? (
                <video
                  src={src}
                  className="max-h-full max-w-full rounded-2xl bg-black/20 object-contain"
                  controls
                  playsInline
                  autoPlay
                />
              ) : (
                <div className="w-full max-w-3xl px-3 py-2">
                  <AudioPlayer src={src} name={resolvedName} />
                </div>
              )
            ) : (
              <div className="text-sm text-muted-foreground">{t("previewNotSupported")}</div>
            )}
          </div>

          <div className="mt-4 flex justify-center px-2">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="soft"
                color="muted"
                onClick={() => void handleDownload()}
                disabled={!src || downloading}
              >
                {downloading ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconDownload className="size-4" />
                )}
                {tc("download")}
              </Button>
              <Button
                variant="outline"
                color="muted"
                onClick={() => void handleCopyLink()}
                disabled={!copyTarget}
              >
                <IconCopy className="size-4" />
                {t("copyLink")}
              </Button>
              {onDelete ? (
                <Button
                  variant="soft"
                  color="destructive"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                >
                  {deleting ? (
                    <IconLoader2 className="size-4 animate-spin" />
                  ) : (
                    <IconTrash className="size-4" />
                  )}
                  {tc("delete")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <aside
          className="hidden w-[340px] shrink-0 rounded-2xl border border-border bg-popover/95 p-4 text-popover-foreground shadow-2xl lg:flex lg:flex-col"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold">{resolvedName}</div>
              <div className="mt-1 text-xs text-muted-foreground">{type.toUpperCase()}</div>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <IconX className="size-5" />
            </button>
          </div>

          <div className="mt-6 flex-1 space-y-5 overflow-auto">
            <InfoBlock label={t("labelName")} value={resolvedName} fallback={t("notAvailable")} />
            <InfoBlock
              label={t("labelLink")}
              fallback={t("notAvailable")}
              value={
                copyTarget ? (
                  <div className="flex items-start gap-2">
                    <span className="break-all">{truncateMiddle(copyTarget)}</span>
                    <button
                      type="button"
                      onClick={() => void handleCopyLink()}
                      className="mt-0.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <IconExternalLink className="size-4" />
                    </button>
                  </div>
                ) : undefined
              }
            />
            <InfoBlock
              label={t("labelDate")}
              value={formatDateTime(createdAt, t("unknown"))}
              fallback={t("notAvailable")}
            />
            {details.map((detail) => (
              <InfoBlock
                key={detail.label}
                label={detail.label}
                value={detail.value}
                fallback={t("notAvailable")}
              />
            ))}
          </div>
        </aside>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className={cn(
            "absolute right-4 top-6 z-[141] flex size-9 items-center justify-center rounded-full border border-border bg-popover/80 text-popover-foreground/80 transition-colors hover:bg-popover hover:text-popover-foreground lg:hidden"
          )}
        >
          <IconX className="size-5" />
        </button>
      </div>
    </div>,
    document.body
  );
}

function InfoBlock({
  label,
  value,
  fallback = "N/A",
}: {
  label: string;
  value?: React.ReactNode;
  fallback?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="rounded-2xl border border-border bg-muted/20 px-3 py-3 text-sm text-foreground">
        {value ?? fallback}
      </div>
    </div>
  );
}
