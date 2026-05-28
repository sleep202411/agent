"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { IconAdjustments, IconChevronDown, IconLock, IconSparkles } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type {
  FoundryConditionExpression,
  FoundryFieldUi,
  FoundryJsonPrimitive,
  FoundryJsonSchema,
  FoundryUiOption,
} from "@repo/shared";
import type { AiModel } from "../_data/mock-model";
import { ReferenceImageStack } from "./reference-image-stack";

export interface AiOption {
  value: string;
  label: string;
  /** Product plan the option requires. `null` = open to all. */
  requiredPlan?: string | null;
}

export type ComposeBarProps = {
  prompt: string;
  onPromptChange: (v: string) => void;
  model: AiModel;
  models: AiModel[];
  onModelChange: (m: AiModel) => void;
  aspectRatioValue: string;
  aspectRatioOptions: AiOption[];
  onAspectRatioChange: (v: string) => void;
  resolutionTierValue: string;
  resolutionTierOptions: AiOption[];
  onResolutionTierChange: (v: string) => void;
  qualityValue: string;
  qualityOptions: AiOption[];
  onQualityChange: (v: string) => void;
  outputs: number;
  outputOptions: number[];
  onOutputsChange: (n: number) => void;
  formData: Record<string, unknown>;
  onFieldChange: (name: string, value: unknown) => void;
  /** Current user's plan rank — used to lock higher-plan options. */
  userPlanRank: number;
  planRank: (plan: string | null | undefined) => number;
  /**
   * Number of this user's image jobs currently queued or running on
   * the selected model. When > 0 we surface a badge on the model
   * chip and disable the submit button — only one in-flight job at
   * a time per user.
   */
  activeJobCount: number;
  /**
   * True when at least one active job has progressed past the queue
   * (worker has picked it up). Drives "生成中" vs "排队中" wording
   * so a user alone in the queue doesn't see a confusing "queued"
   * label for the entire 50 s provider run.
   */
  activeJobRunning: boolean;
  canSubmit: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  submitDisabledLabel?: string;
  submitDisabledReason?: string;
  disabled?: boolean;
  /**
   * Monotonically-increasing token. Each increment focuses the prompt
   * textarea and scrolls it into view — used by the gallery's
   * "click cell → reuse prompt" flow so the user lands ready to edit.
   * Value itself doesn't matter; only its identity change.
   */
  focusToken?: number;
  t: (key: string, fallback?: string) => string;
};

