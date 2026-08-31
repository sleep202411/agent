"use client";

import { IconArrowRight, IconLoader2, IconMovie, IconPhoto, IconVideo } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { getStoryStoryboard, storyProductionKeys } from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const chapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const draftBarrier = useStoryProjectUiStore((state) => state.draftBarrier);
  const [opening, setOpening] = useState(false);

  const storyboardQuery = useQuery({
    queryKey: storyProductionKeys.storyboard(projectId, chapterId),
    queryFn: ({ signal }) => getStoryStoryboard(projectId, chapterId as string, signal),
    enabled: Boolean(chapterId),
    retry: false,
  });
  const sequence =
    storyboardQuery.data?.find((candidate) => candidate.plotNodeId === nodeId) ?? null;
  const clips = sequence?.clips ?? [];
  const readyCount = clips.filter((clip) => clip.selectedMediaVersion !== null).length;
  const editorHref = `/story-studio/projects/${projectId}/edit?chapter=${encodeURIComponent(
    chapterId ?? ""
  )}&node=${encodeURIComponent(nodeId)}`;

  const openEditor = async () => {
    if (opening || !chapterId) return;
    setOpening(true);
    try {
      // A newborn Plot node may still be inside the canvas autosave window.
      // Crossing this barrier guarantees its canonical empty timeline exists
      // before the editor reads the shared Storyboard query.
      if (draftBarrier) await draftBarrier(async () => undefined);
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(projectId, chapterId),
      });
      router.push(editorHref);
    } catch (error) {
      toast.error(storyApiErrorMessage(error, t("openError")));
      setOpening(false);
    }
  };

  return (
    <section className="mt-4 rounded-[18px] bg-white/[0.045] p-3" aria-label={t("title")}>
      <button
        type="button"
        disabled={opening || !chapterId}
        onClick={() => void openEditor()}
        className="group flex w-full items-center gap-2 text-left disabled:opacity-60"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/55">
          <IconMovie className="size-4" stroke={1.7} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold text-white/82">{t("title")}</span>
          <span className="mt-0.5 block text-[9px] leading-4 text-white/34">
            {storyboardQuery.isPending
              ? t("loading")
              : t("summary", { count: clips.length, ready: readyCount })}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-white/62 transition group-hover:bg-white/[0.08] group-hover:text-white">
          {t("open")}
          {opening ? (
            <IconLoader2 className="size-3.5 animate-spin" stroke={1.8} />
          ) : (
            <IconArrowRight className="size-3.5" stroke={1.8} />
          )}
        </span>
      </button>

      {clips.length > 0 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {clips.map((clip) => {
            const media = clip.selectedMediaVersion;
            const video = Boolean(
              clip.kind === "video" ||
              media?.mediaKind === "video" ||
              media?.mimeType?.startsWith("video/")
            );
            const imageSource = video ? null : (media?.thumbnailUrl ?? media?.previewUrl ?? null);
            const KindIcon = video ? IconVideo : IconPhoto;
            return (
              <Link
                key={clip.id}
                href={editorHref}
                title={clip.title}
                className="group relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-black/30 ring-1 ring-white/[0.06] transition hover:ring-white/25"
              >
                {video && media?.previewUrl ? (
                  <video
                    src={media.previewUrl}
                    muted
                    playsInline
                    preload="metadata"
                    aria-hidden="true"
                    disablePictureInPicture
                    onLoadedMetadata={(event) => {
                      const element = event.currentTarget;
                      if (Number.isFinite(element.duration) && element.duration > 0) {
                        element.currentTime = Math.min(0.05, element.duration / 2);
                      }
                    }}
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : imageSource ? (
                  <Image
                    src={imageSource}
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
