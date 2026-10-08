"use client";

import { useState } from "react";
import Link from "next/link";
import { IconHeart } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { defaultLocale, isValidLocale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";
import type { CrewPositionDTO } from "@/app/(site)/crews/_hooks/use-crew";

type Page = {
  items: { position: CrewPositionDTO; crew: { id: string; name: string } }[];
  nextCursor: string | null;
};
export function SavedJobsMenu() {
  const [open, setOpen] = useState(false);
  const { user } = useCurrentUser();
  const currentLocale = useLocale();
  const locale = isValidLocale(currentLocale) ? currentLocale : defaultLocale;
  const t = useTranslations("savedJobsMenu");
  const nav = useTranslations("nav");
  const positionLabel = useTranslatePositionValue();
  const query = useInfiniteQuery({
    queryKey: ["crew", "positions", "saved-menu", user?.id],
    enabled: open && Boolean(user),
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<Page>("/positions", {
        signal,
        cache: "no-store",
        query: { saved: "true", limit: 20, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={nav("savedJobsShortcut")}
          title={t("title")}
          className="flex size-11 items-center justify-center rounded-full border border-white/15 text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <IconHeart aria-hidden className="size-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-0">
        <h2 className="p-4 text-sm font-semibold">{t("title")}</h2>
        <div className="max-h-96 overflow-y-auto">
          {query.isPending && (
            <p role="status" className="p-4">
              {t("loading")}
            </p>
          )}
          {query.isError ? (
            <div className="p-4">
              <p role="alert">{query.error.message}</p>
              <button onClick={() => void query.refetch()}>{t("retry")}</button>
            </div>
          ) : (
            items.map(({ position, crew }) => (
              <Link
                key={position.id}
                href={localizePath(`/crews/${crew.id}/positions/${position.id}`, locale)}
                onClick={() => setOpen(false)}
                className="block px-4 py-3 hover:bg-white/10"
              >
                <p className="font-medium">{positionLabel(position.positionType)}</p>
                <p className="mt-1 text-muted-foreground">{crew.name}</p>
              </Link>
            ))
          )}
          {!query.isPending && !query.isError && !items.length && (
            <p className="p-4 text-muted-foreground">{t("empty")}</p>
          )}
          {query.hasNextPage && (
            <button
              className="w-full p-3"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("more")}
            </button>
          )}
        </div>
        <Link
          className="p-4 text-center"
          href={localizePath("/crews?view=positions&saved=true", locale)}
          onClick={() => setOpen(false)}
        >
          {t("all")}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
