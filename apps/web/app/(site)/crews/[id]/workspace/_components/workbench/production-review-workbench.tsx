"use client";

import { useMemo, useRef, useState } from "react";
import {
  IconBookmark,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconDots,
  IconFilter,
  IconGridDots,
  IconMaximize,
  IconMessageCircle,
  IconMinus,
  IconMoodSmile,
  IconPaperclip,
  IconPhoto,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconSend,
  IconShare3,
  IconVolume,
  IconVolumeOff,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { useTranslations } from "@/src/i18n/i18n";

type InspectorTab = "comments" | "fields";
type StripTab = "assets" | "versions";

const FRAMES = [
  {
    id: "shot-01",
    code: "SC.010 · SHOT.01",
    time: "00:00",
    src: "/crew-workbench/storyboard-01.png",
  },
  {
    id: "shot-02",
    code: "SC.010 · SHOT.02",
    time: "00:01.8",
    src: "/crew-workbench/storyboard-02.png",
  },
  {
    id: "shot-03",
    code: "SC.010 · SHOT.03",
    time: "00:04.2",
    src: "/crew-workbench/storyboard-03.png",
  },
  {
    id: "shot-04",
    code: "SC.010 · SHOT.04",
    time: "00:06.3",
    src: "/crew-workbench/storyboard-04.png",
  },
] as const;

const INITIAL_COMMENTS = [
  {
    id: "comment-1",
    author: "Zhang Xiao",
    seed: "crew-review-zhang",
    timecode: "00:04:21",
    ageKey: "commentAge29Minutes",
    bodyKey: "commentCamera",
    attachment: "",
  },
  {
    id: "comment-2",
    author: "Chen Hang",
    seed: "crew-review-chen",
    timecode: "00:04:21",
    ageKey: "commentAgeOneHour",
    bodyKey: "commentRain",
    attachment: "",
  },
  {
    id: "comment-3",
    author: "Zhao Jian",
    seed: "crew-review-zhao",
    timecode: "00:06:03",
    ageKey: "commentAgeTwoHours",
    bodyKey: "commentHeadlights",
    attachment: "",
  },
  {
    id: "comment-4",
    author: "Lin Mo",
    seed: "crew-review-lin",
    timecode: "00:08:11",
    ageKey: "commentAgeThreeHours",
    bodyKey: "commentCrowd",
    attachment: "crowd-reference.jpg",
  },
] as const;

interface ProductionReviewWorkbenchProps {
  crewName: string;
}

export function ProductionReviewWorkbench({ crewName }: ProductionReviewWorkbenchProps) {
  const tw = useTranslations("crewWorkbench");
  const viewerRef = useRef<HTMLDivElement>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string>("shot-03");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("comments");
  const [stripTab, setStripTab] = useState<StripTab>("assets");
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set(["comment-1"]));
  const [draft, setDraft] = useState("");
  const [localComments, setLocalComments] = useState<
    Array<{ id: string; body: string; timecode: string }>
  >([]);
  const [uploadOpen, setUploadOpen] = useState(true);

  const selectedFrame = useMemo(
    () => FRAMES.find((frame) => frame.id === selectedFrameId) ?? FRAMES[0],
    [selectedFrameId]
  );

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(tw("linkCopied"));
    } catch {
      toast.error(tw("linkCopyFailed"));
    }
  };

  const toggleSubmitted = () => {
    setSubmitted((current) => {
      toast.success(current ? tw("reviewReopened") : tw("reviewSubmitted"));
      return !current;
    });
  };

  const addComment = () => {
    const body = draft.trim();
    if (!body) return;
    setLocalComments((current) => [
      ...current,
      { id: `local-${Date.now()}`, body, timecode: "00:04:21" },
    ]);
    setDraft("");
  };

  const toggleResolved = (id: string) => {
    setResolvedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openFullscreen = async () => {
    if (!viewerRef.current?.requestFullscreen) return;
    await viewerRef.current.requestFullscreen();
  };

  return (
    <div data-pane="assets" className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#07080a]">
      <header className="flex h-[58px] shrink-0 items-center justify-between gap-3 border-b border-white/[0.075] bg-[#0a0b0e] px-3.5">
        <div className="flex min-w-0 items-center gap-1 text-[11px]">
          <span className="truncate text-[#6f7480]">{crewName}</span>
          <IconChevronRight className="size-3 shrink-0 text-[#464b54]" />
          <span className="shrink-0 text-[#767b86]">{tw("episode01")}</span>
          <IconChevronRight className="size-3 shrink-0 text-[#464b54]" />
          <span className="truncate font-medium text-[#e6e8ec]">S01-010 {tw("taskChase")}</span>
          <IconChevronDown className="size-3 shrink-0 text-[#626873]" />
          <span className="ml-1 rounded-[5px] bg-white/[0.06] px-1.5 py-1 text-[10px] font-medium text-[#9ca1ab]">
            v3
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="mr-1 hidden items-center sm:flex">
            {["Alex", "Zhang", "Chen", "Lin"].map((name, index) => (
              <UserAvatar
                key={name}
                name={name}
                seed={`crew-toolbar-${name}`}
                size={24}
                className={cn("ring-2 ring-[#0a0b0e]", index > 0 && "-ml-1.5")}
              />
            ))}
            <span className="ml-1 text-[10px] text-[#717681]">+4</span>
          </div>

          <button
            type="button"
            onClick={() => void share()}
            className="hidden h-8 items-center gap-1.5 rounded-[7px] border border-white/[0.09] bg-white/[0.025] px-3 text-[11px] font-medium text-[#d5d7dc] transition-colors hover:bg-white/[0.06] sm:inline-flex"
          >
            <IconShare3 className="size-3.5" />
            {tw("share")}
          </button>
          <button
            type="button"
            aria-label={tw("moreActions")}
            title={tw("moreActions")}
            className="grid size-8 place-items-center rounded-[7px] border border-white/[0.09] text-[#9499a3] transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <IconDots className="size-4" />
          </button>
          <button
            type="button"
            onClick={toggleSubmitted}
            className={cn(
              "inline-flex h-8 min-w-[112px] items-center justify-center gap-1.5 rounded-[7px] px-3 text-[11px] font-semibold transition-colors",
              submitted
                ? "bg-[#20352a] text-[#8ce3ad] hover:bg-[#294333]"
                : "bg-[#e52227] text-white hover:bg-[#f13137]"
            )}
          >
            {submitted ? <IconCheck className="size-3.5" /> : <IconSend className="size-3.5" />}
            {submitted ? tw("approved") : tw("submitReview")}
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_332px]">
        <div className="flex min-h-0 min-w-0 flex-col bg-[#08090b]">
          <div className="min-h-0 flex-1 p-2.5 pb-0">
            <div
              ref={viewerRef}
              className="relative flex h-full min-h-[260px] flex-col overflow-hidden rounded-[8px] border border-white/[0.075] bg-black"
            >
              <div className="relative min-h-0 flex-1 overflow-hidden bg-[#050506]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedFrame.src}
                  alt={selectedFrame.code}
                  className="size-full object-contain transition-transform duration-200 ease-out"
                  style={{ transform: `scale(${zoom})` }}
                />
                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1">
                  {selectedFrame.code.split(" · ").map((segment) => (
                    <span
                      key={segment}
                      className="rounded-[4px] bg-black/65 px-1.5 py-0.5 font-mono text-[9px] text-white/80 backdrop-blur-sm"
                    >
                      {segment}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex h-10 shrink-0 items-center border-t border-white/[0.075] px-3">
                <button
                  type="button"
                  aria-label={isPlaying ? tw("pause") : tw("play")}
                  onClick={() => setIsPlaying((value) => !value)}
                  className="grid size-7 place-items-center rounded-md text-white/80 hover:bg-white/[0.07] hover:text-white"
                >
                  {isPlaying ? (
                    <IconPlayerPause className="size-4" fill="currentColor" />
                  ) : (
                    <IconPlayerPlay className="size-4" fill="currentColor" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={muted ? tw("unmute") : tw("mute")}
                  onClick={() => setMuted((value) => !value)}
                  className="grid size-7 place-items-center rounded-md text-white/70 hover:bg-white/[0.07] hover:text-white"
                >
                  {muted ? <IconVolumeOff className="size-4" /> : <IconVolume className="size-4" />}
                </button>
                <span className="ml-auto font-mono text-[9px] tabular-nums text-white/75">
                  00:04:21:12
                  <span className="mx-1.5 text-white/30">/</span>
                  <span className="text-white/40">00:12:08:00</span>
                </span>
                <button
                  type="button"
                  className="ml-auto hidden h-6 items-center gap-1 rounded px-1.5 text-[9px] text-white/60 hover:bg-white/[0.07] sm:flex"
                >
                  1080p <IconChevronDown className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void openFullscreen()}
                  aria-label={tw("fullscreen")}
                  className="ml-1 grid size-7 place-items-center rounded-md text-white/70 hover:bg-white/[0.07] hover:text-white"
                >
                  <IconMaximize className="size-4" />
                </button>
              </div>

              <Timeline selectedFrameId={selectedFrameId} onSelectFrame={setSelectedFrameId} />
            </div>
          </div>

          <div className="h-[190px] shrink-0 px-2.5 pb-2.5 pt-2">
            <div className="flex h-full min-h-0 flex-col rounded-[8px] border border-white/[0.075] bg-[#0a0b0e]">
              <div className="flex h-9 shrink-0 items-center border-b border-white/[0.06] px-2.5">
                <StripTabButton
                  active={stripTab === "assets"}
                  label={tw("assets")}
                  onClick={() => setStripTab("assets")}
                />
                <StripTabButton
                  active={stripTab === "versions"}
                  label={tw("versions")}
                  onClick={() => setStripTab("versions")}
                />
                <div className="ml-auto flex items-center gap-0.5 text-[#6f7480]">
                  <button
                    type="button"
                    aria-label={tw("gridView")}
                    className="grid size-6 place-items-center rounded hover:bg-white/[0.06] hover:text-white"
                  >
                    <IconGridDots className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={tw("zoomOut")}
                    onClick={() => setZoom((value) => Math.max(1, value - 0.1))}
                    className="grid size-6 place-items-center rounded hover:bg-white/[0.06] hover:text-white"
                  >
                    <IconMinus className="size-3.5" />
                  </button>
                  <div className="mx-1 h-1 w-14 overflow-hidden rounded-full bg-white/[0.09]">
                    <div className="h-full w-2/3 bg-[#aeb2bb]" />
                  </div>
                  <button
                    type="button"
                    aria-label={tw("zoomIn")}
                    onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}
                    className="grid size-6 place-items-center rounded hover:bg-white/[0.06] hover:text-white"
                  >
                    <IconPlus className="size-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 items-stretch gap-2 overflow-x-auto p-2">
                {stripTab === "assets"
                  ? FRAMES.map((frame) => (
                      <FrameTile
                        key={frame.id}
                        frame={frame}
                        selected={frame.id === selectedFrameId}
                        onClick={() => setSelectedFrameId(frame.id)}
                      />
                    ))
                  : ["v3", "v2", "v1"].map((version, index) => (
                      <button
                        key={version}
                        type="button"
                        className={cn(
                          "flex w-40 shrink-0 items-center gap-2 rounded-[6px] border px-2 text-left transition-colors",
                          index === 0
                            ? "border-[#e52227]/65 bg-[#2b1214]"
                            : "border-white/[0.075] bg-white/[0.025] hover:bg-white/[0.05]"
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={FRAMES[index]?.src ?? FRAMES[0].src}
                          alt=""
                          className="h-16 w-20 rounded-[4px] object-cover"
                        />
                        <span>
                          <strong className="block text-[11px] font-medium text-[#e4e6ea]">
                            {version}
                          </strong>
                          <span className="mt-1 block text-[9px] text-[#6d727c]">
                            2026-07-{29 - index}
                          </span>
                        </span>
                      </button>
                    ))}
              </div>
            </div>
          </div>
        </div>

        <aside className="hidden min-h-0 flex-col border-l border-white/[0.075] bg-[#0b0c0f] lg:flex">
          <div className="grid h-[42px] shrink-0 grid-cols-2 border-b border-white/[0.07]">
            <InspectorTabButton
              active={inspectorTab === "comments"}
              label={tw("commentsCount", { count: INITIAL_COMMENTS.length + localComments.length })}
              onClick={() => setInspectorTab("comments")}
            />
            <InspectorTabButton
              active={inspectorTab === "fields"}
              label={tw("fields")}
              onClick={() => setInspectorTab("fields")}
            />
          </div>

          {inspectorTab === "comments" ? (
            <CommentsPanel
              draft={draft}
              localComments={localComments}
              resolvedIds={resolvedIds}
              onDraftChange={setDraft}
              onSubmit={addComment}
              onToggleResolved={toggleResolved}
            />
          ) : (
            <FieldsPanel submitted={submitted} />
          )}
        </aside>
      </div>

      <div
        className={cn(
          "flex shrink-0 items-center border-t border-white/[0.075] bg-[#0a0b0d] transition-[height] duration-200",
          uploadOpen ? "h-8" : "h-1"
        )}
      >
        {uploadOpen ? (
          <>
            <span className="ml-3 size-1.5 animate-pulse rounded-full bg-[#e52227]" />
            <span className="ml-2 text-[10px] text-[#9aa0aa]">
              {tw("filesUploading", { count: 2, progress: 68 })}
            </span>
            <div className="ml-4 h-0.5 w-72 max-w-[30vw] overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full w-[68%] rounded-full bg-[#e52227]" />
            </div>
            <button
              type="button"
              onClick={() => setUploadOpen(false)}
              aria-label={tw("collapseUpload")}
              className="ml-auto mr-2 grid size-6 place-items-center rounded text-[#686d77] hover:bg-white/[0.05] hover:text-white"
            >
              <IconX className="size-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            aria-label={tw("expandUpload")}
            className="size-full bg-[#e52227]/60"
          />
        )}
      </div>
    </div>
  );
}

function Timeline({
  selectedFrameId,
  onSelectFrame,
}: {
  selectedFrameId: string;
  onSelectFrame: (id: string) => void;
}) {
  return (
    <div className="h-12 shrink-0 border-t border-white/[0.07] bg-[#090a0c] px-3 py-1.5">
      <div className="relative flex h-5 gap-px overflow-hidden rounded-[3px] bg-white/[0.035]">
        {FRAMES.map((frame, index) => (
          <button
            key={frame.id}
            type="button"
            onClick={() => onSelectFrame(frame.id)}
            className={cn(
              "relative flex-1 border-r border-black/50 transition-colors",
              selectedFrameId === frame.id ? "bg-[#32353c]" : "bg-[#1c1f25] hover:bg-[#282b32]"
            )}
          >
            {index === 1 || index === 3 ? (
              <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-[#a9adb5]" />
            ) : null}
          </button>
        ))}
        <span className="pointer-events-none absolute bottom-0 left-[38%] top-0 w-px bg-[#ef3b42]" />
        <span className="pointer-events-none absolute left-[38%] top-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60 bg-[#e52227]" />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[8px] tabular-nums text-[#4f545e]">
        <span>00:00</span>
        <span>00:02</span>
        <span>00:04</span>
        <span>00:06</span>
        <span>00:08</span>
        <span>00:10</span>
        <span>00:12</span>
      </div>
    </div>
  );
}

function FrameTile({
  frame,
  selected,
  onClick,
}: {
  frame: (typeof FRAMES)[number];
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-36 shrink-0 flex-col overflow-hidden rounded-[6px] border bg-[#0d0e11] text-left transition-colors",
        selected
          ? "border-[#e52227] ring-1 ring-[#e52227]/25"
          : "border-white/[0.085] hover:border-white/[0.18]"
      )}
    >
      <div className="min-h-0 flex-1 overflow-hidden bg-[#111216]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={frame.src}
          alt=""
          className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />
      </div>
      <div className="h-8 shrink-0 px-2 py-1">
        <p className="truncate font-mono text-[8px] text-[#a5a9b1]">{frame.code}</p>
        <p className="mt-0.5 font-mono text-[8px] text-[#555a64]">{frame.time}</p>
      </div>
    </button>
  );
}

function StripTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative h-full px-3 text-[10px] transition-colors",
        active ? "text-[#ebedf1]" : "text-[#686e79] hover:text-[#b9bdc5]"
      )}
    >
      {label}
      {active ? <span className="absolute inset-x-2 bottom-0 h-px bg-[#e52227]" /> : null}
    </button>
  );
}

function InspectorTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative text-[11px] transition-colors",
        active ? "text-[#f0f1f3]" : "text-[#707681] hover:text-[#c8cbd1]"
      )}
    >
      {label}
      {active ? <span className="absolute inset-x-0 bottom-0 h-px bg-[#e52227]" /> : null}
    </button>
  );
}

