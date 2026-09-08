"use client";

import { useState } from "react";
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
  const {
    items,
    isLoading,
    isError,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useTvIps();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const item = items.find((entry) => entry.id === selectedId) ?? items[0];
  // Remember the initial channel so a catalog refresh cannot change it.
  if (item && item.id !== selectedId) {
    setSelectedId(item.id);
    setIsPlaying(false);
  }
  const errorMessage = error instanceof Error ? error.message : undefined;

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
        onSelect={(id) => {
          if (id !== selectedId) {
            setSelectedId(id);
            setIsPlaying(false);
          }
        }}
        hasMore={hasNextPage}
        isLoadingMore={isFetchingNextPage}
        onLoadMore={() => void fetchNextPage()}
      />
      <section
        aria-label={t("playerTitle")}
        className="relative flex min-w-0 flex-col overflow-hidden md:flex-1"
      >
        <div className="relative aspect-video shrink-0 md:aspect-auto md:min-h-0 md:flex-1">
          {item ? (
            <TvStage key={item.id} item={item} onPlaybackChange={setIsPlaying} />
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
