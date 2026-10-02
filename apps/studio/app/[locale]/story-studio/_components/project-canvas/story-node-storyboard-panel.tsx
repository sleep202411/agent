"use client";

import {
  IconArrowRight,
  IconCheck,
  IconLink,
  IconLoader2,
  IconMovie,
  IconPhoto,
  IconPlus,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { StoryboardTaskPicker } from "./storyboard-task-picker";
import { useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@/app/_components/auth-provider";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { getStoryStoryboard, storyProductionKeys } from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { StoryClipVideoReplace } from "../story-clip-video-replace";
import { useStoryProjectUiStore } from "../../_stores/story-project-ui-store";
import {
  createStoryboardChild,
  listStoryboardChildren,
  type StoryboardChildItem,
} from "@/lib/collab/storyboard-children-api";

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
interface StoryNodeStoryboardPanelProps {
  projectId: string;
  nodeId: string;
  canEdit?: boolean;
}

export function StoryNodeStoryboardPanel(props: StoryNodeStoryboardPanelProps) {
  const { user } = useAuth();
  const chapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  return (
    <StoryboardPanelSession
      key={JSON.stringify([user?.id, props.projectId, chapterId, props.nodeId])}
      {...props}
    />
  );
}

function StoryboardPanelSession({
  projectId,
  nodeId,
  canEdit = false,
}: StoryNodeStoryboardPanelProps) {
  const t = useTranslations("storyStudio.canvas.inspector.storyboard");
  const router = useRouter();
  const queryClient = useQueryClient();
  const chapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const draftBarrier = useStoryProjectUiStore((state) => state.draftBarrier);
  const [opening, setOpening] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<string | null>(null);
  const pickerKey = JSON.stringify([projectId, nodeId]);
  const pickerOpen = pickerTarget === pickerKey;
  const [creatingTask, setCreatingTask] = useState(false);
  const alive = useRef(true);
  const openingRef = useRef(false);
  const creatingRef = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const storyboardQuery = useQuery({
    queryKey: storyProductionKeys.storyboard(projectId, chapterId),
    queryFn: ({ signal }) => getStoryStoryboard(projectId, chapterId as string, signal),
    enabled: Boolean(chapterId),
    retry: false,
  });

  const childrenQuery = useQuery({
    queryKey: ["storyboard-children", projectId],
    queryFn: ({ signal }) => listStoryboardChildren(projectId, signal),
    retry: false,
  });

  const childItem = childrenQuery.isError
    ? undefined
    : childrenQuery.data?.find((item: StoryboardChildItem) => item.nodeId === nodeId);

  const sequence = !storyboardQuery.isError
    ? (storyboardQuery.data?.find((candidate) => candidate.plotNodeId === nodeId) ?? null)
    : null;
  const clips = sequence?.clips ?? [];
  const readyCount = clips.filter((clip) => clip.selectedMediaVersion !== null).length;
  const editorHref = `/story-studio/projects/${projectId}/edit?chapter=${encodeURIComponent(
    chapterId ?? ""
  )}&node=${encodeURIComponent(nodeId)}`;

  const openEditor = async () => {
    if (!alive.current || openingRef.current || !chapterId) return;
    openingRef.current = true;
    setOpening(true);
    try {
      // A newborn Plot node may still be inside the canvas autosave window.
      // Crossing this barrier guarantees its canonical empty timeline exists
      // before the editor reads the shared Storyboard query.
      if (draftBarrier) await draftBarrier(async () => undefined);
      if (!alive.current) return;
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(projectId, chapterId),
      });
      if (alive.current) router.push(editorHref);
    } catch (error) {
      if (alive.current) toast.error(storyApiErrorMessage(error, t("openError")));
    } finally {
      openingRef.current = false;
      if (alive.current) setOpening(false);
    }
  };

  const handleCreateTask = async () => {
    if (!alive.current || !canEdit || creatingRef.current) return;
    creatingRef.current = true;
    setCreatingTask(true);
    try {
      await createStoryboardChild(projectId, nodeId, {});
      await queryClient.invalidateQueries({
        queryKey: ["storyboard-children", projectId],
      });
      if (alive.current) toast.success(t("createTask"));
    } catch (error) {
      if (alive.current) toast.error(storyApiErrorMessage(error, "Failed to create task"));
    } finally {
      creatingRef.current = false;
      if (alive.current) setCreatingTask(false);
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
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
            {storyboardQuery.isPending
              ? t("loading")
              : storyboardQuery.isError
                ? t("loadError")
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

      {storyboardQuery.isError && (
        <div role="alert" className="mt-3 space-y-2 text-xs text-muted-foreground">
          <p>{storyApiErrorMessage(storyboardQuery.error, t("loadError"))}</p>
          <button
            type="button"
            disabled={storyboardQuery.isFetching}
            onClick={() => void storyboardQuery.refetch()}
            className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-white/80 disabled:opacity-50"
          >
            {t("retryTasks")}
          </button>
        </div>
      )}

      {/* Linked Task Status / Create Task Affordance */}
      <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
        {childrenQuery.isPending ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t("loading")}
          </p>
        ) : childrenQuery.isError ? (
          <div role="alert" className="space-y-2 text-xs text-muted-foreground">
            <p>{storyApiErrorMessage(childrenQuery.error, t("taskListError"))}</p>
            <button
              type="button"
              disabled={childrenQuery.isFetching}
              onClick={() => void childrenQuery.refetch()}
              className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-white/80 disabled:opacity-50"
            >
              {t("retryTasks")}
            </button>
          </div>
        ) : childItem?.taskId ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">{t("linkedTask")}</span>
              <span className="mt-0.5 block truncate text-[11px] font-semibold text-white/88">
                {childItem.title}
              </span>
            </div>
            {childItem.status ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white/[0.08] px-2 py-0.5 text-[10px] font-medium text-white/72">
                <IconCheck className="size-3" stroke={2} />
                {childItem.status}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="block text-[10px] text-white/45">{t("noTaskYet")}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                disabled={!canEdit || creatingTask || pickerOpen || !childItem}
                onClick={() => setPickerTarget(pickerKey)}
                className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] px-2.5 py-1 text-[10px] font-medium text-white/72 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-50"
              >
                <IconLink className="size-3" stroke={1.8} />
                {t("linkTask")}
              </button>
              <button
                type="button"
                disabled={!canEdit || creatingTask || pickerOpen || !childItem}
                onClick={() => void handleCreateTask()}
                className="inline-flex items-center gap-1 rounded-lg bg-white/[0.12] px-2.5 py-1 text-[10px] font-medium text-white transition hover:bg-white/[0.18] disabled:opacity-50"
              >
                {creatingTask ? (
                  <IconLoader2 className="size-3 animate-spin" stroke={2} />
                ) : (
                  <IconPlus className="size-3" stroke={2} />
                )}
                {t("createTask")}
              </button>
            </div>
          </div>
        )}
      </div>

      {pickerOpen && canEdit && childrenQuery.isSuccess && !childItem?.taskId ? (
        <StoryboardTaskPicker
          key={`${projectId}:${nodeId}`}
          projectId={projectId}
          nodeId={nodeId}
          onClose={() => setPickerTarget(null)}
        />
      ) : null}

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
