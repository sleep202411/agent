"use client";

import { IpKnowledgeAssistant } from "../../_components/ip-knowledge-assistant";
import { ChannelSubmissions } from "../../_components/channel-submissions";
import { IpFanCommunity } from "../../_components/ip-fan-community";
import { IpGenerationPanel } from "../../_components/ip-generation-panel";

import { useReportSubmission } from "../_hooks/use-report-submission";

import { IpEngagementActions } from "./ip-engagement-actions";

import { EpisodeFeedback } from "../../_components/episode-feedback";
import { IpProductionStage } from "../../_components/ip-production-stage";
import { IpReleaseLinks } from "../../_components/ip-release-links";
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  IconArrowLeft,
  IconBookmark,
  IconDotsVertical,
  IconEye,
  IconFlag,
  IconHeart,
  IconLoader2,
  IconLock,
  IconPlayerPlay,
  IconShare3,
  IconSparkles,
  IconTicket,
  IconVideo,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { CommunityRechargeDialog } from "@/components/payment/community-recharge-dialog";
import { CommunityMembershipDialog } from "@/components/payment/community-membership-dialog";
import { VideoPlayer } from "@/components/media/video-player";
import { UserAvatar, resolveUserAvatarUrl } from "@/components/user-avatar";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { useCurrentUser } from "@/src/hooks/use-user";
import { ApiRequestError } from "@/src/lib/api";
import { axonViewItem } from "@/src/lib/axon";
import { creatorHref } from "@/src/lib/user-id-codec";
import { ipRoomPath } from "@/src/lib/ip-commerce/urls";
import { recordMemberView } from "@/src/lib/ip-commerce/api";
import type {
  IpCommerceAsset,
  IpCommerceAccess,
  IpCommerceEpisode,
  IpCommerceIp,
  IpCommercePriceRule,
  IpContentEntitlement,
  IpCreatorIp,
  CreateIpReportInput,
  IpTargetType,
} from "@/src/lib/ip-commerce/api";
import {
  useCommunityPointBalance,
  useIpAccess,
  useIpCommerceCollection,
  useIpCommerceIp,
  useMyIpCommerceIp,
  usePurchaseIpContent,
  useRecordIpView,
  useRemoveIpCommerceCollection,
  useSaveIpCommerceCollection,
  useToggleIpEngagementLike,
} from "@/src/lib/ip-commerce/hooks";

interface IpPublicDetailProps {
  ipReference: string;
}

interface DetailIp {
  id: string;
  roomNumber: string;
  title: string;
  subtitle: string | null;
  summary: string;
  description: string | null;
  status: string;
  listingVisibility: string;
  ageRating: string;
  sourceLocale: string;
  version: number | null;
  coverAsset: IpCommerceAsset | null;
  trailerAsset: IpCommerceAsset | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  price: IpCommercePriceRule | null;
  campaigns: IpCommerceIp["campaigns"];
  episodes: IpCommerceEpisode[];
  genres: string[];
  tags: string[];
  copyrightOwner: string | null;
  createdById: string | null;
  contributors: IpCommerceIp["contributors"];
  viewCount: number;
  likeCount: number;
  viewerHasLiked: boolean;
  previewMode: boolean;
}

type Translate = ReturnType<typeof useTranslations>;

// Sentinel "episode id" for the IP trailer pseudo-item in the playlist.
const TRAILER_ID = "__trailer__";

