"use client";

import { createElement, useId, useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  IconAlertTriangle,
  IconBolt,
  IconBrandOpenai,
  IconLock,
  IconPhoto,
  IconRectangle,
  IconRectangleVertical,
  IconSearch,
  IconSparkles,
  IconSquare,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/components/ui/native-select";
import { useTranslations } from "@/src/i18n/i18n";
import {
  cheapestSellPoints,
  isFizzAiModelUsable,
  schemaFields,
  type FizzAiModel,
  type ModelSettings,
  type SchemaFieldDescriptor,
} from "../../_lib/generation-api";

type SettingsIcon = ComponentType<{ className?: string; stroke?: number }>;

/* ── model + size icon maps ──────────────────────────────────────────────── */

const MODEL_ICON_RULES: Array<[RegExp, SettingsIcon]> = [
  [/gpt/, IconBrandOpenai],
  [/flux/, IconBolt],
  [/seedream|nano|seedance|sora|veo|kling|wan|happy/, IconSparkles],
];

function modelIcon(model: FizzAiModel): SettingsIcon {
  const key = `${model.id ?? ""} ${model.name ?? ""}`.toLowerCase();
  for (const [pattern, icon] of MODEL_ICON_RULES) if (pattern.test(key)) return icon;
  return model.type === "video" ? IconVideo : IconPhoto;
}

/** fal `imageSize` / `aspectRatio` enum tokens → friendly label + orientation icon. */
const SIZE_META: Record<string, { icon: SettingsIcon; label: string }> = {
  "1:1": { icon: IconSquare, label: "1:1" },
  "4:3": { icon: IconRectangle, label: "4:3" },
  "3:4": { icon: IconRectangleVertical, label: "3:4" },
  "16:9": { icon: IconRectangle, label: "16:9" },
  "9:16": { icon: IconRectangleVertical, label: "9:16" },
  "3:2": { icon: IconRectangle, label: "3:2" },
  "2:3": { icon: IconRectangleVertical, label: "2:3" },
  "4:5": { icon: IconRectangleVertical, label: "4:5" },
  "5:4": { icon: IconRectangle, label: "5:4" },
  "21:9": { icon: IconRectangle, label: "21:9" },
  "9:21": { icon: IconRectangleVertical, label: "9:21" },
  square_hd: { icon: IconSquare, label: "1:1 HD" },
  square: { icon: IconSquare, label: "1:1" },
  portrait_4_3: { icon: IconRectangleVertical, label: "3:4" },
  portrait_16_9: { icon: IconRectangleVertical, label: "9:16" },
  landscape_4_3: { icon: IconRectangle, label: "4:3" },
  landscape_16_9: { icon: IconRectangle, label: "16:9" },
  auto: { icon: IconSparkles, label: "Auto" },
};

function sizeMeta(token: string) {
  return SIZE_META[token] ?? { icon: IconRectangle, label: token };
}

const SIZE_FIELDS = new Set(["imageSize", "aspectRatio"]);

/* ── public API ──────────────────────────────────────────────────────────── */

export interface ModelSettingsPanelProps {
  models: FizzAiModel[];
  isLoading: boolean;
  error: boolean;
  selectedModelId: string;
  settings: ModelSettings;
  onSelectModel: (id: string) => void;
  onSettingsChange: (settings: ModelSettings) => void;
  onClose: () => void;
  onRetry?: () => void;
}

export function modelById(models: FizzAiModel[], id: string): FizzAiModel | undefined {
  return models.find((model) => model.id === id);
}

export function getModelLabel(models: FizzAiModel[], id: string): string {
  return modelById(models, id)?.name ?? id;
}

export function ModelSettingsPanel({
  models,
  isLoading,
  error,
  selectedModelId,
  settings,
  onSelectModel,
  onSettingsChange,
  onClose,
  onRetry,
}: ModelSettingsPanelProps) {
  const t = useTranslations("fizzStudio.modelSettings");
  const titleId = useId();

  const selectedModel = useMemo(
    () => modelById(models, selectedModelId),
    [models, selectedModelId]
  );
  const fields = useMemo(() => schemaFields(selectedModel), [selectedModel]);
  const sizeField = fields.find((f) => SIZE_FIELDS.has(f.name));
  const optionFields = fields.filter((f) => !SIZE_FIELDS.has(f.name));

  const update = (name: string, value: string | number | boolean) =>
    onSettingsChange({ ...settings, [name]: value });

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      className="mb-4 max-h-[calc(100svh-15rem)] overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#141416] text-white shadow-[0_24px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] duration-150 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3"
    >
      <div className="flex h-14 items-center justify-between px-5">
        <h2 id={titleId} className="text-sm font-semibold tracking-[-0.01em] text-white/90">
          {t("title")}
        </h2>
        <button
          type="button"
          aria-label={t("close")}
          onClick={onClose}
          className="flex size-9 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconX className="size-5" stroke={1.8} />
        </button>
      </div>

      <div className="max-h-[calc(100svh-20rem)] overflow-y-auto px-4 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.06fr)]">
          <ModelPanel
            models={models}
            isLoading={isLoading}
            error={error}
            selectedModelId={selectedModelId}
            onRetry={onRetry}
            onSelect={onSelectModel}
          />
          <div className="grid min-w-0 gap-4">
            {sizeField ? (
              <AspectRatioSection
                field={sizeField}
                value={String(settings[sizeField.name] ?? "")}
                onSelect={(value) => update(sizeField.name, value)}
                onReset={() =>
                  update(sizeField.name, (sizeField.default as string) ?? sizeField.enum?.[0] ?? "")
                }
              />
            ) : null}
            {optionFields.length > 0 ? (
              <section className="min-w-0">
                <h3 className="text-center text-sm font-semibold text-white/90">
                  {t("moreOptions")}
                </h3>
                <div className="mt-4 divide-y divide-white/[0.07]">
                  {optionFields.map((field) => (
                    <OptionRow
                      key={field.name}
                      field={field}
                      value={settings[field.name]}
                      onChange={(value) => update(field.name, value)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── model list ──────────────────────────────────────────────────────────── */

function ModelPanel({
  models,
  isLoading,
  error,
  selectedModelId,
  onRetry,
  onSelect,
}: {
  models: FizzAiModel[];
  isLoading: boolean;
  error: boolean;
  selectedModelId: string;
  onRetry?: () => void;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("fizzStudio.modelSettings");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? models.filter((m) => m.name.toLowerCase().includes(q)) : models;
  }, [models, query]);

  return (
    <section className="min-w-0">
      <h3 className="text-center text-sm font-semibold text-white/90">{t("selectModel")}</h3>
      <label className="mt-4 flex h-9 items-center gap-2 rounded-[12px] border border-white/[0.07] bg-white/[0.03] px-3 text-white/52">
        <IconSearch className="size-4 shrink-0" stroke={1.8} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchModels")}
          aria-label={t("searchModels")}
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/42"
        />
      </label>

      {isLoading ? (
        <div className="mt-4 flex flex-col gap-1">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 rounded-[14px] px-3 py-2.5">
              <span className="size-9 shrink-0 animate-pulse rounded-[11px] bg-white/[0.06]" />
              <span className="h-3.5 flex-1 animate-pulse rounded-full bg-white/[0.06]" />
              <span className="h-5 w-12 shrink-0 animate-pulse rounded-full bg-white/[0.05]" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-[16px] border border-white/[0.07] bg-white/[0.02] p-5 text-center">
          <IconAlertTriangle className="size-6 text-white/60" stroke={1.8} />
          <p className="text-sm text-white/64">{t("modelsError")}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="h-9 rounded-full border border-white/[0.12] bg-white/[0.06] px-4 text-sm font-semibold text-white transition-colors hover:bg-white/[0.1]"
            >
              {t("retry")}
            </button>
          ) : null}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-[16px] border border-white/[0.07] bg-white/[0.02] p-5 text-center">
          <IconPhoto className="size-6 text-white/50" stroke={1.8} />
          <p className="text-sm text-white/60">
            {query.trim() ? t("noModelMatch") : t("noModels")}
          </p>
        </div>
      ) : (
        <div className="mt-4 flex max-h-[460px] flex-col gap-1 overflow-y-auto pr-1">
          {filtered.map((model) => (
            <ModelRow
              key={model.id}
              active={selectedModelId === model.id}
              locked={!isFizzAiModelUsable(model)}
              model={model}
              onSelect={() => {
                if (isFizzAiModelUsable(model)) onSelect(model.id);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ModelRow({
  active,
  locked,
  model,
  onSelect,
}: {
  active: boolean;
  locked: boolean;
  model: FizzAiModel;
  onSelect: () => void;
}) {
  const t = useTranslations("fizzStudio.modelSettings");
  const lockReason = model.access?.reason || model.disabledReason || t("modelLocked");
  const points = cheapestSellPoints(model);

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-disabled={locked}
      disabled={locked}
      title={locked ? lockReason : undefined}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-[12px] border px-2.5 py-2 text-left transition duration-150",
        locked
          ? "cursor-not-allowed border-transparent text-white/40"
          : active
            ? "border-white/20 bg-white/[0.08] text-white"
            : "border-transparent text-white/72 hover:bg-white/[0.05] hover:text-white"
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-[10px] border transition duration-150",
          active ? "border-white/20 bg-white/[0.12]" : "border-white/[0.07] bg-white/[0.03]",
          locked && "opacity-60"
        )}
      >
        {createElement(modelIcon(model), { className: "size-4", stroke: 1.7 })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{model.name}</span>
          {locked ? (
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
              <IconLock className="size-2.5" stroke={2.4} />
            </span>
          ) : null}
        </span>
        {locked ? (
          <span className="block truncate text-[11px] leading-4 text-amber-200/70">
            {lockReason}
          </span>
        ) : null}
      </span>
      {points != null ? (
        <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-medium tabular-nums text-white/68">
          {t("priceFrom", { points })}
        </span>
      ) : null}
    </button>
  );
}

/* ── aspect ratio / size ─────────────────────────────────────────────────── */

function AspectRatioSection({
  field,
  value,
  onSelect,
  onReset,
}: {
  field: SchemaFieldDescriptor;
  value: string;
  onSelect: (value: string) => void;
  onReset: () => void;
}) {
  const t = useTranslations("fizzStudio.modelSettings");
  const options = field.enum ?? [];
  if (options.length === 0) return null;

  return (
    <section className="min-w-0">
      <div className="flex items-center justify-between gap-4">
        <h3 className="flex-1 text-center text-sm font-semibold text-white/90">
          {t("selectAspectRatio")}
        </h3>
        <button
          type="button"
          onClick={onReset}
          disabled={!field.default && options.length === 0}
          className="text-sm font-semibold text-white/46 transition-colors hover:text-white disabled:opacity-40"
        >
          {t("reset")}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {options.map((token) => {
          const { icon: Icon, label } = sizeMeta(token);
          return (
            <button
              key={token}
              type="button"
              aria-pressed={value === token}
              onClick={() => onSelect(token)}
              className={cn(
                "flex h-9 items-center justify-center gap-2 rounded-[12px] border text-[13px] font-semibold transition duration-200",
                value === token
                  ? "border-white/25 bg-white/[0.12] text-white ring-1 ring-white/15"
                  : "border-white/[0.07] bg-white/[0.03] text-white/62 hover:bg-white/[0.06] hover:text-white"
              )}
            >
              <Icon className="size-4" stroke={1.9} />
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ── more-options rows (one per remaining schema field) ──────────────────── */

function OptionRow({
  field,
  value,
  onChange,
}: {
  field: SchemaFieldDescriptor;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
}) {
  const t = useTranslations("fizzStudio.modelSettings");
  const labelId = useId();
  const label = t(`fields.${field.name}`, { defaultValue: field.title ?? field.name });

  return (
    <div className="flex min-h-[68px] flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <span id={labelId} className="text-sm font-medium text-white/80">
        {label}
      </span>
      <FieldControl field={field} value={value} labelId={labelId} onChange={onChange} />
    </div>
  );
}

/**
 * Human label for a raw enum token: `auto` → localized "Auto"; bare numeric
 * tokens of duration-like fields get the seconds unit ("5" → "5s").
 */
function enumOptionLabel(
  field: SchemaFieldDescriptor,
  option: string,
  t: ReturnType<typeof useTranslations>
): string {
  if (field.name === "quality") return t(`qualityOptions.${option}`, { defaultValue: option });
  if (option === "auto") return t("auto");
  if (/^\d+(\.\d+)?$/.test(option) && (field.name === "duration" || field.unit === "s")) {
    return `${option}s`;
  }
  return option;
}

function FieldControl({
  field,
  value,
  labelId,
  onChange,
}: {
  field: SchemaFieldDescriptor;
  value: string | number | boolean | undefined;
  labelId: string;
  onChange: (value: string | number | boolean) => void;
}) {
  const t = useTranslations("fizzStudio.modelSettings");

  // Multi-line text (e.g. negativePrompt).
  if (field.control === "textarea") {
    return (
      <textarea
        value={typeof value === "string" ? value : ""}
        rows={3}
        aria-labelledby={labelId}
        placeholder={t(`fields.${field.name}Placeholder`, { defaultValue: "" })}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-20 w-full resize-none rounded-[12px] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm leading-5 text-white outline-none transition-colors placeholder:text-white/32 focus:border-white/20 sm:max-w-[360px]"
      />
    );
  }

  // Enum-backed dropdown. Used when the schema asks for a
  // 'select' control or when there are too many options for a button group
  // (e.g. Seedance duration: 'auto' + 4..15 = 13 options).
  if (
    field.enum &&
    field.enum.length > 0 &&
    (field.control === "select" || field.enum.length > 6)
  ) {
    return (
      <div className="flex w-full justify-end sm:max-w-[360px]">
        <NativeSelect
          value={typeof value === "string" ? value : String(value ?? field.enum[0])}
          aria-labelledby={labelId}
          onChange={onChange}
          className="h-9 w-full rounded-[12px] border-white/[0.08] bg-white/[0.04] px-3 text-sm font-semibold text-white transition-colors focus:border-white/20 sm:w-44"
        >
          {field.enum.map((option) => (
            <option key={option} value={option}>
              {enumOptionLabel(field, option, t)}
            </option>
          ))}
        </NativeSelect>
      </div>
    );
  }

  // Enum-backed (segmented / radio) → button group.
  if (field.enum && field.enum.length > 0) {
    return (
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap items-center justify-end gap-2"
      >
        {field.enum.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "h-9 rounded-[12px] border px-3 text-sm font-semibold uppercase transition duration-200",
              value === option
                ? "border-white/25 bg-white/[0.12] text-white ring-1 ring-white/15"
                : "border-white/[0.07] bg-white/[0.03] text-white/68 hover:bg-white/[0.06] hover:text-white"
            )}
          >
            {enumOptionLabel(field, option, t)}
          </button>
        ))}
      </div>
    );
  }

  // Boolean → toggle.
  if (field.type === "boolean" || field.control === "switch") {
    const on = value === true;
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-labelledby={labelId}
        onClick={() => onChange(!on)}
        className={cn(
          "flex h-9 items-center gap-2 rounded-[12px] border px-3 text-sm font-semibold transition duration-200",
          on
            ? "border-white/25 bg-white/[0.12] text-white ring-1 ring-white/15"
            : "border-white/[0.07] bg-white/[0.03] text-white/68 hover:bg-white/[0.06] hover:text-white"
        )}
      >
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded-full border",
            on ? "border-white bg-white" : "border-white/24"
          )}
        >
          {on ? <span className="size-1.5 rounded-full bg-[#111]" /> : null}
        </span>
        {on ? t("on") : t("off")}
      </button>
    );
  }

  const numeric = typeof value === "number" ? value : Number(value) || field.min || 0;

  // Small bounded integer (e.g. numOutputs) → discrete buttons.
  if (
    field.control === "stepper" &&
    field.name !== "seed" &&
    typeof field.min === "number" &&
    typeof field.max === "number" &&
    field.max - field.min <= 7
  ) {
    const values = Array.from(
      { length: field.max - field.min + 1 },
      (_, index) => field.min! + index
    );
    return (
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap items-center justify-end gap-2"
      >
        {values.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={numeric === option}
            onClick={() => onChange(option)}
            className={cn(
              "h-9 min-w-12 rounded-[12px] border text-sm font-semibold transition duration-200",
              numeric === option
                ? "border-white/25 bg-white/[0.12] text-white ring-1 ring-white/15"
                : "border-white/[0.07] bg-white/[0.03] text-white/68 hover:bg-white/[0.06] hover:text-white"
            )}
          >
            {option}
          </button>
        ))}
      </div>
    );
  }

  // Range/slider numeric (duration, guidance, steps).
  if (
    (field.control === "slider" || field.type === "integer" || field.type === "number") &&
    typeof field.min === "number" &&
    typeof field.max === "number" &&
    field.name !== "seed"
  ) {
    const step = field.type === "integer" ? 1 : 0.5;
    const current = Math.min(field.max, Math.max(field.min, numeric || field.min));
    return (
      <div className="flex w-full items-center justify-end gap-3 sm:max-w-[360px]">
        <input
          type="range"
          min={field.min}
          max={field.max}
          step={step}
          value={current}
          aria-labelledby={labelId}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-8 min-w-0 flex-1 accent-white"
        />
        <span className="flex h-8 min-w-14 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-2 text-xs font-semibold tabular-nums text-white/78">
          {current}
          {field.unit ?? ""}
        </span>
      </div>
    );
  }

  // Free numeric (seed) → input.
  return (
    <input
      inputMode="numeric"
      value={value === undefined || value === "" ? "" : String(value)}
      aria-labelledby={labelId}
      placeholder={t("seedPlaceholder", { defaultValue: "" })}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
      className="h-9 w-full rounded-[12px] border border-white/[0.08] bg-white/[0.04] px-3 text-right text-sm font-medium tabular-nums text-white outline-none transition-colors placeholder:text-white/32 focus:border-white/20 sm:w-44"
    />
  );
}
