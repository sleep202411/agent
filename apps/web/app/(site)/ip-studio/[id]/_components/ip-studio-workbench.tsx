"use client";

import { IpCrewOrigin } from "@/app/(site)/ips/_components/ip-crew-origin";
import { ContentGpsOwnerEditor } from "@/app/(site)/ips/_components/content-gps-owner-editor";
import { IpReleaseLinks } from "@/app/(site)/ips/_components/ip-release-links";
import { AudienceKnowledgeEditor } from "./audience-knowledge-editor";
import { AudienceGenerationTemplatesEditor } from "./audience-generation-templates-editor";
import { IpGameAssociations } from "@/app/(site)/ips/_components/ip-game-associations";
import { IpStageApplications } from "@/app/(site)/ips/_components/ip-stage-applications";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EPISODE_SOURCE_MAX_BYTES } from "@repo/shared";
import {
  cancelEpisodeUpload,
  episodeUploadErrorKey,
  type EpisodeUploadStage,
} from "../../_lib/episode-upload";
import type { DragEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCalendarTime,
  IconChevronDown,
  IconCoin,
  IconDeviceFloppy,
  IconEdit,
  IconEye,
  IconFileText,
  IconGift,
  IconLayoutList,
  IconLink,
  IconLoader2,
  IconLock,
  IconPhoto,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconRocket,
  IconShieldCheck,
  IconShoppingCart,
  IconTags,
  IconTrash,
  IconUpload,
  IconUserCheck,
  IconCrown,
  IconUserPlus,
  IconUsers,
  IconVideo,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHero,
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
import { cn } from "@/lib/utils";
import { VideoPlayer } from "@/components/media/video-player";
import type {
  IpCommerceAsset,
  IpAclGrant,
  IpContributorRole,
  IpCreatorCommerceOverview,
  IpCreatorContributor,
  IpCreatorIp,
  IpTaxonomyTerm,
  IpUserSearchHit,
} from "@/src/lib/ip-commerce/api";
import {
  useCreateIpCommerceContributor,
  useCreateIpCommerceEpisode,
  useDeleteIpCommerceContributor,
  useDeleteIpCommerceEpisode,
  useGrantIpEditAccess,
  useIpCommerceTaxonomyTerms,
  useMyIpAclGrants,
  useMyIpContributors,
  useMyIpCommerceOverview,
  useMyIpCommerceIp,
  useRevokeIpEditAccess,
  useTransferIpOwner,
  useSearchIpCommerceUsers,
  useSubmitIpCommerceIpForReview,
  useUpdateIpCommerceContributor,
  useUpdateIpCommerceEpisode,
  useUpdateIpCommerceIpAssets,
  useUpdateIpCommerceIpProfile,
  useUploadIpCommerceMedia,
  useUpsertIpCommercePriceRule,
} from "@/src/lib/ip-commerce/hooks";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { ApiRequestError } from "@/src/lib/api";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { ChannelBadge } from "@/components/channel-badge";

interface IpStudioWorkbenchProps {
  ipId: string;
}

type IconComponent = typeof IconFileText;
type Translate = ReturnType<typeof useTranslations>;

const STUDIO_TABS = [
  { key: "overview", icon: IconFileText },
  { key: "episodes", icon: IconVideo },
  { key: "members", icon: IconUsers },
  { key: "rights", icon: IconFileText },
  { key: "pricing", icon: IconCoin },
  { key: "orders", icon: IconReceipt },
  { key: "generation", icon: IconPhoto },
  { key: "knowledge", icon: IconFileText },
] as const;

type StudioTabKey = (typeof STUDIO_TABS)[number]["key"];

const NAME_MAX_LENGTH = 80;
const SUMMARY_MAX_LENGTH = 280;
const EPISODE_SUMMARY_MAX_LENGTH = 800;
const DESCRIPTION_MAX_LENGTH = 3000;
const GENRE_MAX_COUNT = 8;
const VISIBILITY_OPTIONS = ["private", "unlisted", "public"] as const;
type EditableVisibility = (typeof VISIBILITY_OPTIONS)[number];
const AGE_RATING_OPTIONS = ["general", "teen", "mature", "restricted"] as const;
type EditableAgeRating = (typeof AGE_RATING_OPTIONS)[number];
const IP_CONTENT_CURRENCY = "community_point" as const;
const CONTRIBUTOR_ROLE_OPTIONS: IpContributorRole[] = [
  "owner",
  "producer",
  "director",
  "writer",
  "artist",
  "editor",
  "performer",
  "other",
];
const BPS_FULL = 10000;
const EPISODE_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 21_22_58.png"
);

export function IpStudioWorkbench({ ipId }: IpStudioWorkbenchProps) {
  const { user, isLoading } = useCurrentUser();
  return (
    <IpStudioSession
      key={`${ipId}:${user?.id ?? "guest"}`}
      ipId={ipId}
      signedIn={!!user}
      userLoading={isLoading}
    />
  );
}

function IpStudioSession({
  ipId,
  signedIn,
  userLoading,
}: IpStudioWorkbenchProps & { signedIn: boolean; userLoading: boolean }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("newIpWorkbench");
  const common = useTranslations("common");
  const auth = useAuthDialog();
  const [activeTab, setActiveTab] = useState<StudioTabKey>("overview");
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const { data, isLoading, isFetching, error, refetch } = useMyIpCommerceIp(ipId, { locale });
  const submitReview = useSubmitIpCommerceIpForReview();

  if (userLoading || isLoading) {
    return (
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background text-foreground">
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
          {common("loading")}
        </p>
      </main>
    );
  }

  const accessLost = error instanceof ApiRequestError && [401, 403, 404].includes(error.status);
  if (!signedIn || !data?.ip || accessLost) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-background px-5 py-10 text-foreground">
        <div className="mx-auto flex max-w-xl flex-col items-start gap-5">
          <BackToProfile locale={locale} label={t("backToProfile")} />
          <div>
            <h1 className="text-xl font-semibold">{t("eyebrow")}</h1>
            <p
              role={error ? "alert" : undefined}
              className="mt-2 break-words text-sm leading-6 text-muted-foreground"
            >
              {!signedIn ? t("signInRequired") : errorMessage(error) || t("notFoundBody")}
            </p>
          </div>
          {!signedIn ? (
            <Button size="sm" onClick={() => auth.open()}>
              {t("signIn")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {isFetching ? common("loading") : t("retry")}
            </Button>
          )}
        </div>
      </main>
    );
  }

  const ip = data.ip;
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
      {error && (
        <div
          role="alert"
          className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 text-sm text-destructive"
        >
          <span>{errorMessage(error) || t("notFoundBody")}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      )}
      <EditStyleHero
        ip={ip}
        t={t}
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
          <OverviewPanel ip={ip} t={t} onEdit={() => setProfileEditOpen(true)} />
        ) : null}
        {activeTab === "episodes" ? (
          <EpisodesPanel ip={ip} t={t} onOpenPricing={() => selectTab("pricing")} />
        ) : null}
        {activeTab === "members" ? <MembersPanel ip={ip} t={t} locale={locale} /> : null}
        {activeTab === "rights" ? <RightsPanel ip={ip} t={t} /> : null}
        {activeTab === "pricing" ? <PricingPanel ip={ip} t={t} /> : null}
        {activeTab === "orders" ? <OrdersPanel ip={ip} t={t} locale={locale} /> : null}
        {activeTab === "knowledge" ? (
          <Section title={t("tabs.knowledge")}>
            <AudienceKnowledgeEditor ipId={ip.id} />
          </Section>
        ) : null}
        {activeTab === "generation" ? (
          <Section title={t("tabs.generation", { defaultValue: "Audience Generation" })}>
            <AudienceGenerationTemplatesEditor ipId={ip.id} />
          </Section>
        ) : null}
      </div>

      <IpProfileEditDialog ip={ip} open={profileEditOpen} onOpenChange={setProfileEditOpen} />
    </main>
  );
}