export function IpPublicDetail({ ipReference }: IpPublicDetailProps) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const t = useTranslations("newIpDetail");
  const tPay = useTranslations("payment");
  const statusT = useTranslations("newIpWorkbench");
  const { user, isLoading: userLoading } = useCurrentUser();
  const publicQuery = useIpCommerceIp(ipReference, { locale });
  const previewReference = publicQuery.isError && user ? ipReference : null;
  const creatorQuery = useMyIpCommerceIp(previewReference, { locale });
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [membershipOpen, setMembershipOpen] = useState(false);

  const detailIp = publicQuery.data?.ip
    ? normalizePublicIp(publicQuery.data.ip)
    : creatorQuery.data?.ip
      ? normalizeCreatorIp(creatorQuery.data.ip, user?.id ?? null)
      : null;
  const accessEpisodeIds = detailIp?.episodes.map((episode) => episode.id) ?? [];
  const accessQuery = useIpAccess(
    detailIp && !detailIp.previewMode ? detailIp.id : null,
    accessEpisodeIds.length ? { episodeIds: accessEpisodeIds, locale } : { locale }
  );
  const walletQuery = useCommunityPointBalance(Boolean(detailIp && !detailIp.previewMode && user));
  const purchase = usePurchaseIpContent();
  const collectionQuery = useIpCommerceCollection(
    Boolean(detailIp && !detailIp.previewMode && user),
    locale
  );
  const saveCollection = useSaveIpCommerceCollection();
  const removeCollection = useRemoveIpCommerceCollection();
  const reportSubmission = useReportSubmission(user?.id);
  const recordView = useRecordIpView();
  const toggleLike = useToggleIpEngagementLike();
  const viewedIpRef = useRef<string | null>(null);

  useEffect(() => {
    if (!detailIp || detailIp.previewMode || viewedIpRef.current === detailIp.id) return;
    viewedIpRef.current = detailIp.id;
    recordView.mutate({ ipId: detailIp.id, source: "web_detail" });
  }, [detailIp, recordView]);

  // Fire the AppLovin `view_item` conversion once per IP view, when the IP has
  // loaded. No-op on the CN build / when the pixel key is unset (axon.ts). The
  // price is community-point–denominated (whole points, not minor units).
  const viewItemFiredRef = useRef(false);
  useEffect(() => {
    if (viewItemFiredRef.current || !detailIp) return;
    viewItemFiredRef.current = true;
    const priceAmount = detailIp.price ? parseIntegerAmount(detailIp.price.amount) : null;
    // Community points are denominated in US cents (100 points = $1), so report a
    // USD value: AppLovin rejects non-ISO currency codes ("community_point" would
    // flag the event as invalid and keep it out of the dashboard/optimisation).
    const usdValue = priceAmount !== null ? Number(priceAmount) / 100 : null;
    axonViewItem({
      items: [
        {
          item_id: detailIp.id,
          item_name: detailIp.title,
          quantity: 1,
          ...(usdValue !== null ? { price: usdValue } : {}),
        },
      ],
      ...(usdValue !== null ? { value: usdValue, currency: "USD" } : {}),
      userData: user
        ? { user_id: user.id, email: user.email ? user.email.toLowerCase() : undefined }
        : undefined,
    });
  }, [detailIp, user]);

  if (
    publicQuery.isLoading ||
    (publicQuery.isError && userLoading) ||
    (previewReference && creatorQuery.isLoading)
  ) {
    return <LoadingState t={t} />;
  }

  if (!detailIp) {
    const loadError = [publicQuery.error, previewReference ? creatorQuery.error : null].find(
      (error) =>
        error && !(error instanceof ApiRequestError && [401, 403, 404].includes(error.status))
    );
    if (loadError) {
      return (
        <div className="min-h-[calc(100vh-4rem)] bg-background px-5 py-10 text-foreground">
          <div
            role="alert"
            className="mx-auto flex min-h-[520px] max-w-3xl flex-col items-center justify-center gap-4 text-center"
          >
            <h1 className="text-2xl font-semibold">{t("loadFailure.title")}</h1>
            <p className="text-sm text-muted-foreground">{loadError.message}</p>
            <Button
              disabled={publicQuery.isFetching || creatorQuery.isFetching}
              onClick={() => {
                void publicQuery.refetch();
                if (previewReference) void creatorQuery.refetch();
              }}
            >
              {t("loadFailure.retry")}
            </Button>
          </div>
        </div>
      );
    }
    return <NotFoundState locale={locale} t={t} />;
  }

  const statusLabel = statusT(`status.${detailIp.status}`);
  const visibilityLabel = statusT(`visibility.${detailIp.listingVisibility}`);
  const ipCoverUrl = getAssetUrl(detailIp.coverAsset);
  const ipTrailerUrl = getAssetUrl(detailIp.trailerAsset);
  const isTrailerSelected = selectedEpisodeId === TRAILER_ID;
  const selectedEpisode = isTrailerSelected
    ? null
    : (detailIp.episodes.find((episode) => episode.id === selectedEpisodeId) ??
      detailIp.episodes[0] ??
      null);
  const episodeCoverUrl = getAssetUrl(selectedEpisode?.coverAsset);
  const episodeMediaUrl = getAssetUrl(selectedEpisode?.mediaAsset);

  const selectedEpisodeAccess = selectedEpisode
    ? accessQuery.data?.episodes.find((item) => item.id === selectedEpisode.id)
    : null;
  const activeAccess = selectedEpisode ? selectedEpisodeAccess : accessQuery.data?.ip;
  const activePrice = activeAccess?.price ?? selectedEpisode?.price ?? detailIp.price;
  const activeAccessCode: IpCommerceAccess =
    activeAccess?.access ?? (detailIp.previewMode ? "owned" : "locked");
  // Playlist header unlock is always the IP package CTA (matches「整包权益」),
  // not the currently selected free trailer / free-preview chip.
  const ipAccessEntry = accessQuery.data?.ip;
  const playlistUnlockPrice = ipAccessEntry?.price ?? detailIp.price ?? null;
  const playlistUnlockAccess: IpCommerceAccess =
    ipAccessEntry?.access ?? (detailIp.previewMode ? "owned" : "locked");
  // Active members already get member pricing — don't upsell them the membership.
  const viewerIsMember = accessQuery.data?.member ?? false;
  const pendingUnlockAt = getPendingUnlockAt(
    accessQuery.data?.entitlements ?? [],
    selectedEpisode
      ? { targetType: "episode", episodeId: selectedEpisode.id }
      : { targetType: "ip", episodeId: null }
  );
  const canWatchSelected =
    detailIp.previewMode || !selectedEpisode || isAccessGranted(activeAccessCode);
  const lockedMediaLabel = isAccessPending(activeAccessCode)
    ? formatPendingUnlockLabel(pendingUnlockAt, locale, t)
    : undefined;
  const mediaPosterUrl = episodeCoverUrl ?? ipCoverUrl;
  // A trailer is an explicit playlist selection. Never substitute it for a
  // locked (or not-yet-loaded) full episode under that episode's title.
  const mediaTrailerUrl = selectedEpisode
    ? canWatchSelected
      ? episodeMediaUrl
      : undefined
    : ipTrailerUrl;
  const mediaTitle = isTrailerSelected
    ? t("episodes.trailer")
    : selectedEpisode
      ? selectedEpisode.title
      : detailIp.title;
  const mediaSummary = selectedEpisode?.summary || detailIp.summary || t("emptySummary");
  const storyText = detailIp.description?.trim() || detailIp.summary || t("emptySummary");
  const tagItems = Array.from(new Set(detailIp.genres.map((item) => item.trim()).filter(Boolean)));
  const loginHref = localizePath(
    `/login?redirect=${encodeURIComponent(localizePath(ipRoomPath(detailIp.roomNumber), locale))}`,
    locale
  );
  const collectionTarget = selectedEpisode
    ? ({ targetType: "episode", ipId: detailIp.id, episodeId: selectedEpisode.id } as const)
    : ({ targetType: "ip", ipId: detailIp.id } as const);
  const activeCollectionItem = collectionQuery.data?.items.find((item) => {
    if (item.status !== "active" || item.targetType !== collectionTarget.targetType) return false;
    if (collectionTarget.targetType === "episode") {
      return (item.episode?.id ?? item.episodeId) === collectionTarget.episodeId;
    }
    return (item.ip?.id ?? item.ipId) === collectionTarget.ipId && !item.episode;
  });
  const collectionBusy = saveCollection.isPending || removeCollection.isPending;

  async function handleCollectionToggle() {
    const currentIp = detailIp;
    if (!currentIp || currentIp.previewMode || collectionBusy) return;
    if (!user) {
      router.push(loginHref);
      return;
    }
    try {
      if (activeCollectionItem) {
        await removeCollection.mutateAsync(collectionTarget);
        toast.success(t("actions.uncollectSuccess"));
      } else {
        await saveCollection.mutateAsync(collectionTarget);
        toast.success(t("actions.collectSuccess"));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(
        msg || (activeCollectionItem ? t("actions.uncollectFailed") : t("actions.collectFailed"))
      );
    }
  }

  async function handleLikeToggle() {
    const currentIp = detailIp;
    if (!currentIp || currentIp.previewMode || toggleLike.isPending) return;
    if (!user) {
      router.push(loginHref);
      return;
    }
    try {
      const result = await toggleLike.mutateAsync({
        ipId: currentIp.id,
        viewerHasLiked: currentIp.viewerHasLiked,
      });
      toast.success(result.liked ? t("actions.likeSuccess") : t("actions.unlikeSuccess"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t("actions.likeFailed"));
    }
  }

  async function handleReportSubmit(input: {
    reason: string;
    description?: string;
    blockIp: boolean;
  }) {
    const currentIp = detailIp;
    if (!currentIp) return;
    if (!user) {
      router.push(loginHref);
      return;
    }
    const reportTargetType: IpTargetType = selectedEpisode ? "episode" : "ip";
    const targetId = selectedEpisode?.id ?? currentIp.id;
    try {
      const completed = await reportSubmission.submit({
        ipId: currentIp.id,
        report: {
          targetType: reportTargetType,
          targetId,
          reason: input.reason as CreateIpReportInput["reason"],
          description: input.description,
        },
        blockIp: input.blockIp,
      });
      if (!completed) return;
      toast.success(input.blockIp ? t("report.successBlocked") : t("report.success"));
      setReportOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t("report.failed"));
    }
  }

  async function handleMemberFreeUnlock() {
    const ip = detailIp;
    if (purchase.isPending || !user || !ip) return;
    try {
      await purchase.mutateAsync({
        ipId: ip.id,
        targetType: "ip",
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success(t("commerce.purchaseSuccess"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t("commerce.purchaseFailed"));
    }
  }

  async function handlePurchase() {
    const ip = detailIp;
    if (!ip || !activePrice || purchase.isPending || !user) return;
    const purchaseTarget = resolvePurchaseTarget(activePrice, selectedEpisode);
    try {
      await purchase.mutateAsync({
        ipId: ip.id,
        targetType: purchaseTarget.targetType,
        episodeId: purchaseTarget.episodeId,
        priceRuleId: activePrice.id,
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success(t("commerce.purchaseSuccess"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (err instanceof ApiRequestError && err.code === "INSUFFICIENT_COMMUNITY_POINTS") {
        setRechargeOpen(true);
      }
      toast.error(msg || t("commerce.purchaseFailed"));
    }
  }

  async function handlePlaylistPurchase() {
    const ip = detailIp;
    if (!ip || !playlistUnlockPrice || purchase.isPending || !user) return;
    const purchaseTarget = resolvePurchaseTarget(playlistUnlockPrice, null);
    try {
      await purchase.mutateAsync({
        ipId: ip.id,
        targetType: purchaseTarget.targetType,
        episodeId: purchaseTarget.episodeId,
        priceRuleId: playlistUnlockPrice.id,
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success(t("commerce.purchaseSuccess"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (err instanceof ApiRequestError && err.code === "INSUFFICIENT_COMMUNITY_POINTS") {
        setRechargeOpen(true);
      }
      toast.error(msg || t("commerce.purchaseFailed"));
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background text-foreground">
      <main className="mx-auto w-full max-w-[1840px] px-4 pb-8 pt-3 sm:px-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Button asChild variant="ghost" color="muted" className="text-muted-foreground">
            <Link href={localizePath("/ips", locale)}>
              <IconArrowLeft className="size-4" />
              {t("back")}
            </Link>
          </Button>
          {detailIp.previewMode ? (
            <span className="rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              {t("previewBadge")}
            </span>
          ) : null}
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_410px]">
          <div className="min-w-0">
            <MediaFrame
              title={mediaTitle}
              posterUrl={mediaPosterUrl}
              videoUrl={mediaTrailerUrl}
              locked={Boolean(selectedEpisode && !canWatchSelected)}
              lockedLabel={lockedMediaLabel}
              onFirstPlay={() => {
                // Membership can still be loading after the authorized full-media URL arrives.
                // The server checks eligibility and dedupes monthly; exclude previews/trailers.
                if (
                  user?.id &&
                  !detailIp.previewMode &&
                  selectedEpisode &&
                  !isTrailerSelected &&
                  canWatchSelected &&
                  episodeMediaUrl
                ) {
                  void recordMemberView({
                    ipId: detailIp.id,
                    episodeId: selectedEpisode.id,
                  }).catch(() => {});
                }
              }}
              t={t}
            />

            {selectedEpisode &&
              !isTrailerSelected &&
              selectedEpisode.episodeNo >= 1 &&
              selectedEpisode.episodeNo <= 3 && (
                <EpisodeFeedback ipId={detailIp.id} episodeId={selectedEpisode.id} />
              )}
            <section className="mt-4">
              <h1 className="text-xl font-semibold leading-snug text-foreground sm:text-2xl">
                {detailIp.title}
              </h1>
              <IpProductionStage ipId={detailIp.id} />
              {isTrailerSelected ? (
                <p className="mt-1.5 text-sm font-semibold text-primary">{t("episodes.trailer")}</p>
              ) : selectedEpisode ? (
                <p className="mt-1.5 text-sm leading-snug text-muted-foreground">
                  <span className="font-semibold text-primary">
                    {t("episodes.number", {
                      number:
                        detailIp.episodes.findIndex((item) => item.id === selectedEpisode.id) + 1,
                    })}
                  </span>
                  <span className="mx-1.5 text-muted-foreground/50">·</span>
                  <span className="font-medium text-foreground/85">{selectedEpisode.title}</span>
                </p>
              ) : detailIp.subtitle ? (
                <p className="mt-1.5 text-sm text-muted-foreground">{detailIp.subtitle}</p>
              ) : null}

              <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                  <span className="select-text tabular-nums">
                    {t("roomNumber", { number: detailIp.roomNumber })}
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  {detailIp.genres.slice(0, 2).map((genre) => (
                    <span key={genre}>{genre}</span>
                  ))}
                  {detailIp.genres.length > 0 ? (
                    <span className="text-muted-foreground/50">·</span>
                  ) : null}
                  <span>{statusLabel}</span>
                  <span className="text-muted-foreground/50">·</span>
                  <span>{visibilityLabel}</span>
                  {tagItems.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>

                <IpEngagementActions>
                  <ActionButton
                    onClick={() => void shareIp(ipRoomPath(detailIp.roomNumber), locale, t)}
                    icon={IconShare3}
                  >
                    {t("actions.share")}
                  </ActionButton>
                  <ActionButton
                    active={detailIp.viewerHasLiked}
                    disabled={detailIp.previewMode || toggleLike.isPending}
                    onClick={() => void handleLikeToggle()}
                    icon={IconHeart}
                  >
                    <span>{detailIp.viewerHasLiked ? t("actions.liked") : t("actions.like")}</span>
                    <span
                      className={cn(
                        "rounded-full bg-background/70 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground",
                        detailIp.viewerHasLiked && "bg-primary/10 text-primary"
                      )}
                    >
                      {formatEngagementCount(detailIp.likeCount, locale)}
                    </span>
                  </ActionButton>
                  <ActionButton
                    disabled={detailIp.previewMode || collectionBusy}
                    onClick={() => void handleCollectionToggle()}
                    icon={IconBookmark}
                  >
                    {activeCollectionItem ? t("actions.collected") : t("actions.collect")}
                  </ActionButton>
                  <ActionButton
                    disabled={detailIp.previewMode || reportSubmission.isPending}
                    onClick={() => (user ? setReportOpen(true) : router.push(loginHref))}
                    icon={IconFlag}
                  >
                    {t("actions.report")}
                  </ActionButton>
                </IpEngagementActions>
                {!detailIp.previewMode && <IpFanCommunity ipId={detailIp.id} />}
                {!detailIp.previewMode && (
                  <div className="mt-4">
                    <IpGenerationPanel ipId={detailIp.id} />
                  </div>
                )}
                {!detailIp.previewMode && <ChannelSubmissions ipId={detailIp.id} />}
              </div>

              <PurchasePanel
                ip={detailIp}
                selectedEpisode={selectedEpisode}
                access={activeAccessCode}
                price={activePrice ?? null}
                accessLoading={accessQuery.isLoading}
                walletBalance={walletQuery.balance}
                walletLoading={walletQuery.isLoading}
                authenticated={Boolean(user)}
                locale={locale}
                t={t}
                purchasePending={purchase.isPending}
                pendingUnlockAt={pendingUnlockAt}
                onRecharge={() => setRechargeOpen(true)}
                onSubscribeMembership={() => setMembershipOpen(true)}
                onMemberFreeUnlock={handleMemberFreeUnlock}
                onPurchase={handlePurchase}
              />

              {!viewerIsMember && activeAccessCode === "locked" && (
                <button
                  type="button"
                  onClick={() => setMembershipOpen(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  {tPay("communityMembershipTitle")}
                </button>
              )}

              <div className="mt-3 rounded-lg bg-secondary/80 p-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-foreground">
                  <span>
                    {activePrice ? formatPrice(activePrice, locale, t) : t("commerce.free")}
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  <span>{t("episodes.count", { count: detailIp.episodes.length })}</span>
                  <span className="text-muted-foreground/50">·</span>
                  <span>{formatDate(detailIp.publishedAt ?? detailIp.scheduledAt, locale, t)}</span>
                  <span className="text-muted-foreground/50">·</span>
                  <span className="inline-flex items-center gap-1">
                    <IconEye className="size-3.5 text-muted-foreground" />
                    {t("actions.views", {
                      count: formatEngagementCount(detailIp.viewCount, locale),
                    })}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-line text-sm leading-6 text-secondary-foreground">
                  {mediaSummary}
                </p>
              </div>
            </section>

            <section className="mt-6">
              <h2 className="text-base font-semibold text-foreground">{t("story.title")}</h2>
              <Prose text={storyText} />
            </section>
          </div>

          <aside className="min-w-0 space-y-5 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:pr-1">
            <CreatorTeamCard ip={detailIp} bannerUrl={ipCoverUrl} t={t} />
            {!detailIp.previewMode && <IpReleaseLinks ipId={detailIp.id} />}
            <EpisodePlaylist
              ipTitle={detailIp.title}
              episodes={detailIp.episodes}
              activeEpisodeId={isTrailerSelected ? TRAILER_ID : (selectedEpisode?.id ?? null)}
              accessItems={accessQuery.data?.episodes ?? []}
              hasTrailer={Boolean(ipTrailerUrl)}
              trailerPoster={ipCoverUrl}
              locale={locale}
              t={t}
              onSelectEpisode={setSelectedEpisodeId}
              unlockAction={
                detailIp.previewMode ? null : (
                  <PurchaseUnlockAction
                    roomNumber={detailIp.roomNumber}
                    selectedEpisode={null}
                    access={playlistUnlockAccess}
                    price={playlistUnlockPrice}
                    accessLoading={accessQuery.isLoading}
                    walletBalance={walletQuery.balance}
                    walletLoading={walletQuery.isLoading}
                    authenticated={Boolean(user)}
                    locale={locale}
                    t={t}
                    purchasePending={purchase.isPending}
                    onRecharge={() => setRechargeOpen(true)}
                    onSubscribeMembership={() => setMembershipOpen(true)}
                    onMemberFreeUnlock={handleMemberFreeUnlock}
                    onPurchase={handlePlaylistPurchase}
                  />
                )
              }
            />
            <AccessSummary
              ip={detailIp}
              locale={locale}
              statusLabel={statusLabel}
              visibilityLabel={visibilityLabel}
              access={activeAccessCode}
              price={activePrice ?? null}
              walletBalance={walletQuery.balance}
              accessLoading={accessQuery.isLoading}
              pendingUnlockAt={pendingUnlockAt}
              t={t}
            />
          </aside>
        </div>
        {!detailIp.previewMode && (
          <IpKnowledgeAssistant key={detailIp.id} ipId={detailIp.id} ipTitle={detailIp.title} />
        )}
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          title={selectedEpisode ? selectedEpisode.title : detailIp.title}
          targetType={selectedEpisode ? "episode" : "ip"}
          pending={reportSubmission.isPending}
          t={t}
          onSubmit={handleReportSubmit}
        />
        <CommunityRechargeDialog
          open={rechargeOpen}
          onOpenChange={setRechargeOpen}
          // Return the refetch promise so the dialog awaits the balance refresh
          // and owns the success/processing toast (avoids a duplicate toast).
          onSuccess={() => walletQuery.refetch().then(() => {})}
        />
        <CommunityMembershipDialog
          open={membershipOpen}
          onOpenChange={setMembershipOpen}
          onSuccess={() =>
            Promise.all([walletQuery.refetch(), accessQuery.refetch()]).then(() => {})
          }
        />
      </main>
    </div>
  );
}

function normalizePublicIp(ip: IpCommerceIp): DetailIp {
  return {
    ...ip,
    viewCount: ip.engagement?.viewCount ?? ip.viewCount ?? 0,
    likeCount: ip.engagement?.likeCount ?? ip.likeCount ?? 0,
    viewerHasLiked: ip.engagement?.viewerHasLiked ?? ip.viewerHasLiked === true,
    version: null,
    previewMode: false,
  };
}

export function normalizeCreatorIp(ip: IpCreatorIp, viewerId: string | null): DetailIp {
  return {
    id: ip.id,
    roomNumber: ip.roomNumber,
    title: ip.title,
    subtitle: null,
    summary: ip.summary,
    description: ip.description,
    status: ip.status,
    listingVisibility: ip.listingVisibility,
    ageRating: ip.ageRating,
    sourceLocale: ip.sourceLocale,
    version: ip.version,
    coverAsset: ip.coverAsset,
    trailerAsset: ip.trailerAsset,
    publishedAt: null,
    scheduledAt: null,
    price: ip.price ?? null,
    campaigns: ip.campaigns ?? [],
    episodes: ip.episodes ?? [],
    genres: ip.genres ?? [],
    tags: [],
    copyrightOwner: ip.copyrightOwner ?? null,
    createdById: ip.createdById ?? (ip.viewerAccess.owner ? viewerId : null),
    contributors: (ip.contributors ?? []).map((contributor) => ({
      ...contributor,
      displayName: contributor.displayName ?? "",
    })),
    viewCount: 0,
    likeCount: 0,
    viewerHasLiked: false,
    previewMode: true,
  };
}

function LoadingState({ t }: { t: Translate }) {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background text-foreground">
      <div className="mx-auto flex min-h-[560px] max-w-5xl flex-col justify-center px-5 py-10">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-2xl shadow-black/35">
          <IconLoader2 className="size-4 animate-spin text-primary" />
          {t("loading")}
        </div>
      </div>
    </div>
  );
}

function NotFoundState({ locale, t }: { locale: Locale; t: Translate }) {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background px-5 py-10 text-foreground">
      <div className="mx-auto flex min-h-[520px] max-w-3xl flex-col items-center justify-center text-center">
        <div className="flex size-14 items-center justify-center rounded-lg border border-border bg-card text-primary">
          <IconLock className="size-6" />
        </div>
        <h1 className="mt-6 text-3xl font-semibold">{t("notFound.title")}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          {t("notFound.body")}
        </p>
        <Button asChild className="mt-6">
          <Link href={localizePath("/ips", locale)}>{t("notFound.action")}</Link>
        </Button>
      </div>
    </div>
  );
}

function MediaFrame({
  title,
  posterUrl,
  videoUrl,
  locked,
  lockedLabel,
  onFirstPlay,
  t,
}: {
  title: string;
  posterUrl?: string;
  videoUrl?: string;
  locked?: boolean;
  lockedLabel?: string;
  onFirstPlay?: () => void;
  t: Translate;
}) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-secondary">
      {videoUrl ? (
        <VideoPlayer
          src={videoUrl}
          className="absolute inset-0 size-full [&_.vjs-tech]:object-contain"
          fillParent
          autoplay={false}
          onFirstPlay={onFirstPlay}
        />
      ) : posterUrl ? (
        <Image
          src={posterUrl}
          alt={title}
          fill
          unoptimized
          sizes="(min-width: 1280px) 72vw, 100vw"
          className="object-cover"
        />
      ) : (
        <div className="grid size-full place-items-center">
          <div className="flex flex-col items-center text-center">
            <div className="flex size-14 items-center justify-center rounded-lg bg-background text-muted-foreground">
              <IconSparkles className="size-6" />
            </div>
            <p className="mt-4 text-sm font-semibold text-foreground">{t("visual.emptyTitle")}</p>
            <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
              {t("visual.emptyBody")}
            </p>
          </div>
        </div>
      )}
      {locked ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/50">
          <div className="flex items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-sm font-semibold text-white">
            <IconLock className="size-4 text-primary" />
            {lockedLabel ?? t("commerce.lockedVideo")}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CreatorProfileLink({ userId, children }: { userId?: string | null; children: ReactNode }) {
  const locale = useLocale() as Locale;
  if (!userId) return <>{children}</>;
  return (
    <Link
      href={localizePath(creatorHref(userId), locale)}
      className="flex min-w-0 items-center gap-3 rounded-lg hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {children}
    </Link>
  );
}

function CreatorTeamCard({ ip, bannerUrl, t }: { ip: DetailIp; bannerUrl?: string; t: Translate }) {
  const [membersOpen, setMembersOpen] = useState(false);
  const members = ip.contributors;
  const ownerId = ip.createdById;
  // Resolve member + creator user ids → live Java name/avatar (dicebear fallback).
  const userIds = useMemo(
    () =>
      Array.from(
        new Set([ownerId, ...members.map((member) => member.userId)].filter(Boolean) as string[])
      ),
    [ownerId, members]
  );
  const displays = useUserDisplays(userIds);
  // The owner (ip.createdById) ALWAYS exists (non-nullable) but is NOT always a
  // contributor row — web-created IPs can be published with an owner and zero
  // contributors, and some IPs list collaborators without the owner. So anchor
  // the card on the owner: its real contributor row when present, else one
  // synthesized from createdById.
  const ownerContributor = ownerId
    ? members.find((member) => member.userId === ownerId)
    : undefined;
  // Title: copyright owner / studio name → the real creator's name (live Java
  // nickname first, then the contributor snapshot) → generic fallback. Anchored
  // on the owner, never on an arbitrary first contributor.
  const ownerName =
    (ownerId ? displays.get(ownerId)?.nickname?.trim() : undefined) ||
    ownerContributor?.displayName?.trim() ||
    undefined;
  const teamName = ip.copyrightOwner?.trim() || ownerName || t("creatorTeam.titleFallback");
  const initial = teamName.trim().charAt(0).toUpperCase() || "F";
  // One ordered, deduped people list — owner first, then the (already
  // isPublic-filtered) contributor rows — feeding the avatar stack, the title,
  // and the "see all" dialog so all three stay consistent and the owner is
  // never dropped (even past the first 3, or when absent from contributors).
  const people = useMemo<DetailIp["contributors"]>(() => {
    const ordered: DetailIp["contributors"] = [];
    if (ownerId) {
      ordered.push(
        ownerContributor ?? {
          id: ownerId,
          userId: ownerId,
          displayName: ownerName ?? teamName,
          role: "owner",
          // Match the migrated owner contributor's customRole ("Owner") so the
          // dialog never shows the raw lowercase enum token for a synthesized owner.
          customRole: "Owner",
          isPublic: true,
          displayOrder: -1,
        }
      );
    }
    ordered.push(...members);
    const seen = new Set<string>();
    return ordered.filter((person) => {
      const key = person.userId ?? `row:${person.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [ownerId, ownerContributor, ownerName, teamName, members]);
  const stack = people.slice(0, 3);

  return (
    <section className="overflow-hidden rounded-xl bg-secondary/65">
      <div className="relative h-20 overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(239,35,42,0.42),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.12),rgba(255,255,255,0.02))]">
        {bannerUrl ? (
          <Image
            src={bannerUrl}
            alt={t("creatorTeam.bannerAlt", { name: teamName })}
            fill
            unoptimized
            sizes="410px"
            className="object-cover opacity-80"
          />
        ) : null}
        <div className="absolute inset-0 bg-linear-to-b from-black/5 via-black/10 to-black/45" />
      </div>

      <div className="flex items-center gap-3 p-3">
        {stack.length > 0 ? (
          <div className="flex shrink-0 -space-x-2">
            {stack.map((person) => (
              <CreatorProfileLink key={person.userId ?? person.id} userId={person.userId}>
                <UserAvatar
                  src={
                    person.userId
                      ? resolveUserAvatarUrl(displays.get(person.userId)?.avatar)
                      : undefined
                  }
                  seed={person.userId || person.id}
                  name={person.displayName}
                  className="size-9 ring-2 ring-secondary"
                />
              </CreatorProfileLink>
            ))}
          </div>
        ) : (
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground shadow-lg shadow-primary/20">
            {initial}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <CreatorProfileLink userId={ownerId}>
            <h2 className="truncate text-base font-semibold text-foreground">{teamName}</h2>
          </CreatorProfileLink>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {ip.episodes.length > 0
              ? t("creatorTeam.subtitle", { count: ip.episodes.length })
              : t("creatorTeam.subtitleNoEpisodes")}
          </p>
        </div>

        {people.length > 1 ? (
          <button
            type="button"
            onClick={() => setMembersOpen(true)}
            className="h-9 shrink-0 rounded-full bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background/80"
          >
            {t("creatorTeam.action")}
          </button>
        ) : null}

        <button
          type="button"
          aria-label={t("creatorTeam.menu")}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <IconDotsVertical className="size-5" />
        </button>
      </div>

      <ContributorsDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        teamName={teamName}
        members={people}
        displays={displays}
        t={t}
      />
    </section>
  );
}

function ContributorsDialog({
  open,
  onOpenChange,
  teamName,
  members,
  displays,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamName: string;
  members: DetailIp["contributors"];
  displays: ReturnType<typeof useUserDisplays>;
  t: Translate;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("creatorTeam.titleFallback")}</DialogTitle>
          <DialogDescription className="sr-only">{teamName}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-1">
          {members.map((member) => {
            const display = member.userId ? displays.get(member.userId) : undefined;
            const name = display?.nickname?.trim() || member.displayName;
            const role = member.customRole?.trim() || member.role;
            return (
              <div key={member.id} className="flex items-center gap-3 rounded-lg p-1.5">
                <CreatorProfileLink userId={member.userId}>
                  <UserAvatar
                    src={resolveUserAvatarUrl(display?.avatar)}
                    seed={member.userId || member.id}
                    name={name}
                    className="size-9 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{name}</div>
                    {role ? (
                      <div className="truncate text-xs text-muted-foreground">{role}</div>
                    ) : null}
                  </div>
                </CreatorProfileLink>
              </div>
            );
          })}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function EpisodePlaylist({
  ipTitle,
  episodes,
  activeEpisodeId,
  accessItems,
  hasTrailer,
  trailerPoster,
  locale,
  t,
  onSelectEpisode,
  unlockAction,
}: {
  ipTitle: string;
  episodes: IpCommerceEpisode[];
  activeEpisodeId: string | null;
  accessItems: Array<{ id: string; access: IpCommerceAccess; price: IpCommercePriceRule | null }>;
  hasTrailer: boolean;
  trailerPoster?: string;
  locale: Locale;
  t: Translate;
  onSelectEpisode: (episodeId: string) => void;
  /** Same unlock CTA as the player purchase bar — shown beside the playlist title. */
  unlockAction?: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground" title={ipTitle}>
            {ipTitle}
          </p>
          <h2 className="mt-0.5 text-xs font-medium text-muted-foreground">
            {t("episodes.playlist")}
          </h2>
        </div>
        {unlockAction ? (
          <div className="shrink-0">{unlockAction}</div>
        ) : (
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
            {t("episodes.count", { count: episodes.length })}
          </span>
        )}
      </div>
      {episodes.length > 0 || hasTrailer ? (
        <div className="space-y-1.5">
          {hasTrailer ? (
            <button
              type="button"
              onClick={() => onSelectEpisode(TRAILER_ID)}
              className={cn(
                "flex w-full gap-2.5 rounded-lg p-1.5 text-left transition-colors",
                activeEpisodeId === TRAILER_ID ? "bg-primary/12" : "hover:bg-secondary/65"
              )}
            >
              <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-secondary">
                {trailerPoster ? (
                  <Image
                    src={trailerPoster}
                    alt={t("episodes.trailer")}
                    fill
                    unoptimized
                    sizes="144px"
                    className="object-cover"
                  />
                ) : (
                  <div className="grid size-full place-items-center">
                    <IconVideo className="size-5 text-muted-foreground/45" />
                  </div>
                )}
                <span className="absolute inset-0 grid place-items-center bg-black/25">
                  <IconPlayerPlay className="size-6 text-white drop-shadow" />
                </span>
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div
                  className={cn(
                    "line-clamp-2 text-[13px] font-semibold leading-5",
                    activeEpisodeId === TRAILER_ID ? "text-primary" : "text-foreground"
                  )}
                >
                  {t("episodes.trailer")}
                </div>
                <span className="mt-2 inline-flex rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {t("episodes.freePreview")}
                </span>
              </div>
            </button>
          ) : null}
          {episodes.map((episode, index) => (
            <EpisodePlaylistItem
              key={episode.id}
              episode={episode}
              displayNumber={index + 1}
              active={episode.id === activeEpisodeId}
              access={accessItems.find((item) => item.id === episode.id)?.access}
              locale={locale}
              t={t}
              onSelect={() => onSelectEpisode(episode.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyBlock
          icon={IconVideo}
          title={t("episodes.emptyTitle")}
          body={t("episodes.emptyBody")}
        />
      )}
    </section>
  );
}

function EpisodePlaylistItem({
  episode,
  displayNumber,
  active,
  access,
  locale,
  t,
  onSelect,
}: {
  episode: IpCommerceEpisode;
  /** 1-based position in the live playlist (not raw episodeNo). */
  displayNumber: number;
  active: boolean;
  access?: IpCommerceAccess;
  locale: Locale;
  t: Translate;
  onSelect: () => void;
}) {
  const coverUrl = getAssetUrl(episode.coverAsset) ?? getAssetUrl(episode.trailerAsset);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full gap-2.5 rounded-lg p-1.5 text-left transition-colors",
        active ? "bg-primary/12" : "hover:bg-secondary/65"
      )}
    >
      <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-secondary">
        {coverUrl ? (
          <Image
            src={coverUrl}
            alt={episode.title}
            fill
            unoptimized
            sizes="144px"
            className="object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center">
            <IconVideo className="size-5 text-muted-foreground/45" />
          </div>
        )}
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {formatDuration(episode.durationSeconds, t)}
        </span>
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div
          className={cn(
            "line-clamp-2 text-[13px] font-semibold leading-5",
            active ? "text-primary" : "text-foreground"
          )}
        >
          {episode.title}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t("episodes.number", { number: displayNumber })}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {formatDate(episode.publishedAt ?? episode.scheduledAt, locale, t)}
        </div>
        {episode.isFreePreview || access ? (
          <span className="mt-2 inline-flex rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {episode.isFreePreview
              ? t("episodes.freePreview")
              : isAccessPending(access)
                ? t("commerce.pendingUnlockShort")
                : isAccessGranted(access)
                  ? t("commerce.unlocked")
                  : t("commerce.locked")}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function AccessSummary({
  ip,
  locale,
  statusLabel,
  visibilityLabel,
  access,
  price,
  walletBalance,
  accessLoading,
  pendingUnlockAt,
  t,
}: {
  ip: DetailIp;
  locale: Locale;
  statusLabel: string;
  visibilityLabel: string;
  access: IpCommerceAccess;
  price: IpCommercePriceRule | null;
  walletBalance: string;
  accessLoading: boolean;
  pendingUnlockAt?: string | null;
  t: Translate;
}) {
  const priceLabel = price ? formatPrice(price, locale, t) : t("commerce.free");
  const accessLabel = accessLoading
    ? t("commerce.checking")
    : isAccessGranted(access)
      ? t("commerce.unlocked")
      : isAccessPending(access)
        ? formatPendingUnlockLabel(pendingUnlockAt, locale, t)
        : t("commerce.locked");
  return (
    <section className="rounded-xl bg-secondary/45 p-3">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
          <IconTicket className="size-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-primary">{t("access.eyebrow")}</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">{priceLabel}</h2>
        </div>
      </div>
      <div className="mt-3 divide-y divide-border/50">
        <InfoRow label={t("commerce.accessState")} value={accessLabel} />
        <InfoRow
          label={t("commerce.walletBalance")}
          value={t("priceValue", {
            amount: formatIntegerAmount(walletBalance, locale),
            unit: t("units.communityPoint"),
          })}
        />
        <InfoRow label={t("access.genres")} value={ip.genres.join(" / ") || "—"} />
        <InfoRow label={t("metrics.status")} value={statusLabel} />
        <InfoRow
          label={t("access.visibility")}
          value={ip.previewMode ? t("access.preview") : visibilityLabel}
        />
        <InfoRow label={t("access.language")} value={ip.sourceLocale} />
      </div>
    </section>
  );
}

function PurchasePanel({
  ip,
  selectedEpisode,
  access,
  price,
  accessLoading,
  walletBalance,
  walletLoading,
  authenticated,
  locale,
  t,
  purchasePending,
  pendingUnlockAt,
  onRecharge,
  onPurchase,
  onMemberFreeUnlock,
  onSubscribeMembership,
}: {
  ip: DetailIp;
  selectedEpisode: IpCommerceEpisode | null;
  access: IpCommerceAccess;
  price: IpCommercePriceRule | null;
  accessLoading: boolean;
  walletBalance: string;
  walletLoading: boolean;
  authenticated: boolean;
  locale: Locale;
  t: Translate;
  purchasePending: boolean;
  pendingUnlockAt?: string | null;
  onRecharge: () => void;
  onPurchase: () => Promise<void>;
  onMemberFreeUnlock: () => Promise<void>;
  onSubscribeMembership: () => void;
}) {
  if (ip.previewMode) {
    return (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-primary/10 p-3 text-sm">
        <span className="text-primary">{t("access.previewBody")}</span>
      </div>
    );
  }

  const granted = isAccessGranted(access);
  const pendingUnlock = isAccessPending(access);
  const priceLabel = price ? formatPrice(price, locale, t) : t("commerce.free");
  const balanceLabel = t("priceValue", {
    amount: formatIntegerAmount(walletBalance, locale),
    unit: t("units.communityPoint"),
  });
  const priceAmount = price ? parseIntegerAmount(price.memberAmount ?? price.amount) : null;
  const walletAmount = parseIntegerAmount(walletBalance);
  const missingAmount =
    !walletLoading && priceAmount !== null && walletAmount !== null && walletAmount < priceAmount
      ? priceAmount - walletAmount
      : null;
  const balanceLine =
    missingAmount !== null
      ? t("commerce.shortBalanceLine", {
          amount: t("priceValue", {
            amount: formatBigIntAmount(missingAmount, locale),
            unit: t("units.communityPoint"),
          }),
        })
      : walletLoading
        ? t("commerce.walletChecking")
        : t("commerce.walletLine", { balance: balanceLabel });

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg bg-secondary/80 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          <IconPlayerPlay className="size-4 text-primary" />
          <span>
            {granted
              ? t("commerce.readyToWatch")
              : pendingUnlock
                ? formatPendingUnlockLabel(pendingUnlockAt, locale, t)
                : t("commerce.needUnlock")}
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span>{priceLabel}</span>
          {price ? (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span>
                {price.targetType === "ip" ? t("commerce.ipBundle") : t("commerce.singleEpisode")}
              </span>
            </>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {pendingUnlock ? t("commerce.pendingUnlockBody") : balanceLine}
        </p>
      </div>

      {granted ? (
        <span className="inline-flex h-9 items-center justify-center rounded-full bg-primary/10 px-4 text-sm font-semibold text-primary">
          {t("commerce.unlocked")}
        </span>
      ) : pendingUnlock ? (
        <span className="inline-flex h-9 items-center justify-center rounded-full bg-primary/10 px-4 text-sm font-semibold text-primary">
          {t("commerce.pendingUnlockShort")}
        </span>
      ) : (
        <PurchaseUnlockAction
          roomNumber={ip.roomNumber}
          selectedEpisode={selectedEpisode}
          access={access}
          price={price}
          accessLoading={accessLoading}
          walletBalance={walletBalance}
          walletLoading={walletLoading}
          authenticated={authenticated}
          locale={locale}
          t={t}
          purchasePending={purchasePending}
          onRecharge={onRecharge}
          onPurchase={onPurchase}
          onMemberFreeUnlock={onMemberFreeUnlock}
          onSubscribeMembership={onSubscribeMembership}
        />
      )}
    </div>
  );
}

/** Unlock / top-up / login CTA shared by the player bar and playlist header. */
function PurchaseUnlockAction({
  roomNumber,
  access,
  price,
  accessLoading,
  walletBalance,
  walletLoading,
  authenticated,
  locale,
  t,
  purchasePending,
  onRecharge,
  onPurchase,
  onMemberFreeUnlock,
  onSubscribeMembership,
}: {
  roomNumber: string;
  selectedEpisode: IpCommerceEpisode | null;
  access: IpCommerceAccess;
  price: IpCommercePriceRule | null;
  accessLoading: boolean;
  walletBalance: string;
  walletLoading: boolean;
  authenticated: boolean;
  locale: Locale;
  t: Translate;
  purchasePending: boolean;
  onRecharge: () => void;
  onPurchase: () => Promise<void>;
  onMemberFreeUnlock: () => Promise<void>;
  onSubscribeMembership: () => void;
}) {
  const granted = isAccessGranted(access);
  const pendingUnlock = isAccessPending(access);
  if (granted || pendingUnlock) return null;

  const priceAmount = price ? parseIntegerAmount(price.memberAmount ?? price.amount) : null;
  const walletAmount = parseIntegerAmount(walletBalance);
  const missingAmount =
    !walletLoading && priceAmount !== null && walletAmount !== null && walletAmount < priceAmount
      ? priceAmount - walletAmount
      : null;
  const loginHref = localizePath(
    `/login?redirect=${encodeURIComponent(localizePath(ipRoomPath(roomNumber), locale))}`,
    locale
  );

  if (!authenticated) {
    return (
      <Button asChild size="sm">
        <Link href={loginHref}>{t("commerce.loginToUnlock")}</Link>
      </Button>
    );
  }
  if (access === "member_free") {
    return (
      <Button
        type="button"
        size="sm"
        disabled={accessLoading || purchasePending}
        onClick={() => void onMemberFreeUnlock()}
      >
        {purchasePending ? t("commerce.purchasing") : t("commerce.memberFreeWatch")}
      </Button>
    );
  }
  if (access === "member_locked") {
    return (
      <Button type="button" size="sm" onClick={onSubscribeMembership}>
        {t("commerce.memberJoinToWatch")}
      </Button>
    );
  }
  if (price) {
    return (
      <Button
        type="button"
        size="sm"
        disabled={accessLoading || walletLoading || purchasePending}
        onClick={() => {
          if (missingAmount !== null) onRecharge();
          else void onPurchase();
        }}
      >
        {purchasePending
          ? t("commerce.purchasing")
          : `${t("commerce.purchase")} · ${formatPrice(price, locale, t)}`}
      </Button>
    );
  }
  return (
    <span className="inline-flex h-9 items-center justify-center rounded-full bg-muted px-4 text-sm font-semibold text-muted-foreground">
      {t("commerce.notForSale")}
    </span>
  );
}

function ActionButton({
  children,
  icon: Icon,
  active,
  disabled,
  onClick,
}: {
  children: ReactNode;
  icon: ComponentType<{ className?: string }>;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-full px-3.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:text-muted-foreground",
        active
          ? "bg-primary/10 text-primary hover:bg-primary/15"
          : "bg-secondary text-foreground hover:bg-secondary/80"
      )}
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}

function ReportDialog({
  open,
  onOpenChange,
  title,
  targetType,
  pending,
  t,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  targetType: IpTargetType;
  pending: boolean;
  t: Translate;
  onSubmit: (input: { reason: string; description?: string; blockIp: boolean }) => Promise<void>;
}) {
  const [reason, setReason] = useState("copyright");
  const [description, setDescription] = useState("");
  const [blockIp, setBlockIp] = useState(false);
  const reasonKeys = [
    "copyright",
    "unsafe_content",
    "fraud",
    "misleading",
    "privacy",
    "harassment",
    "other",
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("report.title")}</DialogTitle>
          <DialogDescription>
            {t("report.body", {
              target: title,
              type: t(`report.targetTypes.${targetType}`),
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label className="block space-y-2">
            <span className="text-xs font-semibold text-foreground">{t("report.reason")}</span>
            <NativeSelect
              value={reason}
              onChange={setReason}
              className="h-10 w-full rounded-md bg-secondary px-3 text-sm text-foreground outline-none ring-1 ring-border transition focus:ring-primary"
            >
              {reasonKeys.map((key) => (
                <option key={key} value={key}>
                  {t(`report.reasons.${key}`)}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-semibold text-foreground">{t("report.description")}</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value.slice(0, 2000))}
              placeholder={t("report.descriptionPlaceholder")}
              className="min-h-28 w-full resize-y rounded-md bg-secondary px-3 py-2 text-sm leading-6 text-foreground outline-none ring-1 ring-border transition placeholder:text-muted-foreground focus:ring-primary"
            />
            <span className="block text-right text-xs text-muted-foreground">
              {description.length}/2000
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg bg-secondary/70 p-3 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={blockIp}
              onChange={(event) => setBlockIp(event.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>{t("report.blockIp")}</span>
          </label>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {t("report.cancel")}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              void onSubmit({
                reason,
                description: description.trim() || undefined,
                blockIp,
              })
            }
          >
            <IconFlag className="size-4" />
            {pending ? t("report.submitting") : t("report.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Prose({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/).filter(Boolean);
  return (
    <div className="mt-3 rounded-lg bg-secondary/75 p-3">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="text-sm leading-7 text-secondary-foreground">
          {paragraph}
        </p>
      ))}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

function EmptyBlock({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof IconVideo;
  title: string;
  body: string;
}) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-lg bg-secondary px-5 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg bg-background text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">{body}</p>
    </div>
  );
}

function getAssetUrl(asset: IpCommerceAsset | null | undefined) {
  const url = (asset?.url ?? asset?.externalUrl)?.trim();
  return url || undefined;
}

function formatDate(value: string | null | undefined, locale: Locale, t: Translate) {
  if (!value) return t("dateUnset");
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDuration(seconds: number | null | undefined, t: Translate) {
  if (!seconds) return t("durationUnset");
  const minutes = Math.max(1, Math.round(seconds / 60));
  return t("durationMinutes", { minutes });
}

function formatPrice(rule: IpCommercePriceRule, locale: Locale, t: Translate) {
  // Show the member-effective price when the server resolved one (member viewer),
  // so the displayed number matches what the member is actually charged.
  const amount = formatIntegerAmount(rule.memberAmount ?? rule.amount, locale);
  const unit = t("units.communityPoint");
  return t("priceValue", { amount, unit });
}

function formatIntegerAmount(value: string, locale: Locale) {
  try {
    return BigInt(value).toLocaleString(locale);
  } catch {
    return value;
  }
}

function formatEngagementCount(value: number, locale: Locale): string {
  const normalized = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  return new Intl.NumberFormat(locale, {
    notation: normalized >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: normalized >= 10_000 ? 1 : 0,
  }).format(normalized);
}

function formatBigIntAmount(value: bigint, locale: Locale) {
  return value.toLocaleString(locale);
}

function parseIntegerAmount(value: string | null | undefined) {
  try {
    return BigInt(value ?? "0");
  } catch {
    return null;
  }
}

function formatDateTime(value: string | null | undefined, locale: Locale, t: Translate) {
  if (!value) return t("dateUnset");
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

function formatPendingUnlockLabel(value: string | null | undefined, locale: Locale, t: Translate) {
  return value
    ? t("commerce.pendingUnlockAt", { date: formatDateTime(value, locale, t) })
    : t("commerce.pendingUnlock");
}

function getPendingUnlockAt(
  entitlements: IpContentEntitlement[],
  target: { targetType: IpTargetType; episodeId: string | null }
) {
  const now = Date.now();
  const ipEntitlement = entitlements.find(
    (item) =>
      item.targetType === "ip" && item.episodeId === null && new Date(item.startsAt).getTime() > now
  );
  if (ipEntitlement) return ipEntitlement.startsAt;
  if (target.targetType !== "episode") return null;
  return (
    entitlements.find(
      (item) =>
        item.targetType === "episode" &&
        item.episodeId === target.episodeId &&
        new Date(item.startsAt).getTime() > now
    )?.startsAt ?? null
  );
}

function resolvePurchaseTarget(
  price: IpCommercePriceRule,
  selectedEpisode: IpCommerceEpisode | null
): { targetType: IpTargetType; episodeId?: string } {
  if (price.targetType === "ip") return { targetType: "ip" };
  return {
    targetType: "episode",
    episodeId: selectedEpisode?.id,
  };
}

function isAccessGranted(access: IpCommerceAccess | undefined) {
  return (
    access === "free" ||
    access === "free_preview" ||
    access === "owned" ||
    access === "owned_ip" ||
    access === "owned_episode"
  );
}

function isAccessPending(access: IpCommerceAccess | undefined) {
  return (
    access === "pending_unlock" ||
    access === "pending_unlock_ip" ||
    access === "pending_unlock_episode"
  );
}

async function shareIp(path: string, locale: Locale, t: Translate) {
  const url = `${window.location.origin}${localizePath(path, locale)}`;
  try {
    if (navigator.share) {
      await navigator.share({ url });
    } else {
      await navigator.clipboard.writeText(url);
      toast.success(t("actions.shared"));
    }
  } catch {
    toast.error(t("actions.shareFailed"));
  }
}
