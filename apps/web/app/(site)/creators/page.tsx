"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  IconArrowRight,
  IconBrandWechat,
  IconLoader2,
  IconSearch,
  IconSparkles,
  IconUserCircle,
  IconX,
} from "@tabler/icons-react";
import { useCreators, useCreatorSearch } from "@/app/(site)/creators/_hooks/use-creator";
import { CreatorsTalentGrid } from "@/app/(site)/creators/_components/creators-talent-grid";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PlazaHero } from "@/components/layout/plaza-hero";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

/**
 * Group QR card visible until `WECHAT_GROUP_EXPIRES_AT`. Drop the latest
 * QR PNG at `public/wechat-group.png` (current 7-day token, replaced
 * weekly during the recruiting push) and bump the expiry date here.
 * After the date passes the card hides itself — no stale invite shown.
 */
const WECHAT_GROUP_QR_SRC = "/wechat-group.png";
const WECHAT_GROUP_EXPIRES_AT = "2026-05-05";

function isQrActive(now: Date = new Date()): boolean {
  const expiry = new Date(`${WECHAT_GROUP_EXPIRES_AT}T23:59:59`);
  if (Number.isNaN(expiry.getTime())) return false;
  return now <= expiry;
}

export default function CreatorsPage() {
  const t = useTranslations("creator");
  const locale = useLocale() as Locale;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [search]);
  const isSearching = debouncedSearch.length > 0;

  // Both queries are declared; only the active one fetches (search is gated
  // on a non-empty term). The page renders whichever matches the input.
  const listQuery = useCreators();
  const searchQuery = useCreatorSearch(debouncedSearch, isSearching);
  const active = isSearching ? searchQuery : listQuery;
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isError,
    isFetching,
    isFetchNextPageError,
    refetch,
  } = active;

  const creators = data?.list ?? [];
  const showQr = isQrActive();

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage && !isError) {
          fetchNextPage();
        }
      },
      { rootMargin: "320px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isError]);

  return (
    <div className="min-h-screen bg-background">
      <PlazaHero
        eyebrow={{ icon: IconSparkles, label: t("plaza"), meta: t("eyebrowMeta") }}
        title={{ plain: t("heroTitle"), accent: t("heroTitleAccent") }}
        subtitle={t("heroSubtitle")}
        stats={{ items: [], cap: t("openCountCap") }}
        rightSlot={
          <>
            {showQr && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("groupQrTitle")}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-medium text-emerald-300 backdrop-blur-md transition-colors hover:border-emerald-300/40 hover:bg-emerald-300/10 hover:text-emerald-200"
                  >
                    <IconBrandWechat className="size-5" />
                    <span>{t("creatorCommunity")}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 gap-3 p-4">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                    <IconBrandWechat className="size-3.5" />
                    {t("groupQrEyebrow")}
                  </div>
                  <div className="overflow-hidden rounded-lg bg-white">
                    <img
                      src={WECHAT_GROUP_QR_SRC}
                      alt={t("groupQrAlt")}
                      className="block aspect-square w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <p className="text-center text-xs font-medium text-foreground">
                    {t("groupQrTitle")}
                  </p>
                  <p className="-mt-2 text-center text-[10px] text-muted-foreground">
                    {t("groupQrExpiry", { date: WECHAT_GROUP_EXPIRES_AT })}
                  </p>
                </PopoverContent>
              </Popover>
            )}

            <Link
              href={localizePath("/profile", locale)}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/5 px-4 py-2 text-sm font-medium text-amber-300 backdrop-blur-md transition-colors hover:border-amber-300/50 hover:bg-amber-400/10 hover:text-amber-200"
            >
              <IconUserCircle className="size-4" />
              <span>{t("completeProfileCta")}</span>
              <IconArrowRight className="size-3.5" />
            </Link>
          </>
        }
      />
      <div className="mx-auto max-w-screen-2xl px-6 pt-8">
        <div className="relative w-full sm:max-w-md">
          <IconSearch className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="h-12 rounded-full border-white/10 bg-white/[0.03] pl-12 pr-12 text-base focus-visible:bg-white/[0.05]"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label={t("clearSearch")}
              className="absolute right-3 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <IconX className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      {isError && (
        <div role="alert" className="mx-auto max-w-screen-2xl px-6 py-6 text-muted-foreground">
          <p>{t("directoryLoadFailed")}</p>
          <button
            type="button"
            disabled={isFetching}
            onClick={() => {
              void (isFetchNextPageError ? fetchNextPage() : refetch());
            }}
            className="mt-3 rounded-full border border-white/10 px-4 py-2 text-foreground disabled:opacity-50"
          >
            {t("directoryRetry")}
          </button>
        </div>
      )}
      {(!isError || creators.length > 0) && (
        <CreatorsTalentGrid
          creators={creators}
          isLoading={isLoading}
          emptyMessage={isSearching ? t("noResults") : undefined}
        />
      )}
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      {isFetchingNextPage && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <IconLoader2 className="size-5 animate-spin" />
        </div>
      )}
    </div>
  );
}
