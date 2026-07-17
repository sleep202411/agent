"use client";

import { useMemo, useState } from "react";
import { useStore } from "@xyflow/react";
import {
  IconCheck,
  IconChevronDown,
  IconClock,
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
  StoryClipVideoSummary,
  StoryReferenceSlot,
  StoryTrailerVideoSummary,
  StoryFrameProfile,
  StoryVideoGenerationRecipeInput,
} from "@/lib/story-projects-api";
import {
  addStoryRecipeReference,
  countBillableRecipeReferences,
  filterStoryVideoCatalog,
  isStoryRecipeReferencePlanValid,
  removeStoryRecipeReference,
  selectedStoryVideoModel,
  STORY_VIDEO_GENERATION_MODES,
  storyVideoDurationContract,
  storyComposerAddableSlots,
  storyComposerReferenceItems,
  type StoryVideoDurationContract,
} from "./story-shot-composer-model";
import {
  StoryVideoLibraryDialog,
  type StoryVideoLibraryDialogProps,
} from "./story-video-library-dialog";

export type StoryProductionTarget = StoryClipVideoSummary | StoryTrailerVideoSummary;

export interface StoryVideoComposerProps {
  subject?: "clip" | "trailer";
  target: StoryProductionTarget | null;
  recipe: StoryVideoGenerationRecipeInput;
  references: StoryReferenceSlot[];
  frameProfile: StoryFrameProfile;
  canGenerate: boolean;
  disabledReason: string | null;
  pendingKey: string | null;
  error: string | null;
  onRecipeChange: (next: StoryVideoGenerationRecipeInput) => void;
  onGenerate: (recipe: StoryVideoGenerationRecipeInput) => void;
  videoLibrary?: Omit<StoryVideoLibraryDialogProps, "frameContract" | "currentVideo">;
}

/**
 * The selected-node composer deliberately mirrors the creative canvas:
 * prompt is the hero, production controls remain a single compact row, and
 * the inverse viewport scale keeps it readable without turning it into a
 * second inspector.
 */
export function StoryShotComposer({
  subject = "clip",
  target,
  recipe,
  references,
  frameProfile,
  canGenerate,
  disabledReason,
  pendingKey,
  error,
  onRecipeChange,
  onGenerate,
  videoLibrary,
}: StoryVideoComposerProps) {
  const t = useTranslations("storyStudio.canvas.production");
  const trailerT = useTranslations("storyStudio.canvas.trailer.production");
  const zoom = useStore((state) => state.transform[2]);
  const catalogQuery = useAiCatalog();
  const [panel, setPanel] = useState<GenerationPromptComposerPanel>(null);

  const storyCatalog = useMemo(
    () => filterStoryVideoCatalog(catalogQuery.data, recipe.mode),
    [catalogQuery.data, recipe.mode]
  );
  const catalogModel = useMemo(
    () => selectedStoryVideoModel(storyCatalog, recipe.modelId),
    [recipe.modelId, storyCatalog]
  );
  const durationContract = useMemo(() => storyVideoDurationContract(catalogModel), [catalogModel]);
  const approvedReferenceCount = countBillableRecipeReferences(recipe.references);
  const frame = STORY_FRAME_PROFILE_CONTRACTS[frameProfile];
  const cost = useMemo(() => {
    if (!catalogModel) return null;
    return (
      estimateModelSellPoints(catalogModel, {
        durationSeconds: recipe.durationMs / 1000,
        numOutputs: 1,
        referenceImageCount: approvedReferenceCount,
        resolution: `${Math.min(frame.width, frame.height)}p`,
      })?.sellPoints ?? null
    );
  }, [approvedReferenceCount, catalogModel, frame.height, frame.width, recipe.durationMs]);
  const generating = pendingKey === "generate";
  const referenceItems = useMemo(
    () => storyComposerReferenceItems(recipe.references, references),
    [recipe.references, references]
  );
  const addableSlots = useMemo(
    () => storyComposerAddableSlots(recipe.mode, recipe.references, references),
    [recipe.mode, recipe.references, references]
  );
  const referencePlanValid = isStoryRecipeReferencePlanValid(recipe.mode, recipe.references);
  const recipeDisabledReason = !recipe.prompt.trim()
    ? t("disabled.promptRequired")
    : !catalogModel
      ? t("disabled.modelRequired")
      : !referencePlanValid
        ? t("disabled.referencesRequired")
        : disabledReason;

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
          onSelectModel={(model) => {
            const nextDuration = storyVideoDurationContract(model);
            if (!nextDuration) return;
            onRecipeChange({
              ...recipe,
              modelId: model.id,
              durationMs: nextDuration.defaultMs,
            });
          }}
          prompt={recipe.prompt}
          onPromptCommit={(prompt) => onRecipeChange({ ...recipe, prompt })}
          promptPlaceholder={t("emptyPrompt")}
          promptAriaLabel={t("masterPrompt")}
          promptHint={t("promptLocalHint")}
          promptRows={3}
          mode={recipe.mode}
          modes={[...STORY_VIDEO_GENERATION_MODES]}
          onSelectMode={(nextMode) => {
            if (nextMode !== "multimodal_to_video" && nextMode !== "first_last_frame_to_video") {
              return;
            }
            const selectedModelSupportsMode = catalogQuery.data?.models
              .find((model) => model.id === recipe.modelId)
              ?.generationModes?.includes(nextMode);
            const selectedModel = selectedModelSupportsMode
              ? catalogQuery.data?.models.find((model) => model.id === recipe.modelId)
              : undefined;
            const nextDuration = storyVideoDurationContract(selectedModel);
            onRecipeChange({
              ...recipe,
              mode: nextMode,
              modelId: nextDuration ? recipe.modelId : "",
              durationMs: nextDuration?.defaultMs ?? recipe.durationMs,
              references: [],
            });
          }}
          referenceContent={
            <StoryComposerReferenceRail
              items={referenceItems}
              addable={addableSlots}
              onAdd={(referenceVersionId, role) =>
                onRecipeChange({
                  ...recipe,
                  references: addStoryRecipeReference(recipe.references, referenceVersionId, role),
                })
              }
              onRemove={(referenceVersionId) =>
                onRecipeChange({
                  ...recipe,
                  references: removeStoryRecipeReference(recipe.references, referenceVersionId),
                })
              }
            />
          }
          trailingControls={
            <>
              {videoLibrary ? (
                <StoryVideoLibraryDialog
                  {...videoLibrary}
                  frameContract={{ width: frame.width, height: frame.height }}
                  currentVideo={target?.currentVideo ?? null}
                />
              ) : null}
              <span className="flex h-10 items-center rounded-xl bg-white/[0.06] px-3 text-xs text-white/42">
                {`${frame.aspectRatio} · ${frame.width}×${frame.height}`}
              </span>
              <StoryDurationControl
                durationMs={recipe.durationMs}
                contract={durationContract}
                onCommit={(durationMs) => onRecipeChange({ ...recipe, durationMs })}
              />
            </>
          }
          settings={{}}
          settingsEnabled={false}
          panel={panel}
          onPanelChange={setPanel}
          cost={cost}
          canSubmit={canGenerate && recipeDisabledReason === null}
          submitting={generating}
          onSubmit={() => onGenerate(recipe)}
          submitLabel={t("generate")}
          submittingLabel={t("statuses.generating")}
          disabledReason={recipeDisabledReason}
          error={error}
          className="w-[680px]"
        />
      </CanvasNativePointerOwner>
    </div>
  );
}

