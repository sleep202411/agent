"use client";

import { useState } from "react";
import { IconLoader2, IconMovie, IconPhoto, IconTrash, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  storyApiErrorMessage,
  type InteractiveStoryDraftContent,
  type MediaAssetSummary,
  type StoryCandidateAsset,
} from "@/lib/story-projects-api";
import {
  StoryCandidateAssetPickerDialog,
  type StoryCandidateAssetUploadState,
} from "./story-candidate-asset-picker-dialog";

type FoundationField = "logline" | "synopsis" | "worldview";

export interface StoryWorldCoverMediaProps {
  cover: MediaAssetSummary | null;
  candidateAssets: StoryCandidateAsset[];
  candidateAssetsLoading: boolean;
  candidateAssetsError: string | null;
  disabledReason?: string | null;
  onRetryCandidates: () => void;
  onSelectCandidate: (candidate: StoryCandidateAsset) => Promise<void>;
  onClearSelection: () => Promise<void>;
  onUpload: (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ) => Promise<void>;
}

interface StoryWorldLibraryProps {
  content: InteractiveStoryDraftContent;
  canEdit: boolean;
  coverMedia: StoryWorldCoverMediaProps;
  onUpdateFoundation: (field: FoundationField, value: string) => void;
  onClose: () => void;
}

export function StoryWorldLibrary({
  content,
  canEdit,
  coverMedia,
  onUpdateFoundation,
  onClose,
}: StoryWorldLibraryProps) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.12em] text-white/34 uppercase">
            {t("world.eyebrow")}
          </p>
          <h2 className="mt-1 text-base font-semibold">{t("world.title")}</h2>
          <p className="mt-1 text-[11px] leading-5 text-white/38">{t("world.description")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/48 transition hover:bg-white/[0.1] hover:text-white"
          aria-label={t("inspector.close")}
        >
          <IconX className="size-4" />
        </button>
      </header>

      <div className="mt-5">
        <ProjectCoverEditor canEdit={canEdit} media={coverMedia} />
        <FoundationEditor
          content={content}
          canEdit={canEdit}
          onUpdateFoundation={onUpdateFoundation}
        />
      </div>
    </>
  );
}

