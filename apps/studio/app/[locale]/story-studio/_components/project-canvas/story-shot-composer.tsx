"use client";

import { useMemo, useState } from "react";
import { useStore } from "@xyflow/react";
import {
  IconCheck,
  IconChevronDown,
  IconClock,
  IconLoader2,
  IconPhoto,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import {
  GenerationPromptComposer,
  type GenerationPromptComposerPanel,
} from "@/app/[locale]/_components/generation/generation-prompt-composer";
import { estimateModelSellPoints } from "@/app/[locale]/canvas/_lib/generation-api";
import { useAiCatalog } from "@/app/[locale]/canvas/_lib/use-ai-catalog";
import { CanvasNativePointerOwner } from "@/components/canvas/canvas-native-pointer-owner";
import { useDismiss } from "@/lib/use-dismiss";
import { cn } from "@/lib/utils";
import { STORY_FRAME_PROFILE_CONTRACTS } from "@/lib/story-projects-api";
import type {
  FilmClipSummary,
  FilmReferenceSlot,
  FilmTrailerSummary,
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
import {
  StoryVideoLibraryDialog,
  type StoryVideoLibraryDialogProps,
} from "./story-video-library-dialog";

export interface StoryDefaultVideoModel {
  id: string;
  slug: string;
  displayName: string;
  generationModes: string[];
}

export type StoryProductionTarget = FilmClipSummary | FilmTrailerSummary;

export interface StoryVideoComposerProps {
  subject?: "clip" | "trailer";
  clip: StoryProductionTarget | null;
  prompt: StoryClipPromptDraft | StoryTrailerPromptDraft;
  references: FilmReferenceSlot[];
  defaultModel?: StoryDefaultVideoModel | null;
  frameProfile: StoryFrameProfile;
  canGenerate: boolean;
  disabledReason: string | null;
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
  videoLibrary?: Omit<StoryVideoLibraryDialogProps, "outputContract" | "currentVideo">;
}

/** The two supported generation modes, labelled via the shared canvas vocabulary. */
const STORY_COMPOSER_MODES = ["multimodal_to_video", "first_last_frame_to_video"];

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
  videoLibrary,
}: StoryVideoComposerProps) {
  const t = useTranslations("storyStudio.canvas.production");
  const trailerT = useTranslations("storyStudio.canvas.trailer.production");
  const zoom = useStore((state) => state.transform[2]);
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

  return (
    <div
      className="absolute top-full left-1/2 z-40 flex w-0 justify-center duration-200 animate-in fade-in-0 zoom-in-95"
      style={{ marginTop: 12 / zoom }}
    >
      <CanvasNativePointerOwner
        className="relative shrink-0 origin-top"
        style={{ transform: `scale(${1 / zoom})` }}
      >
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
          promptHint={t("promptAutosaveHint")}
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
              {videoLibrary && clip ? (
                <StoryVideoLibraryDialog
                  {...videoLibrary}
                  outputContract={clip.outputContract}
                  currentVideo={clip.currentVideo}
                />
              ) : null}
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
          canSubmit={canGenerate}
          submitting={generating}
          onSubmit={() => onGenerate(undefined, catalogModel?.id)}
          submitLabel={t("generate")}
          submittingLabel={t("statuses.generating")}
          disabledReason={disabledReason}
          error={error}
          className="w-[680px]"
        />
      </CanvasNativePointerOwner>
    </div>
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
