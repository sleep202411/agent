"use client";

import { IconArrowRight, IconLoader2, IconMovie, IconPhoto } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { getStoryStoryboard, storyProductionKeys } from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { StoryClipVideoReplace } from "../story-clip-video-replace";
import { useStoryProjectUiStore } from "../../_stores/story-project-ui-store";

const VIDEO_FILE = /\.(m4v|mov|mp4|webm)(\?|$)/i;

/** A real image when one exists. Video files stay a silent cover, never a player. */
function clipCover(
  media: {
    thumbnailUrl: string | null;
    previewUrl: string | null;
    mediaKind: string;
    mimeType: string | null;
  } | null
): { kind: "image" | "video"; url: string } | null {
  if (!media) return null;
  const image = [media.thumbnailUrl, media.previewUrl].find((url) => url && !VIDEO_FILE.test(url));
  if (image) return { kind: "image", url: image };
  const videoFile = media.previewUrl ?? media.thumbnailUrl;
  const video = Boolean(
    videoFile &&
    (media.mediaKind === "video" ||
      media.mimeType?.startsWith("video/") ||
      VIDEO_FILE.test(videoFile))
  );
  return video && videoFile ? { kind: "video", url: videoFile } : null;
}

/**
 * The node's production filling, read straight from its storyboard sequence.
 * Editors can upload a new clip or replace an existing one here; the timeline
 * editor remains the place for ordering, prompts, and generation.
 */
export function StoryNodeStoryboardPanel({
  projectId,
  nodeId,
  canEdit = false,
}: {
  projectId: string;
  nodeId: string;
  canEdit?: boolean;
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

      {clips.length > 0 || (sequence && chapterId) ? (
        <div className="mt-3 -mx-0.5 flex gap-2 overflow-x-auto px-0.5 py-0.5">
          {clips.map((clip) => {
            const cover = clipCover(clip.selectedMediaVersion);
            return (
              <div
                key={clip.id}
                className="group relative h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-white/[0.08] bg-black/30"
              >
                {cover?.kind === "image" ? (
                  <Image
                    src={cover.url}
                    alt=""
                    fill
                    sizes="96px"
                    className="pointer-events-none object-cover"
                    unoptimized
                  />
                ) : cover?.kind === "video" ? (
                  <video
                    src={cover.url}
                    muted
                    playsInline
                    preload="metadata"
                    aria-hidden="true"
                    disablePictureInPicture
                    className="pointer-events-none absolute inset-0 size-full object-cover"
                    onLoadedMetadata={(event) => {
                      const element = event.currentTarget;
                      if (Number.isFinite(element.duration) && element.duration > 0) {
                        element.currentTime = Math.min(0.05, element.duration / 2);
                      }
                    }}
                  />
                ) : (
                  <span className="grid size-full place-items-center text-white/28">
                    <IconPhoto className="size-4" stroke={1.6} />
                  </span>
                )}
                <span className="pointer-events-none absolute inset-0 bg-black/50 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100" />
                {sequence && chapterId ? (
                  <StoryClipVideoReplace
                    projectId={projectId}
                    chapterId={chapterId}
                    sequence={sequence}
                    clip={clip}
                    enabled={canEdit}
                    placement="center"
                  />
                ) : null}
              </div>
            );
          })}
          {sequence && chapterId ? (
            <StoryClipVideoReplace
              projectId={projectId}
              chapterId={chapterId}
              sequence={sequence}
              enabled={canEdit}
              placement="placeholder"
              density="thumb"
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
