"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { IpStudioResultSchema, type IpStudioResult } from "@repo/shared/creator-location";
import { api } from "@/src/lib/api";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { Button } from "@/components/ui/button";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";

export function IpContributingStudios({
  ipId,
  viewerId,
}: {
  ipId: string;
  viewerId: string | null;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("contentGpsDiscovery");
  const auth = useAuthDialog();
  const query = useInfiniteQuery({
    queryKey: ["ip-contributing-studios", ipId, viewerId, locale],
    initialPageParam: null as IpStudioResult["nextCursor"],
    queryFn: async ({ pageParam: cursor, signal }) => {
      const requestId = crypto.randomUUID();
      const result = IpStudioResultSchema.parse(
        await api.post("/aurora/ip-commerce/content-gps/studios", {
          data: { requestId, ipId, locale, limit: 20, cursor },
          signal,
          credentials: viewerId ? "include" : "omit",
        })
      );
      if (
        signal.aborted ||
        result.requestId !== requestId ||
        result.ipId !== ipId ||
        result.locale !== locale ||
        (cursor && result.queryId !== cursor.queryId) ||
        (result.nextCursor && result.nextCursor.queryId !== result.queryId)
      )
        throw new Error(t("responseMismatch"));
      return result;
    },
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: 30_000,
  });
  // Never show cached relationship claims during a permission recheck or failure.
  const pages = !query.isError && !query.isRefetching ? query.data?.pages : undefined;
  const items = pages?.flatMap((page) => page.items) ?? [];
  return (
    <section className="space-y-3 pt-4" aria-label={t("studiosTitle")}>
      <h3 className="text-sm font-semibold">{t("studiosTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("studiosDescription")}</p>
      {query.isError ? (
        <div role="alert">
          <p className="text-sm">{query.error.message}</p>
          <Button variant="ghost" onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !pages ? (
        <p role="status">{t("loading")}</p>
      ) : !items.length ? (
        <p className="text-sm text-muted-foreground">{t("studiosEmpty")}</p>
      ) : (
        <ul className="space-y-4">
          {items.map(({ studio, roles }) => (
            <li key={studio.id} className="space-y-2">
              <Link
                className="font-medium underline"
                href={localizePath(`/creators/${encodeURIComponent(studio.id)}`, locale)}
              >
                {studio.name}
              </Link>
              <p className="text-xs text-muted-foreground">
                {roles
                  .map((role) => role.customRole || t(`contributorRoles.${role.role}`))
                  .join(" · ")}
              </p>
              {studio.basedIn && (
                <p className="text-xs">{t("studioBasedIn", { city: studio.basedIn.city })}</p>
              )}
              {studio.remote && <p className="text-xs">{t("studioRemote")}</p>}
              <div className="flex flex-wrap gap-3 text-xs">
                <Link
                  className="underline"
                  href={`${localizePath(`/creators/${encodeURIComponent(studio.id)}`, locale)}#services`}
                >
                  {t("studioServices", { count: studio.serviceCount })}
                </Link>
                <Link
                  className="underline"
                  href={`${localizePath("/creators/studios", locale)}?selected=${encodeURIComponent(studio.id)}`}
                >
                  {t("studioDiscovery")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      {pages && query.hasNextPage && (
        <Button
          variant="ghost"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("studiosMore")}
        </Button>
      )}
      {pages?.some((page) => page.requiresLogin) && (
        <Button variant="ghost" onClick={() => auth.open()}>
          {t("studiosLogin")}
        </Button>
      )}
    </section>
  );
}
