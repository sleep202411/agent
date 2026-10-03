"use client";

import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
  IconMinus,
  IconPhoto,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconTimeline,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MediaTimelineTrack, timelineSecondsToPixels } from "@/components/media-timeline";
import { toast } from "sonner";
import { StoryClipGenerationFields } from "./story-clip-generation-fields";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  defaultMode,
  defaultSettingsForModel,
  schemaFields,
  type FizzAiModel,
  type ModelSettings,
  type SchemaFieldDescriptor,
} from "@/lib/canvas-authoring/generation-api";
import { lockedSettingFields } from "@/lib/canvas-authoring/omni-task-modes";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  createStoryProductionIdempotencyKey,
  createStoryStoryboardClipGeneration,
  getStoryStoryboard,
  patchStoryStoryboardClip,
  putStoryStoryboardTimeline,
  storyProductionKeys,
  type StoryStoryboardClip,
  type StoryStoryboardSequence,
} from "@/lib/story-production-api";
import {
  addStoryCandidateAsset,
  storyApiErrorMessage,
  type StoryCandidateAsset,
} from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import {
  appendStoryTimelineClip,
  createManualStoryTimelineClipStableKey,
  removeStoryTimelineClip,
  storySequenceToTimeline,
  type NewStoryTimelineClip,
} from "../_lib/story-timeline";
import {
  createStoryTimelineRulerTicks,
  storyTimelineRulerStep,
} from "../_lib/story-timeline-ruler";
import {
  advanceStoryTimelinePlayback,
  storyTimelineItemAtTime,
} from "../_lib/story-timeline-playback";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { storyGenerationOptions } from "../_stores/story-production-settings-store";
import { useStoryChapterWorkbench } from "../_lib/use-story-chapter-workbench";
import { useStoryTimelineExport } from "../_lib/use-story-timeline-export";
import {
  StoryCandidateAssetPickerDialog,
  type StoryCandidateAssetUploadState,
} from "./project-canvas/story-candidate-asset-picker-dialog";
import { useStoryCandidateAssets } from "./project-canvas/use-story-candidate-assets";
import { StoryPromptComposer, useStoryAssetMentions } from "./story-prompt-composer";
import { StoryStageLoadingState } from "./story-stage-empty-state";
import { useStoryProductionGenerationDefaults } from "./use-story-production-generation-defaults";

/**
 * Node-local editing workspace. It projects the server Storyboard sequence
 * into editor chrome but never owns a second copy of Plot branching or media.
 */
