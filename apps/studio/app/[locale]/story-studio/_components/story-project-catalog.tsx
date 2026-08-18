"use client";

import { IconGitBranch, IconWorld } from "@tabler/icons-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import { useMemo } from "react";
import { useWorkspace } from "@/app/_components/workspace-context";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { getStoryWorkbench, type StoryGraphNode } from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

const CATALOG_SEGMENTS = new Set(["script", "assets", "storyboard"]);

/**
 * Chapter/scene catalog docked next to the rail (opened by the rail's Catalog
 * button). Gamebook flattening: nodes render once, in array (authoring)
 * order — branching never nests, it shows as an unnumbered choice row whose
 * options jump to their target rows; endings carry an END badge.
 */
export function StoryProjectCatalog({ projectId }: { projectId: string }) {
  const segment = useSelectedLayoutSegment();
  const catalogOpen = useStoryProjectUiStore((state) => state.catalogOpen);
  const t = useTranslations("storyStudio.canvas");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const activeNodeId = searchParams.get("node");
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const enabled = catalogOpen && CATALOG_SEGMENTS.has(segment ?? "");

  const workbenchQuery = useQuery({
    queryKey: ["story-studio", "script-workbench", workspaceId, projectId],
    queryFn: () => getStoryWorkbench(workspaceId as string, projectId),
    enabled: Boolean(workspaceId) && enabled,
    retry: false,
  });
  const chapters = workbenchQuery.data?.chapters ?? [];
  const chapterQueries = useQueries({
    queries: chapters.map((chapter) => ({
      queryKey: ["story-studio", "chapter-workbench", workspaceId, projectId, chapter.id],
      queryFn: () => getStoryWorkbench(workspaceId as string, projectId, chapter.id),
      enabled: Boolean(workspaceId) && enabled,
      retry: false,
    })),
  });

  // nodeId → display name across every loaded chapter, so choice targets read
  // as scene names instead of raw ids.
  const nodeNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const query of chapterQueries) {
      for (const node of query.data?.draft.content.graph.nodes ?? []) {
        names.set(node.nodeId, nodeTitle(node));
      }
    }
    return names;
  }, [chapterQueries]);

  if (!enabled) return null;

  const rowHref = (nodeId: string) =>
    `/story-studio/projects/${projectId}/storyboard?node=${nodeId}`;

  return (
    <nav
      aria-label={t("sidebar.catalog")}
      className="w-64 shrink-0 overflow-y-auto border-r border-white/8 bg-[#0C0C0D] px-3 py-5"
    >
      <p className="px-2 text-[11px] font-semibold tracking-[0.14em] text-white/30 uppercase">
        {t("sidebar.catalog")}
      </p>
      {chapters.map((chapter, index) => {
        const nodes = chapterQueries[index]?.data?.draft.content.graph.nodes ?? [];
        let sceneNumber = 0;
        return (
          <div key={chapter.id} className="mt-4">
            {chapters.length > 1 ? (
              <p className="px-2 text-xs font-semibold text-white/56">
                {chapter.rank + 1}. {chapter.title}
              </p>
            ) : null}
            <div className="mt-1 space-y-0.5">
              {nodes.map((node) => {
                const isEnding = node.exit.kind === "auto" && node.exit.nextNodeId === null;
                if (node.kind === "clip") sceneNumber += 1;
                return (
                  <div key={node.nodeId}>
                    <Link
                      href={rowHref(node.nodeId)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition",
                        activeNodeId === node.nodeId
                          ? "bg-white/[0.08] text-white"
                          : "text-white/52 hover:bg-white/[0.04] hover:text-white/80"
                      )}
                    >
                      {node.kind === "clip" ? (
                        <span className="shrink-0 tabular-nums text-white/30">{sceneNumber}.</span>
                      ) : (
                        <IconWorld className="size-3.5 shrink-0 text-white/30" />
                      )}
                      <span className="truncate">{nodeTitle(node)}</span>
                      {isEnding ? (
                        <span className="ml-auto shrink-0 rounded bg-red-400/12 px-1.5 py-px text-[9px] font-semibold tracking-wide text-red-300/75">
                          {t("catalogPanel.end")}
                        </span>
                      ) : null}
                    </Link>
                    {node.exit.kind === "choice" ? (
                      <div className="mt-0.5 mb-1 ml-3 border-l border-white/8 pl-2">
                        <p className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-white/38">
                          <IconGitBranch className="size-3 shrink-0" />
                          <span className="truncate">
                            {localized(node.exit.prompt, locale) || t("catalogPanel.choice")}
                          </span>
                        </p>
                        {node.exit.choices.map((choice) => (
                          <Link
                            key={choice.choiceId}
                            href={rowHref(choice.nextNodeId)}
                            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-white/44 transition hover:bg-white/[0.04] hover:text-white/78"
                          >
                            <span className="truncate">{localized(choice.label, locale)}</span>
                            <span className="shrink-0 text-white/24">
                              → {nodeNames.get(choice.nextNodeId) ?? choice.nextNodeId}
                            </span>
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function nodeTitle(node: StoryGraphNode): string {
  if (node.kind === "clip") return node.name?.trim() || node.clipKey;
  return node.name?.trim() || node.worldId || node.nodeId;
}

function localized(values: Record<string, string> | undefined, locale: string): string {
  if (!values) return "";
  return values[locale] || values["zh-CN"] || values["en-US"] || Object.values(values)[0] || "";
}
