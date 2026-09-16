"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { toast } from "sonner";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import {
  exportTimelineToMp4,
  isExportSupported,
  triggerBlobDownload,
  TimelineExportError,
  TimelineExportUnsupportedError,
  type ExportableShot,
} from "@/src/lib/timeline-export-mediabunny";

export function useTimelineExport(
  shots: ExportableShot[],
  projectId: string | null,
  episodeId: string | null
) {
  const { user } = useCurrentUser();
  const userId = user?.id;
  const scope = useMemo(() => ({ projectId, episodeId, userId }), [projectId, episodeId, userId]);
  const owner = useRef<{ scope: typeof scope; operation: AbortController | null } | null>(null);
  useLayoutEffect(() => {
    const current = { scope, operation: null as AbortController | null };
    owner.current = current;
    return () => {
      current.operation?.abort();
      if (owner.current === current) owner.current = null;
    };
  }, [scope]);
  const locale = useLocale();
  const tt = useTranslations("timeline");
  const [progress, setProgress] = useState<{ scope: typeof scope; ratio: number } | null>(null);
  const isExporting = progress?.scope === scope;
  const exportProgress = isExporting ? progress.ratio : 0;
  const handleExportMp4 = useCallback(async () => {
    const owned = owner.current;
    if (owned?.scope !== scope || owned.operation) return;
    if (shots.length === 0) {
      toast.warning(tt("noShots"));
      return;
    }
    // CN locale gets google.cn (Google's official mainland mirror —
    // google.com is unreachable inside the GFW). Everyone else gets
    // the canonical google.com page.
    const chromeUrl =
      locale === "zh-CN" ? "https://www.google.cn/chrome/" : "https://www.google.com/chrome/";
    const showUnsupportedToast = () => {
      toast.error(tt("exportUnsupported"), {
        description: tt("exportUnsupportedDesc"),
        duration: 10_000,
        action: {
          label: tt("downloadChrome"),
          onClick: () => window.open(chromeUrl, "_blank", "noopener"),
        },
      });
    };
    // Pre-flight: WebCodecs encoders are Chromium-only today (with
    // partial Safari coverage). Pop a sticky toast with a "Get
    // Chrome" action instead of letting the user watch the export
    // crash mid-way.
    if (!isExportSupported()) {
      showUnsupportedToast();
      return;
    }
    const operation = new AbortController();
    owned.operation = operation;
    const current = () =>
      owner.current === owned && owned.operation === operation && !operation.signal.aborted;
    setProgress({ scope, ratio: 0 });
    try {
      const blob = await exportTimelineToMp4(
        shots.map((shot) => ({
          id: shot.id,
          videoUrl: shot.videoUrl,
          duration: shot.duration,
        })),
        {
          signal: operation.signal,
          onProgress: (ratio) => {
            if (current()) setProgress({ scope, ratio });
          },
        }
      );
      if (!current()) return;
      const filename = `timeline-${Date.now()}.mp4`;
      triggerBlobDownload(blob, filename);
      toast.success(tt("exportSuccess"));
    } catch (error) {
      if (!current()) return;
      console.error("[TimelineView] export failed:", error);
      if (error instanceof TimelineExportUnsupportedError) {
        showUnsupportedToast();
        return;
      }
      const detail =
        error instanceof TimelineExportError || error instanceof Error
          ? error.message
          : String(error);
      toast.error(tt("exportFailed"), { description: detail });
    } finally {
      if (current()) {
        owned.operation = null;
        setProgress(null);
      }
    }
  }, [scope, locale, shots, tt]);
  return { isExporting, exportProgress, handleExportMp4 };
}
