"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconX } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useTvIps } from "../_hooks/use-tv-ips";
import { TvStage } from "./tv-stage";
import { TvIpList } from "./tv-ip-list";
import { TvInfoBar } from "./tv-info-bar";
import { TvEmptyState, TvErrorState, TvLoadingState } from "./tv-empty";

export function TvApp({ embedded = false }: { embedded?: boolean }) {
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [nextError, setNextError] = useState<string | null>(null);
  const navigationVersion = useRef(0);
  const searchEpoch = useRef(debouncedSearch);

  // New search results replace the channel catalog — jump to the first hit.
  if (searchEpoch.current !== debouncedSearch) {
    searchEpoch.current = debouncedSearch;
    if (selectedId !== null) {
      setSelectedId(null);
      setIsPlaying(false);
    }
  }

  const item = items.find((entry) => entry.id === selectedId) ?? items[0];
  // Remember the initial channel so a catalog refresh cannot change it.
  if (item && item.id !== selectedId) {
    setSelectedId(item.id);
    setIsPlaying(false);
  }
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
      // Continue through catalog pages; cover-only IPs remain manually selectable.
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
    <div className="flex w-full flex-col overflow-hidden bg-[#0c0e13] px-3 md:h-full md:flex-row md:px-6">
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
        className="relative flex min-w-0 flex-col overflow-hidden md:flex-1"
      >
        <div className="relative aspect-video shrink-0 md:aspect-auto md:min-h-0 md:flex-1">
          {item ? (
            <TvStage
              item={item}
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
            />
          ) : isLoading ? (
            <TvLoadingState />
          ) : isError ? (
            <TvErrorState message={errorMessage} onRetry={() => void refetch()} />
          ) : (
            <TvEmptyState />
          )}
        </div>
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
    </div>
  );
}
