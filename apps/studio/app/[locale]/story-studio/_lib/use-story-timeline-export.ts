"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  exportTimelineToMp4,
  isExportSupported,
  triggerBlobDownload,
  TimelineExportUnsupportedError,
  type ExportableShot,
} from "@repo/timeline-export";
import type { StoryStoryboardSequence } from "@/lib/story-production-api";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import { addStoryCandidateAsset } from "@/lib/story-projects-api";

export interface UseStoryTimelineExportOptions {
  sequence: StoryStoryboardSequence | null;
  projectId: string;
  chapterId: string | null;
  onComplete?: (assetId: string) => void;
}

export type StoryTimelineExportError =
  | "no_clips_with_media"
  | "browser_unsupported"
  | "cancelled"
  | "failed"
  | null;

export function useStoryTimelineExport({
  sequence,
  projectId,
  chapterId,
  onComplete,
}: UseStoryTimelineExportOptions) {
  const t = useTranslations("storyStudio.timelineExport");
  const clips = sequence?.clips;
  const validShots = useMemo(() => {
    if (!clips?.length) return [];
    const result: ExportableShot[] = [];
    for (const clip of clips) {
      const videoUrl = clip.selectedMediaVersion?.previewUrl;
      if (!videoUrl) {
        continue;
      }
      result.push({
        id: clip.id,
        videoUrl,
        duration: clip.durationMs > 0 ? clip.durationMs / 1000 : undefined,
      });
    }
    return result;
  }, [clips]);

  const mediaKey = JSON.stringify(validShots);
  const scope = useMemo(
    () => ({ sequenceId: sequence?.id, projectId, chapterId, mediaKey }),
    [sequence?.id, projectId, chapterId, mediaKey]
  );
  type Recovery = { blob: Blob; mediaAssetId?: string };
  type Owner = {
    scope: typeof scope;
    operation: AbortController | null;
    recovery: Recovery | null;
  };
  const owner = useRef<Owner | null>(null);

  useEffect(() => {
    const current: Owner = { scope, operation: null, recovery: null };
    owner.current = current;
    return () => {
      current.operation?.abort();
      if (owner.current === current) owner.current = null;
    };
  }, [scope]);

  const [progress, setProgress] = useState<{ scope: typeof scope; ratio: number } | null>(null);
  const [stage, setStage] = useState<"idle" | "exporting" | "uploading" | "saving">("idle");
  const [failure, setFailure] = useState<{
    scope: typeof scope;
    error: StoryTimelineExportError;
  } | null>(null);
  const error = failure?.scope === scope ? failure.error : null;
  const setError = useCallback(
    (error: StoryTimelineExportError) => setFailure({ scope, error }),
    [scope]
  );
  const [lastBlob, setLastBlob] = useState<{ scope: typeof scope; blob: Blob } | null>(null);

  const isExporting = progress?.scope === scope && stage !== "idle";
  const exportProgress = progress?.scope === scope ? progress.ratio : 0;

  const canExport = validShots.length > 0;

  const cancel = useCallback(() => {
    const owned = owner.current;
    if (owned?.scope !== scope) return;
    if (owned.operation) {
      owned.operation.abort();
      owned.operation = null;
    }
    owned.recovery = null;
    setStage("idle");
    setProgress(null);
  }, [scope]);

  const handleExport = useCallback(async () => {
    const owned = owner.current;
    if (owned?.scope !== scope || owned.operation) return;

    if (!validShots.length) {
      setError("no_clips_with_media");
      toast.warning(t("noMedia"));
      return;
    }

    if (!owned.recovery && !isExportSupported()) {
      setError("browser_unsupported");
      toast.error(t("unsupported"));
      return;
    }

    setError(null);
    const operation = new AbortController();
    owned.operation = operation;
    const signal = operation.signal;

    const current = () =>
      owner.current === owned && owned.operation === operation && !signal.aborted;

    setStage("exporting");
    setProgress({ scope, ratio: 0 });

    try {
      let recovery = owned.recovery;
      if (!recovery) {
        const blob = await exportTimelineToMp4(validShots, {
          signal,
          onProgress: (ratio) => {
            if (current()) setProgress({ scope, ratio });
          },
        });
        if (!current()) return;
        recovery = { blob };
        owned.recovery = recovery;
        setLastBlob({ scope, blob });
      }

      // Resume only this exact timeline snapshot. A failed asset attachment
      // must not create another stored video; candidate attachment is an upsert.
      let mediaAssetId = recovery.mediaAssetId;
      if (!mediaAssetId) {
        const filename = `story-${projectId.slice(0, 8)}-stitched-${Date.now()}.mp4`;
        const file = new File([recovery.blob], filename, { type: "video/mp4" });
        setStage("uploading");
        setProgress({ scope, ratio: 0 });
        const uploaded = await uploadFileViaSignedUrl(file, {
          kind: "ai_reference_video",
          scope: { storyProjectId: projectId },
          onProgress: (uploadPercent) => {
            if (current()) setProgress({ scope, ratio: uploadPercent / 100 });
          },
          signal,
        });
        if (!current()) return;
        mediaAssetId = uploaded.mediaAssetId;
        owned.recovery = { blob: recovery.blob, mediaAssetId };
      }

      setStage("saving");
      await addStoryCandidateAsset(projectId, mediaAssetId);
      if (!current()) return;
      owned.recovery = null;

      // Step g: On complete
      toast.success(t("saved"));
      onComplete?.(mediaAssetId);
    } catch (err: unknown) {
      if (!current()) return;
      console.error("[StoryTimelineExport] failed:", err);
      if (err instanceof TimelineExportUnsupportedError) {
        setError("browser_unsupported");
        toast.error(t("unsupported"));
        return;
      }
      setError("failed");
      toast.error(err instanceof Error && err.message ? err.message : t("failed"));
    } finally {
      if (current()) {
        owned.operation = null;
        setStage("idle");
        setProgress(null);
      }
    }
  }, [scope, validShots, projectId, onComplete, setError, t]);

  const downloadOnly = useCallback(async () => {
    const owned = owner.current;
    if (owned?.scope !== scope) return;
    setError(null);
    if (lastBlob?.scope === scope && lastBlob.blob) {
      const filename = `story-${projectId.slice(0, 8)}-stitched-${Date.now()}.mp4`;
      try {
        triggerBlobDownload(lastBlob.blob, filename);
        toast.success(t("downloadStarted"));
      } catch (err: unknown) {
        setError("failed");
        toast.error(err instanceof Error && err.message ? err.message : t("failed"));
      }
      return;
    }

    // If not already exported, run export and download directly
    if (!validShots.length) {
      toast.warning(t("noMedia"));
      return;
    }
    if (!isExportSupported()) {
      toast.error(t("unsupported"));
      return;
    }

    if (owned.operation) return;

    const operation = new AbortController();
    owned.operation = operation;
    const signal = operation.signal;
    const current = () =>
      owner.current === owned && owned.operation === operation && !signal.aborted;

    setStage("exporting");
    setProgress({ scope, ratio: 0 });

    try {
      const blob = await exportTimelineToMp4(validShots, {
        signal,
        onProgress: (ratio) => {
          if (current()) setProgress({ scope, ratio });
        },
      });

      if (!current()) return;
      setLastBlob({ scope, blob });
      const filename = `story-${projectId.slice(0, 8)}-stitched-${Date.now()}.mp4`;
      triggerBlobDownload(blob, filename);
      toast.success(t("downloadStarted"));
    } catch (err: unknown) {
      if (!current()) return;
      setError(err instanceof TimelineExportUnsupportedError ? "browser_unsupported" : "failed");
      toast.error(err instanceof Error && err.message ? err.message : t("failed"));
    } finally {
      if (current()) {
        owned.operation = null;
        setStage("idle");
        setProgress(null);
      }
    }
  }, [scope, lastBlob, validShots, projectId, setError, t]);

  return {
    isExporting,
    exportProgress,
    exportStage: isExporting ? stage : "idle",
    error,
    canExport,
    validShotsCount: validShots.length,
    handleExport,
    cancel,
    downloadOnly,
  };
}
