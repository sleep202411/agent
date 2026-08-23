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
import { StoryProductionPageHeader } from "./story-production-page-header";

const TABS: StoryAssetSpecKind[] = ["character", "location", "prop"];

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
  const active: StoryAssetSpecKind = TABS.includes(kindParam as StoryAssetSpecKind)
    ? (kindParam as StoryAssetSpecKind)
    : "character";

  const assetsQuery = useQuery({
    queryKey: storyProductionKeys.assets(workspaceId, projectId, activeChapterId),
    queryFn: ({ signal }) =>
      listStoryAssetSpecs(workspaceId as string, projectId, activeChapterId as string, signal),
    enabled: Boolean(workspaceId && activeChapterId),
    retry: false,
  });

  const setTab = (tab: StoryAssetSpecKind) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("kind", tab);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const assets = (assetsQuery.data ?? []).filter((asset) => asset.kind === active);
  // Every kind renders the minimal media card; the lane width tracks each
  // kind's media shape (character 3:4, location 16:9, prop 1:1).
  const gridClass =
    active === "character"
      ? "grid-cols-[repeat(auto-fill,minmax(min(180px,100%),1fr))]"
      : active === "location"
        ? "grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))]"
        : "grid-cols-[repeat(auto-fill,minmax(min(200px,100%),1fr))]";
  const loading = workspaceLoading || (Boolean(workspaceId) && assetsQuery.isPending);

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-6 py-6">
          <StoryProductionPageHeader
            title={t("title")}
            description={t("generationHint")}
            meta={assetsQuery.data ? t("count", { count: assetsQuery.data.length }) : null}
            modalities={["image"]}
          />

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
            <div className={cn("mt-5 grid gap-4", gridClass)}>
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="h-72 rounded-2xl" />
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
              <div className={cn("mt-5 grid items-start gap-4", gridClass)}>
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