export function StoryTimelineEditorView({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio.editorPage");
  const router = useRouter();
  const chapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const workbenchQuery = useStoryChapterWorkbench(projectId);
  const projectCanEdit = workbenchQuery.data?.project.capabilities.includes("story.edit") ?? false;

  const storyboardQuery = useQuery({
    queryKey: storyProductionKeys.storyboard(projectId, chapterId),
    queryFn: ({ signal }) => getStoryStoryboard(projectId, chapterId as string, signal),
    enabled: Boolean(chapterId),
    retry: false,
  });
  const requestedPlotNodeId = searchParams.get("node");
  const selectedSequence = useMemo(() => {
    const sequences = storyboardQuery.data ?? [];
    if (requestedPlotNodeId) {
      return sequences.find((sequence) => sequence.plotNodeId === requestedPlotNodeId) ?? null;
    }
    return sequences[0] ?? null;
  }, [requestedPlotNodeId, storyboardQuery.data]);

  const timelineExport = useStoryTimelineExport({
    canEdit: projectCanEdit,
    sequence: selectedSequence,
    projectId,
    chapterId,
    onComplete: () => {
      void storyboardQuery.refetch();
    },
  });
  const selectedNodeTitle = useMemo(() => {
    const plotNodeId = selectedSequence?.plotNodeId;
    if (!plotNodeId) return "";
    const node = workbenchQuery.data?.draft.content.graph.nodes.find(
      (candidate) => candidate.kind === "clip" && candidate.nodeId === plotNodeId
    );
    return node && node.kind === "clip" ? node.name?.trim() || node.clipKey : plotNodeId;
  }, [selectedSequence?.plotNodeId, workbenchQuery.data?.draft.content.graph.nodes]);
  const timeline = useMemo(
    () => (selectedSequence ? storySequenceToTimeline(selectedSequence) : null),
    [selectedSequence]
  );
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackStartMsRef = useRef(0);

  const selectedClip =
    timeline?.visualTrack.clips.find((clip) => clip.id === selectedClipId) ??
    timeline?.visualTrack.clips[0] ??
    null;

  useEffect(() => {
    if (!isPlaying || !timeline) return;
    const wallStartMs = performance.now();
    let animationFrame = 0;

    const tick = (nowMs: number) => {
      const next = advanceStoryTimelinePlayback(
        playbackStartMsRef.current,
        nowMs - wallStartMs,
        timeline.durationMs
      );
      setPlayheadMs(next.timeMs);
      const activeClip = storyTimelineItemAtTime(timeline.visualTrack.clips, next.timeMs);
      if (activeClip) {
        setSelectedClipId((current) => (current === activeClip.id ? current : activeClip.id));
      }
      if (next.ended) {
        setIsPlaying(false);
        return;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isPlaying, timeline]);

  const addMutation = useMutation({
    retry: false,
    mutationFn: ({
      sequence,
      clip,
    }: {
      sequence: StoryStoryboardSequence;
      clip: Omit<NewStoryTimelineClip, "stableKey">;
    }) =>
      putStoryStoryboardTimeline(
        projectId,
        sequence.chapterId,
        sequence.id,
        createStoryProductionIdempotencyKey("story-timeline-append"),
        appendStoryTimelineClip(sequence, {
          ...clip,
          stableKey: createManualStoryTimelineClipStableKey(),
        })
      ),
    onSuccess: async (updated) => {
      queryClient.setQueryData<StoryStoryboardSequence[]>(
        storyProductionKeys.storyboard(projectId, updated.chapterId),
        (current) => current?.map((sequence) => (sequence.id === updated.id ? updated : sequence))
      );
      const appended = updated.clips.at(-1) ?? null;
      setIsPlaying(false);
      setSelectedClipId(appended?.id ?? null);
      setPlayheadMs(appended?.startMs ?? 0);
      toast.success(t("addSuccess"));
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(projectId, updated.chapterId),
      });
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("addError"))),
  });

  const deleteMutation = useMutation({
    retry: false,
    mutationFn: ({
      sequence,
      clipId,
    }: {
      sequence: StoryStoryboardSequence;
      clipId: string;
      activeClipId: string | null;
    }) =>
      putStoryStoryboardTimeline(
        projectId,
        sequence.chapterId,
        sequence.id,
        createStoryProductionIdempotencyKey("story-timeline-delete"),
        removeStoryTimelineClip(sequence, clipId)
      ),
    onSuccess: async (updated, { sequence, clipId, activeClipId }) => {
      queryClient.setQueryData<StoryStoryboardSequence[]>(
        storyProductionKeys.storyboard(projectId, updated.chapterId),
        (current) => current?.map((item) => (item.id === updated.id ? updated : item))
      );
      const deletedIndex = sequence.clips
        .slice()
        .sort((left, right) => left.rank - right.rank)
        .findIndex((clip) => clip.id === clipId);
      const remaining = storySequenceToTimeline(updated).visualTrack.clips;
      const adjacent = remaining[Math.min(Math.max(0, deletedIndex), remaining.length - 1)] ?? null;
      const nextSelection =
        activeClipId && activeClipId !== clipId
          ? (remaining.find((clip) => clip.id === activeClipId) ?? adjacent)
          : adjacent;
      setIsPlaying(false);
      setSelectedClipId(nextSelection?.id ?? null);
      setPlayheadMs(nextSelection?.startMs ?? 0);
      toast.success(t("deleteSuccess"));
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(projectId, updated.chapterId),
      });
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("deleteError"))),
  });

  const loading = Boolean(chapterId) && storyboardQuery.isPending;
  if (loading) {
    return (
      <main aria-busy="true" className="h-full min-h-0 min-w-0 overflow-hidden px-4 py-5 sm:px-6">
        <StoryStageLoadingState label={t("loading")} />
      </main>
    );
  }

  if (storyboardQuery.isError) {
    return (
      <main className="grid h-full min-h-0 min-w-0 place-items-center px-6 text-center">
        <div>
          <IconAlertTriangle className="mx-auto size-6 text-white/58" aria-hidden="true" />
          <p role="alert" className="mt-3 max-w-lg text-sm text-white/72">
            {storyApiErrorMessage(storyboardQuery.error, t("loadError"))}
          </p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => {
              void storyboardQuery.refetch();
            }}
          >
            <IconRefresh />
            {t("retry")}
          </Button>
        </div>
      </main>
    );
  }

  if (!chapterId || !selectedSequence || !timeline) {
    return (
      <main className="grid h-full min-h-0 min-w-0 place-items-center px-6 text-center">
        <div>
          <IconTimeline className="mx-auto size-7 text-white/45" aria-hidden="true" />
          <h1 className="mt-3 text-base font-semibold text-white/92">{t("emptyTitle")}</h1>
          <p className="mt-1.5 text-sm text-white/60">{t("emptyDescription")}</p>
          <Button variant="secondary" className="mt-5" onClick={() => router.back()}>
            {t("back")}
          </Button>
        </div>
      </main>
    );
  }

  const canEdit = projectCanEdit;
  const allowGeneration = projectCanEdit;
  const canImportMedia = canEdit;

  const addClip = () =>
    addMutation.mutate({
      sequence: selectedSequence,
      clip: {
        kind: "image",
        title: t("newClipTitle"),
        durationMs: 4_000,
        prompt: t("newClipPrompt"),
        description: null,
      },
    });

  const selectClip = (clip: StoryStoryboardClip, timeMs = clip.startMs) => {
    setIsPlaying(false);
    setSelectedClipId(clip.id);
    setPlayheadMs(timeMs);
  };
  const seekTimeline = (seconds: number) => {
    setIsPlaying(false);
    const timeMs = Math.round(seconds * 1_000);
    setPlayheadMs(timeMs);
    const clip = storyTimelineItemAtTime(timeline.visualTrack.clips, timeMs);
    if (clip) setSelectedClipId(clip.id);
  };
  const togglePlayback = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    const startMs = playheadMs >= timeline.durationMs ? 0 : playheadMs;
    const activeClip = storyTimelineItemAtTime(timeline.visualTrack.clips, startMs);
    playbackStartMsRef.current = startMs;
    setPlayheadMs(startMs);
    if (activeClip) setSelectedClipId(activeClip.id);
    setIsPlaying(true);
  };
  const restartPlayback = () => {
    setIsPlaying(false);
    setPlayheadMs(0);
    setSelectedClipId(timeline.visualTrack.clips[0]?.id ?? null);
  };

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--canvas-background)]">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-[oklch(0.185_0_0)] px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label={t("back")}
            className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
          >
            <IconArrowLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("back")}</span>
          </button>
          <span className="h-5 w-px bg-white/10" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="shrink-0 text-sm font-semibold text-white/92">{t("title")}</h1>
              <span className="truncate text-xs text-white/48">{selectedNodeTitle}</span>
            </div>
            <p className="hidden truncate text-[10px] text-white/36 lg:block">{t("description")}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {timelineExport.isExporting ? (
            <button
              type="button"
              onClick={() => timelineExport.cancel()}
              className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
            >
              {t("cancelExport")} {Math.round(timelineExport.exportProgress * 100)}%
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={!timelineExport.canExport}
                onClick={() => void timelineExport.handleExport()}
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
              >
                {t("exportFilm")}
              </button>
              <button
                type="button"
                disabled={timelineExport.validShotsCount === 0}
                onClick={() => void timelineExport.downloadOnly()}
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
              >
                {t("downloadFilm")}
              </button>
            </>
          )}
          <span
            className="hidden items-center gap-1.5 text-[11px] text-white/45 sm:inline-flex"
            aria-live="polite"
          >
            {addMutation.isPending || deleteMutation.isPending ? (
              <IconRefresh className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <IconCircleCheck className="size-3.5" aria-hidden="true" />
            )}
            {t(addMutation.isPending || deleteMutation.isPending ? "saving" : "saved")}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[240px_minmax(0,1fr)_360px] xl:grid-cols-[260px_minmax(0,1fr)_400px]">
        <TimelineClipSidebar
          clips={timeline.visualTrack.clips}
          selectedClipId={selectedClip?.id ?? null}
          onSelectClip={selectClip}
          canEdit={canEdit}
          adding={addMutation.isPending}
          deleting={deleteMutation.isPending}
          onAddClip={addClip}
          onDeleteClip={(clip) =>
            deleteMutation.mutate({
              sequence: selectedSequence,
              clipId: clip.id,
              activeClipId: selectedClip?.id ?? null,
            })
          }
        />
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <section
            aria-label={t("preview")}
            className="grid min-h-[260px] min-w-0 flex-1 place-items-center overflow-hidden bg-black/38 p-5"
          >
            <TimelineClipPreview
              clip={selectedClip}
              timelineTimeMs={playheadMs}
              timelinePlaying={isPlaying}
              onTimeUpdate={(seconds) =>
                setPlayheadMs(
                  selectedClip
                    ? selectedClip.startMs + Math.min(selectedClip.durationMs, seconds * 1_000)
                    : 0
                )
              }
            />
          </section>
          <TimelineTrack
            timeline={timeline}
            selectedClipId={selectedClip?.id ?? null}
            playheadMs={playheadMs}
            playing={isPlaying}
            onSelectClip={selectClip}
            onSeek={seekTimeline}
            onTogglePlayback={togglePlayback}
            onRestart={restartPlayback}
          />
        </div>
        <aside className="min-h-0 overflow-y-auto border-t border-white/8 bg-white/[0.025] p-5 md:border-t-0 md:border-l">
          <h2 className="text-xs font-semibold tracking-[0.12em] text-white/52 uppercase">
            {t("inspector")}
          </h2>
          {selectedClip ? (
            <TimelineClipInspector
              key={`${selectedClip.id}:${selectedClip.version}`}
              clip={selectedClip}
              sequenceId={selectedSequence.id}
              projectId={projectId}
              chapterId={chapterId}
              editable={canEdit}
              allowGeneration={allowGeneration}
              canImportMedia={canImportMedia}
            />
          ) : (
            <p className="mt-4 text-xs leading-5 text-white/55">{t("selectClip")}</p>
          )}
        </aside>
      </div>
    </main>
  );
}

