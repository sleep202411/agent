"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { recordMemberView } from "@/src/lib/ip-commerce/api";
import { ipRoomPath } from "@/src/lib/ip-commerce/urls";
import { IconChevronDown, IconLock, IconX } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useTvIps, useTvSelectedIp } from "../_hooks/use-tv-ips";
import { EpisodeFeedback } from "@/app/(site)/ips/_components/episode-feedback";

import { TvEpisodeUnlock } from "./tv-episode-unlock";

import { TvGames } from "./tv-games";
import { TvStage } from "./tv-stage";
import stageStyles from "./tv-stage.module.css";
import { TvIpList } from "./tv-ip-list";
import { TvInfoBar } from "./tv-info-bar";
import { TvEmptyState, TvErrorState, TvLoadingState } from "./tv-empty";
import { TvRightRail } from "./tv-right-rail";

import { CommunityVideoDialog } from "@/app/(site)/ips/_components/community-video-dialog";
import { NewIpCreateDialog } from "@/app/(site)/ip-studio/_components/new-ip-create-form";
import { TvCatalogToolbar } from "./tv-catalog-toolbar";

type TvEntryProps = { embedded?: boolean; initialIpId?: string; initialEpisodeId?: string };
export function TvApp({ embedded = false, initialIpId, initialEpisodeId }: TvEntryProps) {
  const { user } = useCurrentUser();
  const [createOpen, setCreateOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const tv = useTranslations("tv");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [mode, setMode] = useState<"videos" | "games">("videos");
  return (
    <div className="flex min-h-full min-w-0 max-w-full flex-col lg:h-full lg:min-h-0 bg-[#0c0e13] text-white">
      <TvCatalogToolbar
        mode={mode}
        onModeChange={setMode}
        onCreate={() => setCreateOpen(true)}
        onSubmitVideo={() => setVideoOpen(true)}
      />
      <CommunityVideoDialog open={videoOpen} onOpenChange={setVideoOpen} />
      <NewIpCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      {mode === "games" && !embedded && (
        <button
          type="button"
          aria-label={tv("exit")}
          onClick={() => router.push(localizePath("/ips", locale))}
          className="absolute right-4 top-4 z-20 flex size-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-white/20"
        >
          <IconX className="size-5" />
        </button>
      )}
      {mode === "videos" ? (
        <>
          <TvVideoApp
            key={`${user?.id ?? "guest"}:${initialIpId ?? ""}:${initialEpisodeId ?? ""}`}
            embedded={embedded}
            initialIpId={initialIpId}
            initialEpisodeId={initialEpisodeId}
          />
        </>
      ) : (
        <TvGames />
      )}
    </div>
  );
}

function TvVideoApp({ embedded = false, initialIpId, initialEpisodeId }: TvEntryProps) {
  const { user } = useCurrentUser();
  const signaledEpisodes = useRef(new Set<string>());
  const t = useTranslations("tv");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const {
    items,
    isLoading,
    isError,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    fetchNextChannels,
    isFetchingNextPage,
  } = useTvIps({ q: debouncedSearch });
  const [episodeChoice, setEpisodeChoice] = useState<{ ipId: string; episodeId: string } | null>(
    initialIpId && initialEpisodeId ? { ipId: initialIpId, episodeId: initialEpisodeId } : null
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialIpId ?? null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [nextError, setNextError] = useState<string | null>(null);
  const navigationVersion = useRef(0);
  const [searchEpoch, setSearchEpoch] = useState(debouncedSearch);

  // New search results replace the channel catalog — jump to the first hit.
  if (searchEpoch !== debouncedSearch) {
    setSearchEpoch(debouncedSearch);
    if (selectedId !== null) {
      setSelectedId(null);
      setIsPlaying(false);
    }
  }

  const requestedId = selectedId ?? items[0]?.id;
  const listedItem = items.find((entry) => entry.id === requestedId);
  const detail = useTvSelectedIp(requestedId);
  // A deep link resolves independently of the current catalogue page. Never
  // substitute the first channel or a cached public preview after access fails.
  const entryNeedsDetail = Boolean(initialIpId && requestedId === initialIpId);
  const item = detail.isError
    ? undefined
    : (detail.item ?? (entryNeedsDetail ? undefined : listedItem));
  // Remember the initial channel so a catalog refresh cannot change it.
  if (item && item.id !== selectedId) {
    setSelectedId(item.id);
    setIsPlaying(false);
  }
  const episode =
    episodeChoice && episodeChoice.ipId === item?.id
      ? item?.episodes?.find((entry) => entry.id === episodeChoice.episodeId)
      : undefined;
  const missingEpisode = Boolean(
    item && episodeChoice?.ipId === item.id && !episode && detail.isSuccess && !detail.isFetching
  );
  const playbackItem =
    item && episode ? { ...item, trailer: episode.video, trailerType: episode.videoType } : item;
  const errorMessage = error instanceof Error ? error.message : undefined;
  const index = items.findIndex((entry) => entry.id === item?.id);
  const hasNext =
    index >= 0 && (hasNextPage || items.slice(index + 1).some((entry) => entry.trailer));

  useEffect(
    () => () => {
      navigationVersion.current += 1;
    },
    []
  );

  function selectChannel(id: string) {
    navigationVersion.current += 1;
    setAdvancing(false);
    setNextError(null);
    if (id !== selectedId) {
      setEpisodeChoice(null);
      setSelectedId(id);
      setIsPlaying(false);
    }
  }

  async function nextChannel() {
    if (!item || advancing) return;
    const version = ++navigationVersion.current;
    let channels = items;
    let hasMore = hasNextPage;
    setNextError(null);
    setAdvancing(true);
    try {
      // Continue through catalog pages that may contain no eligible video channels.
      while (version === navigationVersion.current) {
        const currentIndex = channels.findIndex((entry) => entry.id === item.id);
        if (currentIndex < 0) return;
        const next = channels.slice(currentIndex + 1).find((entry) => entry.trailer);
        if (next) {
          selectChannel(next.id);
          return;
        }
        if (!hasMore) return;
        const result = await fetchNextChannels();
        channels = result.items;
        hasMore = result.hasMore;
      }
    } catch (error) {
      if (version === navigationVersion.current) {
        setNextError(error instanceof Error ? error.message : t("loadFailed"));
      }
    } finally {
      if (version === navigationVersion.current) setAdvancing(false);
    }
  }

  return (
    <div className="flex w-full shrink-0 flex-col bg-[#0c0e13] px-3 lg:min-h-0 lg:flex-1 lg:flex-row lg:overflow-hidden lg:px-6">
      <TvIpList
        embedded={embedded}
        items={items}
        selectedId={selectedId}
        isPlaying={isPlaying}
        isLoading={isLoading}
        isError={isError}
        errorMessage={errorMessage}
        onRetry={() => void refetch()}
        onSelect={selectChannel}
        hasMore={hasNextPage}
        isLoadingMore={isFetchingNextPage}
        onLoadMore={() => void fetchNextPage()}
        search={search}
        onSearchChange={(value) => {
          navigationVersion.current += 1;
          setAdvancing(false);
          setNextError(null);
          setSearch(value);
        }}
      />
      <section
        aria-label={t("playerTitle")}
        className="relative flex min-w-0 shrink-0 flex-col lg:flex-1 lg:overflow-hidden"
      >
        <div
          className={`${stageStyles.viewport} relative aspect-video shrink-0 lg:aspect-auto lg:min-h-0 lg:flex-1`}
        >
          {missingEpisode ? (
            <TvErrorState message={t("entryUnavailable")} onRetry={() => void detail.refetch()} />
          ) : item ? (
            <TvStage
              item={playbackItem!}
              onPlaybackChange={(playing, source) => {
                setIsPlaying(playing);
                if (playing) {
                  navigationVersion.current += 1;
                  setAdvancing(false);
                  // The API applies membership/grant eligibility and monthly deduplication.
                  // Only report an actually playing full episode, never its trailer.
                  if (
                    user?.id &&
                    episode?.video &&
                    !episode.locked &&
                    source &&
                    new URL(source, window.location.href).href ===
                      new URL(episode.video, window.location.href).href
                  ) {
                    const key = JSON.stringify([
                      item.id,
                      episode.id,
                      new Date().toISOString().slice(0, 7),
                    ]);
                    if (!signaledEpisodes.current.has(key)) {
                      signaledEpisodes.current.add(key);
                      void recordMemberView({ ipId: item.id, episodeId: episode.id })
                        .then((result) => {
                          // Eligibility may change after a membership purchase or free unlock.
                          if (!result.recorded) signaledEpisodes.current.delete(key);
                        })
                        .catch(() => {
                          // A later playback/resume may retry a failed best-effort signal.
                          signaledEpisodes.current.delete(key);
                        });
                    }
                  }
                }
              }}
              onNext={hasNext ? () => void nextChannel() : undefined}
              advancing={advancing}
              navigationError={nextError}
              onRefreshSource={() => void detail.refetch()}
            />
          ) : requestedId && detail.isError ? (
            <TvErrorState
              message={detail.error instanceof Error ? detail.error.message : t("entryUnavailable")}
              onRetry={() => void detail.refetch()}
            />
          ) : requestedId && detail.isPending ? (
            <TvLoadingState />
          ) : entryNeedsDetail ? (
            <TvErrorState message={t("entryUnavailable")} onRetry={() => void detail.refetch()} />
          ) : isLoading ? (
            <TvLoadingState />
          ) : isError ? (
            <TvErrorState message={errorMessage} onRetry={() => void refetch()} />
          ) : (
            <TvEmptyState />
          )}
        </div>
        {item && detail.isError && (
          <p role="alert" className="px-4 py-2 text-xs text-red-400">
            {detail.error instanceof Error ? detail.error.message : t("loadFailed")}{" "}
            <button
              type="button"
              disabled={detail.isFetching}
              className="underline"
              onClick={() => void detail.refetch()}
            >
              {t("retry")}
            </button>
          </p>
        )}
        {item && (
          <div className="shrink-0 lg:max-h-[45%] lg:overflow-y-auto" data-lenis-prevent>
            <button
              type="button"
              aria-expanded={detailsOpen}
              aria-controls="tv-channel-details"
              onClick={() => setDetailsOpen((open) => !open)}
              className="flex min-h-11 w-full items-center justify-between gap-3 border-t border-white/10 px-4 text-sm text-white/70 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-white"
            >
              <span>{t(detailsOpen ? "hideDetails" : "showDetails")}</span>
              <IconChevronDown
                aria-hidden
                className={`size-4 ${detailsOpen ? "rotate-180" : ""}`}
              />
            </button>
            <div id="tv-channel-details" hidden={!detailsOpen}>
              {item && Boolean(item.episodes?.length) && (
                <div className="shrink-0 space-y-2 px-4 py-2">
                  <p className="text-xs text-white/60">{t("episodeSelector")}</p>
                  <div
                    role="group"
                    aria-label={t("episodeSelector")}
                    className="flex gap-2 overflow-x-auto pb-2"
                  >
                    {[
                      {
                        id: "",
                        title: t("preview"),
                        cover: item.cover,
                        number: 0,
                        locked: false,
                        video: item.trailer,
                      },
                      ...(item.episodes ?? []),
                    ].map((entry) => (
                      <button
                        type="button"
                        key={entry.id}
                        data-episode-id={entry.id}
                        aria-pressed={(episode?.id ?? "") === entry.id}
                        onClick={() => {
                          navigationVersion.current += 1;
                          setAdvancing(false);
                          setNextError(null);
                          setIsPlaying(false);
                          setEpisodeChoice(
                            entry.id ? { ipId: item.id, episodeId: entry.id } : null
                          );
                        }}
                        title={entry.title}
                        className="flex w-28 shrink-0 flex-col rounded-md p-1 text-left text-xs text-white/70 hover:bg-primary/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                      >
                        {entry.cover ? (
                          <Image
                            unoptimized
                            width={112}
                            height={63}
                            src={entry.cover}
                            alt=""
                            className="mb-1 aspect-video w-full rounded-md object-cover"
                          />
                        ) : (
                          <span className="mb-1 flex aspect-video items-center justify-center rounded-md bg-white/10">
                            {entry.number || t("preview")}
                          </span>
                        )}
                        <span
                          className={`line-clamp-1 ${(episode?.id ?? "") === entry.id ? "text-primary" : ""}`}
                        >
                          {entry.number ? `${entry.number}. ` : ""}
                          {entry.title}
                        </span>
                        {isPlaying && !entry.locked && (episode?.id ?? "") === entry.id && (
                          <span className="text-xs text-primary">{t("nowPlaying")}</span>
                        )}
                        {entry.locked && (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <IconLock aria-hidden="true" className="size-3" />
                            {t("lockedEpisode")}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  {episode && !episode.video && (
                    <p role="status" className="text-sm text-white/60">
                      {episode.locked ? t("episodeAccess") : t("videoUnavailable")}{" "}
                      <Link
                        className="underline"
                        href={localizePath(ipRoomPath(item.roomNumber), locale)}
                      >
                        {t("viewDetail")}
                      </Link>
                    </p>
                  )}
                  {episode?.locked && (
                    <TvEpisodeUnlock
                      key={`${item.id}:${episode.id}`}
                      ipId={item.id}
                      episodeId={episode.id}
                    />
                  )}
                  {episode &&
                    Boolean(episode.video) &&
                    episode.number >= 1 &&
                    episode.number <= 3 && (
                      <EpisodeFeedback ipId={item.id} episodeId={episode.id} />
                    )}
                </div>
              )}
              {item && <TvInfoBar item={item} />}
            </div>
          </div>
        )}

        {!embedded && (
          <div className="absolute right-4 top-4 z-20 flex items-center gap-2 sm:right-6">
            <button
              type="button"
              onClick={() => router.push(localizePath("/ips", locale))}
              aria-label={t("exit")}
              className="flex size-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
            >
              <IconX className="size-5" />
            </button>
          </div>
        )}
      </section>
      <TvRightRail ipId={item?.id ?? null} />
    </div>
  );
}
