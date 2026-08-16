"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  IconArrowLeft,
  IconArrowsMove,
  IconChevronDown,
  IconClick,
  IconClock,
  IconCopy,
  IconFocusCentered,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRectangle,
  IconRoute,
  IconSelector,
  IconTrash,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { MediaTimelineRange, MediaTimelineTrack } from "@/components/media-timeline";
import { cn } from "@/lib/utils";
import type {
  StoryClipGraphNode,
  StoryClipVideoSummary,
  StoryFrameProfile,
  StoryGraphNode,
} from "@/lib/story-projects-api";
import { createStoryHotspotId } from "./story-interaction-ids";
import type {
  NormalizedHotspotRect,
  StoryInteractionActionDraft,
  StoryInteractionDraft,
} from "./story-interaction-types";

const StoryHotspotStage = dynamic(
  () => import("./story-hotspot-stage").then((module) => module.StoryHotspotStage),
  { ssr: false }
);

type EditorMode = "edit" | "preview";
type EditorTool = "select" | "rectangle";

interface StoryInteractionEditorProps {
  node: StoryClipGraphNode;
  nodes: StoryGraphNode[];
  clip: StoryClipVideoSummary | null;
  frameProfile: StoryFrameProfile;
  drafts: StoryInteractionDraft[];
  onDraftsChange: (drafts: StoryInteractionDraft[]) => void;
  onClose: () => void;
}

const MIN_RECT_SIZE = 0.035;
const MIN_WINDOW_SECONDS = 0.1;

