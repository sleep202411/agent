"use client";

import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useWorkspace } from "@/app/_components/workspace-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePathname, useRouter } from "@/i18n/navigation";
import {
  listStoryAssetSpecs,
  storyProductionKeys,
  type StoryAssetSpecKind,
} from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { StoryAssetSpecCard } from "./story-asset-spec-card";

type TabKey = "all" | StoryAssetSpecKind;

const TABS: TabKey[] = ["all", "character", "location", "prop"];

/** Chapter-scoped logical Asset Specs. A spec remains usable by @stable-key
 * before any media exists; this view never starts paid generation on load. */
export function StoryAssetsGallery({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio.assetsPage");
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const kindParam = searchParams.get("kind");
  const active: TabKey = TABS.includes(kindParam as TabKey) ? (kindParam as TabKey) : "all";

  const assetsQuery = useQuery({
    queryKey: storyProductionKeys.assets(workspaceId, projectId, activeChapterId),
    queryFn: ({ signal }) =>
      listStoryAssetSpecs(workspaceId as string, projectId, activeChapterId as string, signal),
    enabled: Boolean(workspaceId && activeChapterId),
    retry: false,
  });

  const setTab = (tab: TabKey) => {
    const next = new URLSearchParams(searchParams.toString());
    if (tab === "all") next.delete("kind");
    else next.set("kind", tab);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const assets =
    active === "all"
      ? (assetsQuery.data ?? [])
      : (assetsQuery.data ?? []).filter((asset) => asset.kind === active);
  const loading = workspaceLoading || (Boolean(workspaceId) && assetsQuery.isPending);

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-6 py-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-sm leading-6 text-white/72">{t("logicalHint")}</p>
              <p className="mt-1 text-xs text-white/64">{t("generationHint")}</p>
            </div>
            {assetsQuery.data ? (
              <span className="text-xs font-medium tabular-nums text-white/58">
                {t("count", { count: assetsQuery.data.length })}
              </span>
            ) : null}
          </div>

          <nav
            className="mt-5 inline-flex max-w-full flex-wrap gap-1 rounded-2xl bg-white/[0.035] p-1.5"
            aria-label={t("filterLabel")}
          >
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={active === tab}
                onClick={() => setTab(tab)}
                className={cn(
                  "inline-flex h-9 items-center rounded-xl px-3.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
                  active === tab
                    ? "bg-white/[0.12] text-white shadow-sm"
                    : "text-white/58 hover:bg-white/[0.06] hover:text-white/88"
                )}
              >
                {t(`tabs.${tab}`)}
              </button>
            ))}
          </nav>

          {loading ? (
            <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(min(560px,100%),1fr))] gap-4">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="h-56 rounded-2xl" />
              ))}
            </div>
          ) : null}

          {assetsQuery.isError ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <IconAlertTriangle className="size-6 text-white/58" aria-hidden="true" />
              <p className="mt-3 max-w-lg text-sm text-white/72">
                {storyApiErrorMessage(assetsQuery.error, t("loadError"))}
              </p>
              <Button
                variant="secondary"
                className="mt-5"
                onClick={() => void assetsQuery.refetch()}
              >
                <IconRefresh />
                {t("retry")}
              </Button>
            </div>
          ) : null}

          {!loading && !assetsQuery.isError && workspaceId && activeChapterId ? (
            assets.length > 0 ? (
              <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(min(560px,100%),1fr))] items-start gap-4">
                {assets.map((asset) => (
                  <StoryAssetSpecCard
                    key={`${asset.id}:${asset.version}`}
                    asset={asset}
                    workspaceId={workspaceId}
                    projectId={projectId}
                    chapterId={activeChapterId}
                  />
                ))}
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center text-center">
                <div>
                  <p className="text-sm font-medium text-white/72">{t("empty")}</p>
                  <p className="mt-1.5 text-xs text-white/64">{t("emptyHint")}</p>
                </div>
              </div>
            )
          ) : null}
        </div>
      </div>
    </main>
  );
}
