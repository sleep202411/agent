"use client";

import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  getStoryProductionState,
  getStoryStoryboard,
  storyProductionKeys,
} from "@/lib/story-production-api";
import {
  storyApiErrorMessage,
  type StoryClipGraphNode,
  type StoryGraphNode,
} from "@/lib/story-projects-api";
import { useStoryChapterWorkbench } from "../_lib/use-story-chapter-workbench";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { localizedText } from "./project-canvas/story-project-canvas-model";
import { StoryProductionPageHeader } from "./story-production-page-header";
import {
  storyStoryboardStageGuidance,
  storyStoryboardStageHasStaleContent,
} from "./story-production-stage-guidance";
import {
  StoryStageEmptyState,
  StoryStageLoadingState,
  StoryStageNotice,
} from "./story-stage-empty-state";
import {
  StoryStoryboardChoiceCard,
  StoryStoryboardSequenceSection,
  StoryStoryboardUnplannedSection,
  type StorySequenceChoiceOptions,
} from "./story-storyboard-sequence-section";

/**
 * Chapter-owned production board. The chapter graph is the board's skeleton —
 * every plot node renders one section in narrative (authoring) order, numbered
 * exactly like the catalog. A storyboard sequence fills its node's section;
 * a node that has never been planned shows an unplanned placeholder instead
 * of silently disappearing. A ?node= deep link (from the catalog or the
 * canvas) scrolls to its section.
 */