function TimelineClipSidebar({
  clips,
  selectedClipId,
  onSelectClip,
  canEdit,
  adding,
  deleting,
  onAddClip,
  onDeleteClip,
}: {
  clips: readonly StoryStoryboardClip[];
  selectedClipId: string | null;
  onSelectClip: (clip: StoryStoryboardClip, timeMs?: number) => void;
  canEdit: boolean;
  adding: boolean;
  deleting: boolean;
  onAddClip: () => void;
  onDeleteClip: (clip: StoryStoryboardClip) => void;
}) {
  const t = useTranslations("storyStudio.editorPage");
  const [pendingDelete, setPendingDelete] = useState<StoryStoryboardClip | null>(null);

  return (
    <aside
      aria-label={t("clipList")}
      className="hidden min-h-0 overflow-hidden border-r border-white/8 bg-white/[0.018] md:flex md:flex-col"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/8 px-3.5">
        <h2 className="text-[10px] font-semibold tracking-[0.14em] text-white/52 uppercase">
          {t("clipList")}
        </h2>
        <span className="text-[10px] tabular-nums text-white/36">{clips.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <ol className="space-y-1.5">
          {clips.map((clip, index) => {
            const selected = clip.id === selectedClipId;
            const KindIcon = clip.kind === "video" ? IconVideo : IconPhoto;

            return (
              <li key={clip.id} className="group/clip relative">
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelectClip(clip)}
                  className={cn(
                    "group grid w-full grid-cols-[72px_minmax(0,1fr)] gap-2 rounded-lg p-1.5 pr-9 text-left transition-colors focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
                    selected ? "bg-white/[0.11]" : "hover:bg-white/[0.055]"
                  )}
                >
                  <span className="relative aspect-video overflow-hidden rounded-md bg-black/45">
                    <TimelineClipMediaThumbnail
                      clip={clip}
                      sizes="72px"
                      loading={selected ? "eager" : "lazy"}
                    />
                    <span className="absolute top-1 left-1 inline-flex min-w-4 items-center justify-center rounded bg-black/72 px-1 text-[9px] font-medium tabular-nums text-white/78">
                      {index + 1}
                    </span>
                  </span>
                  <span className="min-w-0 py-0.5">
                    <span className="block truncate text-[11px] font-medium text-white/80 group-hover:text-white">
                      {clip.title}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-[9px] tabular-nums text-white/38">
                      <KindIcon className="size-3" aria-hidden="true" />
                      <span>{formatTimecode(clip.durationMs)}</span>
                    </span>
                  </span>
                </button>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`${t("deleteClip")}: ${clip.title}`}
                    disabled={deleting}
                    onClick={() => setPendingDelete(clip)}
                    className="absolute top-1/2 right-2 z-10 grid size-7 -translate-y-1/2 place-items-center rounded-lg bg-destructive/10 text-destructive opacity-0 transition-[opacity,background-color] hover:bg-destructive/20 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-destructive/45 focus-visible:outline-none disabled:pointer-events-none group-focus-within/clip:opacity-100 group-hover/clip:opacity-100"
                  >
                    <IconTrash className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="shrink-0 border-t border-white/8 p-2">
        <Button
          variant="secondary"
          block
          loading={adding}
          disabled={!canEdit || adding || deleting}
          onClick={onAddClip}
        >
          <IconPlus />
          {t("addClip")}
        </Button>
      </div>
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete ? t("deleteTitle", { name: pendingDelete.title }) : null}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteCancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) onDeleteClip(pendingDelete);
              }}
            >
              {t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

function TimelineClipMediaThumbnail({
  clip,
  sizes,
  className,
  loading = "lazy",
}: {
  clip: StoryStoryboardClip;
  sizes: string;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const media = clip.selectedMediaVersion;
  const video = Boolean(
    clip.kind === "video" || media?.mediaKind === "video" || media?.mimeType?.startsWith("video/")
  );

  if (video && media?.previewUrl) {
    return (
      <video
        src={media.previewUrl}
        poster={media.thumbnailUrl ?? undefined}
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
        className={cn("absolute inset-0 size-full object-cover", className)}
      />
    );
  }

  const source = media?.thumbnailUrl ?? media?.previewUrl ?? null;
  if (source) {
    return (
      <Image
        src={source}
        alt=""
        fill
        unoptimized
        loading={loading}
        sizes={sizes}
        className={cn("object-cover", className)}
      />
    );
  }

  const KindIcon = video ? IconVideo : IconPhoto;
  return (
    <KindIcon
      className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-white/28"
      aria-hidden="true"
    />
  );
}

function TimelineClipPreview({
  clip,
  timelineTimeMs,
  timelinePlaying,
  onTimeUpdate,
}: {
  clip: StoryStoryboardClip | null;
  timelineTimeMs: number;
  timelinePlaying: boolean;
  onTimeUpdate: (seconds: number) => void;
}) {
  const t = useTranslations("storyStudio.editorPage");
  const videoRef = useRef<HTMLVideoElement>(null);
  const media = clip?.selectedMediaVersion ?? null;
  const video = Boolean(
    clip?.kind === "video" || media?.mediaKind === "video" || media?.mimeType?.startsWith("video/")
  );
  const videoSource = video ? (media?.previewUrl ?? null) : null;
  const source = video
    ? (media?.previewUrl ?? media?.thumbnailUrl)
    : (media?.thumbnailUrl ?? media?.previewUrl);
  const localTimeSeconds = clip
    ? Math.min(clip.durationMs, Math.max(0, timelineTimeMs - clip.startMs)) / 1_000
    : 0;
  const localTimeRef = useRef(localTimeSeconds);

  useEffect(() => {
    localTimeRef.current = localTimeSeconds;
  }, [localTimeSeconds]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !videoSource) return;
    const synchronize = () => {
      if (Math.abs(element.currentTime - localTimeRef.current) > 0.3) {
        element.currentTime = localTimeRef.current;
      }
    };

    synchronize();
    if (!timelinePlaying) {
      element.pause();
      return;
    }

    if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      void element.play().catch(() => {});
      return;
    }
    const handleCanPlay = () => {
      synchronize();
      void element.play().catch(() => {});
    };
    element.addEventListener("canplay", handleCanPlay, { once: true });
    return () => element.removeEventListener("canplay", handleCanPlay);
  }, [clip?.id, timelinePlaying, videoSource]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || timelinePlaying || !videoSource) return;
    if (Math.abs(element.currentTime - localTimeSeconds) > 0.05) {
      element.currentTime = localTimeSeconds;
    }
  }, [clip?.id, localTimeSeconds, timelinePlaying, videoSource]);

  if (!clip || !media || !source) {
    return (
      <div className="max-w-sm text-center">
        <IconPhoto className="mx-auto size-7 text-white/32" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-white/72">{t("previewEmpty")}</p>
        <p className="mt-1 text-xs leading-5 text-white/48">{t("previewEmptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-2xl bg-black shadow-2xl">
      {video && videoSource ? (
        <video
          key={clip.id}
          ref={videoRef}
          src={videoSource}
          aria-label={clip.title}
          poster={media.thumbnailUrl ?? undefined}
          controls={!timelinePlaying}
          autoPlay={timelinePlaying}
          playsInline
          preload="metadata"
          onCanPlay={(event) => {
            if (!timelinePlaying) return;
            event.currentTarget.currentTime = localTimeRef.current;
            void event.currentTarget.play().catch(() => {});
          }}
          onTimeUpdate={(event) => {
            if (!timelinePlaying) onTimeUpdate(event.currentTarget.currentTime);
          }}
          className="size-full object-contain"
        />
      ) : (
        <Image
          src={source}
          alt={clip.title}
          fill
          unoptimized
          loading="eager"
          sizes="(max-width: 768px) 100vw, 960px"
          className="object-contain"
        />
      )}
    </div>
  );
}

function TimelineTrack({
  timeline,
  selectedClipId,
  playheadMs,
  playing,
  onSelectClip,
  onSeek,
  onTogglePlayback,
  onRestart,
}: {
  timeline: ReturnType<typeof storySequenceToTimeline>;
  selectedClipId: string | null;
  playheadMs: number;
  playing: boolean;
  onSelectClip: (clip: StoryStoryboardClip, timeMs?: number) => void;
  onSeek: (seconds: number) => void;
  onTogglePlayback: () => void;
  onRestart: () => void;
}) {
  const t = useTranslations("storyStudio.editorPage");
  const durationSeconds = timeline.durationMs / 1_000;
  const [pixelsPerSecond, setPixelsPerSecond] = useState(44);
  const timeAxisWidth = Math.max(1, durationSeconds * pixelsPerSecond);
  const canvasWidth = Math.max(720, Math.ceil(timeAxisWidth) + 72);
  const playheadX = timelineSecondsToPixels(playheadMs / 1_000, timeAxisWidth, durationSeconds);
  const rulerStep = storyTimelineRulerStep(pixelsPerSecond);
  const ticks = useMemo(
    () => createStoryTimelineRulerTicks(durationSeconds, rulerStep.minor, rulerStep.major),
    [durationSeconds, rulerStep.major, rulerStep.minor]
  );

  return (
    <section
      aria-label={t("timeline")}
      className="h-[132px] shrink-0 overflow-hidden border-t border-white/8 bg-[oklch(0.16_0_0)]"
    >
      <div className="grid h-10 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-white/8 px-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] text-white/52 uppercase">
            <IconTimeline className="size-3.5" aria-hidden="true" />
            {t("timeline")}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-white/42">
            {formatTimecode(playheadMs)} / {formatTimecode(timeline.durationMs)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("restart")}
            onClick={onRestart}
            className="grid size-7 place-items-center rounded-md text-white/48 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/45 focus-visible:outline-none"
          >
            <IconPlayerSkipBack className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t(playing ? "pause" : "play")}
            aria-pressed={playing}
            onClick={onTogglePlayback}
            className="grid size-8 place-items-center rounded-full bg-white text-black transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-white/55 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:outline-none active:scale-95"
          >
            {playing ? (
              <IconPlayerPause className="size-4 fill-current" aria-hidden="true" />
            ) : (
              <IconPlayerPlay className="size-4 fill-current" aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            aria-label={t("zoomOut")}
            disabled={pixelsPerSecond <= 18}
            onClick={() => setPixelsPerSecond((current) => Math.max(18, current - 8))}
            className="grid size-7 place-items-center rounded-md text-white/42 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-25"
          >
            <IconMinus className="size-3.5" aria-hidden="true" />
          </button>
          <Slider
            aria-label={t("timelineZoom")}
            min={18}
            max={96}
            step={2}
            value={[pixelsPerSecond]}
            onValueChange={([value]) => setPixelsPerSecond(value ?? 44)}
            className="w-24"
          />
          <button
            type="button"
            aria-label={t("zoomIn")}
            disabled={pixelsPerSecond >= 96}
            onClick={() => setPixelsPerSecond((current) => Math.min(96, current + 8))}
            className="grid size-7 place-items-center rounded-md text-white/42 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-25"
          >
            <IconPlus className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="min-w-0 overflow-x-auto overflow-y-hidden">
        <MediaTimelineTrack
          dataSlot="story-timeline-canvas"
          className="relative h-[92px] cursor-text select-none"
          durationSeconds={durationSeconds}
          timeAxisWidth={timeAxisWidth}
          seekOnPointerDrag
          onSeek={onSeek}
          style={{ width: `${canvasWidth}px` }}
        >
          <div className="relative h-7 border-b border-white/8 bg-white/[0.015]">
            {ticks.map((tick) => (
              <span
                key={tick.seconds}
                className={cn("absolute bottom-0 w-px bg-white/16", tick.major ? "h-3" : "h-1.5")}
                style={{
                  left: `${timelineSecondsToPixels(
                    tick.seconds,
                    timeAxisWidth,
                    durationSeconds
                  )}px`,
                }}
              >
                {tick.major ? (
                  <span className="absolute bottom-3 left-1 font-mono text-[9px] tabular-nums whitespace-nowrap text-white/38">
                    {formatRulerTime(tick.seconds)}
                  </span>
                ) : null}
              </span>
            ))}
          </div>

          <div
            className="relative h-16 bg-black/24"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgb(255 255 255 / 0.045) 1px, transparent 1px)",
              backgroundSize: `${timelineSecondsToPixels(
                rulerStep.major,
                timeAxisWidth,
                durationSeconds
              )}px 100%`,
            }}
          >
            {timeline.visualTrack.clips.map((clip) => {
              const selected = clip.id === selectedClipId;
              const KindIcon = clip.kind === "video" ? IconVideo : IconPhoto;
              const width = Math.max(
                28,
                timelineSecondsToPixels(clip.durationMs / 1_000, timeAxisWidth, durationSeconds)
              );

              return (
                <button
                  key={clip.id}
                  type="button"
                  aria-label={clip.title}
                  aria-current={selected ? "true" : undefined}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onSelectClip(clip)}
                  className={cn(
                    "group absolute top-1 h-14 overflow-hidden rounded-[3px] border bg-[oklch(0.25_0_0)] text-left outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-white/60",
                    selected
                      ? "z-10 border-white/85 ring-1 ring-white/55"
                      : "border-white/12 hover:border-white/38"
                  )}
                  style={{
                    left: `${timelineSecondsToPixels(
                      clip.startMs / 1_000,
                      timeAxisWidth,
                      durationSeconds
                    )}px`,
                    width: `${width}px`,
                  }}
                >
                  <TimelineClipMediaThumbnail
                    clip={clip}
                    sizes={`${Math.ceil(width)}px`}
                    className="opacity-48"
                    loading={selected ? "eager" : "lazy"}
                  />
                  <span className="absolute inset-0 bg-gradient-to-r from-black/68 via-black/34 to-transparent" />
                  <span className="absolute inset-x-2 top-1.5 flex min-w-0 items-center gap-1 text-[10px] font-medium text-white/88">
                    <KindIcon className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{clip.title}</span>
                  </span>
                  <span className="absolute bottom-1.5 left-2 font-mono text-[8px] tabular-nums text-white/55">
                    {formatRulerTime(clip.durationMs / 1_000)}
                  </span>
                  {selected ? (
                    <>
                      <span className="absolute inset-y-0 left-0 w-0.5 bg-white/85" />
                      <span className="absolute inset-y-0 right-0 w-0.5 bg-white/85" />
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>

          {timeline.cues.map((cue) => (
            <span
              key={cue.id}
              role="img"
              aria-label={t("decisionCue", { time: formatTimecode(cue.atMs) })}
              title={t("decisionCue", { time: formatTimecode(cue.atMs) })}
              className="pointer-events-none absolute top-5 bottom-0 z-20 w-px -translate-x-1/2 bg-[var(--brand-blue)]/72"
              style={{
                left: `${timelineSecondsToPixels(
                  cue.atMs / 1_000,
                  timeAxisWidth,
                  durationSeconds
                )}px`,
              }}
            >
              <span className="absolute top-0 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-[var(--brand-blue)]" />
            </span>
          ))}

          <span
            role="img"
            aria-label={t("playhead", { time: formatTimecode(playheadMs) })}
            className="pointer-events-none absolute top-0 bottom-0 z-30 w-px -translate-x-1/2 bg-[var(--brand-red)] shadow-[0_0_5px_rgb(229_34_39_/_0.45)]"
            style={{ left: `${playheadX}px` }}
          >
            <span className="absolute top-0 left-1/2 h-3 w-2.5 -translate-x-1/2 rounded-b-[2px] bg-[var(--brand-red)]" />
          </span>
        </MediaTimelineTrack>
      </div>
    </section>
  );
}

function formatRulerTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  const precision = Number.isInteger(remainder) ? 0 : 1;
  return `${minutes}:${remainder.toFixed(precision).padStart(precision ? 4 : 2, "0")}`;
}

function TimelineClipInspector({
  clip,
  sequenceId,
  projectId,
  chapterId,
  editable,
  allowGeneration,
  canImportMedia,
}: {
  clip: StoryStoryboardClip;
  sequenceId: string;
  projectId: string;
  chapterId: string;
  editable: boolean;
  allowGeneration: boolean;
  canImportMedia: boolean;
}) {
  const t = useTranslations("storyStudio.editorPage");
  const queryClient = useQueryClient();
  const candidateAssets = useStoryCandidateAssets({ projectId, canEdit: canImportMedia });
  const mentions = useStoryAssetMentions(projectId, chapterId);
  const [title, setTitle] = useState(clip.title);
  const [kind, setKind] = useState<StoryStoryboardClip["kind"]>(clip.kind);
  const [prompt, setPrompt] = useState(
    (clip.kind === "image" ? clip.imagePrompt : clip.videoPrompt) ?? ""
  );
  const generationDefaults = useStoryProductionGenerationDefaults(projectId, kind);
  const [modelId, setModelId] = useState<string | null>(null);
  const selectedModel =
    generationDefaults.models.find((candidate) => candidate.id === modelId) ??
    generationDefaults.model;
  const [modeOverride, setModeOverride] = useState<string | null>(null);
  const modes = selectedModel?.generationModes ?? [];
  const selectedMode =
    modeOverride && (modes as readonly string[]).includes(modeOverride)
      ? modeOverride
      : defaultMode(selectedModel);
  const [modelSettingsOverride, setModelSettingsOverride] = useState<{
    modelId: string;
    settings: ModelSettings;
  } | null>(null);
  const baseModelSettings =
    modelSettingsOverride && modelSettingsOverride.modelId === selectedModel?.id
      ? modelSettingsOverride.settings
      : modelId === null
        ? generationDefaults.options
        : defaultSettingsForModel(selectedModel);
  const modelSettings =
    modelSettingsOverride && modelSettingsOverride.modelId === selectedModel?.id
      ? baseModelSettings
      : storyTimelineDefaultGenerationSettings(selectedModel, baseModelSettings, clip.durationMs);
  const updateModelSettings = (settings: ModelSettings) => {
    if (!selectedModel) return;
    setModelSettingsOverride({ modelId: selectedModel.id, settings });
  };
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const savedPrompt = (clip.kind === "image" ? clip.imagePrompt : clip.videoPrompt) ?? "";
  const dirty = title.trim() !== clip.title || kind !== clip.kind || prompt.trim() !== savedPrompt;
  const invalid = !title.trim() || !prompt.trim();

  const cacheClip = (updated: StoryStoryboardClip) => {
    queryClient.setQueryData<StoryStoryboardSequence[]>(
      storyProductionKeys.storyboard(projectId, chapterId),
      (current) =>
        current?.map((sequence) =>
          sequence.id === sequenceId
            ? {
                ...sequence,
                clips: sequence.clips.map((item) => (item.id === updated.id ? updated : item)),
              }
            : sequence
        )
    );
  };

  const persistDraft = async (source?: StoryCandidateAsset) => {
    const sourceKind = source?.asset.kind;
    if (sourceKind && sourceKind !== "image" && sourceKind !== "video") {
      throw new Error(t("inspectorForm.unsupportedMedia"));
    }
    const nextKind = sourceKind ?? kind;
    const nextTitle = title.trim();
    const nextPrompt = prompt.trim();
    const kindChanged = nextKind !== clip.kind;
    const titleChanged = nextTitle !== clip.title;
    const promptChanged = nextPrompt !== savedPrompt;
    return patchStoryStoryboardClip(
      projectId,
      chapterId,
      sequenceId,
      clip.id,
      createStoryProductionIdempotencyKey("story-clip-inspector"),
      {
        expectedVersion: clip.version,
        ...(kindChanged ? { kind: nextKind } : {}),
        ...(titleChanged ? { title: nextTitle } : {}),
        ...(promptChanged || kindChanged
          ? {
              imagePrompt: nextKind === "image" ? nextPrompt : null,
              videoPrompt: nextKind === "video" ? nextPrompt : null,
            }
          : {}),
        ...(source ? { sourceMediaAssetId: source.asset.id } : {}),
      }
    );
  };

  const saveMutation = useMutation({
    retry: false,
    mutationFn: () => persistDraft(),
    onSuccess: (updated) => {
      cacheClip(updated);
      toast.success(t("inspectorForm.saved"));
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("inspectorForm.saveError"))),
  });

  const replaceMutation = useMutation({
    retry: false,
    mutationFn: (source: StoryCandidateAsset) => persistDraft(source),
    onSuccess: async (updated) => {
      cacheClip(updated);
      toast.success(t("inspectorForm.replaceSuccess"));
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(projectId, chapterId),
      });
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("inspectorForm.replaceError"))),
  });

  const generateMutation = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!selectedModel) {
        throw new Error(t("inspectorForm.noModels"));
      }
      const target = dirty ? await persistDraft() : clip;
      if (dirty) cacheClip(target);
      return createStoryStoryboardClipGeneration(
        projectId,
        chapterId,
        sequenceId,
        clip.id,
        createStoryProductionIdempotencyKey("story-generate"),
        {
          expectedVersion: target.version,
          modelId: selectedModel.id,
          schemaVersion: selectedModel.schemaVersion,
          options: storyGenerationOptions(modelSettings),
        }
      );
    },
    onSuccess: async () => {
      toast.success(t("inspectorForm.generateStarted"));
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(projectId, chapterId),
      });
    },
    onError: async (error) => {
      toast.error(storyApiErrorMessage(error, t("inspectorForm.generateError")));
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(projectId, chapterId),
      });
    },
  });

  const uploadReplacement = async (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ) => {
    if (!canImportMedia) {
      throw new Error(t("inspectorForm.mediaUnavailable"));
    }
    const uploadKind = storyTimelineUploadKind(file);
    const uploaded = await uploadFileViaSignedUrl(file, {
      kind: uploadKind === "video" ? "ai_reference_video" : "ai_reference_image",
      scope: { storyProjectId: projectId },
      onProgress: (progress) => onState({ stage: "uploading", progress }),
      signal,
    });
    if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
    onState({ stage: "processing" });
    const candidate = await addStoryCandidateAsset(projectId, uploaded.mediaAssetId);
    await candidateAssets.refresh();
    if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
    await replaceMutation.mutateAsync(candidate);
  };

  const busy = saveMutation.isPending || replaceMutation.isPending || generateMutation.isPending;

  return (
    <div className="mt-4 space-y-4">
      <code className="block truncate text-[10px] text-white/36">@{clip.stableKey}</code>
      <Field dense required label={t("inspectorForm.name")} htmlFor={`clip-name-${clip.id}`}>
        <Input
          id={`clip-name-${clip.id}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={!editable || busy}
          className="h-9 rounded-lg px-3"
        />
      </Field>
      <Field dense required label={t("kind")}>
        <Select
          value={kind}
          onValueChange={(value) => {
            setKind(value as StoryStoryboardClip["kind"]);
            setModelId(null);
            setModeOverride(null);
            setModelSettingsOverride(null);
          }}
          disabled={!editable || busy}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="image">{t("inspectorForm.image")}</SelectItem>
            <SelectItem value="video">{t("inspectorForm.video")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field dense label={t("inspectorForm.media")}>
        <div className="overflow-hidden rounded-xl bg-black/30">
          <div className="relative aspect-video">
            <TimelineClipMediaThumbnail clip={clip} sizes="320px" loading="eager" />
            {!clip.selectedMediaVersion ? (
              <span className="absolute inset-0 grid place-items-center text-[10px] text-white/36">
                {t("inspectorForm.noMedia")}
              </span>
            ) : null}
          </div>
          <Button
            variant="secondary"
            block
            disabled={!canImportMedia || invalid || busy}
            onClick={() => setAssetPickerOpen(true)}
            className="rounded-t-none"
          >
            <IconRefresh />
            {t("inspectorForm.replaceMedia")}
          </Button>
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <InspectorRow label={t("startsAt")}>{formatSeconds(clip.startMs, t)}</InspectorRow>
        <InspectorRow label={t("duration")}>{formatSeconds(clip.durationMs, t)}</InspectorRow>
      </div>
      <Field dense required label={t("prompt")} htmlFor={`clip-prompt-${clip.id}`}>
        <StoryPromptComposer
          id={`clip-prompt-${clip.id}`}
          value={prompt}
          onChange={setPrompt}
          mentions={mentions}
          required
          disabled={!editable || busy}
        />
      </Field>
      <StoryClipGenerationFields
        models={generationDefaults.models}
        model={selectedModel}
        onSelectModel={(model) => {
          setModelId(model.id);
          setModeOverride(null);
          setModelSettingsOverride(null);
        }}
        settings={modelSettings}
        onSettingsChange={updateModelSettings}
        mode={selectedMode}
        onSelectMode={setModeOverride}
        disabled={!allowGeneration || busy}
        loading={generationDefaults.loading}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          disabled={!editable || !dirty || invalid || busy}
          loading={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {t("inspectorForm.save")}
        </Button>
        <Button
          disabled={
            !allowGeneration || invalid || busy || generationDefaults.loading || !selectedModel
          }
          loading={generateMutation.isPending}
          onClick={() => generateMutation.mutate()}
        >
          <IconSparkles />
          {t("inspectorForm.generate")}
        </Button>
      </div>
      <StoryCandidateAssetPickerDialog
        projectId={projectId}
        open={assetPickerOpen}
        onOpenChange={setAssetPickerOpen}
        items={candidateAssets.items}
        allowedKinds={["image", "video"]}
        currentAssetId={clip.selectedMediaVersion?.mediaAssetId ?? null}
        loading={candidateAssets.loading}
        error={candidateAssets.failed ? candidateAssets.error : null}
        canSelect={canImportMedia}
        disabledReason={canImportMedia ? null : t("inspectorForm.mediaUnavailable")}
        onRetry={() => void candidateAssets.refresh()}
        onSelect={async (candidate) => {
          await replaceMutation.mutateAsync(candidate);
        }}
        uploadAccept="image/*,video/*,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm"
        onUpload={uploadReplacement}
      />
    </div>
  );
}

function storyTimelineUploadKind(file: File): StoryStoryboardClip["kind"] {
  if (file.type.toLowerCase().startsWith("video/")) return "video";
  if (/\.(mp4|mov|webm)$/i.test(file.name)) return "video";
  return "image";
}

export function storyTimelineDefaultGenerationSettings(
  model: FizzAiModel | undefined,
  settings: ModelSettings,
  clipDurationMs: number
): ModelSettings {
  const taskType =
    typeof settings.omniReferenceTaskType === "string" ? settings.omniReferenceTaskType : undefined;
  if (lockedSettingFields(taskType).has("duration")) return settings;
  const durationField = schemaFields(model).find(isStoryDurationField);
  if (!durationField) return settings;
  const value = nearestStoryDurationValue(durationField, clipDurationMs / 1_000);
  return value === undefined ? settings : { ...settings, [durationField.name]: value };
}

function isStoryDurationField(field: SchemaFieldDescriptor): boolean {
  return ["duration", "durationseconds"].includes(field.name.replaceAll(/[_-]/g, "").toLowerCase());
}

function nearestStoryDurationValue(
  field: SchemaFieldDescriptor,
  clipSeconds: number
): string | number | undefined {
  if (!Number.isFinite(clipSeconds) || clipSeconds <= 0) return undefined;
  if (field.enum?.length) {
    return field.enum
      .map((value) => ({ value, seconds: Number(value) }))
      .filter((candidate) => Number.isFinite(candidate.seconds) && candidate.seconds > 0)
      .sort((left, right) => {
        const distance =
          Math.abs(left.seconds - clipSeconds) - Math.abs(right.seconds - clipSeconds);
        return distance || right.seconds - left.seconds;
      })[0]?.value;
  }
  if (field.type !== "number" && field.type !== "integer") return undefined;
  const bounded = Math.min(
    field.max ?? clipSeconds,
    Math.max(field.min ?? clipSeconds, clipSeconds)
  );
  const stepped = field.step ? Math.round(bounded / field.step) * field.step : bounded;
  const normalized = field.type === "integer" ? Math.round(stepped) : stepped;
  return Number(normalized.toFixed(9));
}

function InspectorRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-white/45">{label}</span>
      <span className="min-w-0 text-right tabular-nums text-white/78">{children}</span>
    </div>
  );
}

function formatSeconds(ms: number, t: ReturnType<typeof useTranslations>): string {
  return t("seconds", { value: Number((ms / 1_000).toFixed(2)) });
}

function formatTimecode(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1_000);
  const milliseconds = safeMs % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}
