"use client";

import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useViewport } from "@xyflow/react";
import {
  IconCheck,
  IconChevronDown,
  IconClock,
  IconLoader2,
  IconMovie,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconStarFilled,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import {
  GenerationPromptComposer,
  type GenerationPromptComposerPanel,
} from "@/app/[locale]/_components/generation/generation-prompt-composer";
import { estimateModelSellPoints } from "@/app/[locale]/canvas/_lib/generation-api";
import { useAiCatalog } from "@/app/[locale]/canvas/_lib/use-ai-catalog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDismiss } from "@/lib/use-dismiss";
import { cn } from "@/lib/utils";
import { STORY_FRAME_PROFILE_CONTRACTS } from "@/lib/story-projects-api";
import type {
  FilmClipSummary,
  FilmReferenceSlot,
  FilmReviewChecklistValue,
  FilmReviewDecision,
  FilmTake,
  FilmTrailerSummary,
  FilmTrailerTake,
  FilmTakeReviewChecklist,
  StoryFrameProfile,
  StoryClipPromptDraft,
  StoryTrailerPromptDraft,
} from "@/lib/story-projects-api";
import {
  countBillableBoundReferences,
  filterStoryVideoCatalog,
  storyComposerAddableSlots,
  storyComposerReferenceItems,
  storyReferenceBindingsWith,
  storyReferenceBindingsWithout,
} from "./story-shot-composer-model";
import type { StoryReferenceBindingInput } from "./story-clip-reference-bindings-model";

export interface StoryDefaultVideoModel {
  id: string;
  slug: string;
  displayName: string;
  generationModes: string[];
}

export type StoryProductionTarget = FilmClipSummary | FilmTrailerSummary;
export type StoryProductionTake = FilmTake | FilmTrailerTake;

export interface StoryVideoComposerProps {
  subject?: "clip" | "trailer";
  clip: StoryProductionTarget | null;
  prompt: StoryClipPromptDraft | StoryTrailerPromptDraft;
  references: FilmReferenceSlot[];
  defaultModel?: StoryDefaultVideoModel | null;
  frameProfile: StoryFrameProfile;
  canGenerate: boolean;
  disabledReason: string | null;
  preparingInputs?: boolean;
  pendingKey: string | null;
  error: string | null;
  onGenerate: (variationNote?: string, modelId?: string) => void;
  /** Commits master-direction edits into the draft (composer is editable). */
  onPromptCommit?: (next: string) => void;
  /** Switches the clip between the two supported generation modes. */
  onModeChange?: (mode: "omni_reference" | "first_last_frame") => void;
  /** Commits a new target duration (ms) into the draft prompt. */
  onDurationCommit?: (durationMs: number) => void;
  /** FilmSpec cap for a single generated clip, in milliseconds. */
  maxDurationMs?: number;
  referenceApiConnected?: boolean;
  referenceBindingsPending?: boolean;
  onUpdateReferenceBindings?: (bindings: StoryReferenceBindingInput[]) => void;
}

export interface StoryShotComposerProps extends StoryVideoComposerProps {
  takes: FilmTake[];
  takesLoading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onRetry: (take: FilmTake, variationNote?: string) => void;
  onReview: (
    take: FilmTake,
    decision: FilmReviewDecision,
    checklist: FilmTakeReviewChecklist,
    comment?: string
  ) => void;
  onSetMaster: (take: FilmTake) => void;
}

/** The two supported generation modes, labelled via the shared canvas vocabulary. */
const STORY_COMPOSER_MODES = ["multimodal_to_video", "first_last_frame_to_video"];

const REVIEW_KEYS = [
  "technical",
  "identityContinuity",
  "visualContinuity",
  "motion",
  "dialogueTiming",
  "lipSync",
  "safety",
] as const satisfies readonly (keyof FilmTakeReviewChecklist)[];

const PASSING_CHECKLIST: FilmTakeReviewChecklist = {
  technical: "pass",
  identityContinuity: "pass",
  visualContinuity: "pass",
  motion: "pass",
  dialogueTiming: "pass",
  lipSync: "pass",
  safety: "pass",
};

/**
 * The selected-node composer deliberately mirrors the creative canvas:
 * prompt is the hero, production controls remain a single compact row, and
 * the inverse viewport scale keeps it readable without turning it into a
 * second inspector.
 */
export function StoryShotComposer({
  subject = "clip",
  clip,
  prompt,
  references,
  defaultModel,
  frameProfile,
  canGenerate,
  disabledReason,
  preparingInputs = false,
  pendingKey,
  error,
  onGenerate,
  onPromptCommit,
  onModeChange,
  onDurationCommit,
  maxDurationMs,
  referenceApiConnected = false,
  referenceBindingsPending = false,
  onUpdateReferenceBindings,
  anchorRef,
}: StoryVideoComposerProps & { anchorRef: RefObject<HTMLElement | null> }) {
  const t = useTranslations("storyStudio.canvas.production");
  const trailerT = useTranslations("storyStudio.canvas.trailer.production");
  const viewport = useViewport();
  const composerRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const catalogQuery = useAiCatalog();
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>(defaultModel?.slug);
  const [panel, setPanel] = useState<GenerationPromptComposerPanel>(null);

  const storyCatalog = useMemo(
    () => filterStoryVideoCatalog(catalogQuery.data),
    [catalogQuery.data]
  );
  const catalogModel = useMemo(
    () =>
      storyCatalog?.models.find((model) => model.id === selectedModelId) ??
      storyCatalog?.models.find((model) => model.id === defaultModel?.slug) ??
      storyCatalog?.models.find((model) => model.ui_policy?.recommended) ??
      storyCatalog?.models[0],
    [defaultModel?.slug, selectedModelId, storyCatalog]
  );
  const approvedReferenceCount = countBillableBoundReferences(clip);
  const frame = STORY_FRAME_PROFILE_CONTRACTS[frameProfile];
  const outputContract = useMemo(
    () =>
      clip?.outputContract ?? {
        aspectRatio: frame.aspectRatio,
        width: frame.width,
        height: frame.height,
        durationMs: prompt.targetDurationMs,
      },
    [clip?.outputContract, frame.aspectRatio, frame.height, frame.width, prompt.targetDurationMs]
  );
  const cost = useMemo(() => {
    if (!catalogModel) return null;
    return (
      estimateModelSellPoints(catalogModel, {
        durationSeconds: outputContract.durationMs / 1000,
        numOutputs: 1,
        referenceImageCount: approvedReferenceCount,
        resolution: `${Math.min(outputContract.width, outputContract.height)}p`,
      })?.sellPoints ?? null
    );
  }, [approvedReferenceCount, catalogModel, outputContract]);
  const generating = pendingKey === "generate";
  const referenceItems = useMemo(
    () => storyComposerReferenceItems(clip, references),
    [clip, references]
  );
  const addableSlots = useMemo(
    () => storyComposerAddableSlots(clip, references),
    [clip, references]
  );
  const referencesEditable = Boolean(
    clip && referenceApiConnected && onUpdateReferenceBindings && !referenceBindingsPending
  );

  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = 680;
      const height = composerRef.current?.offsetHeight ?? 190;
      const gutter = 12;
      const inspectorWidth = 380;
      const canvasRight = Math.max(width + gutter * 2, window.innerWidth - inspectorWidth);
      const left = Math.min(
        Math.max(gutter, rect.left + rect.width / 2 - width / 2),
        canvasRight - width - gutter
      );
      const below = rect.bottom + gutter;
      const above = rect.top - height - gutter;
      const top =
        below + height <= window.innerHeight - gutter
          ? below
          : above >= gutter
            ? above
            : Math.max(gutter, Math.min(window.innerHeight - height - gutter, below));
      setPosition((current) =>
        current?.left === left && current.top === top ? current : { left, top }
      );
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (anchorRef.current) observer.observe(anchorRef.current);
    if (composerRef.current) observer.observe(composerRef.current);
    window.addEventListener("resize", updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
    };
  }, [anchorRef, position, viewport.x, viewport.y, viewport.zoom]);

  if (!position) return null;

  return createPortal(
    <div
      className="fixed z-40 duration-200 animate-in fade-in-0 zoom-in-95"
      style={{ left: position.left, top: position.top }}
    >
      <section ref={composerRef} className="relative">
        <GenerationPromptComposer
          ariaLabel={subject === "trailer" ? trailerT("title") : t("title")}
          modality="video"
          catalog={storyCatalog}
          model={catalogModel}
          modelFallbackLabel={defaultModel?.displayName}
          onSelectModel={(model) => setSelectedModelId(model.id)}
          prompt={prompt.masterDirection}
          onPromptCommit={(next) => onPromptCommit?.(next)}
          promptPlaceholder={t("emptyPrompt")}
          promptAriaLabel={t("masterPrompt")}
          promptHint={
            preparingInputs
              ? `${t("statuses.preparing")} · ${t("promptAutosaveHint")}`
              : t("promptAutosaveHint")
          }
          promptReadOnly={!onPromptCommit}
          promptRows={3}
          mode={
            prompt.generationControl.mode === "omni_reference"
              ? "multimodal_to_video"
              : "first_last_frame_to_video"
          }
          modes={STORY_COMPOSER_MODES}
          onSelectMode={
            onModeChange
              ? (nextMode) =>
                  onModeChange(
                    nextMode === "multimodal_to_video" ? "omni_reference" : "first_last_frame"
                  )
              : undefined
          }
          modePickerEnabled={Boolean(onModeChange)}
          referenceContent={
            clip ? (
              <StoryComposerReferenceRail
                items={referenceItems}
                addable={addableSlots}
                editable={referencesEditable}
                pending={referenceBindingsPending}
                onAdd={(slotId, role) =>
                  onUpdateReferenceBindings?.(storyReferenceBindingsWith(clip, slotId, role))
                }
                onRemove={(slotId) =>
                  onUpdateReferenceBindings?.(storyReferenceBindingsWithout(clip, slotId))
                }
              />
            ) : undefined
          }
          trailingControls={
            <>
              <span className="flex h-10 items-center rounded-xl bg-white/[0.06] px-3 text-xs text-white/42">
                {`${outputContract.aspectRatio} · ${outputContract.width}×${outputContract.height}`}
              </span>
              <StoryDurationControl
                durationMs={outputContract.durationMs}
                maxDurationMs={maxDurationMs}
                onCommit={onDurationCommit}
              />
            </>
          }
          settings={{}}
          settingsEnabled={false}
          panel={panel}
          onPanelChange={setPanel}
          cost={cost}
          canSubmit={canGenerate && !preparingInputs}
          submitting={generating}
          onSubmit={() => onGenerate(undefined, catalogModel?.id)}
          submitLabel={t("generate")}
          submittingLabel={t("statuses.generating")}
          disabledReason={preparingInputs ? t("disabled.preparing") : disabledReason}
          error={error}
          className="w-[680px]"
        />
      </section>
    </div>,
    document.body
  );
}