function EditStyleHero({
  ip,
  t,
  updatedAt,
  locale,
  canSubmitReview,
  reviewMissing,
  submitPending,
  onSubmitReview,
}: {
  ip: IpCreatorIp;
  t: Translate;
  updatedAt: string;
  locale: Locale;
  canSubmitReview: boolean;
  reviewMissing: string[];
  submitPending: boolean;
  onSubmitReview: () => void;
}) {
  // The readiness ring + "准备发布" CTA belong to the draft→submit→review flow.
  // Once the IP is published/in-review they're moot (and a disabled "准备发布"
  // contradicts the 已发布 status pill), so show them only while submittable.
  const submittable = canSubmitForReview(ip.status);
  return (
    <div className="relative border-b border-border bg-card">
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
            <ChannelBadge category={ip.channelType} tone="surface" />
            {ip.genres.slice(0, 2).map((genre) => (
              <StatusPill key={genre}>{genre}</StatusPill>
            ))}
            <StatusPill>{t(`status.${ip.status}`)}</StatusPill>
            <StatusPill>{t(`visibility.${ip.listingVisibility}`)}</StatusPill>
            <StatusPill>
              {ip.viewerAccess.owner ? t("viewerAccess.owner") : t("viewerAccess.editor")}
            </StatusPill>
            <span className="text-xs text-muted-foreground">
              {t("lastEdited", { time: updatedAt })}
            </span>
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:max-w-md sm:items-end">
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {submittable ? <ReadinessRing ip={ip} t={t} /> : null}
            <Button
              asChild
              size="sm"
              variant="outline"
              color="muted"
              className="min-w-[7.5rem] justify-center"
            >
              <Link href={localizePath(`/ips/${ip.id}`, locale)}>
                <IconEye className="size-3.5" />
                {t("preview")}
              </Link>
            </Button>
            {submittable ? (
              <Button
                size="sm"
                disabled={!canSubmitReview}
                onClick={onSubmitReview}
                className="min-w-[7.5rem] justify-center disabled:border disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
              >
                <IconRocket className="size-3.5" />
                {submitPending ? t("reviewSubmit.submitting") : t("publish")}
              </Button>
            ) : null}
          </div>
          {submittable && reviewMissing.length > 0 ? (
            <p className="inline-flex items-start gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-2 text-left text-xs font-medium leading-5 text-primary sm:max-w-sm">
              <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{t("reviewSubmit.requirements", { items: reviewMissing.join("、") })}</span>
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

function OverviewPanel({ ip, t, onEdit }: { ip: IpCreatorIp; t: Translate; onEdit: () => void }) {
  // Readiness/next-steps moved into the header completion ring (ReadinessRing).
  const taxonomy = ip.genres;
  const updateAssets = useUpdateIpCommerceIpAssets();
  const uploadMedia = useUploadIpCommerceMedia();
  // Cover + trailer share one mutation, so `isPending` can't tell which
  // slot is in flight — track the active slot so only it shows loading.
  const [uploadingSlot, setUploadingSlot] = useState<"cover" | "trailer" | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleCoverUpload = async (file: File) => {
    setUploadingSlot("cover");
    setUploadProgress(0);
    try {
      const { asset } = await uploadMedia.mutateAsync({
        ipId: ip.id,
        file,
        kind: "image",
        purpose: "cover",
        onProgress: setUploadProgress,
      });
      await updateAssets.mutateAsync({
        ipId: ip.id,
        coverAssetId: asset.id,
      });
      toast.success(t("assetsPanel.toasts.uploadSaved"));
    } catch (err) {
      toast.error(errorMessage(err) || t("assetsPanel.toasts.uploadFailed"));
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleTrailerUpload = async (file: File) => {
    setUploadingSlot("trailer");
    setUploadProgress(0);
    try {
      const { asset } = await uploadMedia.mutateAsync({
        ipId: ip.id,
        file,
        kind: "video",
        purpose: "trailer",
        onProgress: setUploadProgress,
      });
      await updateAssets.mutateAsync({
        ipId: ip.id,
        trailerAssetId: asset.id,
      });
      toast.success(t("assetsPanel.toasts.uploadSaved"));
    } catch (err) {
      toast.error(errorMessage(err) || t("assetsPanel.toasts.uploadFailed"));
    } finally {
      setUploadingSlot(null);
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
              {taxonomy.length > 0 || ip.channelType ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <ChannelBadge category={ip.channelType} tone="surface" />
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
            isUploading={uploadingSlot === "cover"}
            progress={uploadProgress}
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
            isUploading={uploadingSlot === "trailer"}
            progress={uploadProgress}
            onUpload={(file) => void handleTrailerUpload(file)}
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

export function EpisodeManager({
  ip,
  t,
  onOpenPricing,
}: {
  ip: IpCreatorIp;
  t: Translate;
  onOpenPricing: () => void;
}) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingEpisodeId, setEditingEpisodeId] = useState<string | null>(null);
  const episodes = ip.episodes ?? [];
  const editingEpisode = episodes.find((episode) => episode.id === editingEpisodeId) ?? null;

  return (
    <div className="space-y-3">
      {episodes.length > 0 ? (
        <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">
                {t("episodesPanel.episodeCountLabel")}
              </p>
              <div className="mt-1 flex flex-wrap items-end gap-2">
                <p className="text-3xl font-semibold">{episodes.length}</p>
                <StatusPill>{t("episodesPanel.episodeUpload.hasContent")}</StatusPill>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="solid"
                color="primary"
                onClick={() => setCreateDialogOpen(true)}
              >
                <IconPlus className="size-4" />
                {t("episodesPanel.create.addAction")}
              </Button>
              <Button type="button" variant="outline" color="muted" onClick={onOpenPricing}>
                <IconCoin className="size-4" />
                {t("episodesPanel.episodePricing.openPricing")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {episodes.map((episode, index) => (
          <EpisodeCard
            key={episode.id}
            ip={ip}
            episode={episode}
            displayNumber={index + 1}
            t={t}
            onEdit={() => setEditingEpisodeId(episode.id)}
          />
        ))}
        {!episodes.length ? (
          <div className="rounded-xl bg-card p-6 text-center ring-1 ring-border/65">
            <IconVideo className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">{t("episodesPanel.empty.title")}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("episodesPanel.empty.body")}
            </p>
            <Button type="button" className="mt-4" onClick={() => setCreateDialogOpen(true)}>
              <IconPlus className="size-4" />
              {t("episodesPanel.create.addAction")}
            </Button>
          </div>
        ) : null}
      </div>

      <EpisodeUpsertDialog
        key={`create:${ip.id}:${createDialogOpen}`}
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        ip={ip}
        t={t}
      />
      {editingEpisode ? (
        <EpisodeUpsertDialog
          key={`edit:${ip.id}:${editingEpisode.id}`}
          open={Boolean(editingEpisode)}
          onOpenChange={(open) => {
            if (!open) setEditingEpisodeId(null);
          }}
          ip={ip}
          episode={editingEpisode}
          t={t}
        />
      ) : null}
    </div>
  );
}

type StudioEpisode = NonNullable<IpCreatorIp["episodes"]>[number];

type EpisodeDialogDraft = {
  title: string;
  summary: string;
  mediaAssetId: string | null;
  mediaUrl: string;
  coverAssetId: string | null;
  coverUrl: string;
  durationSeconds: string;
  isFreePreview: boolean;
};

function EpisodeUpsertDialog({
  open,
  onOpenChange,
  ip,
  episode,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ip: IpCreatorIp;
  episode?: StudioEpisode;
  t: Translate;
}) {
  // Preserve the concurrency version belonging to this open draft.
  const [expectedVersion] = useState(ip.version);
  const oldT = useTranslations("ipEdit");
  const commonT = useTranslations("common");
  const createEpisode = useCreateIpCommerceEpisode();
  const updateEpisode = useUpdateIpCommerceEpisode();
  const uploadMedia = useUploadIpCommerceMedia();
  const [draft, setDraft] = useState<EpisodeDialogDraft>(() =>
    episodeDialogDraftFromEpisode(episode)
  );
  const [probing, setProbing] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoStage, setVideoStage] = useState<EpisodeUploadStage>("uploading");
  const videoFileRef = useRef<File | null>(null);
  const videoAbortRef = useRef<AbortController | null>(null);
  const [coverProgress, setCoverProgress] = useState(0);
  const [videoDragOver, setVideoDragOver] = useState(false);
  const [coverDragOver, setCoverDragOver] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const mediaObjectUrlRef = useRef("");
  const coverObjectUrlRef = useRef("");
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const isEditing = Boolean(episode);
  const submitting = createEpisode.isPending || updateEpisode.isPending;

  useEffect(() => {
    return () => {
      videoAbortRef.current?.abort();
      if (mediaObjectUrlRef.current) URL.revokeObjectURL(mediaObjectUrlRef.current);
      if (coverObjectUrlRef.current) URL.revokeObjectURL(coverObjectUrlRef.current);
    };
  }, []);

  const updateDraft = (patch: Partial<EpisodeDialogDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    if (submitError) setSubmitError(null);
  };

  const resetObjectUrl = (target: "media" | "cover") => {
    const ref = target === "media" ? mediaObjectUrlRef : coverObjectUrlRef;
    if (ref.current) {
      URL.revokeObjectURL(ref.current);
      ref.current = "";
    }
  };

  const probeAndApply = async (src: string) => {
    setProbing(true);
    const meta = await probeVideo(src);
    if (mediaObjectUrlRef.current !== src) return;
    setProbing(false);
    if (!meta) {
      toast.warning(oldT("epProbeFailed"));
      return;
    }
    updateDraft({ durationSeconds: meta.duration > 0 ? String(meta.duration) : "" });
  };

  const handleVideoFile = async (file: File) => {
    if (!["video/mp4", "video/webm", "video/quicktime"].includes(file.type)) {
      toast.error(oldT("epFileNotVideo"));
      return;
    }
    if (file.size > EPISODE_SOURCE_MAX_BYTES) {
      toast.error(oldT("epSourceTooLarge"));
      return;
    }
    videoAbortRef.current?.abort();
    const controller = new AbortController();
    videoAbortRef.current = controller;
    if (videoFileRef.current !== file) {
      resetObjectUrl("media");
      const localUrl = URL.createObjectURL(file);
      mediaObjectUrlRef.current = localUrl;
      videoFileRef.current = file;
      updateDraft({ mediaUrl: localUrl, mediaAssetId: null, durationSeconds: "" });
      void probeAndApply(localUrl);
    }
    setVideoError(null);
    setVideoProgress(0);
    setVideoStage("uploading");
    setUploadingVideo(true);
    try {
      const { asset } = await uploadMedia.mutateAsync({
        ipId: ip.id,
        file,
        kind: "video",
        purpose: "episode_media",
        signal: controller.signal,
        onProgress: (percent) => {
          if (!controller.signal.aborted) setVideoProgress(percent);
        },
        onStage: (stage) => {
          if (!controller.signal.aborted) setVideoStage(stage);
        },
      });
      if (controller.signal.aborted) return;
      updateDraft({ mediaAssetId: asset.id });
      toast.success(commonT("uploadSuccess"));
    } catch (err) {
      if (controller.signal.aborted) return;
      const localKey = episodeUploadErrorKey(err);
      const message = localKey ? oldT(localKey) : errorMessage(err) || commonT("uploadFailed");
      setVideoError(message);
      toast.error(message);
    } finally {
      if (videoAbortRef.current === controller) setUploadingVideo(false);
    }
  };

  const removeVideo = () => {
    videoAbortRef.current?.abort();
    videoAbortRef.current = null;
    const file = videoFileRef.current;
    videoFileRef.current = null;
    setUploadingVideo(false);
    setProbing(false);
    setVideoError(null);
    resetObjectUrl("media");
    updateDraft({ mediaUrl: "", mediaAssetId: null, durationSeconds: "" });
    if (file)
      void cancelEpisodeUpload(file, ip.id).catch((err) =>
        toast.error(errorMessage(err) || commonT("uploadFailed"))
      );
  };

  const handleCoverFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(oldT("epCoverNotImage"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(oldT("epCoverTooLarge"));
      return;
    }
    resetObjectUrl("cover");
    const localUrl = URL.createObjectURL(file);
    coverObjectUrlRef.current = localUrl;
    setCoverError(null);
    updateDraft({ coverUrl: localUrl, coverAssetId: null });
    setCoverProgress(0);
    setUploadingCover(true);
    try {
      const { asset } = await uploadMedia.mutateAsync({
        ipId: ip.id,
        file,
        kind: "image",
        purpose: "episode_cover",
        onProgress: setCoverProgress,
      });
      updateDraft({ coverAssetId: asset.id });
      toast.success(commonT("uploadSuccess"));
    } catch (err) {
      const message = errorMessage(err) || commonT("uploadFailed");
      resetObjectUrl("cover");
      updateDraft({ coverUrl: "", coverAssetId: null });
      setCoverError(message);
      toast.error(message);
    } finally {
      setUploadingCover(false);
    }
  };

  const handleSave = async () => {
    if (uploadingVideo || uploadingCover) {
      toast.warning(commonT("uploading"));
      return;
    }
    if (!draft.title.trim()) {
      toast.warning(oldT("epTitleRequired"));
      return;
    }
    if (!draft.summary.trim()) {
      toast.warning(oldT("epDescriptionRequired"));
      return;
    }
    if (!draft.mediaAssetId) {
      toast.warning(oldT("epVideoRequired"));
      return;
    }
    setSubmitError(null);
    try {
      if (episode) {
        await updateEpisode.mutateAsync({
          ipId: ip.id,
          episodeId: episode.id,
          title: draft.title.trim(),
          summary: draft.summary.trim(),
          durationSeconds: draft.durationSeconds.trim()
            ? Number(draft.durationSeconds.trim())
            : null,
          isFreePreview: draft.isFreePreview,
          coverAssetId: draft.coverAssetId,
          mediaAssetId: draft.mediaAssetId,
          expectedVersion,
        });
        toast.success(t("episodesPanel.toasts.saved"));
      } else {
        await createEpisode.mutateAsync({
          ipId: ip.id,
          title: draft.title.trim(),
          summary: draft.summary.trim() || undefined,
          // Episode order is assigned server-side when appending.
          durationSeconds: draft.durationSeconds.trim()
            ? Number(draft.durationSeconds.trim())
            : undefined,
          isFreePreview: draft.isFreePreview,
          coverAssetId: draft.coverAssetId ?? undefined,
          mediaAssetId: draft.mediaAssetId ?? undefined,
          expectedVersion,
        });
        toast.success(t("episodesPanel.toasts.created"));
      }
      onOpenChange(false);
    } catch (err) {
      setSubmitError(errorMessage(err) || t("episodesPanel.toasts.saveFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={EPISODE_HERO_URL}
          eyebrow={oldT("epHeroEyebrow")}
          title={isEditing ? oldT("epDialogTitleEdit") : oldT("epDialogTitleNew")}
          description={oldT("epHeroSubtitle")}
        />

        <DialogBody className="py-4">
          <Field>
            <FieldLabel>
              {oldT("epTitleLabel")} <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              value={draft.title}
              onChange={(event) =>
                updateDraft({ title: event.target.value.slice(0, NAME_MAX_LENGTH) })
              }
              placeholder={oldT("epTitlePlaceholder")}
              maxLength={NAME_MAX_LENGTH}
              showCount
            />
            <FieldDescription>{oldT("epTitleHelp")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>
              {oldT("epDescriptionLabel")} <span className="text-destructive">*</span>
            </FieldLabel>
            <Textarea
              value={draft.summary}
              onChange={(event) =>
                updateDraft({ summary: event.target.value.slice(0, EPISODE_SUMMARY_MAX_LENGTH) })
              }
              placeholder={oldT("epDescriptionPlaceholder")}
              maxLength={EPISODE_SUMMARY_MAX_LENGTH}
              showCount
              rows={3}
            />
            <FieldDescription>{oldT("epDescriptionHelp")}</FieldDescription>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>
                {oldT("epVideoLabel")} <span className="text-destructive">*</span>
              </FieldLabel>
              {draft.mediaUrl ? (
                <div className="relative aspect-video overflow-hidden rounded-lg bg-muted/50">
                  <VideoPlayer
                    key={draft.mediaUrl}
                    src={draft.mediaUrl}
                    autoplay={false}
                    className={cn(
                      "size-full",
                      "[&_.video-js]:size-full",
                      "[&_.vjs-big-play-button]:size-10!",
                      "[&_.vjs-big-play-button]:-mt-5! [&_.vjs-big-play-button]:-ml-5!",
                      "[&_.vjs-big-play-button]:rounded-full!",
                      "[&_.vjs-big-play-button]:border-0!",
                      "[&_.vjs-big-play-button]:bg-black/60!",
                      "[&_.vjs-big-play-button]:text-base! [&_.vjs-big-play-button]:leading-10!",
                      "[&_.vjs-picture-in-picture-control]:hidden!"
                    )}
                  />
                  {uploadingVideo ? (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 bg-black/55 text-white">
                      <IconLoader2 className="size-5 animate-spin" />
                      <span className="text-[11px] font-medium">
                        {videoStage === "confirming"
                          ? oldT("epUploadFinalizing")
                          : `${commonT("uploading")} ${videoProgress}%`}
                      </span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={removeVideo}
                    aria-label={oldT("epRemoveVideo")}
                    className="absolute right-1.5 top-1.5 z-30 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <IconX className="size-3.5" />
                  </button>
                  {draft.durationSeconds ? (
                    <span className="absolute left-1.5 top-1.5 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {formatDuration(Number(draft.durationSeconds))}
                    </span>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setVideoDragOver(true);
                  }}
                  onDragLeave={() => setVideoDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setVideoDragOver(false);
                    const file = event.dataTransfer.files?.[0];
                    if (file) void handleVideoFile(file);
                  }}
                  className={cn(
                    "flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-card/40 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-card/60",
                    videoDragOver && "border-primary/60 bg-primary/5 text-primary"
                  )}
                >
                  {uploadingVideo || probing ? (
                    <>
                      <IconLoader2 className="size-5 animate-spin" />
                      <span className="text-[11px]">
                        {uploadingVideo
                          ? `${commonT("uploading")}${videoProgress > 0 ? ` ${videoProgress}%` : ""}`
                          : oldT("epProbing")}
                      </span>
                    </>
                  ) : (
                    <>
                      <IconUpload className="size-5" />
                      <span className="text-[11px] font-medium">
                        {oldT("epVideoDropzoneTitle")}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">
                        {oldT("epSourceDropzoneHint")}
                      </span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void handleVideoFile(file);
                }}
              />
              {videoError ? (
                <div className="space-y-1.5" role="alert">
                  <p className="text-[11px] text-destructive">{videoError}</p>
                  {!uploadingVideo ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (videoFileRef.current) void handleVideoFile(videoFileRef.current);
                      }}
                    >
                      <IconRefresh className="size-3.5" />
                      {commonT("retry")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <FieldDescription>{oldT("epSourceVideoHelp")}</FieldDescription>
              )}
            </Field>

            <Field>
              <FieldLabel>{oldT("epCoverLabel")}</FieldLabel>
              {draft.coverUrl ? (
                <div className="relative aspect-video overflow-hidden rounded-lg bg-muted/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={draft.coverUrl} alt="" className="size-full object-cover" />
                  {uploadingCover ? (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 bg-black/55 text-white">
                      <IconLoader2 className="size-5 animate-spin" />
                      <span className="text-[11px] font-medium">
                        {commonT("uploading")}
                        {coverProgress > 0 ? ` ${coverProgress}%` : ""}
                      </span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      resetObjectUrl("cover");
                      updateDraft({ coverUrl: "", coverAssetId: null });
                    }}
                    disabled={uploadingCover}
                    className="absolute right-1.5 top-1.5 z-30 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <IconX className="size-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setCoverDragOver(true);
                  }}
                  onDragLeave={() => setCoverDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setCoverDragOver(false);
                    const file = event.dataTransfer.files?.[0];
                    if (file) void handleCoverFile(file);
                  }}
                  className={cn(
                    "flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-card/40 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-card/60",
                    coverDragOver && "border-primary/60 bg-primary/5 text-primary"
                  )}
                >
                  {uploadingCover ? (
                    <>
                      <IconLoader2 className="size-5 animate-spin" />
                      <span className="text-[11px]">
                        {commonT("uploading")}
                        {coverProgress > 0 ? ` ${coverProgress}%` : ""}
                      </span>
                    </>
                  ) : (
                    <>
                      <IconUpload className="size-5" />
                      <span className="text-[11px] font-medium">
                        {oldT("epCoverDropzoneTitle")}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">
                        {oldT("epCoverHint")}
                      </span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void handleCoverFile(file);
                }}
              />
              {coverError ? (
                <p className="text-[11px] text-destructive">{coverError}</p>
              ) : (
                <FieldDescription>{oldT("epCoverHelp")}</FieldDescription>
              )}
            </Field>
          </div>
        </DialogBody>

        <DialogFooter className="sm:items-center">
          {submitError ? (
            <p className="mr-auto text-xs text-destructive sm:max-w-[60%]">{submitError}</p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {commonT("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={uploadingVideo || uploadingCover || submitting}
          >
            {submitting ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconDeviceFloppy className="size-3.5" />
            )}
            {commonT("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EpisodeCard({
  ip,
  episode,
  displayNumber,
  t,
  onEdit,
}: {
  ip: IpCreatorIp;
  episode: StudioEpisode;
  /** 1-based position in the live list (not raw episodeNo). */
  displayNumber: number;
  t: Translate;
  onEdit: () => void;
}) {
  const deleteEpisode = useDeleteIpCommerceEpisode();
  const coverUrl = getAssetUrl(episode.coverAsset);
  const hasVideo = Boolean(episode.mediaAsset?.url ?? episode.mediaAsset?.externalUrl);

  const handleDelete = async () => {
    try {
      await deleteEpisode.mutateAsync({ ipId: ip.id, episodeId: episode.id });
      toast.success(t("episodesPanel.toasts.deleted"));
    } catch (err) {
      toast.error(errorMessage(err) || t("episodesPanel.toasts.deleteFailed"));
    }
  };

  return (
    <div className="group rounded-xl border border-border/70 bg-card p-3 transition-colors hover:border-primary/30">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onEdit}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div className="relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/50">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt="" className="size-full object-cover" />
            ) : (
              <IconVideo className="size-6 text-muted-foreground/35" />
            )}
            {hasVideo ? (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/15">
                <span className="flex size-6 items-center justify-center rounded-full bg-black/55 text-white/90 shadow-sm backdrop-blur-sm transition-transform group-hover:scale-110">
                  <IconVideo className="size-3.5" />
                </span>
              </span>
            ) : null}
            {episode.durationSeconds ? (
              <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/65 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white/95">
                {formatDuration(episode.durationSeconds)}
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] font-semibold tabular-nums tracking-wider text-muted-foreground">
                EP {String(displayNumber).padStart(2, "0")}
              </span>
              {episode.isFreePreview ? (
                <StatusPill>{t("episodesPanel.form.freePreview")}</StatusPill>
              ) : null}
            </div>
            <div className="truncate text-sm font-medium text-foreground">{episode.title}</div>
            <div className="line-clamp-1 text-xs text-muted-foreground">
              {episode.summary?.trim() ||
                (hasVideo
                  ? t("episodesPanel.form.mediaUploadTitle")
                  : t("episodesPanel.form.mediaUploadBody"))}
            </div>
          </div>
        </button>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <StatusPill>{episode.status}</StatusPill>
          <Button variant="ghost" color="muted" size="icon-xs" onClick={onEdit}>
            <IconEdit className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            color="muted"
            size="icon-xs"
            className="text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
            onClick={handleDelete}
            disabled={deleteEpisode.isPending}
          >
            <IconTrash className="size-3.5" />
          </Button>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:hidden">
          <Button variant="ghost" color="muted" size="icon-xs" onClick={onEdit}>
            <IconEdit className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            color="muted"
            size="icon-xs"
            className="text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
            onClick={handleDelete}
            disabled={deleteEpisode.isPending}
          >
            <IconTrash className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function episodeDialogDraftFromEpisode(episode?: StudioEpisode): EpisodeDialogDraft {
  return {
    title: episode?.title ?? "",
    summary: episode?.summary ?? "",
    mediaAssetId: episode?.mediaAsset?.id ?? null,
    mediaUrl: getAssetUrl(episode?.mediaAsset) ?? "",
    coverAssetId: episode?.coverAsset?.id ?? null,
    coverUrl: getAssetUrl(episode?.coverAsset) ?? "",
    durationSeconds: episode?.durationSeconds ? String(episode.durationSeconds) : "",
    isFreePreview: episode?.isFreePreview ?? false,
  };
}

function FormTextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  multiline,
  maxLength,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  multiline?: boolean;
  maxLength?: number;
  required?: boolean;
}) {
  const control = multiline ? (
    <Textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      maxLength={maxLength}
      showCount={Boolean(maxLength)}
      placeholder={placeholder}
      rows={3}
    />
  ) : (
    <Input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      maxLength={maxLength}
      showCount={Boolean(maxLength)}
      placeholder={placeholder}
    />
  );

  return (
    <div className="space-y-2">
      <FieldLabel required={required}>{label}</FieldLabel>
      {control}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders tab — read-only sales & settlement surface (moved out of Pricing).
// Owns the commerce overview query, metric cards, pricing-health block, the
// settlement card, and the recent-orders list.
// ---------------------------------------------------------------------------
function OrdersPanel({ ip, t, locale }: { ip: IpCreatorIp; t: Translate; locale: Locale }) {
  const commerce = useMyIpCommerceOverview(ip.id, { locale });

  return (
    <Section title={t("ordersPanel.title")} description={t("ordersPanel.body")}>
      <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold">{t("ordersPanel.statusTitle")}</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("ordersPanel.statusBody")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void commerce.refetch()}
            disabled={commerce.isFetching}
          >
            <IconRefresh className={cn("size-4", commerce.isFetching && "animate-spin")} />
            {t("ordersPanel.refresh")}
          </Button>
        </div>

        {commerce.isLoading ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-4 text-sm text-muted-foreground">
            <IconLoader2 className="size-4 animate-spin" />
            {t("ordersPanel.loading")}
          </div>
        ) : commerce.error ? (
          <div className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-3 text-sm text-destructive">
            {errorMessage(commerce.error) || t("ordersPanel.loadFailed")}
          </div>
        ) : commerce.data ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <CommerceMetricCard
                icon={IconReceipt}
                label={t("ordersPanel.orders")}
                value={String(commerce.data.metrics.recognizedOrders)}
                hint={t("ordersPanel.last7Days", {
                  count: commerce.data.metrics.ordersLast7Days,
                })}
              />
              <CommerceMetricCard
                icon={IconCoin}
                label={t("ordersPanel.points")}
                value={formatPoints(commerce.data.metrics.grossCommunityPoints, locale)}
                hint={t("ordersPanel.pointsLast7Days", {
                  amount: formatPoints(commerce.data.metrics.grossCommunityPointsLast7Days, locale),
                })}
              />
              <CommerceMetricCard
                icon={IconUsers}
                label={t("ordersPanel.buyers")}
                value={String(commerce.data.metrics.uniqueBuyers)}
                hint={t("ordersPanel.totalOrders", {
                  count: commerce.data.metrics.totalOrders,
                })}
              />
              <CommerceMetricCard
                icon={IconShieldCheck}
                label={t("ordersPanel.entitlements")}
                value={String(commerce.data.metrics.activeEntitlements)}
                hint={t("ordersPanel.pendingUnlocks", {
                  count: commerce.data.metrics.pendingUnlocks,
                })}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
              <div className="rounded-xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h5 className="text-sm font-semibold">{t("ordersPanel.healthTitle")}</h5>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("ordersPanel.healthSummary", {
                        prices: commerce.data.pricingHealth.activeEpisodePriceCount,
                        episodes: commerce.data.pricingHealth.publishedEpisodeCount,
                      })}
                    </p>
                  </div>
                  <StatusPill>
                    {t(`ordersPanel.health.${commerce.data.pricingHealth.status}`)}
                  </StatusPill>
                </div>
                <div className="mt-3 space-y-2">
                  {commerce.data.pricingHealth.warnings.map((warning) => (
                    <div
                      key={warning.code}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"
                    >
                      {commerceWarningLabel(warning.code, t)}
                    </div>
                  ))}
                  {!commerce.data.pricingHealth.warnings.length ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
                      {t("ordersPanel.healthReadyBody")}
                    </div>
                  ) : null}
                </div>
              </div>

              <SettlementCard settlement={commerce.data.settlement} t={t} locale={locale} />
            </div>

            <div className="rounded-xl border border-border bg-background p-4">
              <h5 className="text-sm font-semibold">{t("ordersPanel.recentOrders")}</h5>
              <div className="mt-3 divide-y divide-border/70">
                {commerce.data.recentOrders.slice(0, 6).map((order) => (
                  <div
                    key={order.id}
                    className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_120px_120px]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {order.episode?.title ?? t(`ordersPanel.orderTarget.${order.targetType}`)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {order.orderNo} · {formatDateTime(order.createdAt, locale)}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground sm:text-sm">
                      {orderStatusLabel(order.status, t)}
                    </p>
                    <p className="font-medium sm:text-right">
                      {formatPoints(order.totalAmount, locale)}
                    </p>
                  </div>
                ))}
                {!commerce.data.recentOrders.length ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {t("ordersPanel.noOrders")}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Pricing tab — mutually-exclusive access mode (free / paid bundle / per-episode).
// The mode is inferred from existing price rules: an IP-level rule means bundle
// mode, episode-level rules mean per-episode mode. There is no schema field.
// ---------------------------------------------------------------------------
type AccessMode = "free" | "bundle" | "episode";

// Only published/scheduled episodes are sellable — the per-episode pricing list
// is a view over that sellable subset (a contextual filter, not list dedupe).
function isSellableEpisode(episode: StudioEpisode): boolean {
  return episode.status === "published" || episode.status === "scheduled";
}

function inferAccessMode(ip: IpCreatorIp): AccessMode {
  if (ip.price) return "bundle";
  const episodes = ip.episodes ?? [];
  if (episodes.some((episode) => Boolean(episode.price))) return "episode";
  return "free";
}

function PricingPanel({ ip, t }: { ip: IpCreatorIp; t: Translate }) {
  const sellableEpisodes = (ip.episodes ?? []).filter(isSellableEpisode);
  const [mode, setMode] = useState<AccessMode>(() => inferAccessMode(ip));
  const detectedMode = inferAccessMode(ip);
  // If a save round-trips and changes which rules exist, follow the server's
  // inferred mode (adjust-state-during-render pattern, no effect).
  const [syncedDetected, setSyncedDetected] = useState(detectedMode);
  if (syncedDetected !== detectedMode) {
    setSyncedDetected(detectedMode);
    setMode(detectedMode);
  }

  const hasBundlePrice = Boolean(ip.price);
  const hasEpisodePrices = sellableEpisodes.some((episode) => Boolean(episode.price));

  const modeOptions: { key: AccessMode; icon: IconComponent }[] = [
    { key: "free", icon: IconGift },
    { key: "bundle", icon: IconShoppingCart },
    { key: "episode", icon: IconLayoutList },
  ];

  return (
    <Section title={t("pricingPanel.title")} description={t("pricingPanel.body")}>
      <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("pricingPanel.mode.eyebrow")}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3" role="tablist">
          {modeOptions.map((option) => {
            const Icon = option.icon;
            const active = mode === option.key;
            return (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(option.key)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                    : "border-border bg-background hover:border-foreground/30"
                )}
              >
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-semibold",
                    active ? "text-primary" : "text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {t(`pricingPanel.mode.${option.key}.label`)}
                </span>
                <span className="text-xs leading-5 text-muted-foreground">
                  {t(`pricingPanel.mode.${option.key}.body`)}
                </span>
              </button>
            );
          })}
        </div>

        {mode === "bundle" && hasEpisodePrices ? (
          <ModeSwitchNotice text={t("pricingPanel.switch.toBundle")} />
        ) : null}
        {mode === "episode" && hasBundlePrice ? (
          <ModeSwitchNotice text={t("pricingPanel.switch.toEpisode")} />
        ) : null}
        {mode === "free" && (hasBundlePrice || hasEpisodePrices) ? (
          <ModeSwitchNotice text={t("pricingPanel.switch.toFree")} />
        ) : null}
      </div>

      {mode === "free" ? <FreeModeCard t={t} /> : null}
      {mode === "bundle" ? <BundlePriceEditor key={ip.id} ip={ip} t={t} /> : null}
      {mode === "episode" ? <EpisodePricingList ip={ip} episodes={sellableEpisodes} t={t} /> : null}
    </Section>
  );
}

function ModeSwitchNotice({ text }: { text: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
      <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function FreeModeCard({ t }: { t: Translate }) {
  return (
    <div className="rounded-xl bg-card p-6 text-center ring-1 ring-border/65">
      <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <IconGift className="size-5" />
      </span>
      <p className="mt-3 text-sm font-semibold">{t("pricingPanel.free.title")}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
        {t("pricingPanel.free.body")}
      </p>
    </div>
  );
}

function EpisodePricingList({
  ip,
  episodes,
  t,
}: {
  ip: IpCreatorIp;
  episodes: StudioEpisode[];
  t: Translate;
}) {
  if (!episodes.length) {
    return (
      <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
        <div className="flex gap-3 rounded-xl border border-dashed border-border bg-background p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <IconVideo className="size-5" />
          </span>
          <div>
            <h5 className="text-sm font-semibold">{t("pricingPanel.episode.emptyTitle")}</h5>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("pricingPanel.episode.emptyBody")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {episodes.map((episode, index) => (
        <EpisodePriceEditor
          key={episode.id}
          ip={ip}
          episode={episode}
          displayNumber={index + 1}
          t={t}
        />
      ))}
    </div>
  );
}

function SettlementCard({
  settlement,
  t,
  locale,
}: {
  settlement: IpCreatorCommerceOverview["settlement"];
  t: Translate;
  locale: Locale;
}) {
  const sharePct = settlement.saleShareBps / 100;
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <h5 className="flex items-center gap-1.5 text-sm font-semibold">
          <IconWallet className="size-4" />
          {t("ordersPanel.settlementTitle")}
        </h5>
        <StatusPill>{t("ordersPanel.cashOutComingSoon")}</StatusPill>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">
            {t("ordersPanel.withdrawableRevenue")}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight">
            {formatPoints(settlement.withdrawableBalance, locale)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">{t("ordersPanel.ipLifetimeEarnings")}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight">
            {formatPoints(settlement.ipLifetimeEarnings, locale)}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {t("ordersPanel.youEarnPercentOfSale", { pct: sharePct })}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
        <IconLock className="size-3.5 shrink-0" />
        {t("ordersPanel.settlementCashOutNote")}
      </p>
    </div>
  );
}

function CommerceMetricCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: IconComponent;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-4" />
        <span>{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

const BUNDLE_QUICK_PICKS = ["30", "50", "99"] as const;

// Prominent whole-IP bundle card. One price unlocks every episode (incl. future
// ones) via an IP-level entitlement. No per-episode prices exist in this mode.
export function BundlePriceEditor({ ip, t }: { ip: IpCreatorIp; t: Translate }) {
  const upsertPrice = useUpsertIpCommercePriceRule();
  const [baseline, setBaseline] = useState(ip);
  const [amount, setAmount] = useState(baseline.price?.amount ?? "");
  const [originalAmount, setOriginalAmount] = useState(baseline.price?.originalAmount ?? "");
  const [startsAt, setStartsAt] = useState(toDateTimeLocal(baseline.price?.startsAt));
  const [endsAt, setEndsAt] = useState(toDateTimeLocal(baseline.price?.endsAt));
  const dirty =
    amount !== (baseline.price?.amount ?? "") ||
    originalAmount !== (baseline.price?.originalAmount ?? "") ||
    startsAt !== toDateTimeLocal(baseline.price?.startsAt) ||
    endsAt !== toDateTimeLocal(baseline.price?.endsAt);
  if (!dirty && !upsertPrice.isPending && ip.version > baseline.version) {
    setBaseline(ip);
    setAmount(ip.price?.amount ?? "");
    setOriginalAmount(ip.price?.originalAmount ?? "");
    setStartsAt(toDateTimeLocal(ip.price?.startsAt));
    setEndsAt(toDateTimeLocal(ip.price?.endsAt));
  }
  const valid = validatePriceRuleInput({ amount, originalAmount, startsAt, endsAt });
  const canSave = !upsertPrice.isPending && valid;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      const result = await upsertPrice.mutateAsync({
        ipId: ip.id,
        targetType: "ip",
        status: "active",
        currency: IP_CONTENT_CURRENCY,
        amount: amount.trim(),
        originalAmount: originalAmount.trim() ? originalAmount.trim() : null,
        startsAt: dateTimeLocalToIso(startsAt),
        endsAt: dateTimeLocalToIso(endsAt),
        maxPerUser: null,
        expectedVersion: baseline.version,
      });
      setBaseline(result.ip);
      toast.success(t("pricingPanel.toasts.saved"));
    } catch (err) {
      toast.error(errorMessage(err) || t("pricingPanel.toasts.saveFailed"));
    }
  };

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-border/65">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <IconShoppingCart className="size-5" />
          </span>
          <div>
            <h4 className="text-sm font-semibold">{t("pricingPanel.bundle.title")}</h4>
            <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
              {t("pricingPanel.bundle.body")}
            </p>
          </div>
        </div>
        <StatusPill>
          {ip.price ? t("pricingPanel.status.priced") : t("pricingPanel.status.unpriced")}
        </StatusPill>
      </div>

      <div className="mt-4 max-w-xs">
        <FormTextField
          label={t("pricingPanel.form.amount")}
          value={amount}
          onChange={setAmount}
          placeholder={t("pricingPanel.form.amountPlaceholder")}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {BUNDLE_QUICK_PICKS.map((pick) => (
            <QuickPickChip
              key={pick}
              label={t("pricingPanel.form.quickPick", { amount: pick })}
              active={amount === pick}
              onClick={() => setAmount(pick)}
            />
          ))}
        </div>
      </div>

      <PriceScheduleFields
        originalAmount={originalAmount}
        startsAt={startsAt}
        endsAt={endsAt}
        onOriginalAmountChange={setOriginalAmount}
        onStartsAtChange={setStartsAt}
        onEndsAtChange={setEndsAt}
        t={t}
      />

      <p className="mt-4 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
        <IconShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
        {t("pricingPanel.bundle.unlockNote")}
      </p>

      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={handleSave} disabled={!canSave}>
          <IconDeviceFloppy className="size-4" />
          {upsertPrice.isPending ? t("pricingPanel.form.saving") : t("pricingPanel.form.save")}
        </Button>
      </div>
    </div>
  );
}

type EpisodePriceState = "unpriced" | "free_preview" | "priced";

function deriveEpisodePriceState(episode: StudioEpisode): EpisodePriceState {
  if (episode.isFreePreview) return "free_preview";
  if (episode.price) return "priced";
  return "unpriced";
}

// One row in the per-episode pricing list. Hides the amount input behind an
// explicit "Set price" affordance; supports clearing back to unpriced and a
// "Free preview" state. Compare-at + schedule live behind a per-row disclosure.
export function EpisodePriceEditor({
  ip,
  episode,
  displayNumber,
  t,
}: {
  ip: IpCreatorIp;
  episode: StudioEpisode;
  /** 1-based position in the live list (not raw episodeNo). */
  displayNumber: number;
  t: Translate;
}) {
  // Price (amount/compare-at/schedule) round-trips through the price-rule
  // endpoint. The free-preview flag is an episode field, so it goes through the
  // episode-update endpoint — the two are coordinated here.
  const upsertPrice = useUpsertIpCommercePriceRule();
  const updateEpisode = useUpdateIpCommerceEpisode();
  const serverState = deriveEpisodePriceState(episode);
  const [editing, setEditing] = useState(false);
  const [draftBase, setDraftBase] = useState({
    version: ip.version,
    isFreePreview: episode.isFreePreview,
  });
  const [amount, setAmount] = useState(episode.price?.amount ?? "");
  const [originalAmount, setOriginalAmount] = useState(episode.price?.originalAmount ?? "");
  const [startsAt, setStartsAt] = useState(toDateTimeLocal(episode.price?.startsAt));
  const [endsAt, setEndsAt] = useState(toDateTimeLocal(episode.price?.endsAt));
  const valid = validatePriceRuleInput({ amount, originalAmount, startsAt, endsAt });
  const busy = upsertPrice.isPending || updateEpisode.isPending;

  const beginEdit = () => {
    setDraftBase({ version: ip.version, isFreePreview: episode.isFreePreview });
    setAmount(episode.price?.amount ?? "");
    setOriginalAmount(episode.price?.originalAmount ?? "");
    setStartsAt(toDateTimeLocal(episode.price?.startsAt));
    setEndsAt(toDateTimeLocal(episode.price?.endsAt));
    setEditing(true);
  };

  // Clear the free-preview flag (if set) before/while pricing, since a priced
  // episode is not a free preview.
  const clearFreePreview = async () => {
    if (!draftBase.isFreePreview) return draftBase.version;
    const result = await updateEpisode.mutateAsync({
      ipId: ip.id,
      episodeId: episode.id,
      isFreePreview: false,
      expectedVersion: draftBase.version,
    });
    setDraftBase({ version: result.ip.version, isFreePreview: false });
    return result.ip.version;
  };

  const handleSavePrice = async () => {
    if (!valid || busy) return;
    try {
      const expectedVersion = await clearFreePreview();
      await upsertPrice.mutateAsync({
        ipId: ip.id,
        targetType: "episode",
        episodeId: episode.id,
        status: "active",
        currency: IP_CONTENT_CURRENCY,
        amount: amount.trim(),
        originalAmount: originalAmount.trim() ? originalAmount.trim() : null,
        startsAt: dateTimeLocalToIso(startsAt),
        endsAt: dateTimeLocalToIso(endsAt),
        maxPerUser: null,
        expectedVersion,
      });
      toast.success(t("pricingPanel.toasts.saved"));
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err) || t("pricingPanel.toasts.saveFailed"));
    }
  };

  // Disable any active episode price rule, returning the episode to unpriced.
  const disablePrice = async () => {
    if (!episode.price) return ip.version;
    const result = await upsertPrice.mutateAsync({
      ipId: ip.id,
      targetType: "episode",
      episodeId: episode.id,
      status: "disabled",
      currency: IP_CONTENT_CURRENCY,
      maxPerUser: null,
      expectedVersion: ip.version,
    });
    return result.ip.version;
  };

  const handleClear = async () => {
    if (busy) return;
    try {
      const expectedVersion = await disablePrice();
      if (episode.isFreePreview) {
        await updateEpisode.mutateAsync({
          ipId: ip.id,
          episodeId: episode.id,
          isFreePreview: false,
          expectedVersion,
        });
      }
      toast.success(t("pricingPanel.toasts.saved"));
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err) || t("pricingPanel.toasts.saveFailed"));
    }
  };

  const handleFreePreview = async () => {
    if (busy || episode.isFreePreview) return;
    try {
      // A free preview is free — drop any active price first.
      const expectedVersion = await disablePrice();
      await updateEpisode.mutateAsync({
        ipId: ip.id,
        episodeId: episode.id,
        isFreePreview: true,
        expectedVersion,
      });
      toast.success(t("pricingPanel.toasts.saved"));
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err) || t("pricingPanel.toasts.saveFailed"));
    }
  };

  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-border/65">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold tabular-nums tracking-wider text-muted-foreground">
              EP {String(displayNumber).padStart(2, "0")}
            </span>
            <EpisodeStatePill state={serverState} t={t} />
          </div>
          <h5 className="mt-1 truncate text-sm font-medium">{episode.title}</h5>
        </div>
        {serverState === "priced" && episode.price ? (
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {t("pricingPanel.form.pointsValue", { amount: episode.price.amount })}
          </p>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="max-w-xs">
            <FormTextField
              label={t("pricingPanel.form.amount")}
              value={amount}
              onChange={setAmount}
              placeholder={t("pricingPanel.form.amountPlaceholder")}
            />
          </div>
          <PriceScheduleFields
            originalAmount={originalAmount}
            startsAt={startsAt}
            endsAt={endsAt}
            onOriginalAmountChange={setOriginalAmount}
            onStartsAtChange={setStartsAt}
            onEndsAtChange={setEndsAt}
            t={t}
          />
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              color="muted"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              {t("pricingPanel.form.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSavePrice()}
              disabled={!valid || busy}
            >
              <IconDeviceFloppy className="size-3.5" />
              {busy ? t("pricingPanel.form.saving") : t("pricingPanel.form.save")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <Button
            type="button"
            size="sm"
            variant={serverState === "priced" ? "outline" : "solid"}
            color={serverState === "priced" ? "muted" : "primary"}
            onClick={beginEdit}
            disabled={busy}
          >
            <IconCoin className="size-3.5" />
            {serverState === "priced"
              ? t("pricingPanel.form.editPrice")
              : t("pricingPanel.form.setPrice")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={serverState === "free_preview" ? "solid" : "outline"}
            color={serverState === "free_preview" ? "primary" : "muted"}
            onClick={() => void handleFreePreview()}
            disabled={busy}
          >
            <IconGift className="size-3.5" />
            {t("pricingPanel.form.freePreview")}
          </Button>
          {serverState !== "unpriced" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              color="muted"
              onClick={() => void handleClear()}
              disabled={busy}
            >
              {t("pricingPanel.form.clear")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function EpisodeStatePill({ state, t }: { state: EpisodePriceState; t: Translate }) {
  const label =
    state === "free_preview"
      ? t("pricingPanel.status.freePreview")
      : state === "priced"
        ? t("pricingPanel.status.priced")
        : t("pricingPanel.status.unpriced");
  return <StatusPill>{label}</StatusPill>;
}

function QuickPickChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

// Collapsed "Schedule a sale" disclosure: compare-at (strikethrough) + a
// start/end window. Closed by default to keep the editor clean.
function PriceScheduleFields({
  originalAmount,
  startsAt,
  endsAt,
  onOriginalAmountChange,
  onStartsAtChange,
  onEndsAtChange,
  t,
}: {
  originalAmount: string;
  startsAt: string;
  endsAt: string;
  onOriginalAmountChange: (value: string) => void;
  onStartsAtChange: (value: string) => void;
  onEndsAtChange: (value: string) => void;
  t: Translate;
}) {
  const [open, setOpen] = useState(Boolean(originalAmount || startsAt || endsAt));
  const invalidWindow = Boolean(startsAt && endsAt && new Date(startsAt) >= new Date(endsAt));

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
      >
        <IconCalendarTime className="size-3.5" />
        {t("pricingPanel.schedule.toggle")}
        <IconChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
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
          {invalidWindow ? (
            <p className="text-xs text-destructive sm:col-span-3">
              {t("pricingPanel.form.invalidWindow")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MembersPanel({ ip, t, locale }: { ip: IpCreatorIp; t: Translate; locale: Locale }) {
  const { data, isLoading, isFetching, error, refetch } = useMyIpContributors(ip.id);
  const [addOpen, setAddOpen] = useState(false);

  if (isLoading && !data) {
    return (
      <Section title={t("membersPanel.sectionTitle")} description={t("membersPanel.sectionBody")}>
        <div className="flex items-center gap-2 rounded-xl bg-card p-6 text-sm text-muted-foreground ring-1 ring-border/65">
          <IconLoader2 className="size-4 animate-spin" />
          {t("membersPanel.loading")}
        </div>
      </Section>
    );
  }

  if (!data) {
    return (
      <Section title={t("membersPanel.sectionTitle")} description={t("membersPanel.sectionBody")}>
        <div className="rounded-xl bg-card p-6 ring-1 ring-border/65">
          <p className="text-sm text-destructive">
            {errorMessage(error) || t("membersPanel.loadFailed")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <IconRefresh className="size-4" />
            {t("membersPanel.retry")}
          </Button>
        </div>
      </Section>
    );
  }

  const allocatedPct = formatBpsPercent(data.poolAllocatedBps, locale);
  const overAllocated = data.poolAllocatedBps > BPS_FULL;

  return (
    <Section title={t("membersPanel.sectionTitle")} description={t("membersPanel.sectionBody")}>
      {error ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
          <p>{errorMessage(error) || t("membersPanel.loadFailed")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {t("membersPanel.retry")}
          </Button>
        </div>
      ) : null}
      <div className="space-y-4">
        <AccessControlPanel ip={ip} contributors={data.contributors} t={t} locale={locale} />

        <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{t("membersPanel.splitPrompt")}</p>
            </div>
            <div className="text-right">
              <p
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  overAllocated ? "text-destructive" : "text-foreground"
                )}
              >
                {t("membersPanel.allocated", { allocated: allocatedPct })}
              </p>
              {overAllocated ? (
                <p className="mt-1 max-w-[16rem] text-[11px] leading-4 text-destructive">
                  {t("membersPanel.overAllocated")}
                </p>
              ) : null}
            </div>
          </div>

          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            {t("membersPanel.ownerFallbackNote")}
          </p>

          <div className="mt-4 divide-y divide-border/70 rounded-lg border border-border">
            {data.contributors.length ? (
              data.contributors.map((contributor) => (
                <MemberRow
                  key={contributor.id}
                  ip={ip}
                  contributor={contributor}
                  contributors={data.contributors}
                  t={t}
                />
              ))
            ) : (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t("membersPanel.empty")}
              </p>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <Button type="button" onClick={() => setAddOpen(true)}>
              <IconUserPlus className="size-4" />
              {t("membersPanel.addMember")}
            </Button>
          </div>
        </div>
      </div>

      <AddMemberDialog
        key={`add:${addOpen}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        ip={ip}
        contributors={data.contributors}
        t={t}
      />
    </Section>
  );
}

type LinkedUserDraft = { userId: string; name: string };

export function AccessControlPanel({
  ip,
  contributors,
  t,
  locale,
}: {
  ip: IpCreatorIp;
  contributors: IpCreatorContributor[];
  t: Translate;
  locale: Locale;
}) {
  const canManageAcl = ip.viewerAccess.canManageAcl;
  const canTransferOwner = ip.viewerAccess.canTransferOwner;
  const acl = useMyIpAclGrants(ip.id, canManageAcl);
  const grantAccess = useGrantIpEditAccess();
  const revokeAccess = useRevokeIpEditAccess();
  const transferOwner = useTransferIpOwner();
  const [selectedUser, setSelectedUser] = useState<LinkedUserDraft | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<{ userId: string; name: string } | null>(
    null
  );
  // Whether the outgoing owner is dropped (default: kept on as an editor).
  const [transferLeave, setTransferLeave] = useState(false);

  const handleTransfer = async () => {
    if (!pendingTransfer) return;
    const { userId, name } = pendingTransfer;
    try {
      await transferOwner.mutateAsync({
        ipId: ip.id,
        toUserId: userId,
        removeOldOwner: transferLeave,
      });
      toast.success(t("membersPanel.toasts.ownerTransferred", { name }));
      setPendingTransfer(null);
      setTransferLeave(false);
    } catch (err) {
      toast.error(errorMessage(err) || t("membersPanel.toasts.ownerTransferFailed"));
    }
  };

  if (!canManageAcl) {
    return (
      <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <IconShieldCheck className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {t("membersPanel.accessEditorTitle")}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("membersPanel.accessEditorBody")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const activeGrants = acl.data?.grants ?? [];
  const activeUserIds = new Set(activeGrants.map((grant) => grant.userId));
  const ownerUserId = acl.data?.ownerUserId ?? "";
  const selectedIsOwner = Boolean(selectedUser && selectedUser.userId === ownerUserId);
  const selectedAlreadyEditor = Boolean(selectedUser && activeUserIds.has(selectedUser.userId));
  const blockedReason = selectedIsOwner
    ? t("membersPanel.accessAlreadyOwner")
    : selectedAlreadyEditor
      ? t("membersPanel.accessAlreadyEditor")
      : null;
  const canGrant =
    Boolean(selectedUser) &&
    !blockedReason &&
    !acl.isLoading &&
    !acl.error &&
    !grantAccess.isPending;

  const handleGrant = async () => {
    if (!selectedUser) {
      toast.error(t("membersPanel.accessSelectUserFirst"));
      return;
    }
    if (blockedReason) {
      toast.error(blockedReason);
      return;
    }
    try {
      await grantAccess.mutateAsync({
        ipId: ip.id,
        userId: selectedUser.userId,
        permission: "edit",
      });
      toast.success(t("membersPanel.toasts.accessGranted"));
      // A completed grant must not discard an account selected while it was pending.
      setSelectedUser((current) => (current === selectedUser ? null : current));
    } catch (err) {
      toast.error(errorMessage(err) || t("membersPanel.toasts.accessGrantFailed"));
    }
  };

  const handleRevoke = async (grant: IpAclGrant) => {
    const label = accessUserLabel(grant.userId, contributors);
    if (!window.confirm(t("membersPanel.accessRevokeConfirm", { name: label }))) return;
    try {
      await revokeAccess.mutateAsync({ ipId: ip.id, grantId: grant.id });
      toast.success(t("membersPanel.toasts.accessRevoked"));
    } catch (err) {
      toast.error(errorMessage(err) || t("membersPanel.toasts.accessRevokeFailed"));
    }
  };

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border/65">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{t("membersPanel.accessTitle")}</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            {t("membersPanel.accessBody")}
          </p>
        </div>
        <StatusPill>{t("viewerAccess.owner")}</StatusPill>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <div className="min-w-0 rounded-lg border border-border bg-background">
          <AccessUserRow
            icon={<IconShieldCheck className="size-4" />}
            title={t("membersPanel.accessOwnerImplicitTitle")}
            subtitle={ownerUserId ? t("membersPanel.accessUserId", { id: ownerUserId }) : ""}
            badge={t("viewerAccess.owner")}
          />
          <div className="border-t border-border/70">
            {acl.isLoading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <IconLoader2 className="size-4 animate-spin" />
                {t("membersPanel.accessLoading")}
              </div>
            ) : acl.error ? (
              <div className="px-3 py-4">
                <p className="text-sm text-destructive">
                  {errorMessage(acl.error) || t("membersPanel.accessLoadFailed")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  color="muted"
                  size="sm"
                  className="mt-3"
                  onClick={() => void acl.refetch()}
                >
                  <IconRefresh className="size-4" />
                  {t("membersPanel.retry")}
                </Button>
              </div>
            ) : activeGrants.length ? (
              <div className="divide-y divide-border/70">
                {activeGrants.map((grant) => {
                  const label = accessUserLabel(grant.userId, contributors);
                  return (
                    <AccessUserRow
                      key={grant.id}
                      icon={<IconUserCheck className="size-4" />}
                      title={label}
                      subtitle={t("membersPanel.accessGrantedLine", {
                        id: grant.userId,
                        date: formatDateTime(grant.createdAt, locale),
                      })}
                      badge={t("viewerAccess.editor")}
                      action={
                        <div className="flex items-center gap-1">
                          {canTransferOwner ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              color="muted"
                              disabled={transferOwner.isPending}
                              onClick={() =>
                                setPendingTransfer({ userId: grant.userId, name: label })
                              }
                            >
                              <IconCrown className="size-3.5" />
                              {t("membersPanel.transferOwner")}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            color="muted"
                            className="text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                            disabled={revokeAccess.isPending}
                            onClick={() => void handleRevoke(grant)}
                          >
                            <IconX className="size-3.5" />
                            {t("membersPanel.accessRevoke")}
                          </Button>
                        </div>
                      }
                    />
                  );
                })}
              </div>
            ) : (
              <p className="px-3 py-5 text-sm text-muted-foreground">
                {t("membersPanel.accessEmpty")}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-sm font-medium text-foreground">
            {t("membersPanel.accessGrantTitle")}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("membersPanel.accessGrantBody")}
          </p>
          <div className="mt-3">
            <UserSearchPicker
              t={t}
              selectedUser={selectedUser}
              onSelect={(hit) =>
                setSelectedUser({ userId: hit.userId, name: hit.nickname || hit.userId })
              }
              onClear={() => setSelectedUser(null)}
              placeholder={t("membersPanel.linkUserPlaceholder")}
              selectedLabel={(user) => t("membersPanel.lookupFound", { name: user.name })}
              description={blockedReason ?? t("membersPanel.accessGrantHint")}
              descriptionClassName={blockedReason ? "text-destructive" : undefined}
            />
          </div>
          <Button
            type="button"
            className="mt-3 w-full"
            disabled={!canGrant}
            onClick={() => void handleGrant()}
          >
            {grantAccess.isPending ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconUserPlus className="size-4" />
            )}
            {grantAccess.isPending
              ? t("membersPanel.accessGranting")
              : t("membersPanel.accessGrant")}
          </Button>
        </div>
      </div>

      <Dialog
        open={pendingTransfer !== null}
        onOpenChange={(v) => {
          if (!v && !transferOwner.isPending) {
            setPendingTransfer(null);
            setTransferLeave(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("membersPanel.transferOwner")}</DialogTitle>
            <DialogDescription>
              {pendingTransfer
                ? t("membersPanel.transferOwnerConfirm", { name: pendingTransfer.name })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={transferLeave}
                onChange={(event) => setTransferLeave(event.target.checked)}
                disabled={transferOwner.isPending}
                className="size-4 accent-primary"
              />
              {t("membersPanel.transferOwnerLeaveLabel")}
            </label>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              color="muted"
              onClick={() => {
                setPendingTransfer(null);
                setTransferLeave(false);
              }}
              disabled={transferOwner.isPending}
            >
              {t("membersPanel.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleTransfer()}
              disabled={transferOwner.isPending}
            >
              {transferOwner.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {t("membersPanel.transferOwner")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccessUserRow({
  icon,
  title,
  subtitle,
  badge,
  action,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  badge: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:flex-nowrap">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{title}</p>
        {subtitle ? <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      <StatusPill>{badge}</StatusPill>
      {action}
    </div>
  );
}

function accessUserLabel(userId: string, contributors: IpCreatorContributor[]) {
  const contributor = contributors.find((item) => item.userId === userId);
  return contributor?.displayName || userId;
}

function UserSearchPicker({
  t,
  selectedUser,
  onSelect,
  onClear,
  placeholder,
  selectedLabel,
  description,
  descriptionClassName,
}: {
  t: Translate;
  selectedUser: LinkedUserDraft | null;
  onSelect: (hit: IpUserSearchHit) => void;
  onClear: () => void;
  placeholder: string;
  selectedLabel: (user: LinkedUserDraft) => string;
  description: string;
  descriptionClassName?: string;
}) {
  const search = useSearchIpCommerceUsers();
  const [account, setAccount] = useState("");
  const [results, setResults] = useState<IpUserSearchHit[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const lookupVersion = useRef(0);

  useEffect(
    () => () => {
      lookupVersion.current += 1;
    },
    []
  );

  const handleSearch = async () => {
    const value = account.trim();
    if (!value) return;
    const version = ++lookupVersion.current;
    setLookupError(null);
    setResults([]);
    try {
      const hits = await search.mutateAsync(value);
      if (version !== lookupVersion.current) return;
      setResults(hits);
      if (hits.length === 0) setLookupError(t("membersPanel.lookupNotFound"));
    } catch (err) {
      if (version !== lookupVersion.current) return;
      setResults([]);
      setLookupError(errorMessage(err) || t("membersPanel.lookupFailed"));
    }
  };

  const handleSelect = (hit: IpUserSearchHit) => {
    lookupVersion.current += 1;
    onSelect(hit);
    setAccount("");
    setResults([]);
    setLookupError(null);
  };

  const handleClear = () => {
    lookupVersion.current += 1;
    onClear();
    setAccount("");
    setResults([]);
    setLookupError(null);
  };

  if (selectedUser) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm">
            <IconLink className="size-4 shrink-0 text-primary" />
            <span className="truncate">{selectedLabel(selectedUser)}</span>
          </span>
          <Button type="button" size="sm" variant="ghost" color="muted" onClick={handleClear}>
            {t("membersPanel.unlink")}
          </Button>
        </div>
        <FieldDescription className={descriptionClassName}>{description}</FieldDescription>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={account}
          onChange={(event) => {
            lookupVersion.current += 1;
            setAccount(event.target.value);
            setResults([]);
            setLookupError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleSearch();
            }
          }}
          placeholder={placeholder}
        />
        <Button
          type="button"
          variant="outline"
          color="muted"
          disabled={!account.trim() || search.isPending}
          onClick={() => void handleSearch()}
        >
          {search.isPending ? t("membersPanel.looking") : t("membersPanel.lookup")}
        </Button>
      </div>
      {results.length > 0 ? (
        <ul className="max-h-44 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background">
          {results.map((hit) => (
            <li key={hit.userId}>
              <button
                type="button"
                onClick={() => handleSelect(hit)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {(hit.nickname || hit.userId).charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {hit.nickname || hit.userId}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t("membersPanel.accessUserId", { id: hit.userId })}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {lookupError ? (
        <FieldDescription className="text-destructive">{lookupError}</FieldDescription>
      ) : (
        <FieldDescription className={descriptionClassName}>{description}</FieldDescription>
      )}
    </div>
  );
}

export function MemberRow({
  ip,
  contributor,
  contributors,
  t,
}: {
  ip: IpCreatorIp;
  contributor: IpCreatorContributor;
  contributors: IpCreatorContributor[];
  t: Translate;
}) {
  const update = useUpdateIpCommerceContributor();
  const remove = useDeleteIpCommerceContributor();
  const linked = Boolean(contributor.userId);
  const [shareText, setShareText] = useState(bpsToPercentText(contributor.revenueShareBps));
  const [shareDirty, setShareDirty] = useState(false);
  const sharePending = useRef(false);
  // Refresh untouched inputs without replacing an unsaved percentage draft.
  const [syncedBps, setSyncedBps] = useState(contributor.revenueShareBps);
  if (syncedBps !== contributor.revenueShareBps) {
    setSyncedBps(contributor.revenueShareBps);
    if (!shareDirty) setShareText(bpsToPercentText(contributor.revenueShareBps));
  }

  const roleLabel = contributor.customRole?.trim()
    ? contributor.customRole
    : t(`roles.${contributor.role}`);

  const eligibleSumExcludingThis = sumEligibleBps(contributors, contributor.id);

  const commitShare = async () => {
    if (sharePending.current || update.isPending || remove.isPending) return;
    const nextBps = percentTextToBps(shareText);
    if (nextBps === undefined) {
      toast.error(t("membersPanel.invalidShare"));
      return;
    }
    if (nextBps === contributor.revenueShareBps) {
      setShareDirty(false);
      return;
    }
    // Client guard: eligible totals must stay <= 100%.
    if (contributor.revenueEligible && eligibleSumExcludingThis + (nextBps ?? 0) > BPS_FULL) {
      toast.error(t("membersPanel.overAllocated"));
      return;
    }
    sharePending.current = true;
    try {
      await update.mutateAsync({
        ipId: ip.id,
        contributorId: contributor.id,
        revenueShareBps: nextBps,
      });
      setShareDirty(false);
      toast.success(t("membersPanel.toasts.updated"));
    } catch (err) {
      toast.error(errorMessage(err) || t("membersPanel.toasts.updateFailed"));
    } finally {
      sharePending.current = false;
    }
  };

  const toggleEligible = async () => {
    const nextEligible = !contributor.revenueEligible;
    if (!linked) return; // disabled — an unlinked member cannot earn.
    if (nextEligible && eligibleSumExcludingThis + (contributor.revenueShareBps ?? 0) > BPS_FULL) {
      toast.error(t("membersPanel.overAllocated"));
      return;
    }
    try {
      await update.mutateAsync({
        ipId: ip.id,
        contributorId: contributor.id,
        revenueEligible: nextEligible,
      });
      toast.success(t("membersPanel.toasts.updated"));
    } catch (err) {
      toast.error(errorMessage(err) || t("membersPanel.toasts.updateFailed"));
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(t("membersPanel.removeConfirm"))) return;
    try {
      await remove.mutateAsync({ ipId: ip.id, contributorId: contributor.id });
      toast.success(t("membersPanel.toasts.removed"));
    } catch (err) {
      toast.error(errorMessage(err) || t("membersPanel.toasts.removeFailed"));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{contributor.displayName}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {roleLabel}
          {" · "}
          {linked
            ? t("membersPanel.linkedAs", { name: contributor.userId ?? "" })
            : t("membersPanel.notLinked")}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant={contributor.revenueEligible ? "solid" : "outline"}
        color={contributor.revenueEligible ? "primary" : "muted"}
        disabled={!linked || update.isPending}
        title={linked ? undefined : t("membersPanel.cannotEarn")}
        onClick={() => void toggleEligible()}
      >
        {!linked
          ? t("membersPanel.cannotEarn")
          : contributor.revenueEligible
            ? t("membersPanel.eligible")
            : t("membersPanel.notEligible")}
      </Button>
      <Input
        value={shareText}
        onChange={(event) => {
          setShareDirty(true);
          setShareText(event.target.value);
        }}
        onBlur={() => void commitShare()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        disabled={!linked || !contributor.revenueEligible || update.isPending}
        placeholder={t("membersPanel.sharePlaceholder")}
        aria-label={t("membersPanel.shareAriaLabel")}
        className="h-9 w-20"
      />
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        color="muted"
        className="text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
        disabled={remove.isPending}
        title={t("membersPanel.remove")}
        onClick={() => void handleRemove()}
      >
        <IconTrash className="size-3.5" />
      </Button>
    </div>
  );
}

export function AddMemberDialog({
  open,
  onOpenChange,
  ip,
  contributors,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ip: IpCreatorIp;
  contributors: IpCreatorContributor[];
  t: Translate;
}) {
  const create = useCreateIpCommerceContributor();
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<IpContributorRole>("writer");
  const [customRole, setCustomRole] = useState("");
  const [linkedUser, setLinkedUser] = useState<LinkedUserDraft | null>(null);
  const [eligible, setEligible] = useState(false);
  const [shareText, setShareText] = useState("");

  const eligibleSum = sumEligibleBps(contributors, null);

  const pickUser = (hit: IpUserSearchHit) => {
    setLinkedUser({ userId: hit.userId, name: hit.nickname || hit.userId });
    // Default the credit name to the matched user if not set yet.
    setDisplayName((current) => current.trim() || hit.nickname || hit.userId);
  };

  const unlink = () => {
    setLinkedUser(null);
    setEligible(false);
    setShareText("");
  };

  const canSubmit =
    displayName.trim().length > 0 && (!eligible || Boolean(linkedUser)) && !create.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const shareBps = eligible ? percentTextToBps(shareText) : null;
    if (shareBps === undefined) {
      toast.error(t("membersPanel.invalidShare"));
      return;
    }
    if (eligible && !linkedUser) {
      toast.error(t("membersPanel.mustLinkToEarn"));
      return;
    }
    if (eligible && eligibleSum + (shareBps ?? 0) > BPS_FULL) {
      toast.error(t("membersPanel.overAllocated"));
      return;
    }
    try {
      await create.mutateAsync({
        ipId: ip.id,
        displayName: displayName.trim(),
        userId: linkedUser?.userId ?? null,
        role,
        customRole: customRole.trim() || null,
        revenueEligible: eligible,
        revenueShareBps: shareBps,
      });
      toast.success(t("membersPanel.toasts.added"));
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err) || t("membersPanel.toasts.addFailed"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("membersPanel.addTitle")}</DialogTitle>
          <DialogDescription>{t("membersPanel.addBody")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <fieldset disabled={create.isPending} className="min-w-0">
            <FieldGroup>
              <Field>
                <FieldLabel required>{t("membersPanel.displayNameLabel")}</FieldLabel>
                <Input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value.slice(0, 120))}
                  placeholder={t("membersPanel.displayNamePlaceholder")}
                  maxLength={120}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>{t("membersPanel.roleLabel")}</FieldLabel>
                  <Select
                    value={role}
                    onValueChange={(value) => setRole(value as IpContributorRole)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTRIBUTOR_ROLE_OPTIONS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`roles.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>{t("membersPanel.customRoleLabel")}</FieldLabel>
                  <Input
                    value={customRole}
                    onChange={(event) => setCustomRole(event.target.value.slice(0, 80))}
                    placeholder={t("membersPanel.customRolePlaceholder")}
                    maxLength={80}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel>{t("membersPanel.linkUserLabel")}</FieldLabel>
                <UserSearchPicker
                  t={t}
                  selectedUser={linkedUser}
                  onSelect={pickUser}
                  onClear={unlink}
                  placeholder={t("membersPanel.linkUserPlaceholder")}
                  selectedLabel={(user) => t("membersPanel.lookupFound", { name: user.name })}
                  description={t("membersPanel.eligibleHint")}
                />
              </Field>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
                <label
                  className={cn(
                    "inline-flex items-center gap-2 text-sm",
                    linkedUser ? "text-foreground" : "cursor-not-allowed text-muted-foreground"
                  )}
                  title={linkedUser ? undefined : t("membersPanel.cannotEarn")}
                >
                  <input
                    type="checkbox"
                    checked={eligible}
                    disabled={!linkedUser}
                    onChange={(event) => setEligible(event.target.checked)}
                    className="size-4 accent-primary"
                  />
                  {t("membersPanel.eligible")}
                </label>
                <Input
                  value={shareText}
                  onChange={(event) => setShareText(event.target.value)}
                  disabled={!linkedUser || !eligible}
                  placeholder={t("membersPanel.sharePlaceholder")}
                  aria-label={t("membersPanel.shareAriaLabel")}
                  className="h-9 w-24"
                />
              </div>
            </FieldGroup>
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            {t("membersPanel.cancel")}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {create.isPending ? t("membersPanel.adding") : t("membersPanel.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RightsPanel({ ip, t }: { ip: IpCreatorIp; t: Translate }) {
  return (
    <Section title={t("assetsPanel.rightsTitle")} description={t("assetsPanel.rightsBody")}>
      <RightsGovernanceEditor key={ip.id} ip={ip} t={t} />
      <IpCrewOrigin ipId={ip.id} editable />
      <IpReleaseLinks ipId={ip.id} editable />
      <ContentGpsOwnerEditor ipId={ip.id} ownerId={ip.createdById} />
      <IpGameAssociations ipId={ip.id} />
      <IpStageApplications ipId={ip.id} />
    </Section>
  );
}

export function RightsGovernanceEditor({ ip, t }: { ip: IpCreatorIp; t: Translate }) {
  const update = useUpdateIpCommerceIpProfile();
  const [baseline, setBaseline] = useState(ip);
  const currentOwner = baseline.copyrightOwner ?? "";
  const currentRights = jsonStringField(baseline.rightsSummary, "statement");
  const currentAiStatement = jsonStringField(baseline.aiDisclosure, "statement");
  const currentGeneratedVisuals = jsonBooleanField(baseline.aiDisclosure, "generatedVisuals");
  const currentGeneratedCopy = jsonBooleanField(baseline.aiDisclosure, "generatedCopy");
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
  // Refresh clean forms, but never attach a newer version to an older draft.
  if (!dirty && !update.isPending && ip.version > baseline.version) {
    setBaseline(ip);
    setOwner(ip.copyrightOwner ?? "");
    setRightsStatement(jsonStringField(ip.rightsSummary, "statement"));
    setAiStatement(jsonStringField(ip.aiDisclosure, "statement"));
    setGeneratedVisuals(jsonBooleanField(ip.aiDisclosure, "generatedVisuals"));
    setGeneratedCopy(jsonBooleanField(ip.aiDisclosure, "generatedCopy"));
  }
  const canSave = dirty && !update.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      const result = await update.mutateAsync({
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
        expectedVersion: baseline.version,
      });
      setBaseline(result.ip);
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
          required
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
          required
        />
        <FormTextField
          label={t("assetsPanel.rightsForm.aiStatement")}
          value={aiStatement}
          onChange={setAiStatement}
          maxLength={1000}
          placeholder={t("assetsPanel.rightsForm.aiPlaceholder")}
          multiline
          required={generatedVisuals || generatedCopy}
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
  progress,
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
  progress: number;
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
        {isUploading ? (
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <IconLoader2 className="size-5 animate-spin" />
          </span>
        ) : (
          <>
            {assetUrl ? <AssetPreview asset={asset} assetUrl={assetUrl} icon={Icon} /> : null}
            {!assetUrl ? (
              <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <IconUpload className="size-5" />
              </span>
            ) : null}
          </>
        )}
        <p className="mt-3 text-sm font-semibold text-foreground">
          {isUploading ? `${uploadingLabel}${progress > 0 ? ` ${progress}%` : ""}` : uploadLabel}
        </p>
        {isUploading ? (
          <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-200"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        ) : (
          <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
            {t("assetsPanel.form.uploadHint")}
          </p>
        )}
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

type IpProfileEditDialogProps = {
  ip: IpCreatorIp;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function IpProfileEditDialog(props: IpProfileEditDialogProps) {
  return (
    <IpProfileEditSession key={`${props.ip.id}:${props.open ? "open" : "closed"}`} {...props} />
  );
}

function IpProfileEditSession({ ip: currentIp, open, onOpenChange }: IpProfileEditDialogProps) {
  // An open editing session owns both its initial fields and their server version.
  const [ip] = useState(currentIp);
  const t = useTranslations("newIpWorkbench");
  const typeT = useTranslations("newIpCreate");
  const commonT = useTranslations("common");
  const locale = useLocale() as Locale;
  const update = useUpdateIpCommerceIpProfile();
  const taxonomy = useIpCommerceTaxonomyTerms({ locale });
  const taxonomyItems = taxonomy.data?.items ?? [];
  const genreOptions = taxonomyItems.filter((item) => item.type === "genre");
  const [title, setTitle] = useState(ip.title);
  const [summary, setSummary] = useState(ip.summary);
  const [description, setDescription] = useState(ip.description ?? "");
  const [visibility, setVisibility] = useState<EditableVisibility>(
    normalizeEditableVisibility(ip.listingVisibility)
  );
  const [ageRating, setAgeRating] = useState<EditableAgeRating>(
    normalizeEditableAgeRating(ip.ageRating)
  );
  const [genreCodes, setGenreCodes] = useState(ip.genreCodes ?? []);

  const trimmedTitle = title.trim();
  const trimmedSummary = summary.trim();
  const trimmedDescription = description.trim();
  const dirty =
    trimmedTitle !== ip.title.trim() ||
    trimmedSummary !== ip.summary.trim() ||
    (trimmedDescription || null) !== (ip.description?.trim() || null) ||
    visibility !== normalizeEditableVisibility(ip.listingVisibility) ||
    ageRating !== normalizeEditableAgeRating(ip.ageRating) ||
    !sameStringList(genreCodes, ip.genreCodes ?? []);
  const canSave = trimmedTitle.length > 0 && genreCodes.length > 0 && dirty && !update.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await update.mutateAsync({
        ipId: ip.id,
        title: trimmedTitle,
        summary: trimmedSummary,
        description: trimmedDescription || null,
        listingVisibility: visibility,
        ageRating,
        genreCodes,
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
                showCount
                placeholder={typeT("fieldNamePlaceholder")}
              />
            </Field>

            <Field>
              <FieldLabel>{typeT("fieldDescription")}</FieldLabel>
              <Textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                maxLength={SUMMARY_MAX_LENGTH}
                showCount
                placeholder={typeT("fieldDescriptionPlaceholder")}
                rows={4}
              />
            </Field>

            <Field>
              <FieldLabel>{t("profileEdit.description")}</FieldLabel>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={DESCRIPTION_MAX_LENGTH}
                showCount
                placeholder={t("profileEdit.descriptionPlaceholder")}
                rows={6}
              />
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

            <Field>
              <FieldLabel required>{t("profileEdit.genres")}</FieldLabel>
              {taxonomy.isError ? (
                <div role="alert" className="space-y-2">
                  <p className="text-sm text-destructive">{typeT("taxonomyLoadFailed")}</p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={taxonomy.isFetching}
                    onClick={() => void taxonomy.refetch()}
                  >
                    {commonT("retry")}
                  </Button>
                </div>
              ) : (
                <TaxonomyPicker
                  items={genreOptions}
                  selectedCodes={genreCodes}
                  max={GENRE_MAX_COUNT}
                  loading={taxonomy.isLoading}
                  emptyLabel={t("profileEdit.taxonomyEmpty")}
                  onChange={setGenreCodes}
                />
              )}
              <FieldDescription>
                {t("profileEdit.taxonomyHelp", { count: genreCodes.length, max: GENRE_MAX_COUNT })}
              </FieldDescription>
            </Field>
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

function TaxonomyPicker({
  items,
  selectedCodes,
  max,
  loading,
  emptyLabel,
  onChange,
}: {
  items: IpTaxonomyTerm[];
  selectedCodes: string[];
  max: number;
  loading: boolean;
  emptyLabel: string;
  onChange: (codes: string[]) => void;
}) {
  const selected = new Set(selectedCodes);

  if (loading) {
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground">
        <IconLoader2 className="size-4 animate-spin" />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground">
        <IconTags className="size-4" />
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = selected.has(item.code);
        const disabled = !active && selectedCodes.length >= max;
        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (active) {
                onChange(selectedCodes.filter((code) => code !== item.code));
              } else if (!disabled) {
                onChange([...selectedCodes, item.code]);
              }
            }}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-3 text-sm font-medium transition",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              disabled && "cursor-not-allowed opacity-45"
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
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

// Publish-readiness phases for the header ring. Episodes are recommended but
// not required to submit. Once profile/assets/rights are done the ring shows
// "ready to submit" — the ring only renders while the IP is still submittable.
function ipReadinessSteps(ip: IpCreatorIp): {
  key: string;
  done: boolean;
  optional?: boolean;
}[] {
  return [
    {
      key: "profile",
      done: Boolean(ip.title.trim() && ip.summary.trim() && ip.genreCodes.length),
    },
    { key: "assets", done: hasPublicationAsset(ip) },
    { key: "rights", done: hasRightsDeclaration(ip) && hasRequiredAiDisclosure(ip) },
    { key: "episodes", done: ip.counts.episodes > 0, optional: true },
  ];
}

// Compact completion ring in the header. Incomplete next step stays visible;
// click/hover opens the full phase checklist via a portal so parent overflow
// cannot clip the list.
function ReadinessRing({ ip, t }: { ip: IpCreatorIp; t: Translate }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const steps = ipReadinessSteps(ip);
  const requiredSteps = steps.filter((s) => !s.optional);
  const total = requiredSteps.length;
  const done = requiredSteps.filter((s) => s.done).length;
  const remaining = total - done;
  const pct = Math.round((done / total) * 100);
  // Prefer the first incomplete required phase; optional steps never block "next".
  const currentIndex = steps.findIndex((s) => !s.done && !s.optional);
  const currentStep = currentIndex >= 0 ? steps[currentIndex] : null;
  const complete = remaining === 0;
  const panelVisible = open || hovered;

  const r = 15;
  const circ = 2 * Math.PI * r;
  const filled = (pct / 100) * circ;

  const clearHoverClose = () => {
    if (hoverCloseTimer.current) {
      clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  };

  const openFromHover = () => {
    clearHoverClose();
    setHovered(true);
    updatePanelPos();
  };

  const scheduleHoverClose = () => {
    clearHoverClose();
    // Delay so the pointer can cross the gap into the portaled panel.
    hoverCloseTimer.current = setTimeout(() => setHovered(false), 120);
  };

  const updatePanelPos = () => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const panelWidth = 288; // w-72
    const left = Math.min(Math.max(8, rect.right - panelWidth), window.innerWidth - panelWidth - 8);
    setPanelPos({ top: rect.bottom + 8, left });
  };

  useEffect(() => () => clearHoverClose(), []);

  useLayoutEffect(() => {
    if (!panelVisible) return;
    updatePanelPos();
    const onScrollOrResize = () => updatePanelPos();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [panelVisible]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const panel =
    panelVisible && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={t("overview.next.eyebrow")}
            onMouseEnter={openFromHover}
            onMouseLeave={scheduleHoverClose}
            style={{ top: panelPos.top, left: panelPos.left }}
            className="fixed z-[80] w-72 rounded-xl border border-border bg-popover p-3 shadow-lg"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("overview.next.eyebrow")}
              </p>
              {!complete ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {t("readiness.remainingBadge", { remaining })}
                </span>
              ) : null}
            </div>
            <ul className="mt-2.5 max-h-[min(24rem,70vh)] space-y-1 overflow-y-auto">
              {steps.map((step, index) => {
                const isCurrent = index === currentIndex;
                const requiredIndex = requiredSteps.findIndex((s) => s.key === step.key);
                const badge = step.done ? "✓" : step.optional ? "·" : String(requiredIndex + 1);
                return (
                  <li
                    key={step.key}
                    className={[
                      "rounded-lg px-2 py-1.5",
                      isCurrent ? "bg-primary/10 ring-1 ring-primary/30" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={[
                          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold leading-none",
                          step.done
                            ? "border-muted-foreground/40 bg-muted text-muted-foreground"
                            : isCurrent
                              ? "border-primary bg-primary text-primary-foreground"
                              : step.optional
                                ? "border-dashed border-muted-foreground/50 text-muted-foreground"
                                : "border-foreground/35 text-foreground",
                        ].join(" ")}
                      >
                        {badge}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={[
                              "block text-sm leading-5",
                              step.done
                                ? "text-muted-foreground line-through decoration-muted-foreground/50"
                                : isCurrent
                                  ? "font-semibold text-foreground"
                                  : step.optional
                                    ? "font-medium text-muted-foreground"
                                    : "font-medium text-foreground",
                            ].join(" ")}
                          >
                            {t(`progress.${step.key}.title`)}
                          </span>
                          {step.optional && !step.done ? (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {t("readiness.optional")}
                            </span>
                          ) : null}
                        </span>
                        {isCurrent ? (
                          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                            {t(`progress.${step.key}.body`)}
                          </span>
                        ) : null}
                        {!step.done && !isCurrent ? (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {step.optional ? t("readiness.optionalHint") : t("readiness.pending")}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={openFromHover}
      onMouseLeave={scheduleHoverClose}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={panelVisible}
        aria-haspopup="dialog"
        aria-label={t("overview.next.eyebrow")}
        onClick={() => {
          setOpen((value) => !value);
          updatePanelPos();
        }}
        className={[
          "flex max-w-[16rem] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors",
          "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
          !complete ? "border border-primary/35 bg-primary/5" : "border border-transparent",
          open ? "bg-muted/60" : "",
        ].join(" ")}
      >
        <span className="relative inline-flex size-9 shrink-0 items-center justify-center">
          <svg viewBox="0 0 36 36" className="size-9 -rotate-90" aria-hidden>
            <circle
              cx="18"
              cy="18"
              r={r}
              fill="none"
              strokeWidth="3.5"
              stroke="currentColor"
              className="text-border"
            />
            <circle
              cx="18"
              cy="18"
              r={r}
              fill="none"
              strokeWidth="3.5"
              strokeLinecap="round"
              stroke="currentColor"
              className="text-primary"
              strokeDasharray={`${filled} ${circ}`}
            />
          </svg>
          <span className="absolute text-[10px] font-semibold tabular-nums text-foreground">
            {pct}%
          </span>
        </span>
        <span className="min-w-0 flex flex-col gap-0.5">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {complete
              ? t("readiness.ready", { done, total })
              : t("readiness.remaining", { remaining, total })}
          </span>
          {currentStep ? (
            <span className="truncate text-xs font-semibold text-primary">
              {t("readiness.next", {
                step: t(`progress.${currentStep.key}.title`),
              })}
            </span>
          ) : (
            <span className="truncate text-xs font-medium text-foreground">
              {t("readiness.allReady")}
            </span>
          )}
        </span>
      </button>
      {panel}
    </div>
  );
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
  if (!ip.genreCodes.length) missing.push(t("fields.genre"));
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

async function probeVideo(src: string): Promise<{
  duration: number;
  width: number;
  height: number;
} | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = src;

    let settled = false;
    const finish = (result: { duration: number; width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      video.removeAttribute("src");
      video.load();
      resolve(result);
    };

    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      finish({
        duration: Math.round(video.duration || 0),
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };

    setTimeout(() => finish(null), 8000);
  });
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (item: number) => String(item).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
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

function formatPoints(value: string, locale: Locale) {
  try {
    return new Intl.NumberFormat(locale).format(Number(BigInt(value)));
  } catch {
    return value;
  }
}

function commerceWarningLabel(code: string, t: Translate) {
  const known = new Set([
    "not_public",
    "no_episodes",
    "no_published_episodes",
    "no_active_price",
    "missing_bundle_price",
    "all_free_preview",
  ]);
  return known.has(code) ? t(`ordersPanel.warnings.${code}`) : t("ordersPanel.warnings.unknown");
}

function orderStatusLabel(status: string, t: Translate) {
  const known = new Set([
    "pending",
    "paid",
    "fulfilled",
    "canceled",
    "failed",
    "refunded",
    "partially_refunded",
  ]);
  return known.has(status) ? t(`ordersPanel.orderStatus.${status}`) : status;
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
  amount,
  originalAmount,
  startsAt,
  endsAt,
}: {
  amount: string;
  originalAmount: string;
  startsAt: string;
  endsAt: string;
}) {
  if (!/^\d+$/.test(amount.trim())) return false;
  if (originalAmount.trim() && !/^\d+$/.test(originalAmount.trim())) return false;
  if (startsAt && Number.isNaN(new Date(startsAt).getTime())) return false;
  if (endsAt && Number.isNaN(new Date(endsAt).getTime())) return false;
  if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) return false;
  return true;
}

function bpsToPercentText(bps: number | null): string {
  return bps == null ? "" : String(bps / 100);
}

function percentTextToBps(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return undefined;
  const percent = Number(trimmed);
  if (!Number.isFinite(percent)) return undefined;
  return Math.round(percent * 100);
}

// Sum of eligible contributors' pool shares (bps), optionally excluding one id
// (so a row's own pending edit isn't double-counted in the <=100% guard).
function sumEligibleBps(contributors: IpCreatorContributor[], excludeId: string | null): number {
  return contributors.reduce((sum, c) => {
    if (!c.revenueEligible || c.id === excludeId) return sum;
    return sum + (c.revenueShareBps ?? 0);
  }, 0);
}

function formatBpsPercent(bps: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(bps / BPS_FULL);
  } catch {
    return `${bps / 100}%`;
  }
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