function ProjectCoverEditor({
  canEdit,
  media,
}: {
  canEdit: boolean;
  media: StoryWorldCoverMediaProps;
}) {
  const t = useTranslations("storyStudio.canvas");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [clearPending, setClearPending] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const coverUsable =
    media.cover?.status === "ready" &&
    media.cover.moderationStatus !== "blocked" &&
    Boolean(media.cover.previewUrl);
  const dimensions =
    media.cover?.width && media.cover.height ? `${media.cover.width}×${media.cover.height}` : null;
  const duration =
    media.cover?.kind === "video" && media.cover.durationSeconds !== null
      ? formatDuration(media.cover.durationSeconds)
      : null;

  return (
    <section className="border-b border-white/[0.06] pb-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-semibold text-white/72">{t("world.cover.title")}</h3>
          <p className="mt-1 text-[10px] leading-4 text-white/34">{t("world.cover.description")}</p>
        </div>
        {media.cover ? (
          <span className="shrink-0 text-[9px] text-white/30">
            {media.cover.kind === "video"
              ? t("candidatePicker.filters.video")
              : t("candidatePicker.filters.image")}
            {[dimensions, duration].filter(Boolean).length > 0
              ? ` · ${[dimensions, duration].filter(Boolean).join(" · ")}`
              : ""}
          </span>
        ) : null}
      </div>

      <div className="mt-3 aspect-video overflow-hidden rounded-2xl bg-black/28">
        {coverUsable && media.cover?.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed project media URL
          <img
            src={media.cover.previewUrl as string}
            alt={t("world.cover.imageAlt")}
            className="size-full object-cover"
          />
        ) : coverUsable && media.cover?.kind === "video" ? (
          <video
            src={media.cover.previewUrl as string}
            aria-label={t("world.cover.videoLabel")}
            muted
            controls
            playsInline
            preload="metadata"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-white/24">
            <span className="grid size-9 place-items-center rounded-full bg-white/[0.055]">
              {media.cover?.kind === "video" ? (
                <IconMovie className="size-4" stroke={1.6} />
              ) : (
                <IconPhoto className="size-4" stroke={1.6} />
              )}
            </span>
            <span className="text-[9px] font-medium">
              {media.cover ? t("world.cover.unavailable") : t("world.cover.empty")}
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!canEdit}
          title={!canEdit ? (media.disabledReason ?? undefined) : undefined}
          onClick={() => setPickerOpen(true)}
          className="h-8 rounded-xl px-3 text-[10px]"
        >
          <IconPhoto className="size-3.5" stroke={1.8} />
          {media.cover ? t("world.cover.replace") : t("world.cover.choose")}
        </Button>
        {media.cover ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!canEdit || clearPending}
            title={!canEdit ? (media.disabledReason ?? undefined) : undefined}
            onClick={() => {
              setClearPending(true);
              setClearError(null);
              void media
                .onClearSelection()
                .catch((error) =>
                  setClearError(storyApiErrorMessage(error, t("candidatePicker.clearError")))
                )
                .finally(() => setClearPending(false));
            }}
            className="h-8 rounded-xl px-3 text-[10px] text-white/42 hover:text-[#ff9b9e]"
          >
            {clearPending ? (
              <IconLoader2 className="size-3.5 animate-spin" stroke={1.8} />
            ) : (
              <IconTrash className="size-3.5" stroke={1.8} />
            )}
            {t("world.cover.remove")}
          </Button>
        ) : null}
      </div>
      {clearError ? (
        <p className="mt-2 text-[9px] leading-4 text-destructive-foreground" role="alert">
          {clearError}
        </p>
      ) : null}

      <StoryCandidateAssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        items={media.candidateAssets}
        allowedKinds={["image", "video"]}
        currentAssetId={media.cover?.id}
        loading={media.candidateAssetsLoading}
        error={media.candidateAssetsError}
        canSelect={canEdit}
        disabledReason={media.disabledReason}
        onRetry={media.onRetryCandidates}
        isSelectable={(candidate) =>
          candidate.asset.status === "ready" &&
          candidate.asset.moderationStatus !== "blocked" &&
          Boolean(candidate.asset.previewUrl)
        }
        unavailableReason={() => t("world.cover.unavailable")}
        onSelect={media.onSelectCandidate}
        onClearSelection={media.onClearSelection}
        uploadAccept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,.jpg,.jpeg,.png,.webp,.mp4,.mov"
        onUpload={media.onUpload}
      />
    </section>
  );
}

function FoundationEditor({
  content,
  canEdit,
  onUpdateFoundation,
}: Pick<StoryWorldLibraryProps, "content" | "canEdit" | "onUpdateFoundation">) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <div>
      <p className="text-[10px] leading-4 text-white/36">{t("foundation.description")}</p>
      <FoundationField
        label={t("foundation.logline")}
        placeholder={t("foundation.loglinePlaceholder")}
        value={content.storyBible.logline}
        rows={3}
        maxLength={1_000}
        disabled={!canEdit}
        onChange={(value) => onUpdateFoundation("logline", value)}
      />
      <FoundationField
        label={t("foundation.synopsis")}
        placeholder={t("foundation.synopsisPlaceholder")}
        value={content.storyBible.synopsis}
        rows={7}
        maxLength={20_000}
        disabled={!canEdit}
        onChange={(value) => onUpdateFoundation("synopsis", value)}
      />
      <FoundationField
        label={t("foundation.worldview")}
        placeholder={t("foundation.worldviewPlaceholder")}
        value={content.storyBible.worldview}
        rows={5}
        maxLength={20_000}
        disabled={!canEdit}
        onChange={(value) => onUpdateFoundation("worldview", value)}
      />
    </div>
  );
}

function formatDuration(seconds: number): string {
  const normalized = Math.max(0, seconds);
  if (normalized < 60) return `${normalized.toFixed(normalized % 1 === 0 ? 0 : 1)}s`;
  const minutes = Math.floor(normalized / 60);
  const remainder = Math.round(normalized % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function FoundationField({
  label,
  placeholder,
  value,
  rows,
  maxLength,
  disabled,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  rows: number;
  maxLength: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-4 block">
      <span className="text-[10px] font-semibold text-white/42">{label}</span>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        className="mt-2 resize-none bg-white/[0.055] text-xs leading-5"
      />
    </label>
  );
}
