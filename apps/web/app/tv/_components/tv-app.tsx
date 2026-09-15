"use client";
import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ipRoomPath } from "@/src/lib/ip-commerce/urls";
import { IconX } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useTvIps, useTvSelectedIp } from "../_hooks/use-tv-ips";
import { EpisodeFeedback } from "@/app/(site)/ips/_components/episode-feedback";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TvGames } from "./tv-games";
import { TvStage } from "./tv-stage";
import { TvIpList } from "./tv-ip-list";
import { TvInfoBar } from "./tv-info-bar";
import { TvEmptyState, TvErrorState, TvLoadingState } from "./tv-empty";
import { TvRightRail } from "./tv-right-rail";

export function TvApp({ embedded = false }: { embedded?: boolean }) {
  const { user } = useCurrentUser();
  const t = useTranslations("tvGames");
  const tv = useTranslations("tv");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [mode, setMode] = useState<"videos" | "games">("videos");
  return (
    <div className="flex min-h-full min-w-0 max-w-full flex-col lg:h-full lg:min-h-0 bg-[#0c0e13] text-white">
      <div role="group" aria-label={t("catalog")} className="flex shrink-0 gap-1 px-4 py-2">
        {(["videos", "games"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className="min-h-11 rounded-full px-3 text-sm font-medium leading-5 text-white/60 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-pressed:bg-white/10 aria-pressed:text-white"
          >
            {t(value)}
          </button>
        ))}
      </div>
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
        <TvVideoApp key={user?.id ?? "guest"} embedded={embedded} />
      ) : (
        <TvGames />
      )}
    </div>
  );
}

function TvVideoApp({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations("tv");
  const locale = useLocale() as Locale;
  const router = useRouter();
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
    null
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const listedItem = items.find((entry) => entry.id === selectedId) ?? items[0];
  const detail = useTvSelectedIp(listedItem?.id);
  const item = detail.item ?? listedItem;
  // Remember the initial channel so a catalog refresh cannot change it.
  if (item && item.id !== selectedId) {
    setSelectedId(item.id);
    setIsPlaying(false);
  }
  const episode =
    episodeChoice?.ipId === item?.id
      ? item?.episodes?.find((entry) => entry.id === episodeChoice.episodeId)
      : undefined;
  const playbackItem =
    item && episode ? { ...item, trailer: episode.video, trailerType: episode.videoType } : item;
  const errorMessage = error instanceof Error ? error.message : undefined;
  const index = items.findIndex((entry) => entry.id === item?.id);
  const hasNext = hasNextPage || items.slice(index + 1).some((entry) => entry.trailer);

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
        onSearchChange={setSearch}
      />
      <section
        aria-label={t("playerTitle")}
        className="relative flex min-w-0 shrink-0 flex-col lg:flex-1 lg:overflow-hidden"
      >
        <div className="relative aspect-video shrink-0 lg:aspect-auto lg:min-h-0 lg:flex-1">
          {item ? (
            <TvStage
              item={playbackItem!}
              onPlaybackChange={(playing) => {
                setIsPlaying(playing);
                if (playing) {
                  navigationVersion.current += 1;
                  setAdvancing(false);
                }
              }}
              onNext={hasNext ? () => void nextChannel() : undefined}
              advancing={advancing}
              navigationError={nextError}
              onRefreshSource={() => void detail.refetch()}
            />
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
        {item && Boolean(item.episodes?.length) && (
          <div className="shrink-0 space-y-2 px-4 py-2">
            <p className="text-xs text-white/60">{t("episodeSelector")}</p>
            <NativeSelect
              aria-label={t("episodeSelector")}
              value={episode?.id ?? ""}
              onChange={(episodeId) => {
                navigationVersion.current += 1;
                setAdvancing(false);
                setNextError(null);
                setIsPlaying(false);
                setEpisodeChoice(episodeId ? { ipId: item.id, episodeId } : null);
              }}
            >
              <NativeSelectOption value="">{t("preview")}</NativeSelectOption>
              {item.episodes?.map((entry) => (
                <NativeSelectOption key={entry.id} value={entry.id}>
                  {entry.number}. {entry.title}
                  {entry.locked
                    ? ` · ${t("lockedEpisode")}`
                    : !entry.video
                      ? ` · ${t("videoUnavailable")}`
                      : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
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
            {episode && Boolean(episode.video) && episode.number >= 1 && episode.number <= 3 && (
              <EpisodeFeedback ipId={item.id} episodeId={episode.id} />
            )}
          </div>
        )}
        {item && <TvInfoBar item={item} />}

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
