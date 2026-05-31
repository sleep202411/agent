"use client";

import { useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  IconArrowLeft,
  IconCoin,
  IconDeviceFloppy,
  IconEdit,
  IconEye,
  IconFileText,
  IconLoader2,
  IconPhoto,
  IconPlus,
  IconRocket,
  IconTrash,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { IpCommerceAsset, IpCreatorIp } from "@/src/lib/ip-commerce/api";
import {
  useCreateIpCommerceEpisode,
  useDeleteIpCommerceEpisode,
  useMyIpCommerceIp,
  useSubmitIpCommerceIpForReview,
  useUpdateIpCommerceEpisode,
  useUpdateIpCommerceIpAssets,
  useUpdateIpCommerceIpProfile,
  useUploadIpCommerceMedia,
  useUpsertIpCommercePriceRule,
} from "@/src/lib/ip-commerce/hooks";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";

interface IpStudioWorkbenchProps {
  ipId: string;
}

type IconComponent = typeof IconFileText;
type Translate = ReturnType<typeof useTranslations>;

const STUDIO_TABS = [
  { key: "overview", icon: IconFileText },
  { key: "episodes", icon: IconVideo },
  { key: "rights", icon: IconFileText },
  { key: "pricing", icon: IconCoin },
] as const;

type StudioTabKey = (typeof STUDIO_TABS)[number]["key"];

const NAME_MAX_LENGTH = 80;
const SUMMARY_MAX_LENGTH = 280;
const DESCRIPTION_MAX_LENGTH = 3000;
const GENRE_MAX_COUNT = 8;
const TAG_MAX_COUNT = 20;
const IP_TYPE_OPTIONS = ["series", "film_short", "other"] as const;
type EditableIpType = (typeof IP_TYPE_OPTIONS)[number];
const VISIBILITY_OPTIONS = ["private", "unlisted", "public"] as const;
type EditableVisibility = (typeof VISIBILITY_OPTIONS)[number];
const AGE_RATING_OPTIONS = ["general", "teen", "mature", "restricted"] as const;
type EditableAgeRating = (typeof AGE_RATING_OPTIONS)[number];
const IP_CONTENT_CURRENCY = "community_point" as const;

export function IpStudioWorkbench({ ipId }: IpStudioWorkbenchProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations("newIpWorkbench");
  const typeT = useTranslations("newIpCreate");
  const [activeTab, setActiveTab] = useState<StudioTabKey>("overview");
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const { data, isLoading, error, refetch } = useMyIpCommerceIp(ipId, { locale });
  const submitReview = useSubmitIpCommerceIpForReview();

  if (isLoading) {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background text-foreground">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (error || !data?.ip) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-background px-5 py-10 text-foreground">
        <div className="mx-auto flex max-w-xl flex-col items-start gap-5 rounded-2xl border border-border bg-card p-6">
          <BackToProfile locale={locale} label={t("backToProfile")} />
          <div>
            <h1 className="text-2xl font-semibold">{t("notFoundTitle")}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("notFoundBody")}</p>
          </div>
          <Button type="button" onClick={() => void refetch()}>
            {t("retry")}
          </Button>
        </div>
      </main>
    );
  }

  const ip = data.ip;
  const typeLabel = typeT(`ipType.${ip.ipType}`);
  const updatedAt = formatDateTime(ip.updatedAt, locale);
  const reviewReadiness = getReviewReadiness(ip, t, locale);
  const canSubmitReview =
    canSubmitForReview(ip.status) && reviewReadiness.ready && !submitReview.isPending;
  const selectTab = (tab: StudioTabKey) => {
    setActiveTab(tab);
    window.requestAnimationFrame(() => {
      document.getElementById("ip-studio-content")?.scrollIntoView({ block: "start" });
    });
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background text-foreground">
      <EditStyleHero
        ip={ip}
        t={t}
        typeLabel={typeLabel}
        updatedAt={updatedAt}
        locale={locale}
        canSubmitReview={canSubmitReview}
        reviewMissing={reviewReadiness.missing}
        submitPending={submitReview.isPending}
        onSubmitReview={async () => {
          if (!canSubmitReview) return;
          try {
            await submitReview.mutateAsync({
              ipId: ip.id,
              expectedVersion: ip.version,
              changeSummary: t("reviewSubmit.defaultSummary"),
            });
            toast.success(t("reviewSubmit.success"));
          } catch (err) {
            const msg = err instanceof Error ? err.message : "";
            toast.error(msg || t("reviewSubmit.failed"));
          }
        }}
      />

      <div className="sticky top-14 z-30 border-b border-border bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/70">
        <div className="relative flex items-center justify-center px-6">
          <nav className="flex items-center gap-1 overflow-x-auto">
            {STUDIO_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => selectTab(tab.key)}
                  className={[
                    "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors",
                    active
                      ? "border-primary font-semibold text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon className="size-4" />
                  {t(`sections.${tab.key}.title`)}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div id="ip-studio-content" className="mx-auto max-w-6xl scroll-mt-28 px-4">
        {activeTab === "overview" ? (
          <OverviewPanel
            ip={ip}
            t={t}
            typeLabel={typeLabel}
            onEdit={() => setProfileEditOpen(true)}
          />
        ) : null}
        {activeTab === "episodes" ? (
          <EpisodesPanel ip={ip} t={t} onOpenPricing={() => selectTab("pricing")} />
        ) : null}
        {activeTab === "rights" ? <RightsPanel ip={ip} t={t} /> : null}
        {activeTab === "pricing" ? <PricingPanel ip={ip} t={t} /> : null}
      </div>

      <IpProfileEditDialog
        key={`${ip.id}:${ip.version}:${profileEditOpen ? "open" : "closed"}`}
        ip={ip}
        open={profileEditOpen}
        onOpenChange={setProfileEditOpen}
      />
    </main>
  );
}

function EditStyleHero({
  ip,
  t,
  typeLabel,
  updatedAt,
  locale,
  canSubmitReview,
  reviewMissing,
  submitPending,
  onSubmitReview,
}: {
  ip: IpCreatorIp;
  t: Translate;
  typeLabel: string;
  updatedAt: string;
  locale: Locale;
  canSubmitReview: boolean;
  reviewMissing: string[];
  submitPending: boolean;
  onSubmitReview: () => void;
}) {
  return (
    <div className="relative overflow-hidden border-b border-border bg-card">
      <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:py-10 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <BackToProfile locale={locale} label={t("backToProfile")} />
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/80">
            {t("eyebrow")}
          </p>
          <h1 className="line-clamp-2 text-2xl font-bold text-foreground sm:text-3xl">
            {ip.title}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {ip.summary || t("emptySummary")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill>{typeLabel}</StatusPill>
            <StatusPill>{t(`status.${ip.status}`)}</StatusPill>
            <StatusPill>{t(`visibility.${ip.listingVisibility}`)}</StatusPill>
            <span className="text-xs text-muted-foreground">
              {t("lastEdited", { time: updatedAt })}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-row flex-wrap items-center gap-2">
          <Button
            asChild
            size="sm"
            variant="outline"
            color="muted"
            className="min-w-[7.5rem] justify-center"
          >
            <Link href={localizePath(`/ip-commerce/${ip.id}`, locale)}>
              <IconEye className="size-3.5" />
              {t("preview")}
            </Link>
          </Button>
          <Button
            size="sm"
            disabled={!canSubmitReview}
            onClick={onSubmitReview}
            className="min-w-[7.5rem] justify-center"
          >
            <IconRocket className="size-3.5" />
            {submitPending ? t("reviewSubmit.submitting") : t("publish")}
          </Button>
          {reviewMissing.length > 0 ? (
            <p className="basis-full text-right text-xs leading-5 text-muted-foreground">
              {t("reviewSubmit.requirements", { items: reviewMissing.join("、") })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BackToProfile({ locale, label }: { locale: Locale; label: string }) {
  return (
    <Link
      href={localizePath("/profile", locale)}
      className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
    >
      <IconArrowLeft className="size-4" />
      {label}
    </Link>
  );
}

function OverviewPanel({
  ip,
  t,
  typeLabel,
  onEdit,
}: {
  ip: IpCreatorIp;
  t: Translate;
  typeLabel: string;
  onEdit: () => void;
}) {
  const hasAsset = hasPublicationAsset(ip);
  const hasProfile = Boolean(ip.title.trim() && ip.summary.trim());
  const hasRights = hasRightsDeclaration(ip) && hasRequiredAiDisclosure(ip);
  const taxonomy = [...ip.genres, ...ip.tags];
  const updateAssets = useUpdateIpCommerceIpAssets();
  const uploadMedia = useUploadIpCommerceMedia();

  const handleCoverUpload = async (file: File) => {
    try {
      const { asset } = await uploadMedia.mutateAsync({
        ipId: ip.id,
        file,
        kind: "image",
        purpose: "cover",
      });
      await updateAssets.mutateAsync({
        ipId: ip.id,
        coverAssetId: asset.id,
      });
      toast.success(t("assetsPanel.toasts.uploadSaved"));
    } catch (err) {
      toast.error(errorMessage(err) || t("assetsPanel.toasts.uploadFailed"));
    }
  };

  const handleTrailerUpload = async (file: File) => {
    try {
      const { asset } = await uploadMedia.mutateAsync({
        ipId: ip.id,
        file,
        kind: "video",
        purpose: "trailer",
      });
      await updateAssets.mutateAsync({
        ipId: ip.id,
        trailerAssetId: asset.id,
      });
      toast.success(t("assetsPanel.toasts.uploadSaved"));
    } catch (err) {
      toast.error(errorMessage(err) || t("assetsPanel.toasts.uploadFailed"));
    }
  };

  return (
    <>
      <Section title={t("overview.identityEyebrow")} description={t("panels.overview.body")}>
        <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="break-words text-xl font-semibold">{ip.title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {ip.summary || t("emptySummary")}
              </p>
              {ip.description ? (
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {ip.description}
                </p>
              ) : null}
              {taxonomy.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {taxonomy.map((item) => (
                    <span
                      key={item}
                      className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <Button type="button" size="sm" onClick={onEdit}>
              <IconEdit className="size-3.5" />
              {t("editBasics")}
            </Button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <MetaCell label={t("meta.status")} value={t(`status.${ip.status}`)} />
            <MetaCell label={t("meta.ipType")} value={typeLabel} />
            <MetaCell
              label={t("meta.visibility")}
              value={t(`visibility.${ip.listingVisibility}`)}
            />
            <MetaCell label={t("meta.ageRating")} value={t(`ageRating.${ip.ageRating}`)} />
            <MetaCell label={t("meta.sourceLocale")} value={ip.sourceLocale} />
            <MetaCell label={t("meta.version")} value={`v${ip.version}`} />
          </div>
        </div>
      </Section>

      <Section
        title={t("overview.displayAssets.title")}
        description={t("overview.displayAssets.body")}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <AssetUploadSlot
            icon={IconPhoto}
            title={t("assetsPanel.slots.cover.title")}
            body={t("assetsPanel.slots.cover.body")}
            asset={ip.coverAsset}
            t={t}
            uploadLabel={t("assetsPanel.form.uploadCover")}
            uploadingLabel={t("assetsPanel.form.uploading")}
            uploadAccept="image/*"
            uploadDisabled={uploadMedia.isPending || updateAssets.isPending}
            isUploading={uploadMedia.isPending}
            onUpload={(file) => void handleCoverUpload(file)}
          />
          <AssetUploadSlot
            icon={IconVideo}
            title={t("assetsPanel.slots.trailer.title")}
            body={t("assetsPanel.slots.trailer.body")}
            asset={ip.trailerAsset}
            t={t}
            uploadLabel={t("assetsPanel.form.uploadTrailer")}
            uploadingLabel={t("assetsPanel.form.uploading")}
            uploadAccept="video/*"
            uploadDisabled={uploadMedia.isPending || updateAssets.isPending}
            isUploading={uploadMedia.isPending}
            onUpload={(file) => void handleTrailerUpload(file)}
          />
        </div>
      </Section>

      <Section title={t("overview.next.eyebrow")} description={t("flowBody")}>
        <div className="space-y-2">
          <ReadinessItem
            title={t("progress.profile.title")}
            body={t("progress.profile.body")}
            done={hasProfile}
          />
          <ReadinessItem
            title={t("progress.episodes.title")}
            body={t("progress.episodes.body")}
            done={ip.counts.episodes > 0}
          />
          <ReadinessItem
            title={t("progress.assets.title")}
            body={t("progress.assets.body")}
            done={hasAsset}
          />
          <ReadinessItem
            title={t("progress.rights.title")}
            body={t("progress.rights.body")}
            done={hasRights}
          />
          <ReadinessItem
            title={t("progress.publish.title")}
            body={t("overview.next.publish.body")}
            done={ip.status === "published"}
          />
        </div>
      </Section>
    </>
  );
}

function EpisodesPanel({
  ip,
  t,
  onOpenPricing,
}: {
  ip: IpCreatorIp;
  t: Translate;
  onOpenPricing: () => void;
}) {
  return (
    <>
      <Section
        title={t("episodesPanel.managementTitle")}
        description={t("episodesPanel.managementBody")}
      >
        <EpisodeManager ip={ip} t={t} onOpenPricing={onOpenPricing} />
      </Section>
    </>
  );
}

function EpisodeManager({
  ip,
  t,
  onOpenPricing,
}: {
  ip: IpCreatorIp;
  t: Translate;
  onOpenPricing: () => void;
}) {
  const createEpisode = useCreateIpCommerceEpisode();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [isFreePreview, setIsFreePreview] = useState(false);
  const nextEpisodeNo =
    (ip.episodes ?? []).reduce((max, episode) => Math.max(max, episode.episodeNo), 0) + 1;
  const trimmedTitle = title.trim();
  const canCreate = trimmedTitle.length > 0 && !createEpisode.isPending;

  const handleCreate = async () => {
    if (!canCreate) return;
    try {
      await createEpisode.mutateAsync({
        ipId: ip.id,
        title: trimmedTitle,
        summary: summary.trim() || undefined,
        episodeNo: nextEpisodeNo,
        isFreePreview,
        expectedVersion: ip.version,
      });
      setTitle("");
      setSummary("");
      setIsFreePreview(false);
      toast.success(t("episodesPanel.toasts.created"));
    } catch (err) {
      toast.error(errorMessage(err) || t("episodesPanel.toasts.createFailed"));
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">{t("episodesPanel.episodeCountLabel")}</p>
            <div className="mt-1 flex flex-wrap items-end gap-2">
              <p className="text-3xl font-semibold">{ip.episodes?.length ?? 0}</p>
              <StatusPill>
                {(ip.episodes?.length ?? 0) > 0
                  ? t("episodesPanel.episodeUpload.hasContent")
                  : t("episodesPanel.status.empty")}
              </StatusPill>
            </div>
          </div>
          <Button type="button" variant="outline" color="muted" onClick={onOpenPricing}>
            <IconCoin className="size-4" />
            {t("episodesPanel.episodePricing.openPricing")}
          </Button>
        </div>
      </div>

      <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold">{t("episodesPanel.create.title")}</h4>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              {t("episodesPanel.create.body")}
            </p>
          </div>
          <StatusPill>{t("episodesPanel.create.nextNumber", { number: nextEpisodeNo })}</StatusPill>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <FormTextField
            label={t("episodesPanel.form.title")}
            value={title}
            onChange={setTitle}
            maxLength={NAME_MAX_LENGTH}
            placeholder={t("episodesPanel.episodeUpload.titlePlaceholder")}
          />
          <FormTextField
            label={t("episodesPanel.form.summary")}
            value={summary}
            onChange={setSummary}
            maxLength={SUMMARY_MAX_LENGTH}
            placeholder={t("episodesPanel.episodeUpload.summaryPlaceholder")}
            multiline
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={isFreePreview}
              onChange={(event) => setIsFreePreview(event.target.checked)}
              className="size-4 accent-primary"
            />
            {t("episodesPanel.form.freePreview")}
          </label>
          <Button type="button" onClick={handleCreate} disabled={!canCreate}>
            <IconPlus className="size-4" />
            {createEpisode.isPending
              ? t("episodesPanel.create.creating")
              : t("episodesPanel.create.action")}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {(ip.episodes ?? []).map((episode) => (
          <EpisodeEditorRow key={episode.id} ip={ip} episode={episode} t={t} />
        ))}
        {!(ip.episodes ?? []).length ? (
          <div className="rounded-xl bg-card p-6 text-center ring-1 ring-border/65">
            <IconVideo className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">{t("episodesPanel.empty.title")}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("episodesPanel.empty.body")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EpisodeEditorRow({
  ip,
  episode,
  t,
}: {
  ip: IpCreatorIp;
  episode: NonNullable<IpCreatorIp["episodes"]>[number];
  t: Translate;
}) {
  const updateEpisode = useUpdateIpCommerceEpisode();
  const deleteEpisode = useDeleteIpCommerceEpisode();
  const uploadMedia = useUploadIpCommerceMedia();
  const [title, setTitle] = useState(episode.title);
  const [summary, setSummary] = useState(episode.summary ?? "");
  const [duration, setDuration] = useState(
    episode.durationSeconds ? String(episode.durationSeconds) : ""
  );
  const [isFreePreview, setIsFreePreview] = useState(episode.isFreePreview);

  const canSave = title.trim().length > 0 && !updateEpisode.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await updateEpisode.mutateAsync({
        ipId: ip.id,
        episodeId: episode.id,
        title: title.trim(),
        summary: summary.trim(),
        durationSeconds: duration.trim() ? Number(duration.trim()) : null,
        isFreePreview,
        expectedVersion: ip.version,
      });
      toast.success(t("episodesPanel.toasts.saved"));
    } catch (err) {
      toast.error(errorMessage(err) || t("episodesPanel.toasts.saveFailed"));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteEpisode.mutateAsync({ ipId: ip.id, episodeId: episode.id });
      toast.success(t("episodesPanel.toasts.deleted"));
    } catch (err) {
      toast.error(errorMessage(err) || t("episodesPanel.toasts.deleteFailed"));
    }
  };

  const handleUploadAndBind = async (
    file: File,
    kind: "image" | "video",
    purpose: "episode_cover" | "episode_media" | "episode_trailer",
    field: "coverAssetId" | "mediaAssetId" | "trailerAssetId"
  ) => {
    try {
      const { asset } = await uploadMedia.mutateAsync({
        ipId: ip.id,
        file,
        kind,
        purpose,
      });
      await updateEpisode.mutateAsync({
        ipId: ip.id,
        episodeId: episode.id,
        [field]: asset.id,
      });
      toast.success(t("episodesPanel.toasts.uploadSaved"));
    } catch (err) {
      toast.error(errorMessage(err) || t("episodesPanel.toasts.uploadFailed"));
    }
  };

  return (
    <div className="flex h-full flex-col rounded-xl bg-card p-4 ring-1 ring-border/65">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-primary">
            {t("episodesPanel.form.episodeNumber", { number: episode.episodeNo })}
          </p>
          <h4 className="mt-1 text-sm font-semibold">{episode.title}</h4>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            color="muted"
            onClick={handleSave}
            disabled={!canSave}
          >
            <IconDeviceFloppy className="size-4" />
            {updateEpisode.isPending
              ? t("episodesPanel.form.saving")
              : t("episodesPanel.form.save")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            color="muted"
            onClick={handleDelete}
            disabled={deleteEpisode.isPending}
          >
            <IconTrash className="size-4" />
            {t("episodesPanel.form.delete")}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <FormTextField
          label={t("episodesPanel.form.title")}
          value={title}
          onChange={setTitle}
          maxLength={NAME_MAX_LENGTH}
          placeholder={t("episodesPanel.episodeUpload.titlePlaceholder")}
        />
        <FormTextField
          label={t("episodesPanel.form.duration")}
          value={duration}
          onChange={(value) => setDuration(value.replace(/[^\d]/g, ""))}
          placeholder={t("episodesPanel.form.durationPlaceholder")}
        />
        <FormTextField
          label={t("episodesPanel.form.summary")}
          value={summary}
          onChange={setSummary}
          maxLength={SUMMARY_MAX_LENGTH}
          placeholder={t("episodesPanel.episodeUpload.summaryPlaceholder")}
          multiline
        />
        <div className="space-y-3">
          <AssetUploadSlot
            icon={IconPhoto}
            title={t("episodesPanel.form.coverUploadTitle")}
            body={t("episodesPanel.form.coverUploadBody")}
            asset={episode.coverAsset}
            t={t}
            uploadLabel={t("episodesPanel.form.uploadCover")}
            uploadingLabel={t("episodesPanel.form.uploading")}
            uploadAccept="image/*"
            uploadDisabled={uploadMedia.isPending || updateEpisode.isPending}
            isUploading={uploadMedia.isPending}
            onUpload={(file) =>
              void handleUploadAndBind(file, "image", "episode_cover", "coverAssetId")
            }
          />
          <AssetUploadSlot
            icon={IconVideo}
            title={t("episodesPanel.form.mediaUploadTitle")}
            body={t("episodesPanel.form.mediaUploadBody")}
            asset={episode.mediaAsset ?? null}
            t={t}
            uploadLabel={t("episodesPanel.form.uploadMedia")}
            uploadingLabel={t("episodesPanel.form.uploading")}
            uploadAccept="video/*"
            uploadDisabled={uploadMedia.isPending || updateEpisode.isPending}
            isUploading={uploadMedia.isPending}
            onUpload={(file) =>
              void handleUploadAndBind(file, "video", "episode_media", "mediaAssetId")
            }
          />
          <AssetUploadSlot
            icon={IconVideo}
            title={t("episodesPanel.form.trailerUploadTitle")}
            body={t("episodesPanel.form.trailerUploadBody")}
            asset={episode.trailerAsset}
            t={t}
            uploadLabel={t("episodesPanel.form.uploadTrailer")}
            uploadingLabel={t("episodesPanel.form.uploading")}
            uploadAccept="video/*"
            uploadDisabled={uploadMedia.isPending || updateEpisode.isPending}
            isUploading={uploadMedia.isPending}
            onUpload={(file) =>
              void handleUploadAndBind(file, "video", "episode_trailer", "trailerAssetId")
            }
          />
        </div>
      </div>

      <label className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={isFreePreview}
          onChange={(event) => setIsFreePreview(event.target.checked)}
          className="size-4 accent-primary"
        />
        {t("episodesPanel.form.freePreview")}
      </label>
    </div>
  );
}

function FormTextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  multiline,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  const control = multiline ? (
    <Textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      maxLength={maxLength}
      placeholder={placeholder}
      rows={3}
    />
  ) : (
    <Input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      maxLength={maxLength}
      placeholder={placeholder}
    />
  );

  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      {control}
      {maxLength ? <CharacterCount value={value.length} max={maxLength} /> : null}
    </div>
  );
}

function PricingPanel({ ip, t }: { ip: IpCreatorIp; t: Translate }) {
  const episodes = ip.episodes ?? [];

  return (
    <>
      <Section title={t("pricingPanel.accessTitle")} description={t("pricingPanel.accessBody")}>
        <DefaultIpPriceEditor ip={ip} t={t} />
      </Section>

      <Section title={t("pricingPanel.episodeTitle")} description={t("pricingPanel.episodeBody")}>
        <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold">{t("pricingPanel.episodeListTitle")}</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {ip.counts.episodes > 0
                  ? t("pricingPanel.episodeListReady", { count: ip.counts.episodes })
                  : t("pricingPanel.episodeListEmpty")}
              </p>
            </div>
            <StatusPill>
              {ip.counts.episodes > 0
                ? t("pricingPanel.ruleStatus.available")
                : t("pricingPanel.ruleStatus.needsEpisodes")}
            </StatusPill>
          </div>

          {episodes.length ? (
            <div className="mt-4 space-y-3">
              {episodes.map((episode) => (
                <EpisodePriceEditor key={episode.id} ip={ip} episode={episode} t={t} />
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-background p-4">
              <div className="flex gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <IconVideo className="size-5" />
                </span>
                <div>
                  <h5 className="text-sm font-semibold">{t("pricingPanel.episodeEmptyTitle")}</h5>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t("pricingPanel.episodeEmptyBody")}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </Section>
    </>
  );
}

function DefaultIpPriceEditor({ ip, t }: { ip: IpCreatorIp; t: Translate }) {
  const upsertPrice = useUpsertIpCommercePriceRule();
  const [enabled, setEnabled] = useState(Boolean(ip.price));
  const [amount, setAmount] = useState(ip.price?.amount ?? "");
  const [originalAmount, setOriginalAmount] = useState(ip.price?.originalAmount ?? "");
  const [startsAt, setStartsAt] = useState(toDateTimeLocal(ip.price?.startsAt));
  const [endsAt, setEndsAt] = useState(toDateTimeLocal(ip.price?.endsAt));
  const [maxPerUser, setMaxPerUser] = useState(
    ip.price?.maxPerUser ? String(ip.price.maxPerUser) : ""
  );
  const priceRuleValid = validatePriceRuleInput({
    enabled,
    amount,
    originalAmount,
    startsAt,
    endsAt,
    maxPerUser,
  });
  const canSave = !upsertPrice.isPending && priceRuleValid;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await upsertPrice.mutateAsync({
        ipId: ip.id,
        targetType: "ip",
        status: enabled ? "active" : "disabled",
        currency: IP_CONTENT_CURRENCY,
        amount: enabled ? amount.trim() : undefined,
        originalAmount: enabled && originalAmount.trim() ? originalAmount.trim() : null,
        startsAt: enabled ? dateTimeLocalToIso(startsAt) : null,
        endsAt: enabled ? dateTimeLocalToIso(endsAt) : null,
        maxPerUser: enabled && maxPerUser.trim() ? Number(maxPerUser.trim()) : null,
        expectedVersion: ip.version,
      });
      toast.success(t("pricingPanel.toasts.saved"));
    } catch (err) {
      toast.error(errorMessage(err) || t("pricingPanel.toasts.saveFailed"));
    }
  };

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold">{t("pricingPanel.rules.ipDefault.title")}</h4>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            {t("pricingPanel.rules.ipDefault.body")}
          </p>
        </div>
        <StatusPill>
          {enabled ? t("pricingPanel.ruleStatus.available") : t("pricingPanel.ruleStatus.free")}
        </StatusPill>
      </div>

      <div className="mt-4 grid gap-3">
        <FormTextField
          label={t("pricingPanel.form.amount")}
          value={amount}
          onChange={(value) => setAmount(value.replace(/[^\d]/g, ""))}
          placeholder={t("pricingPanel.form.amountPlaceholder")}
        />
      </div>

      <PriceRuleAdvancedFields
        enabled={enabled}
        originalAmount={originalAmount}
        startsAt={startsAt}
        endsAt={endsAt}
        maxPerUser={maxPerUser}
        onOriginalAmountChange={(value) => setOriginalAmount(value.replace(/[^\d]/g, ""))}
        onStartsAtChange={setStartsAt}
        onEndsAtChange={setEndsAt}
        onMaxPerUserChange={(value) => setMaxPerUser(value.replace(/[^\d]/g, ""))}
        t={t}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="size-4 accent-primary"
          />
          {t("pricingPanel.form.enablePaid")}
        </label>
        <Button type="button" onClick={handleSave} disabled={!canSave}>
          <IconDeviceFloppy className="size-4" />
          {upsertPrice.isPending ? t("pricingPanel.form.saving") : t("pricingPanel.form.save")}
        </Button>
      </div>
    </div>
  );
}

function EpisodePriceEditor({
  ip,
  episode,
  t,
}: {
  ip: IpCreatorIp;
  episode: NonNullable<IpCreatorIp["episodes"]>[number];
  t: Translate;
}) {
  const upsertPrice = useUpsertIpCommercePriceRule();
  const [enabled, setEnabled] = useState(Boolean(episode.price));
  const [amount, setAmount] = useState(episode.price?.amount ?? "");
  const [originalAmount, setOriginalAmount] = useState(episode.price?.originalAmount ?? "");
  const [startsAt, setStartsAt] = useState(toDateTimeLocal(episode.price?.startsAt));
  const [endsAt, setEndsAt] = useState(toDateTimeLocal(episode.price?.endsAt));
  const [maxPerUser, setMaxPerUser] = useState(
    episode.price?.maxPerUser ? String(episode.price.maxPerUser) : ""
  );
  const priceRuleValid = validatePriceRuleInput({
    enabled,
    amount,
    originalAmount,
    startsAt,
    endsAt,
    maxPerUser,
  });
  const canSave = !upsertPrice.isPending && priceRuleValid;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await upsertPrice.mutateAsync({
        ipId: ip.id,
        targetType: "episode",
        episodeId: episode.id,
        status: enabled ? "active" : "disabled",
        currency: IP_CONTENT_CURRENCY,
        amount: enabled ? amount.trim() : undefined,
        originalAmount: enabled && originalAmount.trim() ? originalAmount.trim() : null,
        startsAt: enabled ? dateTimeLocalToIso(startsAt) : null,
        endsAt: enabled ? dateTimeLocalToIso(endsAt) : null,
        maxPerUser: enabled && maxPerUser.trim() ? Number(maxPerUser.trim()) : null,
        expectedVersion: ip.version,
      });
      toast.success(t("pricingPanel.toasts.saved"));
    } catch (err) {
      toast.error(errorMessage(err) || t("pricingPanel.toasts.saveFailed"));
    }
  };

  return (
    <div className="rounded-xl bg-background p-3 ring-1 ring-border/55">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary">
            {t("episodesPanel.form.episodeNumber", { number: episode.episodeNo })}
          </p>
          <h5 className="mt-1 truncate text-sm font-medium">{episode.title}</h5>
        </div>
        <StatusPill>
          {episode.isFreePreview
            ? t("pricingPanel.ruleStatus.preview")
            : enabled
              ? t("pricingPanel.ruleStatus.episodePaid")
              : ip.price
                ? t("pricingPanel.ruleStatus.inherit")
                : t("pricingPanel.ruleStatus.free")}
        </StatusPill>
      </div>

      <div className="mt-3 grid gap-3">
        <FormTextField
          label={t("pricingPanel.form.amount")}
          value={amount}
          onChange={(value) => setAmount(value.replace(/[^\d]/g, ""))}
          placeholder={t("pricingPanel.form.amountPlaceholder")}
        />
      </div>

      <PriceRuleAdvancedFields
        enabled={enabled}
        originalAmount={originalAmount}
        startsAt={startsAt}
        endsAt={endsAt}
        maxPerUser={maxPerUser}
        onOriginalAmountChange={(value) => setOriginalAmount(value.replace(/[^\d]/g, ""))}
        onStartsAtChange={setStartsAt}
        onEndsAtChange={setEndsAt}
        onMaxPerUserChange={(value) => setMaxPerUser(value.replace(/[^\d]/g, ""))}
        t={t}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="size-4 accent-primary"
          />
          {t("pricingPanel.form.overrideEpisode")}
        </label>
        <Button type="button" size="sm" onClick={handleSave} disabled={!canSave}>
          <IconDeviceFloppy className="size-4" />
          {upsertPrice.isPending ? t("pricingPanel.form.saving") : t("pricingPanel.form.save")}
        </Button>
      </div>
    </div>
  );
}

function PriceRuleAdvancedFields({
  enabled,
  originalAmount,
  startsAt,
  endsAt,
  maxPerUser,
  onOriginalAmountChange,
  onStartsAtChange,
  onEndsAtChange,
  onMaxPerUserChange,
  t,
}: {
  enabled: boolean;
  originalAmount: string;
  startsAt: string;
  endsAt: string;
  maxPerUser: string;
  onOriginalAmountChange: (value: string) => void;
  onStartsAtChange: (value: string) => void;
  onEndsAtChange: (value: string) => void;
  onMaxPerUserChange: (value: string) => void;
  t: Translate;
}) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <FormTextField
        label={t("pricingPanel.form.originalAmount")}
        value={originalAmount}
        onChange={onOriginalAmountChange}
        placeholder={t("pricingPanel.form.originalAmountPlaceholder")}
      />
      <FormTextField
        type="datetime-local"
        label={t("pricingPanel.form.startsAt")}
        value={startsAt}
        onChange={onStartsAtChange}
        placeholder={t("pricingPanel.form.startsAtPlaceholder")}
      />
      <FormTextField
        type="datetime-local"
        label={t("pricingPanel.form.endsAt")}
        value={endsAt}
        onChange={onEndsAtChange}
        placeholder={t("pricingPanel.form.endsAtPlaceholder")}
      />
      <FormTextField
        label={t("pricingPanel.form.maxPerUser")}
        value={maxPerUser}
        onChange={onMaxPerUserChange}
        placeholder={t("pricingPanel.form.maxPerUserPlaceholder")}
      />
      {enabled && startsAt && endsAt && new Date(startsAt) >= new Date(endsAt) ? (
        <p className="text-xs text-destructive sm:col-span-2 lg:col-span-4">
          {t("pricingPanel.form.invalidWindow")}
        </p>
      ) : null}
    </div>
  );
}

function RightsPanel({ ip, t }: { ip: IpCreatorIp; t: Translate }) {
  return (
    <Section title={t("assetsPanel.rightsTitle")} description={t("assetsPanel.rightsBody")}>
      <RightsGovernanceEditor ip={ip} t={t} />
    </Section>
  );
}

function RightsGovernanceEditor({ ip, t }: { ip: IpCreatorIp; t: Translate }) {
  const update = useUpdateIpCommerceIpProfile();
  const currentOwner = ip.copyrightOwner ?? "";
  const currentRights = jsonStringField(ip.rightsSummary, "statement");
  const currentAiStatement = jsonStringField(ip.aiDisclosure, "statement");
  const currentGeneratedVisuals = jsonBooleanField(ip.aiDisclosure, "generatedVisuals");
  const currentGeneratedCopy = jsonBooleanField(ip.aiDisclosure, "generatedCopy");
  const [owner, setOwner] = useState(currentOwner);
  const [rightsStatement, setRightsStatement] = useState(currentRights);
  const [aiStatement, setAiStatement] = useState(currentAiStatement);
  const [generatedVisuals, setGeneratedVisuals] = useState(currentGeneratedVisuals);
  const [generatedCopy, setGeneratedCopy] = useState(currentGeneratedCopy);

  const dirty =
    owner.trim() !== currentOwner.trim() ||
    rightsStatement.trim() !== currentRights.trim() ||
    aiStatement.trim() !== currentAiStatement.trim() ||
    generatedVisuals !== currentGeneratedVisuals ||
    generatedCopy !== currentGeneratedCopy;
  const canSave = dirty && !update.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await update.mutateAsync({
        ipId: ip.id,
        copyrightOwner: owner.trim() || null,
        rightsSummary: {
          statement: rightsStatement.trim(),
        },
        aiDisclosure: {
          generatedVisuals,
          generatedCopy,
          statement: aiStatement.trim(),
        },
        expectedVersion: ip.version,
      });
      toast.success(t("assetsPanel.rightsForm.saved"));
    } catch (err) {
      toast.error(errorMessage(err) || t("assetsPanel.rightsForm.saveFailed"));
    }
  };

  return (
    <div className="flex h-full flex-col rounded-xl bg-card p-4 ring-1 ring-border/65">
      <div className="grid gap-4 lg:grid-cols-2">
        <FormTextField
          label={t("assetsPanel.rightsForm.owner")}
          value={owner}
          onChange={setOwner}
          maxLength={160}
          placeholder={t("assetsPanel.rightsForm.ownerPlaceholder")}
        />
        <div className="space-y-2">
          <FieldLabel>{t("assetsPanel.rightsForm.aiUsage")}</FieldLabel>
          <div className="flex min-h-10 flex-wrap items-center gap-4 rounded-md bg-background px-3 py-2">
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={generatedVisuals}
                onChange={(event) => setGeneratedVisuals(event.target.checked)}
                className="size-4 accent-primary"
              />
              {t("assetsPanel.rightsForm.generatedVisuals")}
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={generatedCopy}
                onChange={(event) => setGeneratedCopy(event.target.checked)}
                className="size-4 accent-primary"
              />
              {t("assetsPanel.rightsForm.generatedCopy")}
            </label>
          </div>
        </div>
        <FormTextField
          label={t("assetsPanel.rightsForm.rightsStatement")}
          value={rightsStatement}
          onChange={setRightsStatement}
          maxLength={1000}
          placeholder={t("assetsPanel.rightsForm.rightsPlaceholder")}
          multiline
        />
        <FormTextField
          label={t("assetsPanel.rightsForm.aiStatement")}
          value={aiStatement}
          onChange={setAiStatement}
          maxLength={1000}
          placeholder={t("assetsPanel.rightsForm.aiPlaceholder")}
          multiline
        />
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={handleSave} disabled={!canSave}>
          <IconDeviceFloppy className="size-4" />
          {update.isPending ? t("assetsPanel.rightsForm.saving") : t("assetsPanel.rightsForm.save")}
        </Button>
      </div>
    </div>
  );
}

function AssetUploadSlot({
  icon: Icon,
  title,
  body,
  asset,
  t,
  uploadLabel,
  uploadingLabel,
  uploadAccept,
  uploadDisabled,
  isUploading,
  onUpload,
}: {
  icon: IconComponent;
  title: string;
  body: string;
  asset: IpCommerceAsset | null;
  t: Translate;
  uploadLabel: string;
  uploadingLabel: string;
  uploadAccept: string;
  uploadDisabled: boolean;
  isUploading: boolean;
  onUpload: (file: File) => void;
}) {
  const assetUrl = getAssetUrl(asset);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (uploadDisabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) onUpload(file);
  };

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon className="size-5" />
          </span>
          <div>
            <h4 className="text-sm font-semibold">{title}</h4>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{body}</p>
          </div>
        </div>
        <StatusPill>{assetUrl ? t("assetsPanel.ready") : t("assetsPanel.missing")}</StatusPill>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={uploadAccept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onUpload(file);
        }}
      />
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!uploadDisabled) inputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !uploadDisabled) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        className={[
          "mt-4 flex min-h-40 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background/70 px-4 py-6 text-center transition",
          uploadDisabled
            ? "opacity-60"
            : "cursor-pointer hover:border-primary/60 hover:bg-primary/5",
        ].join(" ")}
      >
        {assetUrl ? <AssetPreview asset={asset} assetUrl={assetUrl} icon={Icon} /> : null}
        {!assetUrl ? (
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <IconUpload className="size-5" />
          </span>
        ) : null}
        <p className="mt-3 text-sm font-semibold text-foreground">
          {isUploading ? uploadingLabel : uploadLabel}
        </p>
        <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
          {t("assetsPanel.form.uploadHint")}
        </p>
      </div>
    </div>
  );
}

function AssetPreview({
  asset,
  assetUrl,
  icon: Icon,
}: {
  asset: IpCommerceAsset | null;
  assetUrl: string;
  icon: IconComponent;
}) {
  if (asset?.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={assetUrl} alt="" className="h-28 w-full max-w-sm rounded-lg object-cover" />
    );
  }

  if (asset?.kind === "video") {
    return (
      <video
        src={assetUrl}
        className="h-28 w-full max-w-sm rounded-lg object-cover"
        muted
        playsInline
        controls
      />
    );
  }

  return (
    <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Icon className="size-5" />
    </span>
  );
}

