"use client";

import { useState } from "react";
import { IconUpload } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { StoryCandidateAssetPickerDialog } from "./project-canvas/story-candidate-asset-picker-dialog";
import { useStoryCandidateAssets } from "./project-canvas/use-story-candidate-assets";
import type { StoryCandidateAssetUploadState } from "./project-canvas/story-candidate-asset-picker-dialog";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  patchStoryStoryboardClip,
  putStoryStoryboardTimeline,
  storyProductionKeys,
  createStoryProductionIdempotencyKey,
  type StoryStoryboardClip,
  type StoryStoryboardSequence,
} from "@/lib/story-production-api";
import {
  addStoryCandidateAsset,
  storyApiErrorMessage,
  type StoryCandidateAsset,
} from "@/lib/story-projects-api";
import {
  appendStoryTimelineClip,
  createManualStoryTimelineClipStableKey,
  STORY_TIMELINE_MAX_DURATION_MS,
  STORY_TIMELINE_MIN_CLIP_DURATION_MS,
} from "../_lib/story-timeline";

const VIDEO_ACCEPT = "video/*,.mp4,.mov,.webm";

/**
 * Upload or replace a scene video from the storyboard card. Existing clips are
 * patched in place; a scene with no clips gets one new video clip.
 */
export function StoryClipVideoReplace({
  projectId,
  chapterId,
  sequence,
  clip,
  enabled,
  placement,
  density = "card",
  aspectRatio = "16 / 9",
}: {
  projectId: string;
  chapterId: string;
  sequence: StoryStoryboardSequence;
  clip?: StoryStoryboardClip;
  enabled: boolean;
  /** Empty scenes use a media-sized slot. A clip shows replace on the picture. */
  placement: "placeholder" | "corner" | "center";
  /** `thumb` matches the inspector's small storyboard stills. */
  density?: "card" | "thumb";
  /** Matches the project frame. Callers default this to 16:9. */
  aspectRatio?: string;
}) {
  const t = useTranslations("storyStudio.storyboardPage");
  const queryClient = useQueryClient();
  const candidateAssets = useStoryCandidateAssets({ projectId, canEdit: enabled });
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const hasMedia = Boolean(clip?.selectedMediaVersion);

  const applyCandidate = async (candidate: StoryCandidateAsset) => {
    if (clip) {
      const prompt = clip.videoPrompt?.trim() || clip.imagePrompt?.trim() || t("uploadVideoPrompt");
      await patchStoryStoryboardClip(
        projectId,
        chapterId,
        sequence.id,
        clip.id,
        createStoryProductionIdempotencyKey("story-clip-video-replace"),
        {
          expectedVersion: clip.version,
          sourceMediaAssetId: candidate.asset.id,
          ...(clip.kind === "video"
            ? {}
            : { kind: "video", imagePrompt: null, videoPrompt: prompt }),
        }
      );
    } else {
      await putStoryStoryboardTimeline(
        projectId,
        chapterId,
        sequence.id,
        createStoryProductionIdempotencyKey("story-clip-video-upload"),
        appendStoryTimelineClip(sequence, {
          stableKey: createManualStoryTimelineClipStableKey(),
          kind: "video",
          title: t("uploadVideoTitle"),
          durationMs: videoDurationMs(candidate),
          prompt: t("uploadVideoPrompt"),
          description: null,
          sourceMediaAssetId: candidate.asset.id,
        })
      );
    }
    await queryClient.invalidateQueries({
      queryKey: storyProductionKeys.storyboard(projectId, chapterId),
    });
    toast.success(hasMedia ? t("replaceVideoSuccess") : t("uploadVideoSuccess"));
  };

  const uploadReplacement = async (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ) => {
    setPending(true);
    try {
      const uploaded = await uploadFileViaSignedUrl(file, {
        kind: "ai_reference_video",
        scope: { storyProjectId: projectId },
        onProgress: (progress) => onState({ stage: "uploading", progress }),
        onConfirming: () => onState({ stage: "processing" }),
        signal,
      });
      if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
      onState({ stage: "processing" });
      const candidate = await addStoryCandidateAsset(projectId, uploaded.mediaAssetId);
      await candidateAssets.refresh();
      if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
      await applyCandidate(candidate);
    } finally {
      setPending(false);
    }
  };

  const triggerClassName =
    placement === "placeholder"
      ? density === "thumb"
        ? "relative flex h-14 w-24 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-muted text-muted-foreground [--upload-stroke:var(--border)] transition hover:bg-primary/[0.08] hover:text-primary hover:[--upload-stroke:var(--primary)] focus-visible:bg-primary/[0.08] focus-visible:text-primary focus-visible:[--upload-stroke:var(--primary)] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:outline-none disabled:opacity-60"
        : "relative flex w-[min(68vw,184px)] flex-col items-center justify-center gap-2 rounded-xl bg-muted text-muted-foreground [--upload-stroke:var(--border)] transition hover:bg-primary/[0.08] hover:text-primary hover:[--upload-stroke:var(--primary)] focus-visible:bg-primary/[0.08] focus-visible:text-primary focus-visible:[--upload-stroke:var(--primary)] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:outline-none disabled:opacity-60 sm:w-[184px]"
      : placement === "center"
        ? "pointer-events-none absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-[12px] font-medium whitespace-nowrap text-primary underline-offset-4 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:underline focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:underline focus-visible:outline-none"
        : "absolute top-2 right-2 z-20 text-[12px] font-medium text-primary underline-offset-4 transition hover:underline focus-visible:underline focus-visible:outline-none";

  return (
    <>
      <button
        type="button"
        disabled={pending || !enabled}
        onClick={() => setOpen(true)}
        className={triggerClassName}
        style={placement === "placeholder" && density === "card" ? { aspectRatio } : undefined}
      >
        {placement === "placeholder" ? (
          <>
            <svg
              className="pointer-events-none absolute inset-0 size-full"
              viewBox={density === "thumb" ? "0 0 96 56" : "0 0 184 184"}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <rect
                x={density === "thumb" ? "1" : "1.25"}
                y={density === "thumb" ? "1" : "1.25"}
                width={density === "thumb" ? "94" : "181.5"}
                height={density === "thumb" ? "54" : "181.5"}
                rx={density === "thumb" ? "7" : "14"}
                fill="none"
                stroke="var(--upload-stroke)"
                strokeWidth="1.5"
                strokeDasharray="6 3"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <IconUpload
              className={density === "thumb" ? "size-3.5" : "size-5"}
              stroke={1.8}
              aria-hidden="true"
            />
            <span
              className={density === "thumb" ? "text-[9px] font-medium" : "text-xs font-medium"}
            >
              {t("uploadVideo")}
            </span>
          </>
        ) : hasMedia ? (
          t("replaceVideoAction")
        ) : (
          t("uploadVideo")
        )}
      </button>
      <StoryCandidateAssetPickerDialog
        projectId={projectId}
        open={open}
        onOpenChange={setOpen}
        items={candidateAssets.items}
        allowedKinds={["video"]}
        currentAssetId={clip?.selectedMediaVersion?.mediaAssetId ?? null}
        loading={candidateAssets.loading}
        error={candidateAssets.failed ? candidateAssets.error : null}
        canSelect={!pending}
        onRetry={() => void candidateAssets.refresh()}
        onSelect={async (candidate) => {
          setPending(true);
          try {
            await applyCandidate(candidate);
          } catch (error) {
            throw new Error(storyApiErrorMessage(error, t("uploadVideo")));
          } finally {
            setPending(false);
          }
        }}
        uploadAccept={VIDEO_ACCEPT}
        onUpload={uploadReplacement}
      />
    </>
  );
}

function videoDurationMs(candidate: StoryCandidateAsset): number {
  const seconds = candidate.videoVariant?.durationSeconds ?? candidate.asset.durationSeconds;
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return 4_000;
  return Math.min(
    STORY_TIMELINE_MAX_DURATION_MS,
    Math.max(STORY_TIMELINE_MIN_CLIP_DURATION_MS, Math.round(seconds * 1000))
  );
}
