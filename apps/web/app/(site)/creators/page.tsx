"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  IconArrowRight,
  IconLoader2,
  IconSearch,
  IconUserCircle,
  IconX,
} from "@tabler/icons-react";
import { useCreators, useCreatorSearch } from "@/app/(site)/creators/_hooks/use-creator";
import { CreatorsTalentGrid } from "@/app/(site)/creators/_components/creators-talent-grid";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import {
  creatorQualificationKind,
  type CreatorQualificationKind,
} from "@/src/services/creator-qualification";
import type { Locale } from "@/src/i18n/config";

export default function CreatorsPage() {
  const t = useTranslations("creator");
  const locale = useLocale() as Locale;

  const [qualification, setQualification] = useState<"all" | CreatorQualificationKind>("all");
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

  const creators = (data?.list ?? []).filter(
    (creator) =>
      qualification === "all" ||
      creator.levels.some((level) => creatorQualificationKind(level) === qualification)
  );

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
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isError, creators.length]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-6 pt-8">
        <h1 className="text-2xl font-semibold">{t("plaza")}</h1>
        <Link
          href={localizePath("/profile", locale)}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <IconUserCircle className="size-4" />
          {t("completeProfileCta")}
          <IconArrowRight className="size-4" />
        </Link>
      </div>
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
      <div className="mx-auto max-w-screen-2xl px-6 pt-4">
        <label className="inline-flex items-center gap-3 text-sm text-muted-foreground">
          {t("qualificationFilter")}
          <NativeSelect
            aria-label={t("qualificationFilter")}
            value={qualification}
            onChange={(value) => setQualification(value as "all" | CreatorQualificationKind)}
            className="rounded-lg border border-white/10 bg-background px-3 py-2 text-foreground"
          >
            <NativeSelectOption value="all">{t("qualificationAll")}</NativeSelectOption>
            <NativeSelectOption value="fd">{t("qualificationFd")}</NativeSelectOption>
            <NativeSelectOption value="producer">{t("qualificationProducer")}</NativeSelectOption>
            <NativeSelectOption value="skill">{t("qualificationSkill")}</NativeSelectOption>
          </NativeSelect>
        </label>
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
          emptyMessage={
            hasNextPage
              ? t("noMatchesLoaded")
              : isSearching || qualification !== "all"
                ? t("noResults")
                : undefined
          }
        />
      )}
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      {hasNextPage && !isError && (
        <div className="flex justify-center py-4">
          <button
            type="button"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
            className="rounded-full border border-white/10 px-4 py-2 text-sm disabled:opacity-50"
          >
            {t("loadMore")}
          </button>
        </div>
      )}
      {isFetchingNextPage && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <IconLoader2 className="size-5 animate-spin" />
        </div>
      )}
    </div>
  );
}
