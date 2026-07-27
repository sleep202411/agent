"use client";

import { useState } from "react";
import { IconBookmark, IconChevronRight, IconLoader2, IconMovie } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { StudioVideoPlayer } from "@/components/media/studio-video-player";
import type { StoryCandidateAsset, StoryClipVideoSummary } from "@/lib/story-projects-api";
import {
  StoryCandidateAssetPickerDialog,
  type StoryCandidateAssetUploadState,
} from "./story-candidate-asset-picker-dialog";

const CLIP_VIDEO_ACCEPT = "video/mp4,.mp4";
const CLIP_CANDIDATE_KINDS = ["video"] as const;

export interface StoryClipMediaPanelProps {
  clip: StoryClipVideoSummary | null;
  canEdit: boolean;
  disabledReason?: string | null;
  candidateAssets: StoryCandidateAsset[];
  candidateAssetsLoading?: boolean;
  candidateAssetsError?: string | null;
  onRetryCandidates?: () => void;
  onSelectCandidate: (candidate: StoryCandidateAsset) => Promise<void>;
  onClearSelection: () => Promise<void>;
  onUpload: (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
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
  candidateAssets,
  candidateAssetsLoading = false,
  candidateAssetsError = null,
  onRetryCandidates,
  onSelectCandidate,
  onClearSelection,
  onUpload,
}: StoryClipMediaPanelProps) {
  const t = useTranslations("storyStudio.canvas.inspector.media");
  const [candidatePickerOpen, setCandidatePickerOpen] = useState(false);
  const currentVideo = clip?.currentVideo ?? null;
  const previewUrl = currentVideo?.asset.previewUrl ?? null;
  const disabled = !canEdit;
  const uploadTitle = disabledReason ?? undefined;
  const videoCandidates = candidateAssets.filter((candidate) => candidate.asset.kind === "video");

  const width = currentVideo?.width ?? null;
  const height = currentVideo?.height ?? null;
  const durationSeconds = currentVideo?.durationMs != null ? currentVideo.durationMs / 1_000 : null;

  return (
    <section className="mt-6">
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

      <button
        type="button"
        onClick={() => setCandidatePickerOpen(true)}
        className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-white/[0.055] px-3 py-3 text-left transition hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
        aria-haspopup="dialog"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white/58">
          {candidateAssetsLoading ? (
            <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
          ) : (
            <IconBookmark className="size-4" stroke={1.8} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold text-white/68">
            {t("candidateAction")}
          </span>
          <span className="mt-0.5 block truncate text-[9px] text-white/32">
            {candidateAssetsError
              ? t("candidateLoadError")
              : t("candidateActionDescription", { count: videoCandidates.length })}
          </span>
        </span>
        <IconChevronRight className="size-4 shrink-0 text-white/28" stroke={1.8} />
      </button>

      <StoryCandidateAssetPickerDialog
        open={candidatePickerOpen}
        onOpenChange={setCandidatePickerOpen}
        items={candidateAssets}
        allowedKinds={CLIP_CANDIDATE_KINDS}
        currentAssetId={currentVideo?.asset.id ?? null}
        loading={candidateAssetsLoading}
        error={candidateAssetsError}
        canSelect={!disabled}
        disabledReason={uploadTitle}
        onRetry={onRetryCandidates}
        isSelectable={(candidate) =>
          Boolean(
            candidate.asset.previewUrl &&
            candidate.videoVariant &&
            candidate.videoVariant.contentType.toLowerCase().startsWith("video/")
          )
        }
        unavailableReason={() => t("candidateUnavailable")}
        onSelect={onSelectCandidate}
        onClearSelection={onClearSelection}
        uploadAccept={CLIP_VIDEO_ACCEPT}
        onUpload={onUpload}
      />
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
