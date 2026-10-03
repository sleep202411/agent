"use client";

import { CrewLinkIp } from "./crew-link-ip";
import { CrewStudioWorkspacePicker } from "../[id]/workspace/_components/workbench/crew-studio-workspace-picker";
import { IconArrowUpRight } from "@tabler/icons-react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCrewLinkedIps } from "../_hooks/use-crew-linked-ips";
import { useCrewProductionOverview } from "../_hooks/use-production";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { getStudioHref } from "@/src/lib/region/cell";
import { Button } from "@/components/ui/button";
import { crewApi } from "../_hooks/api";

type Films = { items: { id: string; title: string }[]; nextCursor: string | null };
export function CrewLinkedResources({
  crewId,
  canManage = false,
}: {
  crewId: string;
  canManage?: boolean;
}) {
  const t = useTranslations("crewLinks");
  const locale = useLocale();
  const { user } = useCurrentUser();
  const ips = useCrewLinkedIps(crewId);
  const overview = useCrewProductionOverview(crewId, Boolean(user));
  const workspace = !overview.isError ? overview.data?.studioWorkspace : undefined;
  const linkedIpId = !ips.isError && ips.data?.length === 1 ? ips.data[0]?.id : undefined;
  const films = useInfiniteQuery({
    queryKey: ["crew-linked-films", crewId, workspace?.id, linkedIpId, user?.id],
    enabled: Boolean(workspace && user && linkedIpId),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const result = await crewApi.get<{ code: number; msg?: string; data: Films }>(
        "/story-projects",
        {
          signal,
          cache: "no-store",
          query: { workspaceId: workspace!.id, linkedIpId, limit: 30, cursor: pageParam },
        }
      );
      if (result.code !== 200) throw new Error(result.msg || `Studio error ${result.code}`);
      return result.data;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const studio = getStudioHref(locale).replace(/\/$/, "");
  return (
    <section className="space-y-5" aria-label={t("title")}>
      <h2 className="text-base font-semibold">{t("title")}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <section className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold">{t("ip")}</h3>
          {ips.isError ? (
            <p role="alert" className="text-sm">
              {ips.error.message}
            </p>
          ) : ips.isPending ? (
            <p>{t("loading")}</p>
          ) : ips.data?.length ? (
            ips.data.map((ip, index) => (
              <Link
                key={ip.id}
                href={`/${locale}/ips/${encodeURIComponent(ip.id)}`}
                className="group flex items-center justify-between gap-2 rounded-md bg-white/5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 break-words">{t("openIp", { number: index + 1 })}</span>
                <IconArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("none")}</p>
              {canManage && user && <CrewLinkIp crewId={crewId} userId={user.id} />}
            </div>
          )}
        </section>
        <section className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold">{t("workspace")}</h3>
          {overview.isError ? (
            <p role="alert" className="text-sm">
              {overview.error.message}
            </p>
          ) : overview.isPending ? (
            <p>{t("loading")}</p>
          ) : workspace ? (
            <a
              href={`${studio}/projects?ws=${encodeURIComponent(workspace.id)}`}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center justify-between gap-2 rounded-md bg-white/5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 break-words">{workspace.name}</span>
              <IconArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
            </a>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("none")}</p>
              {overview.data?.capabilities.linkWorkspace && (
                <CrewStudioWorkspacePicker
                  crewId={crewId}
                  value={null}
                  legacyProject={overview.data?.studioProject ?? null}
                  disabled={false}
                />
              )}
            </div>
          )}
        </section>
        <section className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold">{t("films")}</h3>
          {films.isError ? (
            <p role="alert" className="text-sm">
              {films.error.message}
            </p>
          ) : films.isFetching && !films.data ? (
            <p>{t("loading")}</p>
          ) : films.data?.pages.some((page) => page.items.length) ? (
            films.data.pages
              .flatMap((page) => page.items)
              .map((film) => (
                <a
                  key={film.id}
                  href={`${studio}/story-studio/projects/${encodeURIComponent(film.id)}/canvas?ws=${encodeURIComponent(workspace!.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center justify-between gap-2 rounded-md bg-white/5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 break-words">{film.title}</span>
                  <IconArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                </a>
              ))
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("none")}</p>
              {canManage && (
                <>
                  <p className="text-xs leading-relaxed text-muted-foreground">{t("filmsHint")}</p>
                  {workspace && (
                    <Button asChild variant="outline" color="muted" size="sm">
                      <a
                        href={`${studio}/projects?ws=${encodeURIComponent(workspace.id)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("openStudio")}
                        <IconArrowUpRight className="size-4" />
                      </a>
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
          {films.hasNextPage && (
            <Button
              variant="ghost"
              disabled={films.isFetching}
              onClick={() => void films.fetchNextPage()}
            >
              {t("more")}
            </Button>
          )}
        </section>
      </div>
      {(ips.isError || overview.isError || films.isError) && (
        <Button
          variant="outline"
          onClick={() => {
            if (ips.isError) void ips.refetch();
            if (overview.isError) void overview.refetch();
            if (films.isError) void films.refetch();
          }}
        >
          {t("retry")}
        </Button>
      )}
    </section>
  );
}