/**
 * Duration belongs to the pending generation recipe. It is submitted together
 * with the prompt and never mutates the story draft or selected video.
 */
function StoryDurationControl({
  durationMs,
  contract,
  onCommit,
}: {
  durationMs: number;
  contract: StoryVideoDurationContract | null;
  onCommit: (durationMs: number) => void;
}) {
  const t = useTranslations("storyStudio.canvas.production.durationControl");
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false));

  const seconds = durationMs > 0 ? (durationMs / 1000).toFixed(1) : "—";
  const label = (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <IconClock className="size-3.5 opacity-70" stroke={1.8} />
      {durationMs > 0 ? `${seconds}s` : seconds}
    </span>
  );

  if (!contract) {
    return (
      <span className="flex h-10 items-center rounded-xl bg-white/[0.06] px-3 text-xs text-white/42">
        {label}
      </span>
    );
  }

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
          {contract.optionsMs.length > 0 ? (
            contract.optionsMs.map((value) => {
              const active = durationMs === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    onCommit(value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition",
                    active ? "bg-white/[0.12] text-white" : "text-white/70 hover:bg-white/[0.08]"
                  )}
                >
                  {t("seconds", { count: value / 1_000 })}
                  {active ? <IconCheck className="size-3.5" stroke={2.2} /> : null}
                </button>
              );
            })
          ) : (
            <label className="block px-2 py-1.5">
              <span className="text-[10px] font-semibold text-white/42">{t("label")}</span>
              <input
                type="number"
                min={contract.minMs / 1_000}
                max={contract.maxMs / 1_000}
                step={1}
                value={durationMs / 1_000}
                onChange={(event) => {
                  const nextMs = Math.round(event.currentTarget.valueAsNumber * 1_000);
                  if (
                    Number.isInteger(nextMs) &&
                    nextMs >= contract.minMs &&
                    nextMs <= contract.maxMs
                  ) {
                    onCommit(nextMs);
                  }
                }}
                className="mt-1.5 h-9 w-full rounded-xl bg-white/[0.08] px-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-white/45"
              />
            </label>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Approved references selected for this one recipe. Changing the current video
 * never changes this list; the exact version ids are frozen on submission.
 */
function StoryComposerReferenceRail({
  items,
  addable,
  onAdd,
  onRemove,
}: {
  items: ReturnType<typeof storyComposerReferenceItems>;
  addable: ReturnType<typeof storyComposerAddableSlots>;
  onAdd: (referenceVersionId: string, role: (typeof addable)[number]["role"]) => void;
  onRemove: (referenceVersionId: string) => void;
}) {
  const t = useTranslations("storyStudio.canvas.production.referenceRail");
  const [pickerOpen, setPickerOpen] = useState(false);
  useDismiss(pickerOpen, () => setPickerOpen(false));

  if (items.length === 0 && addable.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <div
          key={`${item.role}:${item.referenceVersionId}`}
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
          <button
            type="button"
            onClick={() => onRemove(item.referenceVersionId)}
            aria-label={t("remove", { label: item.label })}
            className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-black/70 text-white/70 opacity-0 transition group-hover:opacity-100 hover:text-white"
          >
            <IconX className="size-2.5" stroke={2.4} />
          </button>
        </div>
      ))}
      {addable.length > 0 ? (
        <div className="relative" data-popover-zone>
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            aria-label={t("add")}
            className="grid size-14 place-items-center rounded-xl bg-white/[0.06] text-white/34 transition hover:bg-white/[0.11] hover:text-white/70"
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
                      onAdd(slot.referenceVersionId, slot.role);
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
    </div>
  );
}
