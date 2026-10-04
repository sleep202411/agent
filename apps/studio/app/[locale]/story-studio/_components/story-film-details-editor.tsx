"use client";

import Image from "next/image";
import { useId, useState } from "react";
import { IconPhoto, IconPlus, IconTrash, IconVideo, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, FIELD_CONTROL, FIELD_CONTROL_TEXTAREA } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  addStoryCandidateAsset,
  type MediaAssetSummary,
  type StoryStoreListing,
} from "@/lib/story-projects-api";
import type { StoryPublicationDraft } from "../_lib/story-publication-draft";
import { StoryCandidateAssetPickerDialog } from "./project-canvas/story-candidate-asset-picker-dialog";
import type { StoryCandidateAssetsController } from "./project-canvas/use-story-candidate-assets";

export function StoryFilmDetailsEditor({
  projectId,
  value,
  onChange,
  cover,
  candidates,
  disabled,
}: {
  projectId: string;
  value: StoryPublicationDraft;
  onChange: (value: StoryPublicationDraft) => void;
  cover: MediaAssetSummary | null;
  candidates: StoryCandidateAssetsController;
  disabled: boolean;
}) {
  const t = useTranslations("storyStudio.publication.details");
  const id = useId();
  const [picker, setPicker] = useState<"cover" | "trailer" | "screenshot" | null>(null);
  const patch = (changes: Partial<StoryStoreListing>) =>
    onChange({ ...value, listing: { ...value.listing, ...changes } });
  const media = (assetId: string | null) =>
    candidates.items.find((item) => item.asset.id === assetId)?.asset ??
    (cover?.id === assetId ? cover : null);
  const select = (assetId: string) => {
    if (picker === "cover") onChange({ ...value, coverAssetId: assetId });
    else if (picker === "trailer") patch({ trailerAssetId: assetId });
    else if (picker === "screenshot" && !value.listing.screenshotAssetIds.includes(assetId))
      patch({ screenshotAssetIds: [...value.listing.screenshotAssetIds, assetId] });
  };
  return (
    <div className="space-y-9">
      <section className="space-y-5" aria-labelledby={`${id}-intro`}>
        <div>
          <h2 id={`${id}-intro`} className="text-lg font-semibold">
            {t("introTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-white/45">{t("introDescription")}</p>
        </div>
        <Field label={t("cover")} required>
          <div className="flex items-center gap-5">
            <MediaThumbnail
              loading={candidates.loading}
              asset={media(value.coverAssetId)}
              video={false}
              naturalAspect
              empty={t(value.coverAssetId ? "unavailableMedia" : "coverEmpty")}
              className="max-w-[50%] shrink-0"
            />
            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-sm leading-6 text-white/45">{t("coverHint")}</p>
              <Button variant="secondary" disabled={disabled} onClick={() => setPicker("cover")}>
                {t(value.coverAssetId ? "replaceCover" : "chooseCover")}
              </Button>
            </div>
          </div>
        </Field>
        <Field label={t("description")} htmlFor={`${id}-description`} required>
          <Textarea
            id={`${id}-description`}
            aria-required
            maxLength={13000}
            value={value.listing.description}
            disabled={disabled}
            placeholder={t("descriptionPlaceholder")}
            className={`${FIELD_CONTROL_TEXTAREA} min-h-48`}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </Field>
        <ChipField
          label={t("tags")}
          values={value.listing.tags}
          max={12}
          disabled={disabled}
          placeholder={t("tagsPlaceholder")}
          onChange={(tags) => patch({ tags })}
        />
      </section>
      <section
        className="space-y-5 border-t border-white/[0.07] pt-8"
        aria-labelledby={`${id}-media`}
      >
        <div>
          <h2 id={`${id}-media`} className="text-lg font-semibold">
            {t("mediaTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-white/45">{t("mediaDescription")}</p>
        </div>
        {candidates.failed ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 text-sm text-destructive"
          >
            <span>{candidates.error || t("candidateLoadError")}</span>
            <Button variant="secondary" onClick={() => void candidates.refresh()}>
              {t("retry")}
            </Button>
          </div>
        ) : null}
        <Field
          label={t("trailer")}
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => setPicker("trailer")}
            >
              {t(value.listing.trailerAssetId ? "replaceTrailer" : "chooseTrailer")}
            </Button>
          }
        >
          {value.listing.trailerAssetId ? (
            <div className="relative">
              <MediaThumbnail
                loading={candidates.loading}
                asset={media(value.listing.trailerAssetId)}
                video
                empty={t("unavailableMedia")}
                className="aspect-video w-full"
              />
              <Button
                variant="secondary"
                size="icon"
                className="absolute right-3 top-3"
                disabled={disabled}
                aria-label={t("removeTrailer")}
                onClick={() => patch({ trailerAssetId: null })}
              >
                <IconTrash className="size-4" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setPicker("trailer")}
              className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.035] px-5 py-7 text-sm text-white/40 hover:bg-white/[0.06] disabled:pointer-events-none"
            >
              <IconVideo className="size-6" />
              {t("trailerEmpty")}
            </button>
          )}
        </Field>
        <Field
          label={t("screenshots")}
          hint={t("screenshotCount", { count: value.listing.screenshotAssetIds.length })}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {value.listing.screenshotAssetIds.map((assetId, index) => (
              <div key={assetId} className="relative overflow-hidden rounded-xl">
                <MediaThumbnail
                  loading={candidates.loading}
                  asset={media(assetId)}
                  video={false}
                  empty={t("unavailableMedia")}
                  className="aspect-video w-full rounded-none"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 z-10 size-8 rounded-full bg-black/60 text-white hover:bg-black/80 hover:text-white"
                  disabled={disabled}
                  aria-label={t("removeScreenshot", { index: index + 1 })}
                  onClick={() =>
                    patch({
                      screenshotAssetIds: value.listing.screenshotAssetIds.filter(
                        (entry) => entry !== assetId
                      ),
                    })
                  }
                >
                  <IconX className="size-3.5" />
                </Button>
              </div>
            ))}
            {value.listing.screenshotAssetIds.length < 8 ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => setPicker("screenshot")}
                className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl bg-white/[0.035] text-xs text-white/40 hover:bg-white/[0.06] disabled:pointer-events-none"
              >
                <IconPlus className="size-5" />
                {t("addScreenshot")}
              </button>
            ) : null}
          </div>
        </Field>
      </section>
      <StoryCandidateAssetPickerDialog
        projectId={projectId}
        open={picker !== null}
        onOpenChange={(open) => !open && setPicker(null)}
        items={candidates.items}
        allowedKinds={picker === "trailer" ? ["video"] : ["image"]}
        currentAssetId={
          picker === "cover"
            ? value.coverAssetId
            : picker === "trailer"
              ? value.listing.trailerAssetId
              : null
        }
        loading={candidates.loading}
        error={candidates.error}
        canSelect={!disabled}
        onRetry={() => void candidates.refresh()}
        isSelectable={(candidate) =>
          candidate.asset.status === "ready" &&
          candidate.asset.moderationStatus !== "blocked" &&
          (picker !== "screenshot" ||
            !value.listing.screenshotAssetIds.includes(candidate.asset.id))
        }
        unavailableReason={(candidate) =>
          candidate.asset.moderationStatus === "blocked"
            ? t("mediaBlocked")
            : candidate.asset.status !== "ready"
              ? t("mediaNotReady")
              : picker === "screenshot" &&
                  value.listing.screenshotAssetIds.includes(candidate.asset.id)
                ? t("screenshotAlreadyAdded")
                : undefined
        }
        onSelect={async (candidate) => {
          select(candidate.asset.id);
          await candidates.refresh();
          setPicker(null);
        }}
        uploadAccept={
          picker === "trailer" ? "video/*,.mp4,.mov,.webm" : "image/*,.jpg,.jpeg,.png,.webp"
        }
        onUpload={
          disabled
            ? undefined
            : async (file, onState, signal) => {
                const uploaded = await uploadFileViaSignedUrl(file, {
                  kind: picker === "trailer" ? "ai_reference_video" : "ai_reference_image",
                  scope: { storyProjectId: projectId },
                  onProgress: (progress) => onState({ stage: "uploading", progress }),
                  signal,
                });
                signal.throwIfAborted();
                onState({ stage: "processing" });
                const candidate = await addStoryCandidateAsset(
                  projectId,
                  uploaded.mediaAssetId,
                  signal
                );
                signal.throwIfAborted();
                select(candidate.asset.id);
                await candidates.refresh();
              }
        }
      />
    </div>
  );
}

