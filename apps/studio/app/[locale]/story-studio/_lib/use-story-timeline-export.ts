"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
  const scope = useMemo(
    () => ({ sequenceId: sequence?.id, projectId, chapterId }),
    [sequence?.id, projectId, chapterId]
  );
  const owner = useRef<{ scope: typeof scope; operation: AbortController | null } | null>(null);

  useEffect(() => {
    const current = { scope, operation: null as AbortController | null };
    owner.current = current;
    return () => {
      current.operation?.abort();
      if (owner.current === current) owner.current = null;
    };
  }, [scope]);

  const [progress, setProgress] = useState<{ scope: typeof scope; ratio: number } | null>(null);
  const [stage, setStage] = useState<"idle" | "exporting" | "uploading" | "saving">("idle");
  const [error, setError] = useState<StoryTimelineExportError>(null);
  const [lastBlob, setLastBlob] = useState<{ scope: typeof scope; blob: Blob } | null>(null);

  const isExporting = progress?.scope === scope && stage !== "idle";
  const exportProgress = progress?.scope === scope ? progress.ratio : 0;

  const validShots = useMemo(() => {
    if (!sequence?.clips?.length) return [];
    const result: ExportableShot[] = [];
    for (const clip of sequence.clips) {
      const videoUrl = clip.selectedMediaVersion?.previewUrl;
      if (!videoUrl) {
        console.warn(`[StoryTimelineExport] clip ${clip.id} has no previewUrl, skipping`);
        continue;
      }
      result.push({
        id: clip.id,
        videoUrl,
        duration: clip.durationMs > 0 ? clip.durationMs / 1000 : undefined,
      });
    }
    return result;
  }, [sequence?.clips]);

  const canExport = validShots.length > 0;

  const cancel = useCallback(() => {
    const owned = owner.current;
    if (owned?.operation) {
      owned.operation.abort();
      owned.operation = null;
    }
    setStage("idle");
    setProgress(null);
  }, []);

  const handleExport = useCallback(async () => {
    const owned = owner.current;
    if (owned?.scope !== scope || owned.operation) return;

    if (!validShots.length) {
      setError("no_clips_with_media");
      toast.warning("没有可导出的媒体片段");
      return;
    }

    if (!isExportSupported()) {
      setError("browser_unsupported");
      toast.error("当前浏览器不支持视频合成导出，建议使用 Chrome 浏览器");
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
      const blob = await exportTimelineToMp4(validShots, {
        signal,
        onProgress: (ratio) => {
          if (current()) {
            setProgress({ scope, ratio });
          }
        },
      });

      if (!current()) return;
      setLastBlob({ scope, blob });

      // Step d: Create file object
      const filename = `story-${projectId.slice(0, 8)}-stitched-${Date.now()}.mp4`;
      const file = new File([blob], filename, { type: "video/mp4" });

      // Step e: Upload via signed url (matching lines 1174-1182)
      setStage("uploading");
      const uploaded = await uploadFileViaSignedUrl(file, {
        kind: "ai_reference_video",
        scope: { storyProjectId: projectId },
        onProgress: (uploadRatio) => {
          if (current()) {
            // keep ratio normalized
            setProgress({ scope, ratio: uploadRatio });
          }
        },
        signal,
      });

      if (!current()) return;

      // Step f: Add candidate asset
      setStage("saving");
      await addStoryCandidateAsset(projectId, uploaded.mediaAssetId);

      if (!current()) return;

      // Step g: On complete
      toast.success("成片已保存到项目资产库");
      onComplete?.(uploaded.mediaAssetId);
    } catch (err: any) {
      if (!current()) return;
      console.error("[StoryTimelineExport] failed:", err);
      if (err instanceof TimelineExportUnsupportedError) {
        setError("browser_unsupported");
        toast.error("当前浏览器不支持视频合成导出");
        return;
      }
      setError("failed");
      toast.error(`成片合成失败: ${err?.message || String(err)}`);
    } finally {
      if (current()) {
        owned.operation = null;
        setStage("idle");
        setProgress(null);
      }
    }
  }, [scope, validShots, projectId, onComplete]);

  const downloadOnly = useCallback(async () => {
    if (lastBlob?.scope === scope && lastBlob.blob) {
      const filename = `story-${projectId.slice(0, 8)}-stitched-${Date.now()}.mp4`;
      triggerBlobDownload(lastBlob.blob, filename);
      toast.success("开始下载已合成的成片");
      return;
    }

    // If not already exported, run export and download directly
    if (!validShots.length) {
      toast.warning("没有可导出的媒体片段");
      return;
    }
    if (!isExportSupported()) {
      toast.error("当前浏览器不支持视频合成导出");
      return;
    }

    const owned = owner.current;
    if (owned?.scope !== scope || owned.operation) return;

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
      toast.success("成片已导出并开始下载");
    } catch (err: any) {
      if (!current()) return;
      toast.error(`导出下载失败: ${err?.message || String(err)}`);
    } finally {
      if (current()) {
        owned.operation = null;
        setStage("idle");
        setProgress(null);
      }
    }
  }, [scope, lastBlob, validShots, projectId]);

  return {
    isExporting,
    exportProgress,
    exportStage: stage,
    error,
    canExport,
    validShotsCount: validShots.length,
    handleExport,
    cancel,
    downloadOnly,
  };
}