function CommentsPanel({
  draft,
  localComments,
  resolvedIds,
  onDraftChange,
  onSubmit,
  onToggleResolved,
}: {
  draft: string;
  localComments: Array<{ id: string; body: string; timecode: string }>;
  resolvedIds: Set<string>;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onToggleResolved: (id: string) => void;
}) {
  const tw = useTranslations("crewWorkbench");

  return (
    <>
      <div className="flex h-9 shrink-0 items-center border-b border-white/[0.055] px-3 text-[10px] text-[#737883]">
        <button type="button" className="inline-flex items-center gap-1 hover:text-[#c9ccd2]">
          {tw("sortByTime")} <IconChevronDown className="size-3" />
        </button>
        <button
          type="button"
          aria-label={tw("filterComments")}
          className="ml-auto grid size-6 place-items-center rounded hover:bg-white/[0.05] hover:text-white"
        >
          <IconFilter className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={tw("moreActions")}
          className="grid size-6 place-items-center rounded hover:bg-white/[0.05] hover:text-white"
        >
          <IconDots className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {INITIAL_COMMENTS.map((comment) => {
          const resolved = resolvedIds.has(comment.id);
          return (
            <article
              key={comment.id}
              className={cn(
                "border-b border-white/[0.055] px-3 py-3 transition-colors",
                resolved && "bg-white/[0.018]"
              )}
            >
              <div className="flex items-start gap-2">
                <UserAvatar name={comment.author} seed={comment.seed} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[10px] font-medium text-[#d8dae0]">
                      {comment.author}
                    </span>
                    <span className="rounded-[4px] bg-white/[0.05] px-1 py-0.5 font-mono text-[8px] text-[#7b808a]">
                      {comment.timecode}
                    </span>
                    <span className="ml-auto shrink-0 text-[8px] text-[#555a64]">
                      {tw(comment.ageKey)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[10.5px] leading-[1.55] text-[#a7abb4]">
                    {tw(comment.bodyKey)}
                  </p>
                  {comment.attachment ? (
                    <button
                      type="button"
                      className="mt-2 inline-flex h-6 max-w-full items-center gap-1.5 rounded-[5px] bg-white/[0.055] px-2 text-[9px] text-[#a8acb5] hover:bg-white/[0.08]"
                    >
                      <IconPhoto className="size-3" />
                      <span className="truncate">{comment.attachment}</span>
                      <IconX className="size-3 text-[#666b75]" />
                    </button>
                  ) : null}
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[9px] text-[#666c77] hover:text-[#c7cad0]"
                    >
                      <IconMessageCircle className="size-3" />
                      {tw("reply")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleResolved(comment.id)}
                      className={cn(
                        "ml-auto inline-flex h-6 items-center gap-1 rounded-[5px] border px-2 text-[9px] transition-colors",
                        resolved
                          ? "border-[#41634c] bg-[#19291f] text-[#7fd49b]"
                          : "border-white/[0.085] text-[#797e88] hover:bg-white/[0.05] hover:text-[#d7d9de]"
                      )}
                    >
                      <IconCheck className="size-3" />
                      {resolved ? tw("resolved") : tw("resolve")}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}

        {localComments.map((comment) => (
          <article key={comment.id} className="border-b border-white/[0.055] px-3 py-3">
            <div className="flex items-start gap-2">
              <UserAvatar name={tw("you")} seed="crew-review-current" size={22} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium text-[#d8dae0]">{tw("you")}</span>
                  <span className="rounded-[4px] bg-white/[0.05] px-1 py-0.5 font-mono text-[8px] text-[#7b808a]">
                    {comment.timecode}
                  </span>
                  <span className="ml-auto text-[8px] text-[#555a64]">{tw("justNow")}</span>
                </div>
                <p className="mt-1.5 text-[10.5px] leading-[1.55] text-[#a7abb4]">{comment.body}</p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="shrink-0 border-t border-white/[0.07] p-2.5">
        <div className="overflow-hidden rounded-[7px] border border-white/[0.095] bg-[#101216] focus-within:border-white/[0.18]">
          <div className="flex items-center gap-1.5 border-b border-white/[0.055] px-2 py-1.5">
            <span className="rounded-[4px] bg-white/[0.055] px-1.5 py-1 font-mono text-[8px] text-[#8a8f99]">
              00:04:21
            </span>
            <IconBookmark className="ml-auto size-3.5 text-[#646a74]" />
          </div>
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") onSubmit();
            }}
            placeholder={tw("addComment")}
            className="min-h-16 w-full resize-none bg-transparent px-2.5 py-2 text-[10.5px] leading-5 text-[#dfe1e5] outline-none placeholder:text-[#4f545e]"
          />
          <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
            <CommentToolButton icon={IconPaperclip} label={tw("attach")} />
            <CommentToolButton icon={IconPhoto} label={tw("addImage")} />
            <CommentToolButton icon={IconMoodSmile} label={tw("addEmoji")} />
            <button
              type="button"
              onClick={onSubmit}
              disabled={!draft.trim()}
              aria-label={tw("sendComment")}
              className="ml-auto grid size-7 place-items-center rounded-[6px] bg-[#e52227] text-white transition-colors hover:bg-[#f03238] disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-[#50555f]"
            >
              <IconSend className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function CommentToolButton({ icon: Icon, label }: { icon: typeof IconPaperclip; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid size-6 place-items-center rounded text-[#656b75] transition-colors hover:bg-white/[0.05] hover:text-[#c7cad0]"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

function FieldsPanel({ submitted }: { submitted: boolean }) {
  const tw = useTranslations("crewWorkbench");

  const fields: Array<{
    label: string;
    value: string;
    tone?: "success" | "warning";
    avatar?: string;
  }> = [
    {
      label: tw("status"),
      value: submitted ? tw("approved") : tw("pendingReview"),
      tone: submitted ? "success" : "warning",
    },
    { label: tw("assignee"), value: "Zhang Xiao", avatar: "crew-review-zhang" },
    { label: tw("linkedTask"), value: tw("storyboardDesign") },
    { label: tw("pointUsage"), value: "128" },
    { label: tw("reviewers"), value: "Alex, Chen Hang +2" },
    { label: tw("dueDate"), value: "2026-07-29" },
    { label: tw("createdAt"), value: "2026-07-29 09:15" },
    { label: tw("updatedAt"), value: "2026-07-29 10:42" },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-4">
        <p className="text-[9px] font-medium uppercase tracking-[0.08em] text-[#565b65]">
          {tw("taskContext")}
        </p>
        <h2 className="mt-1.5 text-[13px] font-semibold tracking-[-0.015em] text-[#e8eaed]">
          S01-010 {tw("taskChase")}
        </h2>
        <p className="mt-1 text-[10px] leading-4 text-[#717681]">{tw("taskDescription")}</p>
      </div>

      <div className="space-y-0.5">
        {fields.map((field) => (
          <div
            key={field.label}
            className="grid min-h-9 grid-cols-[86px_minmax(0,1fr)] items-center rounded-[6px] px-2 hover:bg-white/[0.035]"
          >
            <span className="text-[10px] text-[#626873]">{field.label}</span>
            <span
              className={cn(
                "flex min-w-0 items-center gap-1.5 truncate text-[10px] text-[#b5b9c1]",
                field.tone === "warning" && "text-[#d5ad62]",
                field.tone === "success" && "text-[#7dd49b]"
              )}
            >
              {field.avatar ? (
                <UserAvatar name={field.value} seed={field.avatar} size={18} />
              ) : field.tone ? (
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    field.tone === "success" ? "bg-[#5fc383]" : "bg-[#d29a38]"
                  )}
                />
              ) : null}
              {field.value}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <p className="text-[9px] font-medium uppercase tracking-[0.08em] text-[#565b65]">
          {tw("reviewProgress")}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <IconCircleCheck className="size-4 text-[#66c788]" />
          <div className="min-w-0 flex-1">
            <div className="flex justify-between text-[9px]">
              <span className="text-[#a8acb5]">{tw("commentsResolved")}</span>
              <span className="tabular-nums text-[#6e737e]">8 / 12</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full w-2/3 rounded-full bg-[#67c889]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