function MediaThumbnail({
  asset,
  video,
  empty,
  className,
  loading = false,
  naturalAspect = false,
}: {
  asset: MediaAssetSummary | null;
  video: boolean;
  empty: string;
  className: string;
  loading?: boolean;
  naturalAspect?: boolean;
}) {
  const t = useTranslations("storyStudio.publication.details");
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const previewUrl = asset?.previewUrl ?? null;
  const reservingNaturalPreview =
    naturalAspect && previewUrl && loadedUrl !== previewUrl && (!asset?.width || !asset?.height);
  return (
    <div
      className={`relative grid place-items-center overflow-hidden rounded-xl bg-white/[0.04] ${className} ${reservingNaturalPreview ? "min-h-24 min-w-24" : ""}`}
    >
      {previewUrl && failedUrl !== previewUrl ? (
        video ? (
          <video
            src={previewUrl}
            onError={() => setFailedUrl(previewUrl)}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full object-contain"
          />
        ) : naturalAspect ? (
          // eslint-disable-next-line @next/next/no-img-element -- Covers use the image's intrinsic dimensions, including when media metadata is missing.
          <img
            src={previewUrl}
            width={asset?.width ?? undefined}
            height={asset?.height ?? undefined}
            onLoad={() => setLoadedUrl(previewUrl)}
            onError={() => setFailedUrl(previewUrl)}
            alt=""
            loading="lazy"
            decoding="async"
            className="block h-auto w-auto max-h-48 max-w-full"
          />
        ) : (
          <Image
            src={previewUrl}
            onError={() => setFailedUrl(previewUrl)}
            alt=""
            fill
            unoptimized
            sizes="(max-width: 768px) 50vw, 400px"
            className="object-cover"
          />
        )
      ) : (
        <div
          className={`flex flex-col items-center gap-2 px-3 text-center text-xs leading-5 text-white/35 ${naturalAspect ? "min-h-24 min-w-24 justify-center py-3" : ""}`}
        >
          <IconPhoto className="size-6" />
          <span>
            {loading
              ? t("mediaLoading")
              : failedUrl && failedUrl === previewUrl
                ? t("unavailableMedia")
                : empty}
          </span>
          {failedUrl && failedUrl === previewUrl ? (
            <button
              type="button"
              className="text-white/70 underline underline-offset-4"
              onClick={() => setFailedUrl(null)}
            >
              {t("retry")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ChipField({
  label,
  values,
  max,
  disabled,
  placeholder,
  onChange,
}: {
  label: string;
  values: string[];
  max: number;
  disabled: boolean;
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const t = useTranslations("storyStudio.publication.details");
  const id = useId();
  const [input, setInput] = useState("");
  const add = () => {
    const next = input.trim();
    if (next && !values.includes(next) && values.length < max) {
      onChange([...values, next]);
      setInput("");
    }
  };
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex gap-2">
        <Input
          id={id}
          value={input}
          maxLength={40}
          disabled={disabled || values.length >= max}
          placeholder={placeholder}
          className={FIELD_CONTROL}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button
          variant="secondary"
          size="icon"
          className="size-11 shrink-0"
          disabled={
            disabled || !input.trim() || values.includes(input.trim()) || values.length >= max
          }
          aria-label={t("addValue", { label })}
          onClick={add}
        >
          <IconPlus className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <span
            key={value}
            className="flex items-center gap-1 rounded-lg bg-white/[0.07] py-1 pl-2.5 pr-1 text-xs text-white/70"
          >
            {value}
            <button
              type="button"
              disabled={disabled}
              aria-label={t("removeValue", { value })}
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="grid size-6 place-items-center rounded-md hover:bg-white/[0.08]"
            >
              <IconX className="size-3" />
            </button>
          </span>
        ))}
      </div>
    </Field>
  );
}
