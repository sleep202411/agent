"use client";

import { useAuth } from "@/app/_components/auth-provider";

import { IconAlertTriangle, IconPlus, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getStoryStoryboard, storyProductionKeys } from "@/lib/story-production-api";
import {
  putStoryDraft,
  storyApiErrorMessage,
  type StoryClipGraphNode,
  type StoryGraphNode,
} from "@/lib/story-projects-api";
import { createClipNode } from "./project-canvas/story-project-canvas-mutations";
import { storyAutoFallbackNodeId, storyRouteNodeId } from "@repo/shared/story-stats";
import {
  storyChapterWorkbenchQueryKey,
  useStoryChapterWorkbench,
} from "../_lib/use-story-chapter-workbench";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { localizedText } from "./project-canvas/story-project-canvas-model";
import { StoryProductionPageHeader } from "./story-production-page-header";
import { StoryStageLoadingState } from "./story-stage-empty-state";
import {
  StoryStoryboardChoiceCard,
  StoryStoryboardSequenceSection,
  type StorySequenceChoiceOptions,
} from "./story-storyboard-sequence-section";
import { StorySourceReviewNotes } from "./story-source-review-notes";

/**
 * Chapter-owned production board. The chapter graph is the board's skeleton —
 * every Plot node renders its one canonical Storyboard sequence in narrative
 * (authoring) order, numbered exactly like the catalog. A ?node= deep link
 * (from the catalog or the canvas) scrolls to its section.
 */
export function StoryStoryboardView({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const t = useTranslations("storyStudio.storyboardPage");
  const queryClient = useQueryClient();
  const chapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const workbenchQuery = useStoryChapterWorkbench(projectId, { chapterId });
  const searchParams = useSearchParams();
  const sessionId = useRef(globalThis.crypto.randomUUID());

  const storyboardQuery = useQuery({
    queryKey: storyProductionKeys.storyboard(projectId, chapterId),
    queryFn: ({ signal }) => getStoryStoryboard(projectId, chapterId as string, signal),
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
      if (node.kind !== "clip") continue;
      const nextNode =
        node.exit.kind === "auto" && storyAutoFallbackNodeId(node.exit)
          ? byId.get(storyAutoFallbackNodeId(node.exit)!)
          : undefined;
      const exit =
        node.exit.kind === "choice"
          ? node.exit
          : nextNode?.kind === "decision"
            ? nextNode.exit
            : null;
      if (!exit) continue;
      options.set(node.nodeId, {
        prompt: localizedText(exit.prompt, locale, ""),
        choices: exit.choices.map((choice) => ({
          id: choice.choiceId,
          label: localizedText(choice.label, locale, choice.choiceId),
          target: titleOf(storyRouteNodeId(choice.target)),
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
  const projectCanEdit = workbenchQuery.data?.project.capabilities.includes("story.edit") ?? false;

  const addNodeMutation = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!chapterId || !workbenchQuery.data) throw new Error(t("missingChapter"));
      const created = createClipNode(workbenchQuery.data.draft.content, {
        name: t("newNodeTitle"),
      });
      const draft = await putStoryDraft(projectId, chapterId, {
        expectedRevision: workbenchQuery.data.draft.revision,
        content: created.content,
        sessionId: sessionId.current,
      });
      return { draft, plotNodeId: created.created.nodeId };
    },
    onSuccess: async ({ draft, plotNodeId }) => {
      // The draft save created the Plot node and its empty timeline in one
      // server transaction. Refresh the timeline projection first so React
      // never observes a graph-only node while the two query caches settle.
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(projectId, chapterId),
      });
      queryClient.setQueryData(
        storyChapterWorkbenchQueryKey(projectId, chapterId, user?.id ?? null),
        (current: typeof workbenchQuery.data) => (current ? { ...current, draft } : current)
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: storyChapterWorkbenchQueryKey(projectId, chapterId, user?.id ?? null),
        }),
        queryClient.invalidateQueries({
          queryKey: storyProductionKeys.state(projectId, chapterId),
        }),
      ]);
      toast.success(t("nodeAdded"));
      document.getElementById(`plot-${plotNodeId}`)?.scrollIntoView({ block: "start" });
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("addNodeError"))),
  });

  const loading = workbenchQuery.isPending || (Boolean(chapterId) && storyboardQuery.isPending);

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

  if (storyboardQuery.isError || workbenchQuery.isError) {
    return (
      <main className="grid h-full min-w-0 flex-1 place-items-center px-6 text-center">
        <div>
          <IconAlertTriangle className="mx-auto size-6 text-white/58" aria-hidden="true" />
          <p role="alert" className="mt-3 max-w-lg text-sm text-white/72">
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

  if (!chapterId) {
    return (
      <main className="grid h-full min-w-0 flex-1 place-items-center px-6 text-center">
        <div>
          <p className="text-sm font-medium text-white/72">{t("emptyChapter")}</p>
          <p className="mt-1.5 text-xs text-white/64">{t("emptyHint")}</p>
        </div>
      </main>
    );
  }

  const generationAllowed = projectCanEdit && sceneNodes.length > 0;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      <StoryProductionPageHeader
        projectId={projectId}
        title={t("title")}
        description={t("generationHint")}
        showGenerationControls={generationAllowed && (storyboardQuery.data?.length ?? 0) > 0}
        actions={
          projectCanEdit ? (
            <Button
              type="button"
              variant="secondary"
              disabled={addNodeMutation.isPending}
              onClick={() => addNodeMutation.mutate()}
            >
              {addNodeMutation.isPending ? (
                <IconRefresh className="animate-spin" aria-hidden="true" />
              ) : (
                <IconPlus aria-hidden="true" />
              )}
              {t("addNode")}
            </Button>
          ) : null
        }
      />
      <div className="mt-5 space-y-8">
        <StorySourceReviewNotes notes={workbenchQuery.data?.draft.content.productionNotes} />
        {sceneNodes.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.045] px-5 py-10 text-center text-white shadow-sm">
            <p className="text-sm font-medium text-white/78">{t("emptyChapter")}</p>
            <p className="mt-1.5 text-xs text-white/54">{t("emptyHint")}</p>
          </div>
        ) : null}
        {sceneNodes.map((node, index) => {
          const sequence = sequenceByNode.get(node.nodeId);
          const choiceOptions = choiceOptionsByNode.get(node.nodeId);
          if (!sequence) {
            // The server rejects this invariant before returning a response.
            // Never silently revive the removed graph-only product state if
            // a future cache/write path violates the contract client-side.
            throw new Error(`Storyboard sequence missing for Plot node ${node.nodeId}.`);
          }
          return (
            <div key={node.nodeId} className="space-y-4">
              <StoryStoryboardSequenceSection
                sequence={sequence}
                title={node.name?.trim() || node.clipKey}
                description={node.description ?? ""}
                index={index}
                projectId={projectId}
                chapterId={chapterId}
                allowGeneration={generationAllowed}
              />
              {choiceOptions ? <StoryStoryboardChoiceCard options={choiceOptions} /> : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
