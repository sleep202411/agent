"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconClock,
  IconLoader2,
  IconPhoto,
  IconPlus,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAiCatalog } from "@/app/[locale]/canvas/_lib/use-ai-catalog";
import { useDismiss } from "@/lib/use-dismiss";
import { cn } from "@/lib/utils";
import { STORY_FRAME_PROFILE_CONTRACTS } from "@/lib/story-projects-api";
import type {
  StoryClipVideoSummary,
  StoryFrameProfile,
  StoryReferenceSlot,
  StoryTrailerVideoSummary,
  StoryVideoGenerationRecipeInput,
} from "@/lib/story-projects-api";
import {
  addStoryRecipeReference,
  filterStoryVideoCatalog,
  isStoryRecipeReferencePlanValid,
  removeStoryRecipeReference,
  selectedStoryVideoModel,
  storyComposerAddableSlots,
  storyComposerReferenceItems,
  storyVideoDurationContract,
  type StoryVideoDurationContract,
} from "./story-shot-composer-model";
import {
  StoryVideoLibraryDialog,
  type StoryVideoLibraryDialogProps,
} from "./story-video-library-dialog";

// The inspector generation form is deliberately single-mode. Reference-driven
// multimodal generation covers the authoring need; the first/last-frame mode
// (and its extra controls) was removed to keep this a plain form.
const GENERATION_MODE = "multimodal_to_video" as const;

export type StoryGenerationTarget = StoryClipVideoSummary | StoryTrailerVideoSummary;

export interface StoryClipGenerationFormProps {
  subject?: "clip" | "trailer";
  target: StoryGenerationTarget | null;
  recipe: StoryVideoGenerationRecipeInput;
  references: StoryReferenceSlot[];
  frameProfile: StoryFrameProfile;
  readOnly: boolean;
  canGenerate: boolean;
  disabledReason: string | null;
  pendingKey: string | null;
  error: string | null;
  onRecipeChange: (next: StoryVideoGenerationRecipeInput) => void;
  onGenerate: (recipe: StoryVideoGenerationRecipeInput) => void;
  videoLibrary?: Omit<StoryVideoLibraryDialogProps, "frameContract" | "currentVideo">;
}

/**
 * AI generation as an inspector form. The prompt, model, duration and
 * approved references are edited in place and submitted only on Generate; the
 * recipe stays local to this page and is never written to the story draft.
 */
