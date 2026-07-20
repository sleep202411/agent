"use client";

import { useEffect, useRef, useState } from "react";
import { IconAlertTriangle, IconLoader2, IconMovie, IconUpload } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StudioVideoPlayer } from "@/components/media/studio-video-player";
import { storyApiErrorMessage, type StoryClipVideoSummary } from "@/lib/story-projects-api";

const CLIP_VIDEO_ACCEPT = "video/mp4,.mp4";

export type StoryClipMediaUploadState =
  | { stage: "uploading"; progress: number }
  | { stage: "processing" };

export interface StoryClipMediaPanelProps {
  clip: StoryClipVideoSummary | null;
  canEdit: boolean;
  disabledReason?: string | null;
  onUpload: (
    file: File,
    onState: (state: StoryClipMediaUploadState) => void,
    signal: AbortSignal
  ) => Promise<void>;
}

/**
 * The clip inspector's deliberately small media surface. Authoring graph
 * structure stays on the canvas; this panel owns only the clip's current
 * playable video and the two honest ways to replace it.
 */
export function StoryClipMediaPanel({
  clip,
  canEdit,
  disabledReason,
  onUpload,
}: StoryClipMediaPanelProps) {
  const t = useTranslations("storyStudio.canvas.inspector.media");
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [uploadState, setUploadState] = useState<StoryClipMediaUploadState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentVideo = clip?.currentVideo ?? null;
  const previewUrl = currentVideo?.asset.previewUrl ?? null;
  const busy = uploadState !== null;
  // Upload is valid before this graph node has any video-plane state.
  const disabled = !canEdit || busy;
  const uploadTitle = disabledReason ?? undefined;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadAbortRef.current?.abort();
    };
  }, []);

  const uploadFile = async (file: File) => {
    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploadState({ stage: "uploading", progress: 0 });
    setError(null);
    try {
      await onUpload(
        file,
        (nextState) => {
          if (mountedRef.current && uploadAbortRef.current === controller) {
            setUploadState(
              nextState.stage === "uploading"
                ? {
                    stage: "uploading",
                    progress: Math.min(100, Math.max(0, Math.round(nextState.progress))),
                  }
                : nextState
            );
          }
        },
        controller.signal
      );
    } catch (uploadError) {
      if (!controller.signal.aborted && mountedRef.current) {
        setError(storyApiErrorMessage(uploadError, t("errors.upload")));
      }
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      if (mountedRef.current) setUploadState(null);
    }
  };

  const width = currentVideo?.width ?? null;
  const height = currentVideo?.height ?? null;
  const durationSeconds = currentVideo ? currentVideo.durationMs / 1_000 : null;

  return (
    <section className="mt-6 rounded-[20px] bg-white/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-white/78">{t("title")}</h3>
          <p className="mt-1 text-[10px] leading-4 text-white/36">{t("description")}</p>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-[16px] bg-black/28">
        <div className="relative aspect-video max-h-48 w-full">
          {previewUrl && currentVideo ? (
            <StudioVideoPlayer
              source={{ src: previewUrl, type: currentVideo.contentType }}
              ariaLabel={t("preview", { title: clip?.graphNodeId ?? "" })}
              controlDensity="compact"
              fit="contain"
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-white/[0.055] text-white/28">
                <IconMovie className="size-4" stroke={1.7} />
              </span>
              <div>
                <p className="text-[11px] font-semibold text-white/54">{t("empty")}</p>
                <p className="mt-1 text-[9px] leading-4 text-white/28">{t("emptyDescription")}</p>
              </div>
            </div>
          )}
        </div>
        {clip ? (
          <div className="flex items-center justify-between gap-3 bg-white/[0.035] px-3 py-2 text-[9px] text-white/38">
            <span className="truncate">
              {width && height ? `${width}×${height}` : t("unknownDimensions")}
            </span>
            <span className="shrink-0 tabular-nums">
              {durationSeconds === null ? t("unknownDuration") : formatDuration(durationSeconds)}
            </span>
          </div>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={CLIP_VIDEO_ACCEPT}
        className="hidden"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadFile(file);
        }}
      />

      <Button
        type="button"
        variant="secondary"
        size="lg"
        disabled={disabled}
        title={uploadTitle}
        className="mt-3 w-full rounded-xl bg-white/[0.08]"
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <IconLoader2 className="size-4 animate-spin" /> : <IconUpload className="size-4" />}
        {uploadState?.stage === "processing"
          ? t("processing")
          : uploadState?.stage === "uploading"
            ? t("uploading", { progress: uploadState.progress })
            : currentVideo
              ? t("replace")
              : t("upload")}
      </Button>
      {uploadState?.stage === "uploading" ? (
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={uploadState.progress}
          aria-label={t("uploading", { progress: uploadState.progress })}
        >
          <div
            className="h-full rounded-full bg-white/55 transition-[width] duration-150"
            style={{ width: `${uploadState.progress}%` }}
          />
        </div>
      ) : (
        <p
          className="mt-1.5 text-center text-[9px] text-white/28"
          role={uploadState?.stage === "processing" ? "status" : undefined}
        >
          {uploadState?.stage === "processing" ? t("processingDescription") : t("accepted")}
        </p>
      )}

      {error ? (
        <p
          className="mt-3 flex items-start gap-2 rounded-xl bg-[rgba(229,34,39,0.1)] px-3 py-2 text-[10px] leading-4 text-[#ffb2b4]"
          role="alert"
        >
          <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </section>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const rounded = Math.max(0, seconds);
  if (rounded < 60) return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = Math.round(rounded % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
