"use client";

import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { useWorkspace } from "@/app/_components/workspace-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getStoryStoryboard, storyProductionKeys } from "@/lib/story-production-api";
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
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const chapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const searchParams = useSearchParams();

  const storyboardQuery = useQuery({
    queryKey: storyProductionKeys.storyboard(workspaceId, projectId, chapterId),
    queryFn: ({ signal }) =>
      getStoryStoryboard(workspaceId as string, projectId, chapterId as string, signal),
    enabled: Boolean(workspaceId && chapterId),
    retry: false,
  });

  const locale = useLocale();
  const workbenchQuery = useStoryChapterWorkbench(projectId, { chapterId });
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
  const requestedPlotNodeId = searchParams.get("node");

  const loading =
    workspaceLoading ||
    (Boolean(workspaceId) && (storyboardQuery.isPending || workbenchQuery.isPending));

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
      <main className="min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-56 rounded-2xl" />
        ))}
      </main>
    );
  }

  if (storyboardQuery.isError || workbenchQuery.isError) {
    return (
      <main className="grid h-full min-w-0 flex-1 place-items-center px-6 text-center">
        <div>
          <IconAlertTriangle className="mx-auto size-6 text-white/58" aria-hidden="true" />
          <p className="mt-3 max-w-lg text-sm text-white/72">
            {storyApiErrorMessage(storyboardQuery.error ?? workbenchQuery.error, t("loadError"))}
          </p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => {
              void storyboardQuery.refetch();
              void workbenchQuery.refetch();
            }}
          >
            <IconRefresh />
            {t("retry")}
          </Button>
        </div>
      </main>
    );
  }

  if (sceneNodes.length === 0 || !workspaceId || !chapterId) {
    return (
      <main className="grid h-full min-w-0 flex-1 place-items-center px-6 text-center">
        <div>
          <p className="text-sm font-medium text-white/72">{t("emptyChapter")}</p>
          <p className="mt-1.5 text-xs text-white/64">{t("emptyHint")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      <StoryProductionPageHeader title={t("title")} description={t("generationHint")} />
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
                  workspaceId={workspaceId}
                  projectId={projectId}
                  chapterId={chapterId}
                />
              ) : (
                <StoryStoryboardUnplannedSection
                  nodeId={node.nodeId}
                  title={node.name?.trim() || node.clipKey}
                  index={index}
                />
              )}
              {choiceOptions ? <StoryStoryboardChoiceCard options={choiceOptions} /> : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
