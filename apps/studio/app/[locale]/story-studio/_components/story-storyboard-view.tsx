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
  getStoryWorkbench,
  storyApiErrorMessage,
  type StoryGraphNode,
} from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { localizedText } from "./project-canvas/story-project-canvas-model";
import {
  StoryStoryboardChoiceCard,
  StoryStoryboardSequenceSection,
  type StorySequenceChoiceOptions,
} from "./story-storyboard-sequence-section";

/**
 * Chapter-owned production board, flattened like the catalog: every plot
 * node's sequence renders in narrative order on one page. A ?node= deep link
 * (from the catalog or the canvas) scrolls to its section.
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

  // The chapter graph supplies choice options and node names; the board
  // degrades gracefully to plain sequence cards if it cannot load.
  const locale = useLocale();
  // Same key as the catalog's chapter fetch so the two surfaces share one
  // cache entry instead of double-fetching the workbench.
  const workbenchQuery = useQuery({
    queryKey: ["story-studio", "chapter-workbench", workspaceId, projectId, chapterId],
    queryFn: () => getStoryWorkbench(workspaceId as string, projectId, chapterId as string),
    enabled: Boolean(workspaceId && chapterId),
    retry: false,
  });
  const choiceOptionsByNode = useMemo(() => {
    const nodes = workbenchQuery.data?.draft.content.graph.nodes ?? [];
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
  }, [workbenchQuery.data, locale]);

  // Live plot-node ids so orphaned sequences (their node deleted from the
  // plot tree) can be flagged; null while the workbench is still loading so
  // the badge never flashes on unresolved data.
  const plotNodeIds = useMemo(() => {
    const nodes = workbenchQuery.data?.draft.content.graph.nodes;
    if (!nodes) return null;
    return new Set(nodes.filter((node) => node.kind === "clip").map((node) => node.nodeId));
  }, [workbenchQuery.data]);

  const sequences = storyboardQuery.data ?? [];
  const requestedPlotNodeId = searchParams.get("node");

  // Consume the deep link exactly once: refetches that change the sequence
  // count must not yank the viewport back to the anchor.
  const consumedScrollTarget = useRef<string | null>(null);
  useEffect(() => {
    if (
      !requestedPlotNodeId ||
      sequences.length === 0 ||
      consumedScrollTarget.current === requestedPlotNodeId
    ) {
      return;
    }
    const target = document.getElementById(`plot-${requestedPlotNodeId}`);
    if (!target) return;
    consumedScrollTarget.current = requestedPlotNodeId;
    target.scrollIntoView({ block: "start" });
  }, [requestedPlotNodeId, sequences.length]);

  const loading = workspaceLoading || (Boolean(workspaceId) && storyboardQuery.isPending);

  if (loading) {
    return (
      <main className="min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-56 rounded-2xl" />
        ))}
      </main>
    );
  }

  if (storyboardQuery.isError) {
    return (
      <main className="grid h-full min-w-0 flex-1 place-items-center px-6 text-center">
        <div>
          <IconAlertTriangle className="mx-auto size-6 text-white/58" aria-hidden="true" />
          <p className="mt-3 max-w-lg text-sm text-white/72">
            {storyApiErrorMessage(storyboardQuery.error, t("loadError"))}
          </p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => void storyboardQuery.refetch()}
          >
            <IconRefresh />
            {t("retry")}
          </Button>
        </div>
      </main>
    );
  }

  if (sequences.length === 0 || !workspaceId || !chapterId) {
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
      <p className="text-xs text-white/62">{t("generationHint")}</p>
      <div className="mt-5 space-y-8">
        {sequences.map((sequence, index) => {
          const choiceOptions = choiceOptionsByNode.get(sequence.plotNodeId);
          return (
            <div key={sequence.id} className="space-y-4">
              <StoryStoryboardSequenceSection
                sequence={sequence}
                index={index}
                workspaceId={workspaceId}
                projectId={projectId}
                chapterId={chapterId}
                plotNodeMissing={plotNodeIds ? !plotNodeIds.has(sequence.plotNodeId) : false}
              />
              {choiceOptions ? <StoryStoryboardChoiceCard options={choiceOptions} /> : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
