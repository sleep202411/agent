"use client";

import { IconGitBranch, IconWorld } from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { type StoryGraphNode } from "@/lib/story-projects-api";
import { storyAutoFallbackNodeId, storyRouteNodeId } from "@repo/shared/story-stats";
import { useStoryChapterWorkbench } from "../_lib/use-story-chapter-workbench";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * Chapter/scene catalog — one tenant of the side-panel dock, mounted by
 * StoryProjectSidePanel only while it is the active panel. Gamebook flattening:
 * nodes render once, in array (authoring) order — branching never nests, it
 * shows as an unnumbered choice row whose options jump to their target rows;
 * endings carry an END badge.
 */
export function StoryProjectCatalog({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio.canvas");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const activeNodeId = searchParams.get("node");
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const workbenchQuery = useStoryChapterWorkbench(projectId);
  const chapter = workbenchQuery.data?.chapter ?? null;
  const nodes = useMemo(
    () => workbenchQuery.data?.draft.content.graph.nodes ?? [],
    [workbenchQuery.data?.draft.content.graph.nodes]
  );

  // nodeId → display name within the selected chapter, so choice targets read
  // as scene names instead of raw ids.
  const nodeNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const node of nodes) {
      names.set(node.nodeId, nodeTitle(node, t("catalogPanel.choice")));
    }
    return names;
  }, [nodes, t]);

  const rowHref = (nodeId: string) =>
    `/story-studio/projects/${projectId}/${nodes.find((node) => node.nodeId === nodeId)?.kind === "clip" ? "storyboard" : "canvas"}?chapter=${encodeURIComponent(
      activeChapterId as string
    )}&node=${encodeURIComponent(nodeId)}`;
  let sceneNumber = 0;
  const catalogRows = nodes.map((node) => ({
    node,
    sceneNumber: node.kind === "clip" ? ++sceneNumber : null,
  }));

  return (
    <nav aria-label={t("sidebar.catalog")} className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
      <p className="px-2 text-[11px] font-semibold tracking-[0.14em] text-white uppercase">
        {t("sidebar.catalog")}
      </p>
      {chapter ? (
        <div key={chapter.id} className="mt-4">
          <div className="space-y-0.5">
            {catalogRows.map(({ node, sceneNumber: rowSceneNumber }) => {
              const isEnding =
                node.exit.kind === "auto" && storyAutoFallbackNodeId(node.exit) === null;
              return (
                <div key={node.nodeId}>
                  <Link
                    href={rowHref(node.nodeId)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition",
                      activeNodeId === node.nodeId
                        ? "bg-white/[0.08] text-white"
                        : "text-white hover:bg-white/[0.07]"
                    )}
                  >
                    {node.kind === "clip" ? (
                      <span className="shrink-0 tabular-nums text-white/70">{rowSceneNumber}.</span>
                    ) : node.kind === "decision" ? (
                      <IconGitBranch className="size-3.5 shrink-0 text-white/65" />
                    ) : (
                      <IconWorld className="size-3.5 shrink-0 text-white/65" />
                    )}
                    <span className="truncate">{nodeTitle(node, t("catalogPanel.choice"))}</span>
                    {isEnding ? (
                      <span className="ml-auto shrink-0 rounded bg-red-400/12 px-1.5 py-px text-[9px] font-semibold tracking-wide text-red-300/75">
                        {t("catalogPanel.end")}
                      </span>
                    ) : null}
                  </Link>
                  {node.exit.kind === "choice" ? (
                    <div className="mt-0.5 mb-1 ml-3 border-l border-white/20 pl-2">
                      <p className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-white/80">
                        <IconGitBranch className="size-3 shrink-0" />
                        <span className="truncate">
                          {localized(node.exit.prompt, locale) || t("catalogPanel.choice")}
                        </span>
                      </p>
                      {node.exit.choices.map((choice) => (
                        <Link
                          key={choice.choiceId}
                          href={
                            storyRouteNodeId(choice.target)
                              ? rowHref(storyRouteNodeId(choice.target)!)
                              : rowHref(node.nodeId)
                          }
                          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-white transition hover:bg-white/[0.07]"
                        >
                          <span className="truncate">{localized(choice.label, locale)}</span>
                          <span className="shrink-0 text-white/70">
                            {storyRouteNodeId(choice.target)
                              ? `→ ${nodeNames.get(storyRouteNodeId(choice.target)!) ?? storyRouteNodeId(choice.target)}`
                              : t("interactionCard.unconnected")}
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
      ) : null}
    </nav>
  );
}

function nodeTitle(node: StoryGraphNode, choiceLabel: string): string {
  if (node.kind === "decision") return choiceLabel;
  return node.name?.trim() || node.clipKey;
}

function localized(values: Record<string, string> | undefined, locale: string): string {
  if (!values) return "";
  return values[locale] || values["zh-CN"] || values["en-US"] || Object.values(values)[0] || "";
}
