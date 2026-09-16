"use client";

import { useAuth } from "@/app/_components/auth-provider";

import { IconAlertTriangle, IconPlus, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";
import {
  listStoryAssetSpecs,
  storyProductionKeys,
  type StoryAssetSpec,
  type StoryAssetSpecKind,
} from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { useStoryChapterWorkbench } from "../_lib/use-story-chapter-workbench";
import { StoryAssetSpecCard } from "./story-asset-spec-card";
import { StoryAssetSpecCreateDialog } from "./story-asset-spec-create-dialog";
import { StoryAssetBatchGeneration } from "./story-asset-batch-generation";
import {
  StoryProductionGenerationControls,
  StoryProductionPageHeader,
} from "./story-production-page-header";
import { StoryStageEmptyState, StoryStageLoadingState } from "./story-stage-empty-state";

const TABS: StoryAssetSpecKind[] = ["character", "location", "prop"];

/** Chapter-scoped logical Asset Specs. A spec remains usable by @stable-key
 * before any media exists; this view never starts paid generation on load. */
export function StoryAssetsGallery({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const chapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  return (
    <StoryAssetsGalleryContent
      key={JSON.stringify([projectId, chapterId, user?.id ?? null])}
      projectId={projectId}
    />
  );
}

function StoryAssetsGalleryContent({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const t = useTranslations("storyStudio.assetsPage");
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workbenchQuery = useStoryChapterWorkbench(projectId);
  const [createOpen, setCreateOpen] = useState(false);
  const kindParam = searchParams.get("kind");
  const active: StoryAssetSpecKind = TABS.includes(kindParam as StoryAssetSpecKind)
    ? (kindParam as StoryAssetSpecKind)
    : "character";
  const assetsQuery = useQuery({
    queryKey: storyProductionKeys.assets(projectId, activeChapterId, user?.id ?? null),
    queryFn: ({ signal }) => listStoryAssetSpecs(projectId, activeChapterId as string, signal),
    enabled: Boolean(projectId && activeChapterId && user),
    retry: false,
  });
  const setTab = (tab: StoryAssetSpecKind) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("kind", tab);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const assets = (assetsQuery.data ?? []).filter((asset) => asset.kind === active);
  const assetsWithoutMedia = assets.filter(isAvailableForBatchGeneration);
  const loading = assetsQuery.isPending;
  const error = assetsQuery.error;
  const canEdit = Boolean(workbenchQuery.data?.project.capabilities.includes("story.edit"));
  // Asset Specs are creator-owned chapter resources. Plot/plan state only
  // governs what FizzAgent may derive automatically; it must never lock the
  // manual media workbench.
  const generationAllowed = canEdit;
  return (
    <main aria-busy={loading} className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-4 py-4">
          <StoryProductionPageHeader
            projectId={projectId}
            title={t("title")}
            description={t("generationHint")}
            meta={assetsQuery.data ? t("count", { count: assetsQuery.data.length }) : null}
            modalities={["image"]}
            showGenerationControls={false}
          />

          {!loading && !error ? (
            <div className="mt-5 flex min-w-0 flex-wrap items-center gap-3">
              <nav
                className="inline-flex shrink-0 gap-1 rounded-2xl bg-white/[0.035] p-1.5"
                aria-label={t("filterLabel")}
              >
                {TABS.map((tab) => {
                  return (
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
                  );
                })}
              </nav>
              {activeChapterId && generationAllowed ? (
                <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3">
                  <StoryProductionGenerationControls
                    projectId={projectId}
                    modalities={["image"]}
                    appearance="plain"
                  />
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="primary-ghost"
                      className="shrink-0"
                      onClick={() => setCreateOpen(true)}
                    >
                      <IconPlus />
                      {t(`addByKind.${active}`)}
                    </Button>
                  ) : null}
                  <StoryAssetBatchGeneration
                    projectId={projectId}
                    chapterId={activeChapterId}
                    assets={assetsWithoutMedia}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {loading ? <StoryStageLoadingState label={t("loading")} /> : null}

          {error ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <IconAlertTriangle className="size-6 text-white/58" aria-hidden="true" />
              <p role="alert" className="mt-3 max-w-lg text-sm text-white/72">
                {storyApiErrorMessage(error, t("loadError"))}
              </p>
              <Button
                variant="secondary"
                className="mt-5"
                onClick={() => {
                  void assetsQuery.refetch();
                }}
              >
                <IconRefresh />
                {t("retry")}
              </Button>
            </div>
          ) : null}

          {!loading && !error && activeChapterId ? (
            <>
              {assets.length > 0 ? (
                <div
                  className={cn(
                    "mt-3",
                    active !== "character" && "grid items-stretch gap-3 lg:grid-cols-2"
                  )}
                >
                  {assets.map((asset, index) => (
                    <StoryAssetSpecCard
                      key={asset.id}
                      asset={asset}
                      projectId={projectId}
                      chapterId={activeChapterId}
                      allowEditing={canEdit}
                      allowGeneration={generationAllowed}
                      allowMediaReplacement={canEdit}
                      eagerMedia={index < 4}
                    />
                  ))}
                </div>
              ) : (
                <StoryStageEmptyState
                  title={t(`categoryEmpty.${active}`)}
                  description={t("categoryEmptyHint")}
                />
              )}
            </>
          ) : null}
        </div>
      </div>
      {createOpen && activeChapterId ? (
        <StoryAssetSpecCreateDialog
          projectId={projectId}
          chapterId={activeChapterId}
          initialKind={active}
          open
          onOpenChange={setCreateOpen}
        />
      ) : null}
    </main>
  );
}

const ACTIVE_GENERATION_STATUSES = new Set(["created", "in_queue", "in_progress"]);
const ACTIVE_MATERIALIZATION_STATUSES = new Set(["waiting_for_job", "pending"]);

function isAvailableForBatchGeneration(asset: StoryAssetSpec) {
  if (asset.status === "archived" || asset.selectedMediaVersion !== null) return false;
  const latest = asset.latestGenerations?.primary ?? asset.latestGeneration;
  if (!latest) return true;
  if (ACTIVE_GENERATION_STATUSES.has(latest.aiJob.status)) return false;
  return !(
    latest.aiJob.status === "completed" &&
    ACTIVE_MATERIALIZATION_STATUSES.has(latest.materialization.status)
  );
}