export function StoryInteractionEditor({
  node,
  nodes,
  clip,
  frameProfile,
  drafts,
  onDraftsChange,
  onClose,
}: StoryInteractionEditorProps) {
  const t = useTranslations("storyStudio.canvas.interactionEditor");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
  const bindStageRef = useCallback((element: HTMLDivElement | null) => {
    setStageElement(element);
  }, []);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  const draftsRef = useRef(drafts);
  const previewTimerRef = useRef<number | null>(null);
  const source = clip?.currentVideo?.asset.previewUrl ?? null;
  const declaredDuration = (clip?.currentVideo?.durationMs ?? 0) / 1_000;
  const [duration, setDuration] = useState(
    declaredDuration > 0 ? Math.max(declaredDuration, MIN_WINDOW_SECONDS) : 10
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [tool, setTool] = useState<EditorTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(drafts[0]?.id ?? null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const selected = useMemo(
    () => drafts.find((draft) => draft.id === selectedId) ?? null,
    [drafts, selectedId]
  );
  const targets = useMemo(
    () =>
      nodes.filter(
        (candidate): candidate is StoryClipGraphNode =>
          candidate.kind === "clip" && candidate.nodeId !== node.nodeId
      ),
    [node.nodeId, nodes]
  );
  const currentNodeLabel = node.name?.trim() || node.clipKey;

  const commitDrafts = useCallback(
    (nextDrafts: StoryInteractionDraft[]) => {
      draftsRef.current = nextDrafts;
      onDraftsChange(nextDrafts);
    },
    [onDraftsChange]
  );

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(
    () => () => {
      const returnFocus = returnFocusRef.current;
      if (!returnFocus?.isConnected) return;
      queueMicrotask(() => returnFocus.focus({ preventScroll: true }));
    },
    []
  );

  useEffect(() => {
    const stage = stageElement;
    if (!stage) return;
    const measure = () => {
      const bounds = stage.getBoundingClientRect();
      setStageSize({ width: bounds.width, height: bounds.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageElement]);

  const updateDraft = useCallback(
    (id: string, update: (draft: StoryInteractionDraft) => StoryInteractionDraft) => {
      commitDrafts(draftsRef.current.map((draft) => (draft.id === id ? update(draft) : draft)));
    },
    [commitDrafts]
  );

  const createHotspot = useCallback(
    (rect: NormalizedHotspotRect): string => {
      const currentDrafts = draftsRef.current;
      const id = createStoryHotspotId();
      const startSeconds = clamp(currentTime, 0, Math.max(0, duration - MIN_WINDOW_SECONDS));
      const endSeconds = clamp(
        startSeconds + Math.min(2, Math.max(MIN_WINDOW_SECONDS, duration / 3)),
        startSeconds + MIN_WINDOW_SECONDS,
        duration
      );
      const draft: StoryInteractionDraft = {
        id,
        label: t("newHotspot", { number: currentDrafts.length + 1 }),
        rect,
        startSeconds,
        endSeconds,
        branchAtSeconds: null,
        trigger: { kind: "tap" },
        outcomes: { success: { kind: "continue" } },
      };
      commitDrafts([...currentDrafts, draft]);
      setSelectedId(id);
      return id;
    },
    [commitDrafts, currentTime, duration, t]
  );

  const addDefaultHotspot = () => {
    createHotspot({ x: 0.35, y: 0.31, width: 0.3, height: 0.28 });
    setTool("select");
  };

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const next = draftsRef.current.filter((draft) => draft.id !== selectedId);
    commitDrafts(next);
    setSelectedId(next[0]?.id ?? null);
  }, [commitDrafts, selectedId, setSelectedId]);

  const duplicateSelected = () => {
    if (!selected) return;
    const currentDrafts = draftsRef.current;
    const id = createStoryHotspotId();
    const draft: StoryInteractionDraft = {
      ...selected,
      id,
      label: t("copyName", { name: selected.label }),
      rect: {
        ...selected.rect,
        x: clamp(selected.rect.x + 0.03, 0, 1 - selected.rect.width),
        y: clamp(selected.rect.y + 0.03, 0, 1 - selected.rect.height),
      },
    };
    commitDrafts([...currentDrafts, draft]);
    setSelectedId(id);
  };

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
      } catch {
        setPlaying(false);
      }
      return;
    }
    video.pause();
  }, []);

  const seek = useCallback(
    (seconds: number) => {
      const next = clamp(seconds, 0, duration);
      if (videoRef.current) videoRef.current.currentTime = next;
      setCurrentTime(next);
    },
    [duration]
  );

  const scrubTimeline = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (video && !video.paused) video.pause();
      seek(seconds);
    },
    [seek]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editingText =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (editingText) return;
      if ((event.key === "Backspace" || event.key === "Delete") && mode === "edit") {
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteSelected();
      }
      if (event.code === "Space") {
        event.preventDefault();
        event.stopImmediatePropagation();
        void togglePlayback();
      }
      if (event.key.toLowerCase() === "v") {
        event.stopImmediatePropagation();
        setTool("select");
      }
      if (event.key.toLowerCase() === "r" && mode === "edit") {
        event.stopImmediatePropagation();
        setTool("rectangle");
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [deleteSelected, mode, togglePlayback]);

  useEffect(
    () => () => {
      if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
    },
    []
  );

  const showPreviewAction = (draft: StoryInteractionDraft) => {
    const action = draft.outcomes.success;
    if (action.kind === "continue") {
      setPreviewMessage(t("previewContinue"));
    } else if (action.kind === "seek") {
      setPreviewMessage(t("previewSeek", { time: formatTime(action.timeSeconds) }));
    } else {
      const targetNodeId = action.targetNodeId;
      const target = nodes.find((candidate) => candidate.nodeId === targetNodeId);
      setPreviewMessage(
        target ? t("previewAction", { target: storyNodeLabel(target) }) : t("previewMissingTarget")
      );
    }
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(() => setPreviewMessage(null), 2200);
  };

  const activeDrafts = drafts.filter(
    (draft) => currentTime >= draft.startSeconds && currentTime <= draft.endSeconds
  );
  const presentedDrafts = mode === "preview" ? activeDrafts : drafts;
  const tickCount = duration <= 12 ? Math.ceil(duration) : 10;
  const timelineTicks = Array.from(
    { length: tickCount + 1 },
    (_, index) => (index / tickCount) * duration
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        animateOpen={false}
        showCloseButton={false}
        overlayClassName="z-[70] bg-black/52 backdrop-blur-[6px]"
        className="fixed top-3 right-3 bottom-3 left-3 z-[71] flex h-auto w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-[24px] border border-white/[0.09] bg-[#090909] p-0 text-xs text-white shadow-[0_32px_120px_rgba(0,0,0,0.72)] ring-1 ring-black/70 sm:max-w-none xl:top-5 xl:right-5 xl:bottom-5 xl:left-5"
        aria-label={t("workspaceLabel")}
        aria-modal="true"
        data-story-interaction-editor=""
        data-interaction-editor-surface=""
      >
        <header className="relative flex h-14 shrink-0 items-center border-b border-white/[0.07] bg-[#0d0d0d] px-3">
          <DialogClose asChild>
            <button
              type="button"
              className="grid size-9 place-items-center rounded-xl text-white/56 transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
              aria-label={t("back")}
            >
              <IconArrowLeft className="size-[18px]" stroke={1.8} />
            </button>
          </DialogClose>
          <div className="ml-2 min-w-0">
            <div className="flex items-center gap-2">
              <DialogTitle className="max-w-[360px] truncate text-[13px] font-semibold">
                {currentNodeLabel}
              </DialogTitle>
              <DialogDescription className="sr-only">{t("subtitle")}</DialogDescription>
              <span className="rounded-md bg-white/[0.07] px-2 py-0.5 text-xs font-semibold tracking-[0.08em] text-white/42 uppercase">
                {t("projectInteraction")}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-white/32">{t("subtitle")}</p>
          </div>

          <div className="absolute left-1/2 flex -translate-x-1/2 rounded-[12px] bg-white/[0.055] p-1">
            {(["edit", "preview"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => {
                  setMode(candidate);
                  if (candidate === "preview") setTool("select");
                }}
                className={cn(
                  "min-w-20 rounded-[9px] px-4 py-1.5 text-xs font-semibold transition",
                  mode === candidate
                    ? "bg-white/[0.13] text-white shadow-[0_3px_12px_rgba(0,0,0,0.24)]"
                    : "text-white/42 hover:text-white/72"
                )}
              >
                {t(candidate)}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-white/28 xl:block">{t("refreshWarning")}</span>
            <DialogClose asChild>
              <button
                type="button"
                className="h-9 rounded-xl bg-white px-4 text-xs font-semibold text-black transition hover:bg-white/88 focus-visible:ring-2 focus-visible:ring-white/55 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:outline-none"
              >
                {t("done")}
              </button>
            </DialogClose>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-white/[0.065] bg-[#0c0c0c] py-3">
            <ToolButton
              active={tool === "select"}
              disabled={mode === "preview"}
              label={t("selectTool")}
              shortcut="V"
              onClick={() => setTool("select")}
            >
              <IconSelector className="size-[18px]" stroke={1.7} />
            </ToolButton>
            <ToolButton
              active={tool === "rectangle"}
              disabled={mode === "preview"}
              label={t("rectangleTool")}
              shortcut="R"
              onClick={() => setTool("rectangle")}
            >
              <IconRectangle className="size-[18px]" stroke={1.7} />
            </ToolButton>
            <div className="my-1 h-px w-7 bg-white/[0.07]" />
            <ToolButton
              disabled={mode === "preview"}
              label={t("addHotspot")}
              onClick={addDefaultHotspot}
            >
              <IconPlus className="size-[18px]" stroke={1.7} />
            </ToolButton>
            <div className="mt-auto flex flex-col gap-2">
              <ToolButton
                disabled={!selected || mode === "preview"}
                label={t("duplicate")}
                onClick={duplicateSelected}
              >
                <IconCopy className="size-[17px]" stroke={1.7} />
              </ToolButton>
              <ToolButton
                disabled={!selected || mode === "preview"}
                label={t("delete")}
                danger
                onClick={deleteSelected}
              >
                <IconTrash className="size-[17px]" stroke={1.7} />
              </ToolButton>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#101010] p-6">
              <div className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:radial-gradient(rgba(255,255,255,.22)_1px,transparent_1px)] [background-size:18px_18px]" />
              <div
                ref={bindStageRef}
                data-interaction-stage=""
                className={cn(
                  "relative max-h-full max-w-full overflow-hidden bg-black shadow-[0_28px_100px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.08]",
                  frameProfile === "portrait_9_16"
                    ? "aspect-[9/16] h-full"
                    : "aspect-video w-full max-w-[980px]",
                  mode === "edit" && tool === "rectangle" && "cursor-crosshair"
                )}
              >
                {source ? (
                  <video
                    ref={videoRef}
                    src={source}
                    muted={muted}
                    playsInline
                    preload="metadata"
                    className="pointer-events-none size-full select-none object-contain"
                    onLoadedMetadata={(event) => {
                      const nextDuration = event.currentTarget.duration;
                      if (Number.isFinite(nextDuration) && nextDuration > 0) {
                        const normalizedDuration = Math.max(nextDuration, MIN_WINDOW_SECONDS);
                        setDuration(normalizedDuration);
                        setCurrentTime((time) => Math.min(time, normalizedDuration));
                        const fittedDrafts = fitDraftsToDuration(
                          draftsRef.current,
                          normalizedDuration
                        );
                        if (fittedDrafts !== draftsRef.current) commitDrafts(fittedDrafts);
                      }
                    }}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                  />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center bg-[#070707] text-center">
                    <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.055] text-white/30">
                      <IconRectangle className="size-5" stroke={1.6} />
                    </span>
                    <p className="mt-3 text-xs font-semibold text-white/58">{t("noVideo")}</p>
                    <p className="mt-1 max-w-64 text-xs leading-5 text-white/30">
                      {t("noVideoDescription")}
                    </p>
                  </div>
                )}

                <StoryHotspotStage
                  width={stageSize.width}
                  height={stageSize.height}
                  drafts={presentedDrafts}
                  selectedId={selectedId}
                  currentTime={currentTime}
                  mode={mode}
                  tool={tool}
                  minimumSize={MIN_RECT_SIZE}
                  onCreate={createHotspot}
                  onRectChange={(id, rect) => updateDraft(id, (draft) => ({ ...draft, rect }))}
                  onSelect={setSelectedId}
                  onPreview={showPreviewAction}
                  onDrawComplete={() => setTool("select")}
                />

                {mode === "edit" && drafts.length === 0 ? (
                  <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
                    <div className="pointer-events-auto max-w-72 rounded-2xl bg-black/68 p-4 text-center shadow-[0_18px_60px_rgba(0,0,0,.42)] backdrop-blur-xl">
                      <span className="mx-auto grid size-9 place-items-center rounded-xl bg-white/[0.08] text-white/62">
                        <IconFocusCentered className="size-4" stroke={1.7} />
                      </span>
                      <p className="mt-2.5 text-sm font-semibold text-white/82">
                        {t("emptyTitle")}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-white/42">
                        {t("emptyDescription")}
                      </p>
                      <button
                        type="button"
                        onClick={() => setTool("rectangle")}
                        className="mt-3 h-9 rounded-lg bg-white px-3 text-xs font-semibold text-black transition hover:bg-white/88"
                      >
                        {t("drawFirst")}
                      </button>
                    </div>
                  </div>
                ) : null}

                {previewMessage ? (
                  <div className="pointer-events-none absolute right-4 bottom-4 left-4 z-10 flex justify-center">
                    <div className="flex items-center gap-2 rounded-xl bg-black/78 px-3 py-2 text-xs font-semibold text-white shadow-[0_12px_40px_rgba(0,0,0,.46)] backdrop-blur-xl">
                      <IconRoute className="size-4 text-brand-blue" stroke={1.8} />
                      {previewMessage}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="shrink-0 border-t border-white/[0.065] bg-[#0c0c0c]">
              <div className="flex h-11 items-center gap-3 border-b border-white/[0.055] px-4">
                <button
                  type="button"
                  onClick={() => void togglePlayback()}
                  disabled={!source}
                  className="grid size-7 place-items-center rounded-lg text-white/72 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-25"
                  aria-label={playing ? t("pause") : t("play")}
                >
                  {playing ? (
                    <IconPlayerPause className="size-4" fill="currentColor" />
                  ) : (
                    <IconPlayerPlay className="size-4" fill="currentColor" />
                  )}
                </button>
                <span className="w-[92px] text-xs tabular-nums text-white/52">
                  {formatTime(currentTime)} <span className="text-white/22">/</span>{" "}
                  {formatTime(duration)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.01}
                  value={currentTime}
                  onChange={(event) => seek(Number(event.target.value))}
                  className="h-1 min-w-0 flex-1 cursor-pointer accent-white"
                  aria-label={t("seek")}
                />
                <button
                  type="button"
                  onClick={() => setMuted((current) => !current)}
                  className="grid size-7 place-items-center rounded-lg text-white/52 transition hover:bg-white/[0.08] hover:text-white"
                  aria-label={muted ? t("unmute") : t("mute")}
                >
                  {muted ? (
                    <IconVolumeOff className="size-4" stroke={1.7} />
                  ) : (
                    <IconVolume className="size-4" stroke={1.7} />
                  )}
                </button>
              </div>

              <div className="h-[154px] px-4 pt-3 pb-4">
                <div className="relative ml-[98px] h-4 text-xs tabular-nums text-white/32">
                  {timelineTicks.map((tick) => (
                    <span
                      key={tick}
                      className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
                      style={{ left: `${(tick / duration) * 100}%` }}
                    >
                      {formatTimelineTick(tick)}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-[98px_minmax(0,1fr)] gap-y-2">
                  <div className="flex h-9 items-center gap-2 pr-3 text-xs text-white/44">
                    <IconClock className="size-3.5" stroke={1.6} />
                    {t("videoTrack")}
                  </div>
                  <MediaTimelineTrack
                    durationSeconds={duration}
                    onSeek={seek}
                    className="relative h-9 overflow-hidden rounded-lg bg-white/[0.055] text-left ring-1 ring-white/[0.05]"
                  >
                    <button
                      type="button"
                      aria-label={t("videoTrack")}
                      className="size-full text-left"
                    >
                      <span className="absolute inset-y-0 left-0 w-1 bg-white/24" />
                      <span className="flex size-full items-center px-3 text-xs text-white/52">
                        <span className="truncate">{currentNodeLabel}</span>
                      </span>
                    </button>
                    <span
                      className="pointer-events-none absolute inset-y-0 w-px bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,.4)]"
                      style={{ left: `${(currentTime / duration) * 100}%` }}
                    />
                  </MediaTimelineTrack>

                  <div className="flex h-9 items-center gap-2 pr-3 text-xs text-white/44">
                    <IconClick className="size-3.5" stroke={1.6} />
                    {t("hotspotTrack")}
                  </div>
                  <MediaTimelineTrack
                    durationSeconds={duration}
                    onSeek={seek}
                    className="h-9 overflow-visible rounded-lg bg-white/[0.025] ring-1 ring-white/[0.04]"
                  >
                    {drafts.map((draft) => {
                      const isSelected = draft.id === selectedId;
                      return (
                        <MediaTimelineRange
                          key={draft.id}
                          ariaLabel={draft.label}
                          value={{
                            startSeconds: draft.startSeconds,
                            endSeconds: draft.endSeconds,
                          }}
                          minDurationSeconds={MIN_WINDOW_SECONDS}
                          selected={isSelected}
                          disabled={mode === "preview"}
                          onSelect={() => setSelectedId(draft.id)}
                          onScrub={scrubTimeline}
                          onChange={({ startSeconds, endSeconds }) =>
                            updateDraft(draft.id, (current) => ({
                              ...current,
                              startSeconds,
                              endSeconds,
                            }))
                          }
                          handleClassName="bg-brand-blue"
                          className={cn(
                            "rounded-md border text-xs font-semibold outline-none",
                            isSelected
                              ? "border-brand-blue bg-brand-blue/25 text-white"
                              : "border-white/16 bg-white/[0.08] text-white/48 hover:border-white/35"
                          )}
                        >
                          <span className="block truncate">{draft.label}</span>
                        </MediaTimelineRange>
                      );
                    })}
                    <span
                      className="pointer-events-none absolute -top-1 bottom-[-5px] w-px bg-white/80"
                      style={{ left: `${(currentTime / duration) * 100}%` }}
                    >
                      <span className="absolute -top-1.5 left-1/2 size-1.5 -translate-x-1/2 rotate-45 bg-white" />
                    </span>
                  </MediaTimelineTrack>
                </div>
              </div>
            </div>
          </div>

          <aside className="flex w-[320px] shrink-0 flex-col border-l border-white/[0.065] bg-[#0d0d0d]">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-4">
              <div>
                <h2 className="text-sm font-semibold text-white/78">{t("hotspots")}</h2>
                <p className="mt-0.5 text-xs text-white/34">
                  {t("hotspotCount", { count: drafts.length })}
                </p>
              </div>
              <button
                type="button"
                onClick={addDefaultHotspot}
                disabled={mode === "preview"}
                className="grid size-7 place-items-center rounded-lg bg-white/[0.06] text-white/48 transition hover:bg-white/[0.11] hover:text-white disabled:opacity-30"
                aria-label={t("addHotspot")}
              >
                <IconPlus className="size-4" />
              </button>
            </div>

            {drafts.length > 0 ? (
              <div className="shrink-0 border-b border-white/[0.06] p-2">
                <div className="max-h-[148px] space-y-1 overflow-y-auto">
                  {drafts.map((draft, index) => (
                    <button
                      key={draft.id}
                      type="button"
                      data-hotspot-list-id={draft.id}
                      onClick={() => setSelectedId(draft.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition",
                        draft.id === selectedId
                          ? "bg-white/[0.09] text-white"
                          : "text-white/46 hover:bg-white/[0.05] hover:text-white/72"
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded-md text-xs font-semibold",
                          draft.id === selectedId
                            ? "bg-brand-blue text-white"
                            : "bg-white/[0.07] text-white/42"
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                        {draft.label}
                      </span>
                      <span className="text-xs tabular-nums text-white/32">
                        {formatTime(draft.startSeconds)}–{formatTime(draft.endSeconds)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {selected ? (
                <div className="space-y-5">
                  <PropertySection
                    icon={<IconRectangle className="size-3.5" />}
                    title={t("identity")}
                  >
                    <label className="block">
                      <span className="text-xs font-semibold text-white/38">{t("name")}</span>
                      <input
                        value={selected.label}
                        disabled={mode === "preview"}
                        onChange={(event) =>
                          updateDraft(selected.id, (draft) => ({
                            ...draft,
                            label: event.target.value,
                          }))
                        }
                        className="mt-1.5 h-9 w-full rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-white/20 focus:bg-white/[0.065] disabled:cursor-default disabled:opacity-45"
                      />
                    </label>
                  </PropertySection>

                  <PropertySection icon={<IconClock className="size-3.5" />} title={t("timing")}>
                    <div className="grid grid-cols-2 gap-2">
                      <TimeField
                        label={t("start")}
                        value={selected.startSeconds}
                        disabled={mode === "preview"}
                        max={Math.max(0, selected.endSeconds - MIN_WINDOW_SECONDS)}
                        onChange={(value) =>
                          updateDraft(selected.id, (draft) => ({
                            ...draft,
                            startSeconds: clamp(value, 0, draft.endSeconds - MIN_WINDOW_SECONDS),
                          }))
                        }
                      />
                      <TimeField
                        label={t("end")}
                        value={selected.endSeconds}
                        disabled={mode === "preview"}
                        max={duration}
                        onChange={(value) =>
                          updateDraft(selected.id, (draft) => ({
                            ...draft,
                            endSeconds: clamp(
                              value,
                              draft.startSeconds + MIN_WINDOW_SECONDS,
                              duration
                            ),
                          }))
                        }
                      />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-white/34">{t("timingHint")}</p>
                    <label className="mt-3 block">
                      <span className="text-xs font-semibold text-white/38">{t("branchAt")}</span>
                      <div className="relative mt-1.5">
                        <input
                          type="number"
                          data-branch-at
                          disabled={mode === "preview"}
                          min={selected.endSeconds}
                          max={duration}
                          step={0.1}
                          value={(selected.branchAtSeconds ?? selected.endSeconds).toFixed(1)}
                          onChange={(event) =>
                            updateDraft(selected.id, (draft) => ({
                              ...draft,
                              branchAtSeconds: clamp(
                                Number(event.target.value),
                                draft.endSeconds,
                                duration >= draft.endSeconds ? duration : draft.endSeconds
                              ),
                            }))
                          }
                          className="h-9 w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-2.5 pr-7 text-xs tabular-nums text-white/72 outline-none focus:border-white/18 disabled:cursor-default disabled:opacity-45"
                        />
                        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-white/30">
                          s
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-white/34">{t("branchAtHint")}</p>
                    </label>
                  </PropertySection>

                  <PropertySection
                    icon={<IconArrowsMove className="size-3.5" />}
                    title={t("position")}
                  >
                    <div className="grid grid-cols-2 gap-2">
                      {(["x", "y", "width", "height"] as const).map((field) => (
                        <label key={field} className="block">
                          <span className="text-xs font-semibold text-white/38">{t(field)}</span>
                          <div className="relative mt-1.5">
                            <input
                              type="number"
                              data-position-field={field}
                              disabled={mode === "preview"}
                              min={0}
                              max={100}
                              step={0.1}
                              value={(selected.rect[field] * 100).toFixed(1)}
                              onChange={(event) => {
                                const ratio = Number(event.target.value) / 100;
                                updateDraft(selected.id, (draft) => ({
                                  ...draft,
                                  rect: normalizeEditedRect(draft.rect, field, ratio),
                                }));
                              }}
                              className="h-9 w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-2.5 pr-7 text-xs tabular-nums text-white/72 outline-none focus:border-white/18 disabled:cursor-default disabled:opacity-45"
                            />
                            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-white/30">
                              %
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </PropertySection>

                  <PropertySection icon={<IconClick className="size-3.5" />} title={t("trigger")}>
                    <label className="block">
                      <span className="text-xs font-semibold text-white/38">
                        {t("interactionType")}
                      </span>
                      <div className="relative mt-1.5">
                        <select
                          aria-label={t("interactionType")}
                          value={selected.trigger.kind}
                          disabled={mode === "preview"}
                          onChange={(event) =>
                            updateDraft(selected.id, (draft) => ({
                              ...draft,
                              trigger:
                                event.target.value === "swipe"
                                  ? { kind: "swipe", direction: "right" }
                                  : event.target.value === "press-hold"
                                    ? {
                                        kind: "press-hold",
                                        durationSeconds: 0.8,
                                        controlTimeline: false,
                                      }
                                    : { kind: "tap" },
                              outcomes:
                                event.target.value === "tap"
                                  ? { ...draft.outcomes, failure: undefined }
                                  : draft.outcomes,
                            }))
                          }
                          className="h-9 w-full appearance-none rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 pr-8 text-sm text-white/72 outline-none transition focus:border-white/20 disabled:cursor-default disabled:opacity-45"
                        >
                          <option value="tap">{t("tap")}</option>
                          <option value="swipe">{t("swipe")}</option>
                          <option value="press-hold">{t("pressHold")}</option>
                        </select>
                        <IconChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-white/30" />
                      </div>
                    </label>
                    {selected.trigger.kind === "swipe" ? (
                      <label className="mt-3 block">
                        <span className="text-xs font-semibold text-white/38">
                          {t("direction")}
                        </span>
                        <div className="relative mt-1.5">
                          <select
                            value={selected.trigger.direction}
                            disabled={mode === "preview"}
                            onChange={(event) =>
                              updateDraft(selected.id, (draft) => ({
                                ...draft,
                                trigger: {
                                  kind: "swipe",
                                  direction: event.target.value as "up" | "down" | "left" | "right",
                                },
                              }))
                            }
                            className="h-9 w-full appearance-none rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 pr-8 text-sm text-white/72 outline-none transition focus:border-white/20 disabled:cursor-default disabled:opacity-45"
                          >
                            <option value="up">{t("directionUp")}</option>
                            <option value="down">{t("directionDown")}</option>
                            <option value="left">{t("directionLeft")}</option>
                            <option value="right">{t("directionRight")}</option>
                          </select>
                          <IconChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-white/30" />
                        </div>
                      </label>
                    ) : null}
                    {selected.trigger.kind === "press-hold" ? (
                      <label className="mt-3 block">
                        <span className="text-xs font-semibold text-white/38">
                          {t("holdDuration")}
                        </span>
                        <div className="relative mt-1.5">
                          <input
                            type="number"
                            min={0.3}
                            max={10}
                            step={0.1}
                            value={selected.trigger.durationSeconds}
                            disabled={mode === "preview"}
                            onChange={(event) =>
                              updateDraft(selected.id, (draft) => ({
                                ...draft,
                                trigger:
                                  draft.trigger.kind === "press-hold"
                                    ? {
                                        kind: "press-hold",
                                        durationSeconds: clamp(Number(event.target.value), 0.3, 10),
                                        controlTimeline: draft.trigger.controlTimeline,
                                      }
                                    : draft.trigger,
                              }))
                            }
                            className="h-9 w-full rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 pr-8 text-sm tabular-nums text-white/72 outline-none focus:border-white/20 disabled:opacity-45"
                          />
                          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-white/30">
                            s
                          </span>
                        </div>
                      </label>
                    ) : null}
                    {selected.trigger.kind === "press-hold" ? (
                      <label className="mt-3 flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          data-control-timeline
                          checked={selected.trigger.controlTimeline}
                          disabled={mode === "preview"}
                          onChange={(event) =>
                            updateDraft(selected.id, (draft) => ({
                              ...draft,
                              trigger:
                                draft.trigger.kind === "press-hold"
                                  ? {
                                      kind: "press-hold",
                                      durationSeconds: draft.trigger.durationSeconds,
                                      controlTimeline: event.target.checked,
                                    }
                                  : draft.trigger,
                            }))
                          }
                          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[#ff5c5c]"
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-white/60">
                            {t("controlTimeline")}
                          </span>
                          <span className="mt-0.5 block text-xs leading-4 text-white/34">
                            {t("controlTimelineHint")}
                          </span>
                        </span>
                      </label>
                    ) : null}
                  </PropertySection>

                  <PropertySection icon={<IconRoute className="size-3.5" />} title={t("outcomes")}>
                    <div className="space-y-4">
                      <ActionField
                        ariaLabel={t("successOutcome")}
                        label={t("successOutcome")}
                        action={selected.outcomes.success}
                        targets={targets}
                        duration={duration}
                        disabled={mode === "preview"}
                        onChange={(action) =>
                          updateDraft(selected.id, (draft) => ({
                            ...draft,
                            outcomes: { ...draft.outcomes, success: action },
                          }))
                        }
                      />
                      {selected.trigger.kind !== "tap" ? (
                        <OptionalActionField
                          label={t("failureOutcome")}
                          action={selected.outcomes.failure}
                          targets={targets}
                          duration={duration}
                          disabled={mode === "preview"}
                          onChange={(action) =>
                            updateDraft(selected.id, (draft) => ({
                              ...draft,
                              outcomes: { ...draft.outcomes, failure: action },
                            }))
                          }
                        />
                      ) : null}
                      <OptionalActionField
                        label={t("timeoutOutcome")}
                        action={selected.outcomes.timeout}
                        targets={targets}
                        duration={duration}
                        disabled={mode === "preview"}
                        onChange={(action) =>
                          updateDraft(selected.id, (draft) => ({
                            ...draft,
                            outcomes: { ...draft.outcomes, timeout: action },
                          }))
                        }
                      />
                    </div>
                  </PropertySection>
                </div>
              ) : (
                <div className="flex h-full min-h-52 flex-col items-center justify-center text-center">
                  <span className="grid size-10 place-items-center rounded-2xl bg-white/[0.05] text-white/28">
                    <IconClick className="size-4" stroke={1.6} />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-white/52">{t("nothingSelected")}</p>
                  <p className="mt-1 max-w-48 text-xs leading-5 text-white/34">
                    {t("nothingSelectedDescription")}
                  </p>
                </div>
              )}
            </div>

            {selected ? (
              <div className="flex shrink-0 gap-2 border-t border-white/[0.06] p-3">
                <button
                  type="button"
                  onClick={duplicateSelected}
                  disabled={mode === "preview"}
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/[0.055] text-xs font-semibold text-white/48 transition hover:bg-white/[0.09] hover:text-white disabled:pointer-events-none disabled:opacity-30"
                >
                  <IconCopy className="size-3.5" />
                  {t("duplicate")}
                </button>
                <button
                  type="button"
                  onClick={deleteSelected}
                  disabled={mode === "preview"}
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-destructive/[0.08] text-xs font-semibold text-destructive/80 transition hover:bg-destructive/[0.14] hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                >
                  <IconTrash className="size-3.5" />
                  {t("delete")}
                </button>
              </div>
            ) : null}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function storyNodeLabel(node: StoryGraphNode): string {
  return node.name?.trim() || (node.kind === "clip" ? node.clipKey : (node.worldId ?? node.nodeId));
}

function ToolButton({
  active = false,
  disabled = false,
  danger = false,
  label,
  shortcut,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "relative grid size-9 place-items-center rounded-xl outline-none transition focus-visible:ring-2 focus-visible:ring-white/35 disabled:pointer-events-none disabled:opacity-25",
        active
          ? "bg-white/[0.13] text-white"
          : danger
            ? "text-destructive/70 hover:bg-destructive/[0.1] hover:text-destructive"
            : "text-white/42 hover:bg-white/[0.075] hover:text-white/78"
      )}
    >
      {children}
      {shortcut ? (
        <span className="absolute right-0.5 bottom-0 text-xs leading-none font-semibold text-white/28">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

function PropertySection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 text-white/48">
        {icon}
        <h3 className="text-xs font-semibold tracking-[0.05em] uppercase">{title}</h3>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function OptionalActionField({
  label,
  action,
  targets,
  duration,
  disabled,
  onChange,
}: {
  label: string;
  action: StoryInteractionActionDraft | undefined;
  targets: StoryClipGraphNode[];
  duration: number;
  disabled: boolean;
  onChange: (action: StoryInteractionActionDraft | undefined) => void;
}) {
  const t = useTranslations("storyStudio.canvas.interactionEditor");
  if (!action) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange({ kind: "continue" })}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/[0.1] text-xs font-semibold text-white/38 transition hover:border-white/20 hover:bg-white/[0.035] hover:text-white/68 disabled:pointer-events-none disabled:opacity-35"
      >
        <IconPlus className="size-3.5" />
        {t("addOutcome", { outcome: label })}
      </button>
    );
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-white/38">{label}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(undefined)}
          className="rounded-md px-1.5 py-1 text-xs font-semibold text-white/28 transition hover:bg-white/[0.05] hover:text-white/60 disabled:pointer-events-none disabled:opacity-35"
        >
          {t("removeOutcome")}
        </button>
      </div>
      <ActionField
        ariaLabel={label}
        action={action}
        targets={targets}
        duration={duration}
        disabled={disabled}
        onChange={(next) => onChange(next)}
      />
    </div>
  );
}

function ActionField({
  ariaLabel,
  label,
  action,
  targets,
  duration,
  disabled,
  onChange,
}: {
  ariaLabel: string;
  label?: string;
  action: StoryInteractionActionDraft;
  targets: StoryClipGraphNode[];
  duration: number;
  disabled: boolean;
  onChange: (action: StoryInteractionActionDraft) => void;
}) {
  const t = useTranslations("storyStudio.canvas.interactionEditor");
  return (
    <div>
      {label ? <span className="text-xs font-semibold text-white/38">{label}</span> : null}
      <div className={cn("relative", label && "mt-1.5")}>
        <select
          aria-label={ariaLabel}
          value={action.kind}
          disabled={disabled}
          onChange={(event) => {
            const kind = event.target.value;
            if (kind === "goto") {
              const targetNodeId = targets[0]?.nodeId;
              if (targetNodeId) onChange({ kind: "goto", targetNodeId });
              return;
            }
            onChange(
              kind === "seek" ? { kind: "seek", timeSeconds: duration } : { kind: "continue" }
            );
          }}
          className="h-9 w-full appearance-none rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 pr-8 text-sm text-white/72 outline-none transition focus:border-white/20 disabled:cursor-default disabled:opacity-45"
        >
          <option value="continue">{t("continueCurrent")}</option>
          <option value="seek">{t("seekCurrent")}</option>
          <option value="goto" disabled={targets.length === 0}>
            {t("goToScene")}
          </option>
        </select>
        <IconChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-white/30" />
      </div>

      {action.kind === "goto" ? (
        <label className="mt-2 block">
          <span className="text-xs font-semibold text-white/38">{t("destination")}</span>
          <div className="relative mt-1.5">
            <select
              value={action.targetNodeId}
              disabled={disabled}
              onChange={(event) => onChange({ kind: "goto", targetNodeId: event.target.value })}
              className="h-9 w-full appearance-none rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 pr-8 text-sm text-white/72 outline-none transition focus:border-white/20 disabled:cursor-default disabled:opacity-45"
            >
              {targets.map((target) => (
                <option key={target.nodeId} value={target.nodeId}>
                  {storyNodeLabel(target)}
                </option>
              ))}
            </select>
            <IconChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-white/30" />
          </div>
        </label>
      ) : null}

      {action.kind === "seek" ? (
        <label className="mt-2 block">
          <span className="text-xs font-semibold text-white/38">{t("seekTime")}</span>
          <div className="relative mt-1.5">
            <input
              type="number"
              min={0}
              max={duration}
              step={0.1}
              value={action.timeSeconds}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  kind: "seek",
                  timeSeconds: clamp(Number(event.target.value), 0, duration),
                })
              }
              className="h-9 w-full rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 pr-8 text-sm tabular-nums text-white/72 outline-none focus:border-white/20 disabled:opacity-45"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-white/30">
              s
            </span>
          </div>
        </label>
      ) : null}
    </div>
  );
}

function TimeField({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-white/38">{label}</span>
      <div className="relative mt-1.5">
        <input
          type="number"
          disabled={disabled}
          min={0}
          max={max}
          step={0.1}
          value={value.toFixed(1)}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-9 w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-2.5 pr-7 text-xs tabular-nums text-white/72 outline-none focus:border-white/18 disabled:cursor-default disabled:opacity-45"
        />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-white/30">
          s
        </span>
      </div>
    </label>
  );
}

function normalizeEditedRect(
  rect: StoryInteractionDraft["rect"],
  field: keyof StoryInteractionDraft["rect"],
  value: number
): StoryInteractionDraft["rect"] {
  if (!Number.isFinite(value)) return rect;
  if (field === "x") return { ...rect, x: clamp(value, 0, 1 - rect.width) };
  if (field === "y") return { ...rect, y: clamp(value, 0, 1 - rect.height) };
  if (field === "width") {
    return { ...rect, width: clamp(value, MIN_RECT_SIZE, 1 - rect.x) };
  }
  return { ...rect, height: clamp(value, MIN_RECT_SIZE, 1 - rect.y) };
}

function fitDraftsToDuration(
  drafts: StoryInteractionDraft[],
  duration: number
): StoryInteractionDraft[] {
  let changed = false;
  const fitted = drafts.map((draft) => {
    const startSeconds = clamp(draft.startSeconds, 0, duration - MIN_WINDOW_SECONDS);
    const endSeconds = clamp(draft.endSeconds, startSeconds + MIN_WINDOW_SECONDS, duration);
    if (startSeconds === draft.startSeconds && endSeconds === draft.endSeconds) return draft;
    changed = true;
    return { ...draft, startSeconds, endSeconds };
  });
  return changed ? fitted : drafts;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${minutes}:${String(remainder).padStart(2, "0")}.${tenths}`;
}

function formatTimelineTick(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return formatTime(seconds).slice(0, -2);
}