export function StoryStoryboardView({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio.storyboardPage");
  const chapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const workbenchQuery = useStoryChapterWorkbench(projectId, { chapterId });
  const searchParams = useSearchParams();

  const storyboardQuery = useQuery({
    queryKey: storyProductionKeys.storyboard(projectId, chapterId),
    queryFn: ({ signal }) => getStoryStoryboard(projectId, chapterId as string, signal),
    enabled: Boolean(chapterId),
    retry: false,
  });
  const productionQuery = useQuery({
    queryKey: storyProductionKeys.state(projectId, chapterId),
    queryFn: ({ signal }) => getStoryProductionState(projectId, chapterId as string, signal),
    enabled: Boolean(chapterId),
    retry: false,
  });

  const locale = useLocale();
  const nodes = useMemo(
    () => workbenchQuery.data?.draft.content.graph.nodes ?? [],
    [workbenchQuery.data?.draft.content.graph.nodes]
  );
  // Scene rows in authoring order — the same filter and numbering the catalog
  // uses, so "情节节点 N" here and "N." there always name the same scene.
  const sceneNodes = useMemo(
    () => nodes.filter((node): node is StoryClipGraphNode => node.kind === "clip"),
    [nodes]
  );
  const choiceOptionsByNode = useMemo(() => {
    const byId = new Map<string, StoryGraphNode>(nodes.map((node) => [node.nodeId, node]));
    const titleOf = (nodeId: string | null): string => {
      if (!nodeId) return "";
      const node = byId.get(nodeId);
      return (node && "name" in node && node.name?.trim()) || nodeId;
    };
    const options = new Map<string, StorySequenceChoiceOptions>();
    for (const node of nodes) {
      if (node.kind !== "clip" || node.exit.kind !== "choice") continue;
      options.set(node.nodeId, {
        prompt: localizedText(node.exit.prompt, locale, ""),
        choices: node.exit.choices.map((choice) => ({
          id: choice.choiceId,
          label: localizedText(choice.label, locale, choice.choiceId),
          target: titleOf(choice.nextNodeId),
        })),
      });
    }
    return options;
  }, [nodes, locale]);

  const sequenceByNode = useMemo(
    () => new Map((storyboardQuery.data ?? []).map((sequence) => [sequence.plotNodeId, sequence])),
    [storyboardQuery.data]
  );
  const orphanedSequences = useMemo(() => {
    const currentPlotNodeIds = new Set(sceneNodes.map((node) => node.nodeId));
    return (storyboardQuery.data ?? []).filter(
      (sequence) => !currentPlotNodeIds.has(sequence.plotNodeId)
    );
  }, [sceneNodes, storyboardQuery.data]);
  const requestedPlotNodeId = searchParams.get("node");
  const openAgentComposer = useStoryProjectUiStore((state) => state.openAgentComposer);

  const loading =
    workbenchQuery.isPending ||
    (Boolean(chapterId) && (storyboardQuery.isPending || productionQuery.isPending));

  // Consume the deep link exactly once, after the board has actually rendered
  // (both queries settled): refetches must not yank the viewport back to the
  // anchor.
  const consumedScrollTarget = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !requestedPlotNodeId || consumedScrollTarget.current === requestedPlotNodeId) {
      return;
    }
    const target = document.getElementById(`plot-${requestedPlotNodeId}`);
    if (!target) return;
    consumedScrollTarget.current = requestedPlotNodeId;
    target.scrollIntoView({ block: "start" });
  }, [requestedPlotNodeId, loading]);

  if (loading) {
    return (
      <main aria-busy="true" className="h-full min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <StoryStageLoadingState label={t("loading")} />
      </main>
    );
  }

  if (storyboardQuery.isError || workbenchQuery.isError || productionQuery.isError) {
    return (
      <main className="grid h-full min-w-0 flex-1 place-items-center px-6 text-center">
        <div>
          <IconAlertTriangle className="mx-auto size-6 text-white/58" aria-hidden="true" />
          <p role="alert" className="mt-3 max-w-lg text-sm text-white/72">
            {storyApiErrorMessage(
              storyboardQuery.error ?? workbenchQuery.error ?? productionQuery.error,
              t("loadError")
            )}
          </p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => {
              void storyboardQuery.refetch();
              void workbenchQuery.refetch();
              void productionQuery.refetch();
            }}
          >
            <IconRefresh />
            {t("retry")}
          </Button>
        </div>
      </main>
    );
  }

  if (!chapterId || !productionQuery.data) {
    return (
      <main className="grid h-full min-w-0 flex-1 place-items-center px-6 text-center">
        <div>
          <p className="text-sm font-medium text-white/72">{t("emptyChapter")}</p>
          <p className="mt-1.5 text-xs text-white/64">{t("emptyHint")}</p>
        </div>
      </main>
    );
  }

  const guidance = storyStoryboardStageGuidance(productionQuery.data, sceneNodes.length);
  const staleContent = storyStoryboardStageHasStaleContent(
    productionQuery.data,
    storyboardQuery.data?.length ?? 0
  );
  const resolvableStaleCount = (storyboardQuery.data ?? []).filter(
    (sequence) =>
      sequence.status === "stale" &&
      sequence.conflict !== null &&
      sequence.pendingSourceFingerprint === sequence.conflict.pendingSourceFingerprint
  ).length;
  const staleNeedsAgent =
    guidance === "plotRequired" ||
    guidance === "assetsRequired" ||
    (productionQuery.data.storyboard.staleCount ?? 0) > resolvableStaleCount;
  const generationAllowed =
    guidance === null && productionQuery.data.storyboard.status === "current";
  const canRequestScenePlanning =
    productionQuery.data.plotTree.status === "current" &&
    productionQuery.data.assets.status === "current";
  const showStoryboardRows = staleContent || (sceneNodes.length > 0 && guidance !== "plotRequired");

  if (guidance && !showStoryboardRows) {
    return (
      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <StoryProductionPageHeader
          projectId={projectId}
          title={t("title")}
          description={t("generationHint")}
          showGenerationControls={false}
        />
        <StoryStageEmptyState
          title={t(`stage.${guidance}.title`)}
          description={t(`stage.${guidance}.description`)}
          actionLabel={t("continueWithAgent")}
          prompt={t(`prompts.${guidance}`)}
        />
      </main>
    );
  }

  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      <StoryProductionPageHeader
        projectId={projectId}
        title={t("title")}
        description={t("generationHint")}
        showGenerationControls={generationAllowed && (storyboardQuery.data?.length ?? 0) > 0}
      />
      {staleContent ? (
        <div className="mt-5">
          <StoryStageNotice
            title={t("stage.stale.title", {
              count: productionQuery.data.storyboard.staleCount,
            })}
            description={t("stage.stale.description")}
            actionLabel={staleNeedsAgent ? t("continueWithAgent") : undefined}
            prompt={staleNeedsAgent && guidance ? t(`prompts.${guidance}`) : undefined}
          />
        </div>
      ) : guidance ? (
        <div className="mt-5">
          <StoryStageNotice
            title={t(`stage.${guidance}.title`)}
            description={t(`stage.${guidance}.description`)}
            actionLabel={t("continueWithAgent")}
            prompt={t(`prompts.${guidance}`)}
          />
        </div>
      ) : null}
      <div className="mt-5 space-y-8">
        {sceneNodes.map((node, index) => {
          const sequence = sequenceByNode.get(node.nodeId);
          const choiceOptions = choiceOptionsByNode.get(node.nodeId);
          return (
            <div key={node.nodeId} className="space-y-4">
              {sequence ? (
                <StoryStoryboardSequenceSection
                  sequence={sequence}
                  index={index}
                  projectId={projectId}
                  chapterId={chapterId}
                  allowGeneration={generationAllowed}
                />
              ) : (
                <StoryStoryboardUnplannedSection
                  nodeId={node.nodeId}
                  title={node.name?.trim() || node.clipKey}
                  index={index}
                  onRequestPlanning={
                    canRequestScenePlanning
                      ? () =>
                          openAgentComposer(
                            t("prompts.scene", { title: node.name?.trim() || node.clipKey })
                          )
                      : undefined
                  }
                />
              )}
              {choiceOptions ? <StoryStoryboardChoiceCard options={choiceOptions} /> : null}
            </div>
          );
        })}
        {orphanedSequences.map((sequence, index) => (
          <StoryStoryboardSequenceSection
            key={sequence.id}
            sequence={sequence}
            index={sceneNodes.length + index}
            projectId={projectId}
            chapterId={chapterId}
            allowGeneration={false}
          />
        ))}
      </div>
    </main>
  );
}