export function ComposeBar(props: ComposeBarProps) {
  const {
    prompt,
    onPromptChange,
    model,
    models,
    onModelChange,
    aspectRatioValue,
    aspectRatioOptions,
    onAspectRatioChange,
    resolutionTierValue,
    resolutionTierOptions,
    onResolutionTierChange,
    qualityValue,
    qualityOptions,
    onQualityChange,
    outputs,
    outputOptions,
    onOutputsChange,
    formData,
    onFieldChange,
    userPlanRank,
    planRank,
    activeJobCount,
    activeJobRunning,
    canSubmit,
    isSubmitting,
    onSubmit,
    submitDisabledLabel,
    submitDisabledReason,
    disabled,
    focusToken,
    t,
  } = props;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [openPopover, setOpenPopover] = useState<
    null | "model" | "ratio" | "resolution" | "customize"
  >(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 140);
    el.style.height = `${next}px`;
  }, [prompt]);

  // Refill-from-gallery hook. Each token bump means the caller just
  // dropped a new prompt in; jump focus to the textarea, put the
  // caret at the end (so a hit of Backspace deletes the last word,
  // not the last char of the placeholder), and scroll the bar into
  // view in case the user was deep in the gallery. The token-only
  // dependency keeps focus from firing on plain prompt edits.
  useEffect(() => {
    if (focusToken === undefined) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      /* some browsers throw on hidden inputs — ignore */
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusToken]);

  const modelLocked = model.access?.allowed === false;
  const modelLockedPlan = model.access?.requiredPlan ?? null;
  const modelBusy = activeJobCount > 0;
  const busyLabel = activeJobRunning
    ? t("imageLab.compose.generating", "Generating")
    : t("imageLab.compose.queued", "In queue");

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canSubmit && !submitDisabledReason) onSubmit();
    }
  };

  const isOptionLocked = (opt: AiOption) =>
    opt.requiredPlan != null && planRank(opt.requiredPlan) > userPlanRank;

  const activeResolution = resolutionTierOptions.find((o) => o.value === resolutionTierValue);
  const advancedFields = useMemo(() => getAdvancedFields(model, formData), [model, formData]);
  const referenceField = advancedFields.find((f) => f.name === "reference_images");
  const hasReferenceField = referenceField !== undefined;
  // Reference cap comes from the model's own schema (`maxItems` on the
  // reference_images array property). Don't synthesize a default — if a
  // schema author forgot to declare a cap, the client passes 1 (safe
  // minimum) rather than 16; otherwise we risk uploading 16 images for
  // a model that only takes 4 and getting a backend rejection.
  const referenceMaxImages =
    referenceField &&
    referenceField.field.type === "array" &&
    typeof referenceField.field.maxItems === "number"
      ? referenceField.field.maxItems
      : 1;
  // `reference_images` has its own first-class UI (ReferenceImageStack)
  // on the chip row; strip it from the Customize panel so we don't render
  // a duplicate "paste URLs" textarea.
  const customizeFields = useMemo(
    () => advancedFields.filter((f) => f.name !== "reference_images"),
    [advancedFields]
  );
  const referenceImages = useMemo(() => {
    const raw = formData.reference_images;
    return Array.isArray(raw) ? (raw as string[]).filter((u) => typeof u === "string") : [];
  }, [formData]);
  const hasCustomizeContent =
    qualityOptions.length > 0 || outputOptions.length > 1 || customizeFields.length > 0;
  const submitButton = (
    <Button
      type="button"
      onClick={onSubmit}
      disabled={!canSubmit || modelLocked || modelBusy || Boolean(submitDisabledReason)}
      loading={isSubmitting}
      size="default"
      className="h-8 shrink-0 rounded-full bg-primary px-4 text-primary-foreground hover:bg-primary/90"
      icon={
        submitDisabledReason || modelLocked ? (
          <IconLock className="size-4" />
        ) : !isSubmitting ? (
          <IconSparkles className="size-4" />
        ) : undefined
      }
      title={
        submitDisabledReason ??
        (modelBusy
          ? t("imageLab.compose.busy", "Previous task is still running.")
          : modelLocked
            ? modelLockedPlan
              ? t("imageLab.compose.lockedPlan", "Available to {plan}+ members").replace(
                  "{plan}",
                  modelLockedPlan
                )
              : t("imageLab.compose.lockedMember", "Available to members only")
            : undefined)
      }
    >
      <span>
        {submitDisabledLabel ??
          (modelBusy
            ? busyLabel
            : modelLocked
              ? modelLockedPlan
                ? t("imageLab.compose.unlockPlan", "Unlock {plan}").replace(
                    "{plan}",
                    modelLockedPlan
                  )
                : t("imageLab.compose.unlockMember", "Members only")
              : t("imageLab.compose.create", "Create"))}
      </span>
    </Button>
  );

  return (
    <div
      className="relative rounded-2xl bg-zinc-900/80 px-3 py-3 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/5 backdrop-blur-xl backdrop-saturate-150"
      onMouseLeave={() => setOpenPopover(null)}
    >
      {/* Row 0 — references (only when the current model declares a
          `reference_images` field). Inline horizontal row at the top
          of the bar, same visual language as the storyboard's
          ReferenceGroup: small rotated thumbnails + an `+` tile at
          the end. Hidden entirely when the model doesn't support
          references, so the bar collapses to its prompt-only shape. */}
      {hasReferenceField ? (
        <div className="mb-2 px-1">
          <ReferenceImageStack
            value={referenceImages}
            onChange={(next) => onFieldChange("reference_images", next)}
            maxImages={referenceMaxImages}
            disabled={disabled}
            t={t}
          />
        </div>
      ) : null}

      {/* Row 1 — Prompt. Create button moved to the chip row below
          so the action sits next to the parameters it acts on. */}
      <div className="flex items-end">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={t("imageLab.compose.placeholder", "Describe the image you imagine")}
          rows={3}
          disabled={disabled}
          className="min-h-20 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 text-foreground placeholder:text-zinc-500 focus:outline-none disabled:opacity-50"
        />
      </div>

      {/* Row 2 — chips. `flex-nowrap` + `shrink-0` on each chip keeps
          one row on desktop (compose bar is `max-w-3xl`, fits all
          chips comfortably). We intentionally do NOT add `overflow-
          x-auto` here — CSS treats `overflow-x: auto` + `overflow-y:
          visible` as both-auto, which would clip the chip popovers
          that pop upward. Narrow viewports just let the row overflow
          the bar (rare; mobile path can be revisited separately). */}
      <div className="mt-2 flex flex-nowrap items-center gap-1.5 px-1">
        {/* Reference image stack lives above the textarea now (see the
            absolute-positioned block at the top of this component). */}

        {/* Model chip — always clickable so users can read the model's
            name/description even when only one model is registered.
            When the user has an in-flight job on this model we render
            a "queued" pill inside the chip — same chip-affordance
            (still openable to read details / switch model) but the
            generate button is disabled. */}
        <ChipPopover
          open={openPopover === "model"}
          onOpenChange={(v) => setOpenPopover(v ? "model" : null)}
          label={model.name}
          disabled={disabled}
          trailing={modelBusy ? <QueueBadge count={activeJobCount} label={busyLabel} /> : undefined}
        >
          {models.map((option) => {
            const active = option.id === model.id;
            const locked = option.access?.allowed === false;
            const requiredPlan = option.access?.requiredPlan ?? null;
            return (
              <PopoverItem
                key={option.id}
                active={active}
                onClick={() => {
                  onModelChange(option);
                  setOpenPopover(null);
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="block flex-1 truncate text-sm font-semibold">{option.name}</span>
                  {locked && <PlanBadge plan={requiredPlan ?? "member"} />}
                </div>
                {option.description && (
                  <span className="block truncate text-[11px] text-zinc-400">
                    {option.description}
                  </span>
                )}
              </PopoverItem>
            );
          })}
        </ChipPopover>

        {/* Ratio chip — visual icon */}
        <ChipPopover
          open={openPopover === "ratio"}
          onOpenChange={(v) => setOpenPopover(v ? "ratio" : null)}
          label={aspectRatioValue}
          leadingIcon={<RatioIcon ratio={aspectRatioValue} className="size-3.5" />}
          disabled={disabled}
        >
          <div className="grid grid-cols-3 gap-1">
            {aspectRatioOptions.map((option) => {
              const active = option.value === aspectRatioValue;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onAspectRatioChange(option.value);
                    setOpenPopover(null);
                  }}
                  className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-primary/15 text-primary ring-1 ring-primary/50"
                      : "text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  <RatioIcon ratio={option.value} className="size-5" />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </ChipPopover>

        {/* Resolution chip — with lock on higher-plan options */}
        {resolutionTierOptions.length > 0 && (
          <ChipPopover
            open={openPopover === "resolution"}
            onOpenChange={(v) => setOpenPopover(v ? "resolution" : null)}
            label={activeResolution?.label ?? resolutionTierValue}
            disabled={disabled}
          >
            {resolutionTierOptions.map((option) => {
              const active = option.value === resolutionTierValue;
              const locked = isOptionLocked(option);
              return (
                <PopoverItem
                  key={option.value}
                  active={active}
                  disabled={locked}
                  title={
                    locked
                      ? t("imageLab.compose.lockedPlan", "Available to {plan}+ members").replace(
                          "{plan}",
                          option.requiredPlan ?? "member"
                        )
                      : undefined
                  }
                  onClick={() => {
                    if (locked) return;
                    onResolutionTierChange(option.value);
                    setOpenPopover(null);
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="block flex-1 truncate text-sm font-medium">
                      {option.label}
                    </span>
                    {locked && <PlanBadge plan={option.requiredPlan ?? "member"} />}
                  </div>
                </PopoverItem>
              );
            })}
          </ChipPopover>
        )}

        {/* Customize — single panel that collapses Quality + Outputs +
            schema-driven advanced fields under one chip. Keeps the
            chip row to just model + ratio + resolution + this, with
            the Create button at the trailing edge. The decision came
            after the row got 6+ chips wide and started feeling like
            a control surface instead of a creative compose bar. */}
        {hasCustomizeContent && (
          <ChipPopover
            open={openPopover === "customize"}
            onOpenChange={(v) => setOpenPopover(v ? "customize" : null)}
            label={t("imageLab.compose.customize", "Customize")}
            leadingIcon={<IconAdjustments className="size-3.5" />}
            disabled={disabled}
            align="right"
            contentClassName="w-[min(440px,calc(100vw-32px))] max-h-[70vh] overflow-y-auto rounded-xl bg-zinc-900 p-3 shadow-2xl ring-1 ring-white/10"
          >
            <div className="space-y-4">
              {qualityOptions.length > 0 && (
                <section>
                  <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    {t("imageLab.compose.qualityChip", "Quality")}
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {qualityOptions.map((option) => {
                      const active = option.value === qualityValue;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => onQualityChange(option.value)}
                          disabled={disabled}
                          className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors ${
                            active
                              ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                              : "bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
              {outputOptions.length > 1 && (
                <section>
                  <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    {t("imageLab.compose.outputs", "Outputs")}
                  </h4>
                  <div className="inline-flex h-8 items-center gap-0.5 rounded-full bg-zinc-800/60 px-0.5">
                    {outputOptions.map((value) => {
                      const active = value === outputs;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => onOutputsChange(value)}
                          disabled={disabled}
                          className={`inline-flex h-7 min-w-8 items-center justify-center rounded-full px-2 text-xs font-medium transition-colors ${
                            active
                              ? "bg-zinc-700 text-foreground"
                              : "text-zinc-400 hover:text-zinc-200"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                          aria-label={`${value} ${value === 1 ? "image" : "images"}`}
                        >
                          ×{value}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
              {customizeFields.length > 0 && (
                <section>
                  <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    {t("imageLab.compose.advanced", "Advanced")}
                  </h4>
                  <AdvancedFieldList
                    fields={customizeFields}
                    formData={formData}
                    onFieldChange={onFieldChange}
                    userPlanRank={userPlanRank}
                    planRank={planRank}
                    disabled={disabled}
                    t={t}
                  />
                </section>
              )}
            </div>
          </ChipPopover>
        )}

        {/* Spacer pushes Create to the trailing edge — same row as
            the chips it acts on. */}
        <div className="ml-auto" />
        {submitButton}
      </div>
    </div>
  );
}

// ─── Schema-driven advanced controls ────────────────────────────
// The server is the source of truth for schema, validation, and plan
// enforcement. The compose bar renders secondary fields from that same
// contract so new provider parameters can ship without hand-editing
// page state for every field.
type SchemaOption = Pick<FoundryUiOption, "label" | "labelKey" | "requiredPlan"> & {
  value: Exclude<FoundryJsonPrimitive, null>;
};

type AdvancedField = {
  name: string;
  field: FoundryJsonSchema;
  ui: FoundryFieldUi;
  enabled: boolean;
  required: boolean;
};

const PRIMARY_FIELD_NAMES = new Set(["prompt", "aspect_ratio", "resolution_tier", "quality", "n"]);

function AdvancedFieldList({
  fields,
  formData,
  onFieldChange,
  userPlanRank,
  planRank,
  disabled,
  t,
}: {
  fields: AdvancedField[];
  formData: Record<string, unknown>;
  onFieldChange: (name: string, value: unknown) => void;
  userPlanRank: number;
  planRank: (plan: string | null | undefined) => number;
  disabled?: boolean;
  t: ComposeBarProps["t"];
}) {
  return (
    <div className="space-y-3">
      {fields.map((item) => (
        <SchemaFieldControl
          key={item.name}
          item={item}
          value={formData[item.name] ?? item.field.default}
          onChange={(value) => onFieldChange(item.name, value)}
          userPlanRank={userPlanRank}
          planRank={planRank}
          disabled={disabled || !item.enabled}
          t={t}
        />
      ))}
    </div>
  );
}

function SchemaFieldControl({
  item,
  value,
  onChange,
  userPlanRank,
  planRank,
  disabled,
  t,
}: {
  item: AdvancedField;
  value: unknown;
  onChange: (value: unknown) => void;
  userPlanRank: number;
  planRank: (plan: string | null | undefined) => number;
  disabled?: boolean;
  t: ComposeBarProps["t"];
}) {
  const { name, field, ui, required } = item;
  const label = fieldLabel(name, field, ui, t);
  const description = fieldDescription(field, ui, t);
  const control = ui.control;
  const options = fieldOptions(field, ui);
  const isMediaArray = field.type === "array" && /upload$/.test(control ?? "");

  return (
    <div className="rounded-lg bg-zinc-950/45 px-3 py-3 ring-1 ring-white/5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
            <span className="truncate">{label}</span>
            {required && <span className="text-primary">*</span>}
          </div>
          {description && <p className="mt-1 text-[11px] leading-4 text-zinc-500">{description}</p>}
        </div>
        {disabled && ui.disabledReason && (
          <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
            {ui.disabledReason}
          </span>
        )}
      </div>

      {options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => {
            const active = valuesEqual(value, option.value);
            const locked =
              option.requiredPlan != null && planRank(option.requiredPlan) > userPlanRank;
            const label = option.labelKey
              ? t(option.labelKey, option.label)
              : t(`options.${String(option.value)}`, option.label);
            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => {
                  if (!locked) onChange(option.value);
                }}
                disabled={disabled || locked}
                title={
                  locked
                    ? t("imageLab.compose.lockedPlan", "Available to {plan}+ members").replace(
                        "{plan}",
                        option.requiredPlan ?? "member"
                      )
                    : undefined
                }
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary/15 text-primary ring-1 ring-primary/45"
                    : "bg-zinc-800/70 text-zinc-300 hover:bg-zinc-800"
                } disabled:cursor-not-allowed disabled:opacity-55`}
              >
                <span>{label}</span>
                {locked && <PlanBadge plan={option.requiredPlan ?? "member"} />}
              </button>
            );
          })}
        </div>
      ) : field.type === "boolean" || control === "switch" || control === "checkbox" ? (
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          onClick={() => onChange(!Boolean(value))}
          disabled={disabled}
          className={`inline-flex h-7 w-12 items-center rounded-full p-0.5 transition-colors ${
            value ? "bg-primary" : "bg-zinc-800"
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <span
            className={`size-6 rounded-full bg-white transition-transform ${
              value ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      ) : isMediaArray ? (
        <textarea
          value={mediaReferencesToText(value)}
          onChange={(event) => onChange(textToMediaReferences(event.target.value))}
          disabled={disabled}
          rows={3}
          placeholder={t(
            "imageLab.compose.referencesPlaceholder",
            "Paste image URLs, one per line"
          )}
          className="min-h-20 w-full resize-none rounded-lg bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-200 outline-none ring-1 ring-white/10 placeholder:text-zinc-600 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
        />
      ) : field.type === "integer" || field.type === "number" ? (
        <NumberField field={field} value={value} onChange={onChange} disabled={disabled} />
      ) : (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={ui.placeholderKey ? t(ui.placeholderKey, ui.placeholder) : ui.placeholder}
          className="h-9 w-full rounded-lg bg-zinc-950 px-3 text-xs text-zinc-200 outline-none ring-1 ring-white/10 placeholder:text-zinc-600 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
        />
      )}
    </div>
  );
}

function NumberField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FoundryJsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const minimum = "minimum" in field ? field.minimum : undefined;
  const maximum = "maximum" in field ? field.maximum : undefined;
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : "";
  const isSlider =
    field["x-ui"] &&
    !("groups" in field["x-ui"]) &&
    field["x-ui"].control === "slider" &&
    typeof minimum === "number" &&
    typeof maximum === "number";

  if (isSlider) {
    const current =
      typeof numericValue === "number" ? numericValue : typeof minimum === "number" ? minimum : 0;
    return (
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={minimum}
          max={maximum}
          value={current}
          onChange={(event) => onChange(Number(event.target.value))}
          disabled={disabled}
          className="h-2 flex-1 accent-primary disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span className="w-10 rounded bg-zinc-800 px-2 py-1 text-center text-xs tabular-nums text-zinc-300">
          {current}
        </span>
      </div>
    );
  }

  return (
    <input
      type="number"
      min={minimum}
      max={maximum}
      value={numericValue}
      onChange={(event) => {
        const next = event.target.value;
        onChange(next === "" ? undefined : Number(next));
      }}
      disabled={disabled}
      className="h-9 w-full rounded-lg bg-zinc-950 px-3 text-xs tabular-nums text-zinc-200 outline-none ring-1 ring-white/10 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}

function getAdvancedFields(model: AiModel, formData: Record<string, unknown>): AdvancedField[] {
  const required = new Set(model.input_schema.required ?? []);
  return Object.entries(model.input_schema.properties)
    .filter(([name]) => !PRIMARY_FIELD_NAMES.has(name))
    .map(([name, field]) => {
      const ui = fieldUi(field);
      return {
        name,
        field,
        ui,
        enabled: !ui.enabledWhen || matchesCondition(ui.enabledWhen, formData),
        required: required.has(name),
      };
    })
    .filter((item) => item.ui.control !== "hidden" && item.ui.importance !== "hidden")
    .filter((item) => {
      const ui = item.ui;
      if (ui.visibleWhen && !matchesCondition(ui.visibleWhen, formData)) return false;
      if (ui.showWhen && !matchesCondition(ui.showWhen, formData)) return false;
      return true;
    })
    .sort((a, b) => (a.ui.order ?? 999) - (b.ui.order ?? 999));
}

function fieldUi(field: FoundryJsonSchema): FoundryFieldUi {
  const ui = field["x-ui"];
  return ui && !("groups" in ui) ? ui : {};
}

function fieldOptions(field: FoundryJsonSchema, ui: FoundryFieldUi): SchemaOption[] {
  const raw = ui.options ?? field.enum?.map((value) => ({ value, label: String(value) }));
  if (!raw) return [];
  return raw
    .filter((option): option is FoundryUiOption => option != null && option.value !== null)
    .map((option) => ({
      value: option.value as SchemaOption["value"],
      label: option.label ?? String(option.value),
      labelKey: option.labelKey,
      requiredPlan: option.requiredPlan ?? null,
    }));
}

function fieldLabel(
  name: string,
  field: FoundryJsonSchema,
  ui: FoundryFieldUi,
  t: ComposeBarProps["t"]
): string {
  const fallback = ui.label ?? field.title ?? name.replaceAll("_", " ");
  return ui.labelKey
    ? t(ui.labelKey, fallback)
    : field.titleKey
      ? t(field.titleKey, fallback)
      : fallback;
}

function fieldDescription(
  field: FoundryJsonSchema,
  ui: FoundryFieldUi,
  t: ComposeBarProps["t"]
): string | null {
  const fallback = ui.hint ?? field.description;
  const key = ui.hintKey ?? field.descriptionKey;
  return key ? t(key, fallback) : (fallback ?? null);
}

function matchesCondition(
  condition: FoundryConditionExpression,
  formData: Record<string, unknown>
): boolean {
  if ("all" in condition && condition.all) {
    return condition.all.every((item) => matchesCondition(item, formData));
  }
  if ("any" in condition && condition.any) {
    return condition.any.some((item) => matchesCondition(item, formData));
  }
  if ("not" in condition && condition.not) {
    return !matchesCondition(condition.not, formData);
  }
  if (!("field" in condition)) return false;

  const current = formData[condition.field];
  switch (condition.operator) {
    case "equals":
      return valuesEqual(current, condition.value);
    case "notEquals":
      return !valuesEqual(current, condition.value);
    case "in":
      return (condition.values ?? []).some((item) => valuesEqual(current, item));
    case "notIn":
      return !(condition.values ?? []).some((item) => valuesEqual(current, item));
    case "exists":
      return !isEmptyValue(current);
    case "empty":
      return isEmptyValue(current);
    case "gt":
      return Number(current) > Number(condition.value);
    case "gte":
      return Number(current) >= Number(condition.value);
    case "lt":
      return Number(current) < Number(condition.value);
    case "lte":
      return Number(current) <= Number(condition.value);
    default:
      return false;
  }
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return a === b || String(a) === String(b);
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function mediaReferencesToText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "url" in item) {
        const url = (item as { url?: unknown }).url;
        return typeof url === "string" ? url : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function textToMediaReferences(text: string): Array<{ url: string }> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((url) => ({ url }));
}

// ─── Visual ratio icon ────────────────────────────────────────
// Draws a small proportional rectangle so users can see the shape
// without parsing "1:1" / "9:16" strings. Falls back to a square
// for unknown ratios.
function RatioIcon({ ratio, className }: { ratio: string; className?: string }) {
  const [w, h] = parseRatio(ratio);
  // Normalize so the longer side is 100% and the shorter is < 100%.
  const longest = Math.max(w, h);
  const widthPct = (w / longest) * 100;
  const heightPct = (h / longest) * 100;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className ?? ""}`}
      aria-hidden
    >
      <span
        className="rounded-sm border border-current"
        style={{ width: `${widthPct}%`, height: `${heightPct}%` }}
      />
    </span>
  );
}

function parseRatio(ratio: string): [number, number] {
  const match = ratio.match(/^(\d+):(\d+)$/);
  if (!match) return [1, 1];
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    return [1, 1];
  }
  return [a, b];
}

// ─── Plan badge (lock + plan name) ────────────────────────────
function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-300">
      <IconLock className="size-3" />
      {plan}
    </span>
  );
}

// ─── Queue badge (amber pulsing dot + count) ─────────────────
// Tight single-line affordance: a pulsing dot + count, no text. The
// submit button right next to the chip already says "生成中" /
// "排队中"; repeating it inside the chip is visual noise.
function QueueBadge({ count, label }: { count: number; label: string }) {
  return (
    <span
      className="ml-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-300"
      title={`${label} · ${count}`}
    >
      <span className="inline-block size-1.5 animate-pulse rounded-full bg-amber-400" />
      {count}
    </span>
  );
}

function ChipPopover({
  open,
  onOpenChange,
  label,
  leadingIcon,
  trailing,
  disabled,
  align = "left",
  contentClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  label: string;
  leadingIcon?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  align?: "left" | "right";
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && onOpenChange(!open)}
        disabled={disabled}
        className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {leadingIcon && <span className="text-zinc-400">{leadingIcon}</span>}
        <span className="truncate">{label}</span>
        {trailing}
        <IconChevronDown className="size-3 text-zinc-500" />
      </button>
      {open && (
        <div
          className={`absolute bottom-full z-40 mb-2 ${
            align === "right" ? "right-0" : "left-0"
          } ${contentClassName ?? "min-w-[200px] overflow-hidden rounded-xl bg-zinc-900 p-1 shadow-2xl ring-1 ring-white/10"}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function PopoverItem({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
        disabled ? "cursor-not-allowed opacity-55" : "hover:bg-zinc-800"
      } ${active ? "bg-primary/15 text-primary" : "text-zinc-200"}`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {active && <span className="mt-1.5 size-1.5 rounded-full bg-primary" />}
    </button>
  );
}