export function StoryClipGenerationForm({
  subject = "clip",
  target,
  recipe,
  references,
  frameProfile,
  readOnly,
  canGenerate,
  disabledReason,
  pendingKey,
  error,
  onRecipeChange,
  onGenerate,
  videoLibrary,
}: StoryClipGenerationFormProps) {
  const t = useTranslations("storyStudio.canvas.production");
  const catalogQuery = useAiCatalog();

  const storyCatalog = useMemo(
    () => filterStoryVideoCatalog(catalogQuery.data, GENERATION_MODE),
    [catalogQuery.data]
  );
  const catalogModel = useMemo(
    () => selectedStoryVideoModel(storyCatalog, recipe.modelId),
    [recipe.modelId, storyCatalog]
  );
  const durationContract = useMemo(() => storyVideoDurationContract(catalogModel), [catalogModel]);
  const frame = STORY_FRAME_PROFILE_CONTRACTS[frameProfile];
  const generating = pendingKey === "generate";
  const referenceItems = useMemo(
    () => storyComposerReferenceItems(recipe.references, references),
    [recipe.references, references]
  );
  const addableSlots = useMemo(
    () => storyComposerAddableSlots(GENERATION_MODE, recipe.references, references),
    [recipe.references, references]
  );
  const referencePlanValid = isStoryRecipeReferencePlanValid(GENERATION_MODE, recipe.references);
  const recipeDisabledReason = !recipe.prompt.trim()
    ? t("disabled.promptRequired")
    : !catalogModel
      ? t("disabled.modelRequired")
      : !referencePlanValid
        ? t("disabled.referencesRequired")
        : disabledReason;
  const models = storyCatalog?.models ?? [];

  return (
    <section className="mt-6 space-y-4">
      <div>
        <label className="text-xs font-semibold text-white/78" htmlFor="story-generation-prompt">
          {t("masterPrompt")}
        </label>
        <Textarea
          id="story-generation-prompt"
          value={recipe.prompt}
          disabled={readOnly}
          onChange={(event) => {
            if (!readOnly) onRecipeChange({ ...recipe, prompt: event.target.value });
          }}
          placeholder={t("emptyPrompt")}
          rows={4}
          className="mt-2 resize-none rounded-xl bg-white/[0.05] text-sm"
        />
      </div>

      {(referenceItems.length > 0 || addableSlots.length > 0) && (
        <div>
          <p className="text-xs font-semibold text-white/78">{t("references")}</p>
          <StoryReferenceRail
            items={referenceItems}
            addable={addableSlots}
            disabled={readOnly}
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
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <label
            className="text-[10px] font-semibold text-white/54"
            htmlFor="story-generation-model"
          >
            {t("model")}
          </label>
          <Select
            disabled={readOnly}
            value={recipe.modelId || undefined}
            onValueChange={(modelId) => {
              if (readOnly) return;
              const nextModel = models.find((model) => model.id === modelId);
              const nextDuration = storyVideoDurationContract(nextModel);
              onRecipeChange({
                ...recipe,
                modelId,
                durationMs: nextDuration?.defaultMs ?? recipe.durationMs,
              });
            }}
          >
            <SelectTrigger
              id="story-generation-model"
              className="mt-1.5 h-10! w-full rounded-xl bg-white/[0.055] px-3"
            >
              <SelectValue placeholder={t("disabled.modelRequired")} />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-white/54">{t("durationControl.label")}</p>
          <StoryDurationControl
            durationMs={recipe.durationMs}
            contract={durationContract}
            disabled={readOnly}
            onCommit={(durationMs) => onRecipeChange({ ...recipe, durationMs })}
          />
        </div>
      </div>

      {videoLibrary ? (
        <StoryVideoLibraryDialog
          {...videoLibrary}
          disabled={readOnly || videoLibrary.disabled}
          frameContract={{ width: frame.width, height: frame.height }}
          currentVideo={target?.currentVideo ?? null}
        />
      ) : null}

      <Button
        type="button"
        size="lg"
        disabled={readOnly || !canGenerate || recipeDisabledReason !== null || generating}
        title={recipeDisabledReason ?? undefined}
        className="w-full rounded-xl"
        onClick={() => {
          if (!readOnly) onGenerate(recipe);
        }}
      >
        {generating ? (
          <IconLoader2 className="size-4 animate-spin" />
        ) : (
          <IconSparkles className="size-4" />
        )}
        {generating ? t("statuses.generating") : t("generate")}
      </Button>

      {error ? (
        <p
          className="rounded-xl bg-[rgba(229,34,39,0.1)] px-3 py-2 text-[11px] leading-4 text-[#ffb2b4]"
          role="alert"
        >
          {error}
        </p>
      ) : recipeDisabledReason && subject === "clip" ? (
        <p className="text-center text-[10px] text-white/32">{recipeDisabledReason}</p>
      ) : null}
    </section>
  );
}

/**
 * Duration belongs to the pending generation recipe. It is submitted together
 * with the prompt and never mutates the story draft or selected video.
 */
function StoryDurationControl({
  durationMs,
  contract,
  disabled,
  onCommit,
}: {
  durationMs: number;
  contract: StoryVideoDurationContract | null;
  disabled: boolean;
  onCommit: (durationMs: number) => void;
}) {
  const t = useTranslations("storyStudio.canvas.production.durationControl");
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false));

  useEffect(() => {
    if (!disabled || !open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setOpen(false);
    });
    return () => {
      cancelled = true;
    };
  }, [disabled, open]);

  const seconds = durationMs > 0 ? (durationMs / 1000).toFixed(1) : "—";
  const label = (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <IconClock className="size-3.5 opacity-70" stroke={1.8} />
      {durationMs > 0 ? `${seconds}s` : seconds}
    </span>
  );

  if (!contract) {
    return (
      <span className="mt-1.5 flex h-10 items-center rounded-xl bg-white/[0.06] px-3 text-sm text-white/42">
        {label}
      </span>
    );
  }

  return (
    <div className="relative mt-1.5" data-popover-zone>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((value) => !value);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("label")}
        className={cn(
          "flex h-10 items-center gap-1 rounded-xl px-3 text-sm font-medium text-white/70 transition-colors",
          open ? "bg-white/[0.14]" : "bg-white/[0.08] hover:bg-white/[0.12]",
          disabled && "cursor-not-allowed opacity-45 hover:bg-white/[0.08]"
        )}
      >
        {label}
        <IconChevronDown className="size-3.5 text-white/40" stroke={1.8} />
      </button>
      {open ? (
        <div className="absolute top-full right-0 z-50 mt-2 w-40 rounded-2xl bg-[oklch(0.22_0_0/0.98)] p-1.5 shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
          {contract.optionsMs.length > 0 ? (
            contract.optionsMs.map((value) => {
              const active = durationMs === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    if (disabled) return;
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
                disabled={disabled}
                min={contract.minMs / 1_000}
                max={contract.maxMs / 1_000}
                step={1}
                value={durationMs / 1_000}
                onChange={(event) => {
                  if (disabled) return;
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
function StoryReferenceRail({
  items,
  addable,
  disabled,
  onAdd,
  onRemove,
}: {
  items: ReturnType<typeof storyComposerReferenceItems>;
  addable: ReturnType<typeof storyComposerAddableSlots>;
  disabled: boolean;
  onAdd: (referenceVersionId: string, role: (typeof addable)[number]["role"]) => void;
  onRemove: (referenceVersionId: string) => void;
}) {
  const t = useTranslations("storyStudio.canvas.production.referenceRail");
  const [pickerOpen, setPickerOpen] = useState(false);
  useDismiss(pickerOpen, () => setPickerOpen(false));

  useEffect(() => {
    if (!disabled || !pickerOpen) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setPickerOpen(false);
    });
    return () => {
      cancelled = true;
    };
  }, [disabled, pickerOpen]);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
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
            disabled={disabled}
            onClick={() => {
              if (!disabled) onRemove(item.referenceVersionId);
            }}
            aria-label={t("remove", { label: item.label })}
            className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-black/70 text-white/70 opacity-0 transition group-hover:opacity-100 hover:text-white disabled:hidden"
          >
            <IconX className="size-2.5" stroke={2.4} />
          </button>
        </div>
      ))}
      {addable.length > 0 ? (
        <div className="relative" data-popover-zone>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!disabled) setPickerOpen((open) => !open);
            }}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            aria-label={t("add")}
            className="grid size-14 place-items-center rounded-xl bg-white/[0.06] text-white/34 transition hover:bg-white/[0.11] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/[0.06] disabled:hover:text-white/34"
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
                      if (disabled) return;
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
