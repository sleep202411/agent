"use client";

import { useState } from "react";
import { IconLoader2, IconPhoto, IconTrash, IconX } from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StoryCanvasTextInput } from "./story-canvas-text-input";
import {
  storyApiErrorMessage,
  type InteractiveStoryDraftContent,
  type MediaAssetSummary,
  type StoryCandidateAsset,
  type StoryProjectSummary,
} from "@/lib/story-projects-api";
import {
  StoryCandidateAssetPickerDialog,
  type StoryCandidateAssetUploadState,
} from "./story-candidate-asset-picker-dialog";

type FoundationField = "logline" | "synopsis";

export interface StoryFoundationCoverMediaProps {
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

interface StoryFoundationLibraryProps {
  project: Pick<
    StoryProjectSummary,
    "frameProfile" | "durationPreset" | "visualStyle" | "defaultLocale"
  >;
  content: InteractiveStoryDraftContent;
  canEdit: boolean;
  coverMedia: StoryFoundationCoverMediaProps;
  onUpdateFoundation: (field: FoundationField, value: string) => void;
  onClose: () => void;
}

export function StoryFoundationLibrary({
  project,
  content,
  canEdit,
  coverMedia,
  onUpdateFoundation,
  onClose,
}: StoryFoundationLibraryProps) {
  const t = useTranslations("storyStudio.canvas");
  const locale = useLocale();
  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.12em] text-white/64 uppercase">
            {t("filmFoundation.eyebrow")}
          </p>
          <h2 className="mt-1 text-base font-semibold">{t("filmFoundation.title")}</h2>
          <p className="mt-1 text-[11px] leading-5 text-white/62">
            {t("filmFoundation.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/68 transition hover:bg-white/[0.1] hover:text-white"
          aria-label={t("inspector.close")}
        >
          <IconX className="size-4" />
        </button>
      </header>

      <div className="mt-5">
        <CreativeProfileSummary project={project} locale={locale} />
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

function CreativeProfileSummary({
  project,
  locale,
}: {
  project: StoryFoundationLibraryProps["project"];
  locale: string;
}) {
  const t = useTranslations("storyStudio.canvas.filmFoundation.profile");
  const values = [
    { key: "aspectRatio", value: t(`frameProfiles.${project.frameProfile}`) },
    {
      key: "targetRuntime",
      value: project.durationPreset ? t(`durationPresets.${project.durationPreset}`) : t("notSet"),
    },
    {
      key: "visualStyle",
      value: project.visualStyle ? t(`visualStyles.${project.visualStyle}`) : t("notSet"),
    },
    {
      key: "language",
      value: `${displayLanguage(project.defaultLocale, locale)} · ${project.defaultLocale}`,
    },
  ] as const;

  return (
    <section className="border-b border-white/[0.08] pb-5" aria-labelledby="creative-profile-title">
      <h3 id="creative-profile-title" className="text-[11px] font-semibold text-white/82">
        {t("title")}
      </h3>
      <p className="mt-1 text-[10px] leading-4 text-white/64">{t("description")}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        {values.map((item) => (
          <div key={item.key} className="rounded-xl bg-white/[0.055] px-3 py-2.5">
            <dt className="text-[9px] font-semibold uppercase tracking-[0.1em] text-white/64">
              {t(item.key)}
            </dt>
            <dd className="mt-1 text-[11px] font-medium leading-4 text-white/88">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function displayLanguage(languageTag: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(languageTag) ?? languageTag;
  } catch {
    return languageTag;
  }
}

function ProjectCoverEditor({
  canEdit,
  media,
}: {
  canEdit: boolean;
  media: StoryFoundationCoverMediaProps;
}) {
  const t = useTranslations("storyStudio.canvas");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [clearPending, setClearPending] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  // A cover only counts as set if it is a usable STILL: an image is what the
  // player paints behind its title screen, what the catalogue tile renders, and
  // what the play page serves as og:image. Anything else — an unready or blocked
  // asset, or a legacy video cover the API no longer accepts — reads as a cover
  // that cannot be published, and says so.
  const cover =
    media.cover?.kind === "image" &&
    media.cover.status === "ready" &&
    media.cover.moderationStatus !== "blocked" &&
    media.cover.previewUrl
      ? media.cover
      : null;
  const dimensions = cover?.width && cover.height ? `${cover.width}×${cover.height}` : null;

  return (
    <section className="border-b border-white/[0.08] py-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-semibold text-white/72">
            {t("filmFoundation.cover.title")}
          </h3>
          <p className="mt-1 text-[10px] leading-4 text-white/64">
            {t("filmFoundation.cover.description")}
          </p>
        </div>
        {dimensions ? (
          <span className="shrink-0 text-[9px] text-white/62">{dimensions}</span>
        ) : null}
      </div>

      <div className="mt-3 aspect-video overflow-hidden rounded-2xl bg-black/28">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed project media URL
          <img
            src={cover.previewUrl as string}
            alt={t("filmFoundation.cover.imageAlt")}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-white/64">
            <span className="grid size-9 place-items-center rounded-full bg-white/[0.055]">
              <IconPhoto className="size-4" stroke={1.6} />
            </span>
            <span className="text-[9px] font-medium">
              {media.cover
                ? t("filmFoundation.cover.unavailable")
                : t("filmFoundation.cover.empty")}
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
          {media.cover ? t("filmFoundation.cover.replace") : t("filmFoundation.cover.choose")}
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
            className="h-8 rounded-xl px-3 text-[10px] text-white/64 hover:text-[#ff9b9e]"
          >
            {clearPending ? (
              <IconLoader2 className="size-3.5 animate-spin" stroke={1.8} />
            ) : (
              <IconTrash className="size-3.5" stroke={1.8} />
            )}
            {t("filmFoundation.cover.remove")}
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
        allowedKinds={["image"]}
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
        unavailableReason={() => t("filmFoundation.cover.unavailable")}
        onSelect={media.onSelectCandidate}
        onClearSelection={media.onClearSelection}
        uploadAccept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        onUpload={media.onUpload}
      />
    </section>
  );
}

function FoundationEditor({
  content,
  canEdit,
  onUpdateFoundation,
}: Pick<StoryFoundationLibraryProps, "content" | "canEdit" | "onUpdateFoundation">) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <div>
      <p className="text-[10px] leading-4 text-white/60">{t("foundation.description")}</p>
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
    </div>
  );
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
      <span className="text-[10px] font-semibold text-white/68">{label}</span>
      <StoryCanvasTextInput
        multiline
        value={value}
        onValueChange={onChange}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        className="mt-2 w-full resize-none rounded-lg bg-white/[0.055] px-3 py-2 text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}
