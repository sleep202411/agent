"use client";

import { IconArrowRight, IconMovie, IconPhoto, IconVideo } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useWorkspace } from "@/app/_components/workspace-context";
import { Link } from "@/i18n/navigation";
import { getStoryStoryboard, storyProductionKeys } from "@/lib/story-production-api";
import { useStoryProjectUiStore } from "../../_stores/story-project-ui-store";

/**
 * The node's production filling, read straight from its storyboard sequence —
 * the single source of the scene's playable content. Display + deep link
 * only: generation and prompts live on the storyboard page.
 */
export function StoryNodeStoryboardPanel({
  projectId,
  nodeId,
}: {
  projectId: string;
  nodeId: string;
}) {
  const t = useTranslations("storyStudio.canvas.inspector.storyboard");
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const chapterId = useStoryProjectUiStore((state) => state.activeChapterId);

  const storyboardQuery = useQuery({
    queryKey: storyProductionKeys.storyboard(workspaceId, projectId, chapterId),
    queryFn: ({ signal }) =>
      getStoryStoryboard(workspaceId as string, projectId, chapterId as string, signal),
    enabled: Boolean(workspaceId && chapterId),
    retry: false,
  });
  const sequence =
    storyboardQuery.data?.find((candidate) => candidate.plotNodeId === nodeId) ?? null;
  const clips = sequence?.clips ?? [];
  const readyCount = clips.filter((clip) => clip.selectedMediaVersion !== null).length;
  const boardHref = `/story-studio/projects/${projectId}/storyboard?chapter=${encodeURIComponent(
    chapterId ?? ""
  )}&node=${encodeURIComponent(nodeId)}`;

  return (
    <section className="mt-4 rounded-[18px] bg-white/[0.045] p-3" aria-label={t("title")}>
      <div className="flex items-center gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/55">
          <IconMovie className="size-4" stroke={1.7} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold text-white/82">{t("title")}</span>
          <span className="mt-0.5 block text-[9px] leading-4 text-white/34">
            {sequence
              ? t("summary", { count: clips.length, ready: readyCount })
              : storyboardQuery.isPending
                ? t("loading")
                : t("missing")}
          </span>
        </span>
        {sequence ? (
          <Link
            href={boardHref}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-white/62 transition hover:bg-white/[0.08] hover:text-white"
          >
            {t("open")}
            <IconArrowRight className="size-3.5" stroke={1.8} />
          </Link>
        ) : null}
      </div>

      {clips.length > 0 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {clips.map((clip) => {
            const thumbnail =
              clip.selectedMediaVersion?.thumbnailUrl ??
              clip.selectedMediaVersion?.previewUrl ??
              null;
            const KindIcon = clip.kind === "video" ? IconVideo : IconPhoto;
            return (
              <Link
                key={clip.id}
                href={boardHref}
                title={clip.title}
                className="group relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-black/30 ring-1 ring-white/[0.06] transition hover:ring-white/25"
              >
                {thumbnail ? (
                  <Image
                    src={thumbnail}
                    alt={clip.title}
                    fill
                    sizes="96px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <span className="grid size-full place-items-center text-white/28">
                    <KindIcon className="size-4" stroke={1.6} />
                  </span>
                )}
                <span className="absolute right-1 bottom-1 rounded bg-black/55 px-1 text-[9px] tabular-nums text-white/78">
                  {Number((clip.durationMs / 1000).toFixed(1))}s
                </span>
                <span className="absolute top-1 left-1 grid size-4 place-items-center rounded bg-black/55 text-white/70">
                  <KindIcon className="size-2.5" stroke={2} />
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
