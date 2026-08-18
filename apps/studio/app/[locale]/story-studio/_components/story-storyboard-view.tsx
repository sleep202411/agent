"use client";

import {
  IconAlertTriangle,
  IconCheck,
  IconGitBranch,
  IconPhotoOff,
  IconRefresh,
} from "@tabler/icons-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useWorkspace } from "@/app/_components/workspace-context";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  getStoryWorkbench,
  storyApiErrorMessage,
  type StoryClipVideoSummary,
  type StoryGraphNode,
} from "@/lib/story-projects-api";

/**
 * Storyboard step — the tree's production projection, read-only. Chapter by
 * chapter, one row per clip node: prose summary on the left, the node's
 * CURRENT video (StoryVideoSelection) on the right. Batch generation lands
 * here with the pipeline; until then there are deliberately no action buttons.
 */
export function StoryStoryboardView({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio");
  const locale = useLocale();
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  // Focused row comes from the URL (?node=, set by the catalog panel) so the
  // position deep-links and survives refresh.
  const focusedNodeId = useSearchParams().get("node");

  const workbenchQuery = useQuery({
    queryKey: ["story-studio", "script-workbench", workspaceId, projectId],
    queryFn: () => getStoryWorkbench(workspaceId as string, projectId),
    enabled: Boolean(workspaceId),
    retry: false,
  });
  const chapters = workbenchQuery.data?.chapters ?? [];
  const chapterQueries = useQueries({
    queries: chapters.map((chapter) => ({
      queryKey: ["story-studio", "chapter-workbench", workspaceId, projectId, chapter.id],
      queryFn: () => getStoryWorkbench(workspaceId as string, projectId, chapter.id),
      enabled: Boolean(workspaceId),
      retry: false,
    })),
  });

  const loading = workspaceLoading || (Boolean(workspaceId) && workbenchQuery.isLoading);

  // nodeId → display name across every loaded chapter, so choice targets read
  // as scene names instead of raw ids.
  const nodeNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const query of chapterQueries) {
      for (const node of query.data?.draft.content.graph.nodes ?? []) {
        if (node.kind === "clip") names.set(node.nodeId, nodeTitle(node));
      }
    }
    return names;
  }, [chapterQueries]);

  const chaptersLoaded = chapterQueries.length > 0 && chapterQueries.every((query) => query.data);
  useEffect(() => {
    if (!focusedNodeId || !chaptersLoaded) return;
    document
      .getElementById(`sb-${focusedNodeId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedNodeId, chaptersLoaded]);

  if (loading) {
    return (
      <main className="flex h-full min-w-0 flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
      </main>
    );
  }

  if (workbenchQuery.isError || !workbenchQuery.data) {
    return (
      <main className="grid h-full min-w-0 flex-1 place-items-center px-6">
        <FrostedPanel className="flex flex-col items-center px-8 py-10 text-center">
          <IconAlertTriangle className="size-6 text-white/54" stroke={1.6} />
          <p className="mt-3 text-sm text-white/46">
            {storyApiErrorMessage(workbenchQuery.error, t("errors.generic"))}
          </p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => void workbenchQuery.refetch()}
          >
            <IconRefresh className="size-4" />
            {t("actions.retry")}
          </Button>
        </FrostedPanel>
      </main>
    );
  }

  return (
    <main className="flex h-full min-w-0 flex-1 overflow-hidden">
      {/* Rows — prose summary + the node's current video. The chapter/scene
          catalog lives in the sidebar's side panel, not here. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="w-full px-6 py-6">
          {chapters.map((chapter, index) => {
            const chapterQuery = chapterQueries[index];
            const nodes = clipNodes(chapterQuery?.data?.draft.content.graph.nodes);
            const videos = new Map(
              (chapterQuery?.data?.video.clips ?? []).map((clip) => [clip.graphNodeId, clip])
            );
            return (
              <section key={chapter.id} className="mb-10">
                {chapters.length > 1 ? (
                  <h2 className="text-base font-semibold tracking-[-0.015em] text-white">
                    <span className="mr-2 text-white/34 tabular-nums">{chapter.rank + 1}.</span>
                    {chapter.title}
                  </h2>
                ) : null}
                {chapterQuery?.isLoading ? (
                  <Skeleton className="mt-4 h-24 w-full rounded-2xl" />
                ) : nodes.length === 0 ? (
                  <p className="mt-3 text-xs text-white/34">{t("storyboardPage.emptyChapter")}</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {nodes.map((node, nodeIndex) => (
                      <div key={node.nodeId} className="space-y-3">
                        <StoryCard
                          node={node}
                          index={nodeIndex + 1}
                          clip={videos.get(node.nodeId)}
                          focused={focusedNodeId === node.nodeId}
                          storyLabel={t("storyboardPage.story")}
                          endLabel={t("canvas.catalogPanel.end")}
                          emptyLabel={t("storyboardPage.slotEmpty")}
                          readyLabel={t("storyboardPage.ready")}
                        />
                        {node.exit.kind === "choice" ? (
                          <ChoicesCard
                            exit={node.exit}
                            locale={locale}
                            nodeNames={nodeNames}
                            choicesLabel={t("canvas.catalogPanel.choice")}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

type ClipNode = Extract<StoryGraphNode, { kind: "clip" }>;

function clipNodes(nodes: StoryGraphNode[] | undefined): ClipNode[] {
  return (nodes ?? []).filter((node): node is ClipNode => node.kind === "clip");
}

function nodeTitle(node: ClipNode): string {
  return node.name?.trim() || node.clipKey;
}

function formatDuration(durationMs: number | null): string | null {
  if (durationMs == null) return null;
  const total = Math.round(durationMs / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function StoryCard({
  node,
  index,
  clip,
  focused,
  storyLabel,
  endLabel,
  emptyLabel,
  readyLabel,
}: {
  node: ClipNode;
  index: number;
  clip: StoryClipVideoSummary | undefined;
  focused: boolean;
  storyLabel: string;
  endLabel: string;
  emptyLabel: string;
  readyLabel: string;
}) {
  const video = clip?.currentVideo ?? null;
  const duration = formatDuration(video?.durationMs ?? null);
  const isEnding = node.exit.kind === "auto" && node.exit.nextNodeId === null;
  return (
    <div
      id={`sb-${node.nodeId}`}
      className={cn(
        "flex items-stretch gap-4 rounded-2xl bg-white/[0.03] p-4 transition",
        focused && "ring-1 ring-white/30"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="rounded-md bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white/62">
            {storyLabel}
          </span>
          <p className="truncate text-sm font-semibold text-white/88">
            <span className="mr-1.5 tabular-nums text-white/34">{index}.</span>
            {nodeTitle(node)}
          </p>
          {isEnding ? (
            <span className="shrink-0 rounded bg-red-400/12 px-1.5 py-px text-[9px] font-semibold tracking-wide text-red-300/75">
              {endLabel}
            </span>
          ) : null}
        </div>
        {node.description?.trim() ? (
          <p className="mt-2.5 text-sm leading-6 whitespace-pre-wrap text-white/72">
            {node.description}
          </p>
        ) : null}
      </div>
      <div className="relative aspect-video w-44 shrink-0 overflow-hidden rounded-xl bg-black/40">
        {video?.asset.previewUrl ? (
          <Image
            src={video.asset.previewUrl}
            alt={nodeTitle(node)}
            fill
            sizes="176px"
            className="object-cover"
          />
        ) : video ? (
          <div className="grid h-full place-items-center">
            <IconCheck className="size-5 text-emerald-300/70" />
          </div>
        ) : (
          <div className="grid h-full place-items-center text-white/30">
            <IconPhotoOff className="size-5" />
          </div>
        )}
        <span
          className={cn(
            "absolute right-1.5 bottom-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur",
            video ? "bg-emerald-400/15 text-emerald-200/80" : "bg-white/10 text-white/45"
          )}
        >
          {video ? (duration ? `${readyLabel} · ${duration}` : readyLabel) : emptyLabel}
        </span>
      </div>
    </div>
  );
}

function ChoicesCard({
  exit,
  locale,
  nodeNames,
  choicesLabel,
}: {
  exit: Extract<ClipNode["exit"], { kind: "choice" }>;
  locale: string;
  nodeNames: Map<string, string>;
  choicesLabel: string;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.03] p-4">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white/62">
          <IconGitBranch className="size-3" />
          {choicesLabel}
        </span>
        {localized(exit.prompt, locale) ? (
          <p className="truncate text-sm font-medium text-white/72">
            {localized(exit.prompt, locale)}
          </p>
        ) : null}
      </div>
      <div className="mt-2.5 grid gap-2 md:grid-cols-2">
        {exit.choices.map((choice) => (
          <div
            key={choice.choiceId}
            className="flex items-center justify-between gap-3 rounded-xl bg-black/25 px-3.5 py-2.5"
          >
            <span className="truncate text-xs font-medium text-white/78">
              {localized(choice.label, locale)}
            </span>
            <span className="shrink-0 text-[11px] text-white/34">
              → {nodeNames.get(choice.nextNodeId) ?? choice.nextNodeId}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function localized(values: Record<string, string> | undefined, locale: string): string {
  if (!values) return "";
  return values[locale] || values["zh-CN"] || values["en-US"] || Object.values(values)[0] || "";
}
