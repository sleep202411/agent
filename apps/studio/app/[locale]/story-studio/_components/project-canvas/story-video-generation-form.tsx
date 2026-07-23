"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconClock,
  IconLoader2,
  IconPhoto,
  IconPlus,
  IconSparkles,
  IconUpload,
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
import { useAiCatalog } from "@/lib/canvas-authoring/use-ai-catalog";
import { useDismiss } from "@/lib/use-dismiss";
import { cn } from "@/lib/utils";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  createStoryReferenceSlots,
  createStoryReferenceVersion,
  storyApiErrorMessage,
} from "@/lib/story-projects-api";
import type {
  StoryReferenceSlot,
  StoryVideoGenerationMode,
  StoryVideoGenerationRecipeInput,
} from "@/lib/story-projects-api";
import {
  addStoryRecipeReference,
  filterStoryVideoModels,
  isStoryRecipeReferencePlanValid,
  pruneStoryRecipeReferencesForMode,
  removeStoryRecipeReference,
  selectedStoryVideoModel,
  storyComposerAddableSlots,
  storyComposerReferenceItems,
  storyFreeformUploadTarget,
  storyVideoDurationContract,
  supportedStoryVideoModes,
  type StoryVideoDurationContract,
} from "./story-shot-composer-model";

/**
 * Context a free-form reference upload needs: the uploaded image is turned into
 * a real project reference slot+version (the generation backend is slot-based),
 * then `refresh` reloads the workbench so the new slot appears in `references`.
 */
export interface StoryReferenceUploadContext {
  workspaceId: string;
  projectId: string;
  refresh: () => Promise<unknown>;
}

export interface StoryVideoGenerationFormProps {
  recipe: StoryVideoGenerationRecipeInput;
  references: StoryReferenceSlot[];
  readOnly: boolean;
  canGenerate: boolean;
  disabledReason: string | null;
  pendingKey: string | null;
  error: string | null;
  onRecipeChange: (next: StoryVideoGenerationRecipeInput) => void;
  onGenerate: (recipe: StoryVideoGenerationRecipeInput) => void;
  // Present when a free-form image upload can be created as a project reference
  // slot for this recipe. Absent (e.g. no active workspace) hides that control.
  referenceUpload?: StoryReferenceUploadContext | null;
}

/**
 * AI generation as an inspector form. The prompt, model, duration and
 * approved references are edited in place and submitted only on Generate; the
 * recipe stays local to this page and is never written to the story draft.
 */
export function StoryVideoGenerationForm({
  recipe,
  references,
  readOnly,
  canGenerate,
  disabledReason,
  pendingKey,
  error,
  onRecipeChange,
  onGenerate,
  referenceUpload,
}: StoryVideoGenerationFormProps) {
  const t = useTranslations("storyStudio.canvas.production");
  const catalogQuery = useAiCatalog();

  const storyCatalog = useMemo(
    () => filterStoryVideoModels(catalogQuery.data),
    [catalogQuery.data]
  );
  const catalogModel = useMemo(
    () => selectedStoryVideoModel(storyCatalog, recipe.modelId),
    [recipe.modelId, storyCatalog]
  );
  const durationContract = useMemo(() => storyVideoDurationContract(catalogModel), [catalogModel]);
  const supportedModes = useMemo(() => supportedStoryVideoModes(catalogModel), [catalogModel]);
  // The recipe mode is authoritative, but a persisted mode may not fit the
  // selected model — fall back to its first supported mode for rendering.
  const mode: StoryVideoGenerationMode =
    supportedModes.length > 0 && !supportedModes.includes(recipe.mode)
      ? supportedModes[0]
      : recipe.mode;
  const generating = pendingKey === "generate";
  const referenceItems = useMemo(
    () => storyComposerReferenceItems(recipe.references, references),
    [recipe.references, references]
  );
  const addableSlots = useMemo(
    () => storyComposerAddableSlots(mode, recipe.references, references),
    [mode, recipe.references, references]
  );
  const referencePlanValid = isStoryRecipeReferencePlanValid(mode, recipe.references);
  const recipeDisabledReason = !recipe.prompt.trim()
    ? t("disabled.promptRequired")
    : !catalogModel
      ? t("disabled.modelRequired")
      : !referencePlanValid
        ? t("disabled.referencesRequired")
        : disabledReason;
  const models = storyCatalog?.models ?? [];

  const changeMode = (nextMode: StoryVideoGenerationMode) => {
    if (readOnly || nextMode === recipe.mode) return;
    onRecipeChange({
      ...recipe,
      mode: nextMode,
      references: pruneStoryRecipeReferencesForMode(nextMode, recipe.references),
    });
  };

  // Reconcile a persisted recipe whose mode the selected model can't drive, so
  // the submitted recipe always matches what the rail renders.
  useEffect(() => {
    if (!catalogModel || supportedModes.length === 0) return;
    if (supportedModes.includes(recipe.mode)) return;
    onRecipeChange({
      ...recipe,
      mode: supportedModes[0],
      references: pruneStoryRecipeReferencesForMode(supportedModes[0], recipe.references),
    });
  }, [catalogModel, supportedModes, recipe, onRecipeChange]);

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

      {supportedModes.length > 1 ? (
        <StoryModeToggle mode={mode} disabled={readOnly} onChange={changeMode} />
      ) : null}

      {catalogModel && (referenceItems.length > 0 || addableSlots.length > 0 || referenceUpload) ? (
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
          {referenceUpload ? (
            <StoryReferenceUploadControl
              mode={mode}
              references={recipe.references}
              slotRank={references.length}
              disabled={readOnly}
              context={referenceUpload}
              onUploaded={(referenceVersionId, role) =>
                onRecipeChange({
                  ...recipe,
                  references: addStoryRecipeReference(recipe.references, referenceVersionId, role),
                })
              }
            />
          ) : null}
        </div>
      ) : null}

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
              const nextModes = supportedStoryVideoModes(nextModel);
              const nextMode =
                nextModes.length > 0 && !nextModes.includes(recipe.mode)
                  ? nextModes[0]
                  : recipe.mode;
              onRecipeChange({
                ...recipe,
                modelId,
                durationMs: nextDuration?.defaultMs ?? recipe.durationMs,
                mode: nextMode,
                references:
                  nextMode === recipe.mode
                    ? recipe.references
                    : pruneStoryRecipeReferencesForMode(nextMode, recipe.references),
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
      ) : recipeDisabledReason ? (
        <p className="text-center text-[10px] text-white/32">{recipeDisabledReason}</p>
      ) : null}
    </section>
  );
}