function IpProfileEditDialog({
  ip,
  open,
  onOpenChange,
}: {
  ip: IpCreatorIp;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("newIpWorkbench");
  const typeT = useTranslations("newIpCreate");
  const update = useUpdateIpCommerceIpProfile();
  const [title, setTitle] = useState(ip.title);
  const [summary, setSummary] = useState(ip.summary);
  const [description, setDescription] = useState(ip.description ?? "");
  const [ipType, setIpType] = useState<EditableIpType>(normalizeEditableIpType(ip.ipType));
  const [visibility, setVisibility] = useState<EditableVisibility>(
    normalizeEditableVisibility(ip.listingVisibility)
  );
  const [ageRating, setAgeRating] = useState<EditableAgeRating>(
    normalizeEditableAgeRating(ip.ageRating)
  );
  const [genresText, setGenresText] = useState((ip.genres ?? []).join(", "));
  const [tagsText, setTagsText] = useState((ip.tags ?? []).join(", "));

  const trimmedTitle = title.trim();
  const trimmedSummary = summary.trim();
  const trimmedDescription = description.trim();
  const genres = splitTaxonomyInput(genresText, GENRE_MAX_COUNT);
  const tags = splitTaxonomyInput(tagsText, TAG_MAX_COUNT);
  const dirty =
    trimmedTitle !== ip.title.trim() ||
    trimmedSummary !== ip.summary.trim() ||
    (trimmedDescription || null) !== (ip.description?.trim() || null) ||
    ipType !== normalizeEditableIpType(ip.ipType) ||
    visibility !== normalizeEditableVisibility(ip.listingVisibility) ||
    ageRating !== normalizeEditableAgeRating(ip.ageRating) ||
    !sameStringList(genres, ip.genres ?? []) ||
    !sameStringList(tags, ip.tags ?? []);
  const canSave = trimmedTitle.length > 0 && dirty && !update.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await update.mutateAsync({
        ipId: ip.id,
        title: trimmedTitle,
        summary: trimmedSummary,
        description: trimmedDescription || null,
        ipType,
        listingVisibility: visibility,
        ageRating,
        genres,
        tags,
        expectedVersion: ip.version,
      });
      toast.success(t("profileEdit.saved"));
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t("profileEdit.failed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("profileEdit.title")}</DialogTitle>
          <DialogDescription>{t("profileEdit.body")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel required>{typeT("fieldName")}</FieldLabel>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={NAME_MAX_LENGTH}
                placeholder={typeT("fieldNamePlaceholder")}
              />
              <CharacterCount value={title.length} max={NAME_MAX_LENGTH} />
            </Field>

            <Field>
              <FieldLabel required>{typeT("fieldIpType")}</FieldLabel>
              <Select value={ipType} onValueChange={(value) => setIpType(value as EditableIpType)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={typeT("fieldIpTypePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {IP_TYPE_OPTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {typeT(`ipType.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>{typeT("fieldDescription")}</FieldLabel>
              <Textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                maxLength={SUMMARY_MAX_LENGTH}
                placeholder={typeT("fieldDescriptionPlaceholder")}
                rows={4}
              />
              <CharacterCount value={summary.length} max={SUMMARY_MAX_LENGTH} />
            </Field>

            <Field>
              <FieldLabel>{t("profileEdit.description")}</FieldLabel>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={DESCRIPTION_MAX_LENGTH}
                placeholder={t("profileEdit.descriptionPlaceholder")}
                rows={6}
              />
              <CharacterCount value={description.length} max={DESCRIPTION_MAX_LENGTH} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>{t("profileEdit.visibility")}</FieldLabel>
                <Select
                  value={visibility}
                  onValueChange={(value) => setVisibility(value as EditableVisibility)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VISIBILITY_OPTIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`visibility.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{t("profileEdit.visibilityHelp")}</FieldDescription>
              </Field>

              <Field>
                <FieldLabel>{t("profileEdit.ageRating")}</FieldLabel>
                <Select
                  value={ageRating}
                  onValueChange={(value) => setAgeRating(value as EditableAgeRating)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGE_RATING_OPTIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`ageRating.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>{t("profileEdit.genres")}</FieldLabel>
                <Input
                  value={genresText}
                  onChange={(event) => setGenresText(event.target.value)}
                  placeholder={t("profileEdit.genresPlaceholder")}
                />
                <FieldDescription>
                  {t("profileEdit.taxonomyHelp", { count: genres.length, max: GENRE_MAX_COUNT })}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel>{t("profileEdit.tags")}</FieldLabel>
                <Input
                  value={tagsText}
                  onChange={(event) => setTagsText(event.target.value)}
                  placeholder={t("profileEdit.tagsPlaceholder")}
                />
                <FieldDescription>
                  {t("profileEdit.taxonomyHelp", { count: tags.length, max: TAG_MAX_COUNT })}
                </FieldDescription>
              </Field>
            </div>
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {update.isPending ? t("profileEdit.saving") : t("profileEdit.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-8 border-b border-border py-10 last:border-b-0 md:grid-cols-[1fr_2fr]">
      <div>
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {description ? (
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function StatusPill({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function ReadinessItem({ title, body, done }: { title: string; body: string; done: boolean }) {
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-card p-4">
      <span
        className={[
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
          done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted",
        ].join(" ")}
      >
        <span className="size-1.5 rounded-full bg-current" />
      </span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{body}</span>
      </span>
    </div>
  );
}

function CharacterCount({ value, max }: { value: number; max: number }) {
  return (
    <FieldDescription className="text-right tabular-nums text-muted-foreground">
      {value}/{max}
    </FieldDescription>
  );
}

function normalizeEditableIpType(value: string): EditableIpType {
  return IP_TYPE_OPTIONS.includes(value as EditableIpType) ? (value as EditableIpType) : "other";
}

function normalizeEditableVisibility(value: string): EditableVisibility {
  return VISIBILITY_OPTIONS.includes(value as EditableVisibility)
    ? (value as EditableVisibility)
    : "private";
}

function normalizeEditableAgeRating(value: string): EditableAgeRating {
  return AGE_RATING_OPTIONS.includes(value as EditableAgeRating)
    ? (value as EditableAgeRating)
    : "general";
}

function splitTaxonomyInput(value: string, max: number) {
  const items = value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.slice(0, 32));
  return Array.from(new Set(items)).slice(0, max);
}

function sameStringList(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function canSubmitForReview(status: string) {
  return status === "draft" || status === "changes_requested" || status === "approved";
}

function getReviewReadiness(ip: IpCreatorIp, t: Translate, locale: Locale) {
  const missing: string[] = [];
  if (!ip.title.trim()) missing.push(t("fields.name"));
  if (!ip.summary.trim()) missing.push(t("fields.summary"));
  if (!hasPublicationAsset(ip)) missing.push(t("fields.asset"));
  if (!hasRightsDeclaration(ip)) missing.push(t("fields.rights"));
  if (!hasRequiredAiDisclosure(ip)) missing.push(t("fields.aiDisclosure"));
  return {
    ready: missing.length === 0,
    missing: missing.length ? [missing.join(locale.startsWith("zh") ? "、" : ", ")] : [],
  };
}

function hasPublicationAsset(ip: IpCreatorIp) {
  return Boolean(ip.coverAsset || ip.trailerAsset);
}

function hasRightsDeclaration(ip: IpCreatorIp) {
  return Boolean(
    ip.copyrightOwner?.trim() && jsonStringField(ip.rightsSummary, "statement").trim()
  );
}

function hasRequiredAiDisclosure(ip: IpCreatorIp) {
  const generatedVisuals = jsonBooleanField(ip.aiDisclosure, "generatedVisuals");
  const generatedCopy = jsonBooleanField(ip.aiDisclosure, "generatedCopy");
  if (!generatedVisuals && !generatedCopy) return true;
  return Boolean(jsonStringField(ip.aiDisclosure, "statement").trim());
}

function formatDateTime(value: string, locale: Locale) {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (item: number) => String(item).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("");
}

function dateTimeLocalToIso(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validatePriceRuleInput({
  enabled,
  amount,
  originalAmount,
  startsAt,
  endsAt,
  maxPerUser,
}: {
  enabled: boolean;
  amount: string;
  originalAmount: string;
  startsAt: string;
  endsAt: string;
  maxPerUser: string;
}) {
  if (!enabled) return true;
  if (!/^\d+$/.test(amount.trim())) return false;
  if (originalAmount.trim() && !/^\d+$/.test(originalAmount.trim())) return false;
  if (maxPerUser.trim() && !/^\d+$/.test(maxPerUser.trim())) return false;
  if (startsAt && Number.isNaN(new Date(startsAt).getTime())) return false;
  if (endsAt && Number.isNaN(new Date(endsAt).getTime())) return false;
  if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) return false;
  return true;
}

function getAssetUrl(asset: IpCommerceAsset | null | undefined) {
  const url = (asset?.url ?? asset?.externalUrl)?.trim();
  return url ? url : undefined;
}

function jsonStringField(value: Record<string, unknown> | undefined, key: string) {
  const item = value?.[key];
  return typeof item === "string" ? item : "";
}

function jsonBooleanField(value: Record<string, unknown> | undefined, key: string) {
  return value?.[key] === true;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "";
}