/** Production history belongs in the inspector, not in the canvas composer. */
export function StoryTakePanel({
  clip,
  takes,
  takesLoading,
  refreshing,
  pendingKey,
  error,
  onRefresh,
  onRetry,
  onReview,
  onSetMaster,
}: StoryShotComposerProps) {
  const t = useTranslations("storyStudio.canvas.production");
  const [reviewTake, setReviewTake] = useState<FilmTake | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [reviewDecision, setReviewDecision] = useState<FilmReviewDecision>("approve");
  const [reviewChecklist, setReviewChecklist] =
    useState<FilmTakeReviewChecklist>(PASSING_CHECKLIST);
  const [reviewComment, setReviewComment] = useState("");

  const submitReview = () => {
    if (!reviewTake) return;
    onReview(reviewTake, reviewDecision, reviewChecklist, reviewComment.trim() || undefined);
    setReviewTake(null);
  };

  return (
    <section className="mt-5 rounded-[18px] bg-black/18 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
          aria-expanded={expanded}
        >
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold text-white/58">
              {t("takes.title")}
            </span>
            <span className="mt-0.5 block text-[9px] text-white/28">
              {t("takes.count", { count: takes.length })}
            </span>
          </span>
          <IconChevronDown
            className={cn("size-3.5 shrink-0 text-white/34 transition", expanded && "rotate-180")}
          />
        </button>
        {expanded ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="grid size-8 place-items-center rounded-xl bg-white/[0.06] text-white/42 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-40"
            aria-label={t("refresh")}
          >
            <IconRefresh className={cn("size-3.5", refreshing && "animate-spin")} />
          </button>
        ) : null}
      </div>

      {expanded && takesLoading ? (
        <div className="mt-3 flex h-24 items-center justify-center text-white/32">
          <IconLoader2 className="size-4 animate-spin" />
        </div>
      ) : expanded && takes.length === 0 ? (
        <div className="mt-3 flex h-20 flex-col items-center justify-center rounded-xl bg-white/[0.035] text-center">
          <IconMovie className="size-4 text-white/22" />
          <p className="mt-2 text-[9px] text-white/28">{t("takes.empty")}</p>
        </div>
      ) : expanded ? (
        <div className="mt-3 space-y-2">
          {takes.map((take) => {
            const isMaster = clip?.master?.takeId === take.id;
            const running =
              take.status === "queued" || take.status === "running" || take.status === "processing";
            return (
              <article key={take.id} className="overflow-hidden rounded-xl bg-white/[0.04]">
                <div className="relative aspect-video bg-black/30">
                  {take.outputAsset?.previewUrl ? (
                    <video
                      src={take.outputAsset.previewUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-2 text-white/26">
                      {running ? (
                        <IconLoader2 className="size-5 animate-spin" />
                      ) : (
                        <IconPlayerPlay className="size-5" />
                      )}
                      <span className="text-[9px]">{t(`statuses.${take.status}`)}</span>
                    </div>
                  )}
                  {isMaster ? (
                    <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[8px] font-semibold text-black">
                      <IconStarFilled className="size-2.5" />
                      {t("takes.master")}
                    </span>
                  ) : null}
                </div>
                <div className="p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold text-white/68">
                      {t("takes.take", { number: take.number })}
                    </span>
                    <span className="flex items-center gap-1 text-[8px] text-white/32">
                      <IconClock className="size-2.5" />
                      {t(`statuses.${take.status}`)}
                    </span>
                  </div>
                  <p className="mt-1 text-[8px] text-white/28">
                    {t(`reviewStatuses.${take.reviewStatus}`)}
                    {take.stale ? ` · ${t("takes.stale")}` : ""}
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    {take.status === "ready" && take.reviewStatus !== "approved" && !take.stale ? (
                      <TakeAction onClick={() => setReviewTake(take)}>
                        {t("takes.review")}
                      </TakeAction>
                    ) : null}
                    {(take.status === "failed" || take.status === "cancelled") && !take.stale && (
                      <TakeAction
                        disabled={pendingKey === `retry:${take.id}`}
                        onClick={() => onRetry(take)}
                      >
                        {pendingKey === `retry:${take.id}` ? t("takes.retrying") : t("takes.retry")}
                      </TakeAction>
                    )}
                    {take.reviewStatus === "approved" && !take.stale && !isMaster ? (
                      <TakeAction
                        emphasized
                        disabled={pendingKey === `master:${take.id}`}
                        onClick={() => onSetMaster(take)}
                      >
                        {t("takes.setMaster")}
                      </TakeAction>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      {expanded && error ? (
        <p className="mt-2 text-[9px] leading-4 text-destructive">{error}</p>
      ) : null}

      <Dialog open={Boolean(reviewTake)} onOpenChange={(open) => !open && setReviewTake(null)}>
        <DialogContent className="max-w-[560px] rounded-[24px] bg-[oklch(0.22_0_0/0.98)] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.68)] backdrop-blur-[40px]">
          <DialogHeader>
            <DialogTitle>{t("review.title", { number: reviewTake?.number ?? 0 })}</DialogTitle>
            <DialogDescription>{t("review.description")}</DialogDescription>
          </DialogHeader>
          <label>
            <span className="text-[10px] font-semibold text-white/46">{t("review.decision")}</span>
            <Select
              value={reviewDecision}
              onValueChange={(value) => setReviewDecision(value as FilmReviewDecision)}
            >
              <SelectTrigger className="mt-2 w-full rounded-xl bg-white/[0.06]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approve">{t("review.decisions.approve")}</SelectItem>
                <SelectItem value="request_changes">
                  {t("review.decisions.request_changes")}
                </SelectItem>
                <SelectItem value="reject">{t("review.decisions.reject")}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {REVIEW_KEYS.map((key) => (
              <label key={key} className="rounded-xl bg-white/[0.045] p-2.5">
                <span className="text-[10px] font-semibold text-white/52">
                  {t(`review.checklist.${key}`)}
                </span>
                <Select
                  value={reviewChecklist[key]}
                  onValueChange={(value) =>
                    setReviewChecklist((current) => ({
                      ...current,
                      [key]: value as FilmReviewChecklistValue,
                    }))
                  }
                >
                  <SelectTrigger className="mt-2 h-8! w-full rounded-lg bg-white/[0.055] text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pass">{t("review.values.pass")}</SelectItem>
                    <SelectItem value="fail">{t("review.values.fail")}</SelectItem>
                    <SelectItem value="na">{t("review.values.na")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            ))}
          </div>
          <label>
            <span className="text-[10px] font-semibold text-white/46">{t("review.comment")}</span>
            <Textarea
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
              maxLength={4000}
              rows={3}
              placeholder={t("review.commentPlaceholder")}
              className="mt-2 resize-none rounded-xl bg-white/[0.055]"
            />
          </label>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReviewTake(null)}>
              {t("review.cancel")}
            </Button>
            <Button
              onClick={submitReview}
              disabled={Boolean(reviewTake && pendingKey === `review:${reviewTake.id}`)}
              className="bg-[#E52227] text-white hover:bg-[#c91e22]"
            >
              {reviewTake && pendingKey === `review:${reviewTake.id}` ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconCheck className="size-4" />
              )}
              {t("review.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TakeAction({
  children,
  emphasized = false,
  ...props
}: React.ComponentProps<"button"> & { emphasized?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "h-7 rounded-lg bg-white/[0.07] px-2.5 text-[9px] font-semibold text-white/58 transition hover:bg-white/[0.11] hover:text-white disabled:opacity-40",
        emphasized && "bg-white/[0.12] text-white/78"
      )}
      {...props}
    >
      {children}
    </button>
  );
}

const DURATION_PRESETS_S = [5, 10, 15] as const;

/**
 * The clip's target duration. The aspect/resolution half of the old contract
 * chip stays locked to the project frame profile, but duration is a draft field
 * (`setClipPromptTargetDuration`), so it opens a small preset popover mirroring
 * the canvas quick-settings look. Read-only when the composer is immutable.
 */
function StoryDurationControl({
  durationMs,
  maxDurationMs,
  onCommit,
}: {
  durationMs: number;
  maxDurationMs?: number;
  onCommit?: (durationMs: number) => void;
}) {
  const t = useTranslations("storyStudio.canvas.production.durationControl");
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false));

  const seconds = (durationMs / 1000).toFixed(1);
  const label = (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <IconClock className="size-3.5 opacity-70" stroke={1.8} />
      {`${seconds}s`}
    </span>
  );

  if (!onCommit) {
    return (
      <span className="flex h-10 items-center rounded-xl bg-white/[0.06] px-3 text-xs text-white/42">
        {label}
      </span>
    );
  }

  const presets = DURATION_PRESETS_S.filter(
    (value) => maxDurationMs == null || value * 1000 <= maxDurationMs
  );

  return (
    <div className="relative" data-popover-zone>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("label")}
        className={cn(
          "flex h-10 items-center gap-1 rounded-xl px-3 text-sm font-medium text-white/70 transition-colors",
          open ? "bg-white/[0.14]" : "bg-white/[0.08] hover:bg-white/[0.12]"
        )}
      >
        {label}
        <IconChevronDown className="size-3.5 text-white/40" stroke={1.8} />
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-40 rounded-2xl bg-[oklch(0.22_0_0/0.98)] p-1.5 shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
          {presets.map((value) => {
            const active = Math.round(durationMs / 1000) === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => {
                  onCommit(value * 1000);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition",
                  active ? "bg-white/[0.12] text-white" : "text-white/70 hover:bg-white/[0.08]"
                )}
              >
                {t("seconds", { count: value })}
                {active ? <IconCheck className="size-3.5" stroke={2.2} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Canvas-consistent reference chips: the clip's bound reference 母版 render as
 * thumbnails ahead of the prompt, and approved unbound slots can be attached
 * inline — mirroring the creative canvas ReferenceStack while staying on the
 * slot/approval model story production requires.
 */
function StoryComposerReferenceRail({
  items,
  addable,
  editable,
  pending,
  onAdd,
  onRemove,
}: {
  items: ReturnType<typeof storyComposerReferenceItems>;
  addable: ReturnType<typeof storyComposerAddableSlots>;
  editable: boolean;
  pending: boolean;
  onAdd: (slotId: string, role: (typeof addable)[number]["role"]) => void;
  onRemove: (slotId: string) => void;
}) {
  const t = useTranslations("storyStudio.canvas.production.referenceRail");
  const [pickerOpen, setPickerOpen] = useState(false);
  useDismiss(pickerOpen, () => setPickerOpen(false));

  if (items.length === 0 && (!editable || addable.length === 0)) return null;

  return (
    <div className={cn("mb-3 flex flex-wrap items-center gap-2", pending && "opacity-55")}>
      {items.map((item) => (
        <div
          key={item.slotId}
          className="group relative size-14 shrink-0 overflow-hidden rounded-xl bg-white/[0.06]"
          title={item.label}
        >
          {item.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.previewUrl} alt={item.label} className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-white/26">
              <IconPhoto className="size-4" />
            </div>
          )}
          {!item.approved ? (
            <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-center text-[7px] font-semibold text-white/72">
              {t("unapproved")}
            </span>
          ) : null}
          {editable ? (
            <button
              type="button"
              onClick={() => onRemove(item.slotId)}
              aria-label={t("remove", { label: item.label })}
              className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-black/70 text-white/70 opacity-0 transition group-hover:opacity-100 hover:text-white"
            >
              <IconX className="size-2.5" stroke={2.4} />
            </button>
          ) : null}
        </div>
      ))}
      {editable && addable.length > 0 ? (
        <div className="relative" data-popover-zone>
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            aria-label={t("add")}
            className="grid size-14 place-items-center rounded-xl border border-dashed border-white/[0.14] text-white/34 transition hover:border-white/[0.28] hover:text-white/70"
          >
            <IconPlus className="size-4" stroke={2} />
          </button>
          {pickerOpen ? (
            <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-2xl bg-[oklch(0.22_0_0/0.98)] p-2 shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
              <p className="px-2 pt-1 pb-2 text-[10px] font-semibold text-white/46">
                {t("addTitle")}
              </p>
              <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto overscroll-contain p-1">
                {addable.map((slot) => (
                  <button
                    key={slot.slotId}
                    type="button"
                    onClick={() => {
                      onAdd(slot.slotId, slot.role);
                      setPickerOpen(false);
                    }}
                    title={slot.label}
                    className="group/slot overflow-hidden rounded-xl bg-white/[0.05] transition hover:bg-white/[0.1]"
                  >
                    {slot.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={slot.previewUrl}
                        alt={slot.label}
                        className="aspect-square w-full object-cover"
                      />
                    ) : (
                      <div className="grid aspect-square w-full place-items-center text-white/26">
                        <IconPhoto className="size-4" />
                      </div>
                    )}
                    <span className="block truncate px-1 py-1 text-[8px] text-white/52">
                      {slot.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {pending ? <IconLoader2 className="size-3.5 animate-spin text-white/40" /> : null}
    </div>
  );
}