/**
 * The per-recipe story-mode toggle. Shown only when the selected model can
 * drive BOTH story modes; a single-mode model uses its mode with no control.
 */
function StoryModeToggle({
  mode,
  disabled,
  onChange,
}: {
  mode: StoryVideoGenerationMode;
  disabled: boolean;
  onChange: (mode: StoryVideoGenerationMode) => void;
}) {
  const t = useTranslations("storyStudio.canvas.production.modeToggle");
  const options: Array<{ value: StoryVideoGenerationMode; label: string }> = [
    { value: "multimodal_to_video", label: t("multimodal") },
    { value: "first_last_frame_to_video", label: t("firstLast") },
  ];
  return (
    <div>
      <p className="text-[10px] font-semibold text-white/54">{t("label")}</p>
      <div
        role="radiogroup"
        aria-label={t("label")}
        className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl bg-white/[0.055] p-1"
      >
        {options.map((option) => {
          const active = option.value === mode;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => {
                if (!disabled) onChange(option.value);
              }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                active ? "bg-white/[0.14] text-white" : "text-white/60 hover:bg-white/[0.08]",
                disabled && "cursor-not-allowed opacity-45 hover:bg-transparent"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Free-form reference upload. The picked image is uploaded, then turned into a
 * real project reference slot + version (the generation backend is slot-based),
 * added to the recipe with the mode-appropriate role, and the workbench is
 * refreshed so the new slot surfaces in the shared references list.
 */
function StoryReferenceUploadControl({
  mode,
  references,
  slotRank,
  disabled,
  context,
  onUploaded,
}: {
  mode: StoryVideoGenerationMode;
  references: StoryVideoGenerationRecipeInput["references"];
  slotRank: number;
  disabled: boolean;
  context: StoryReferenceUploadContext;
  onUploaded: (
    referenceVersionId: string,
    role: "reference" | "first_frame" | "last_frame"
  ) => void;
}) {
  const t = useTranslations("storyStudio.canvas.production.uploadReference");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const target = storyFreeformUploadTarget(mode, references);
  const busy = progress !== null;

  const upload = async (file: File) => {
    if (disabled || busy || !target) return;
    setProgress(0);
    setError(null);
    try {
      const asset = await uploadFileViaSignedUrl(file, {
        kind: "ai_reference_image",
        contentType: file.type || undefined,
        workspaceId: context.workspaceId,
        onProgress: setProgress,
      });
      const [slot] = await createStoryReferenceSlots(
        context.workspaceId,
        context.projectId,
        {
          slots: [
            {
              key: freeformSlotKey(),
              kind: target.kind,
              label: freeformSlotLabel(file.name),
              description: "",
              required: false,
              // Server caps rank at 100_000; append after existing slots.
              rank: Math.min(Math.max(slotRank, 0), 100_000),
            },
          ],
        },
        globalThis.crypto.randomUUID()
      );
      if (!slot) throw new Error("Reference slot was not created.");
      const version = await createStoryReferenceVersion(
        context.workspaceId,
        context.projectId,
        slot.id,
        {
          expectedSlotVersion: slot.version,
          assetId: asset.mediaAssetId,
          variantId: asset.variantId,
          source: "upload",
        },
        globalThis.crypto.randomUUID()
      );
      // Refresh first so the new slot is present in `references` before the
      // recipe points at its version (otherwise the rail item can't resolve).
      await context.refresh();
      onUploaded(version.id, target.role);
    } catch (cause) {
      if (!isUploadAbort(cause)) setError(storyApiErrorMessage(cause, t("error")));
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="mt-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || busy || !target}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <IconLoader2 className="size-4 animate-spin" /> : <IconUpload className="size-4" />}
        {busy ? t("uploading", { progress: progress ?? 0 }) : t("action")}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {error ? <p className="mt-2 text-[10px] leading-4 text-destructive">{error}</p> : null}
    </div>
  );
}

/** A schema-valid, collision-resistant slot key for a free-form upload. */
function freeformSlotKey(): string {
  const suffix = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  return `UPLOAD_${suffix}`;
}

/** A readable slot label from the uploaded file name, with a sane fallback. */
function freeformSlotLabel(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/u, "").trim();
  return (stem || "Uploaded reference").slice(0, 80);
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
