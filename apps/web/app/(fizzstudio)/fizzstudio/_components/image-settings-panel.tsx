"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  IconAlertTriangle,
  IconBolt,
  IconBrain,
  IconBrandGoogle,
  IconBrandOpenai,
  IconLock,
  IconPhoto,
  IconRectangle,
  IconRectangleVertical,
  IconSailboat,
  IconSearch,
  IconSparkles,
  IconSquare,
  IconTypography,
  IconVector,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import {
  enumDefault,
  enumOptions,
  estimateModelSellPoints,
  isFizzAiModelUsable,
  maxOutputs,
  supportsOutputCount,
  type FizzAiModel,
} from "../../_lib/generation-api";

type SettingsIcon = ComponentType<{ className?: string; stroke?: number }>;

/** Map a catalog model (by id / name) to a brand-or-family tabler icon. */
const MODEL_ICON_RULES: Array<[RegExp, SettingsIcon]> = [
  [/gpt/, IconBrandOpenai],
  [/nano.?banana|gemini/, IconBrandGoogle],
  [/midjourney/, IconSailboat],
  [/flux|krea/, IconBolt],
  [/qwen/, IconBrain],
  [/seedream/, IconWand],
  [/ideogram/, IconTypography],
  [/recraft/, IconVector],
  [/minimax/, IconSparkles],
];

function modelIcon(model: FizzAiModel): SettingsIcon {
  const key = `${model.id ?? ""} ${model.name ?? ""}`.toLowerCase();
  for (const [pattern, icon] of MODEL_ICON_RULES) {
    if (pattern.test(key)) return icon;
  }
  return IconPhoto;
}

/**
 * Panel value object. `model` is now the catalog model id (a free string), and
 * `aspectRatio` carries the selected model's `imageSize` enum token (e.g.
 * `landscape_16_9`). `resolution` is reserved for models that expose a discrete
 * resolution enum; it stays empty for models that don't (the row hides).
 */
export interface ImageGenerationSettings {
  aspectRatio: string;
  model: string;
  resolution: string;
  variations: number;
}

interface ImageSettingsPanelProps {
  open: boolean;
  models: FizzAiModel[];
  isLoading: boolean;
  error: boolean;
  settings: ImageGenerationSettings;
  onOpenChange: (open: boolean) => void;
  onRetry?: () => void;
  onSettingsChange: (settings: ImageGenerationSettings) => void;
}

export const DEFAULT_IMAGE_GENERATION_SETTINGS: ImageGenerationSettings = {
  aspectRatio: "",
  model: "",
  resolution: "",
  variations: 1,
};

// fal `imageSize` enum tokens → friendly label + orientation icon. Unknown tokens
// fall back to the raw token + a generic rectangle so new server enums still render.
const IMAGE_SIZE_META: Record<string, { icon: SettingsIcon; label: string; mp: number }> = {
  square_hd: { icon: IconSquare, label: "1:1 HD", mp: 1.05 }, // 1024×1024
  square: { icon: IconSquare, label: "1:1", mp: 0.26 }, // 512×512
  portrait_4_3: { icon: IconRectangleVertical, label: "3:4", mp: 0.79 }, // 768×1024
  portrait_16_9: { icon: IconRectangleVertical, label: "9:16", mp: 0.59 }, // 576×1024
  landscape_4_3: { icon: IconRectangle, label: "4:3", mp: 0.79 }, // 1024×768
  landscape_16_9: { icon: IconRectangle, label: "16:9", mp: 0.59 }, // 1024×576
};

function imageSizeMeta(token: string): {
  icon: SettingsIcon;
  label: string;
  mp: number;
} {
  return IMAGE_SIZE_META[token] ?? { icon: IconRectangle, label: token, mp: 1 };
}

/** Megapixels billed for an imageSize token (drives exact per-megapixel pricing). */
export function imageSizeMegapixels(token: string): number {
  return imageSizeMeta(token).mp;
}

/** The schema field image models use to express aspect ratio / size. */
const SIZE_FIELD = "imageSize";
/** Optional discrete resolution field (not emitted by current image models). */
const RESOLUTION_FIELD = "resolution";

export function modelById(models: FizzAiModel[], id: string): FizzAiModel | undefined {
  return models.find((model) => model.id === id);
}

/** Display label for the composer chip; falls back to the id when unresolved. */
export function getImageModelLabel(models: FizzAiModel[], id: string): string {
  return modelById(models, id)?.name ?? id;
}

export function clampVariations(model: FizzAiModel | undefined, value: number): number {
  if (!model || !supportsOutputCount(model)) return 1;
  const max = maxOutputs(model);
  return Math.min(Math.max(1, Math.round(value)), max);
}

/**
 * Seeds settings (aspectRatio / resolution / variations) from a model's schema
 * defaults. Used on first catalog load and whenever the selected model changes.
 */
export function settingsForModel(
  model: FizzAiModel | undefined,
  base: ImageGenerationSettings
): ImageGenerationSettings {
  if (!model) return { ...base, model: "" };
  const sizes = enumOptions(model, SIZE_FIELD);
  const resolutions = enumOptions(model, RESOLUTION_FIELD);
  const defaultSize = enumDefault(model, SIZE_FIELD) ?? sizes?.[0] ?? "";
  const defaultResolution = enumDefault(model, RESOLUTION_FIELD) ?? resolutions?.[0] ?? "";
  return {
    ...base,
    model: model.id,
    aspectRatio: defaultSize,
    resolution: defaultResolution,
    variations: clampVariations(model, base.variations || 1),
  };
}

export function ImageSettingsPanel({
  open,
  models,
  isLoading,
  error,
  settings,
  onOpenChange,
  onRetry,
  onSettingsChange,
}: ImageSettingsPanelProps) {
  const t = useTranslations("fizzStudio.imageStudio");
  const titleId = useId();
  const descriptionId = useId();
  const [query, setQuery] = useState("");

  const selectedModel = useMemo(() => modelById(models, settings.model), [models, settings.model]);

  const updateSettings = (patch: Partial<ImageGenerationSettings>) => {
    onSettingsChange({ ...settings, ...patch });
  };

  const selectModel = (id: string) => {
    const model = modelById(models, id);
    onSettingsChange(settingsForModel(model, settings));
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  if (!open) return null;

  const sizeOptions = selectedModel ? enumOptions(selectedModel, SIZE_FIELD) : null;
  const resolutionOptions = selectedModel ? enumOptions(selectedModel, RESOLUTION_FIELD) : null;
  const variationMax = selectedModel ? maxOutputs(selectedModel) : 1;
  const showVariations = selectedModel ? supportsOutputCount(selectedModel) : false;
  const sizeDefault = selectedModel ? enumDefault(selectedModel, SIZE_FIELD) : undefined;

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="mb-4 max-h-[calc(100svh-15rem)] overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#141416] text-white shadow-[0_24px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] duration-150 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3"
    >
      <div className="flex h-14 items-center justify-between px-5">
        <div>
          <h2
            id={titleId}
            className="text-sm font-semibold leading-tight tracking-[-0.01em] text-white/90"
          >
            {t("settings.title")}
          </h2>
          <p id={descriptionId} className="sr-only">
            {t("settings.description")}
          </p>
        </div>
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
          aria-label={t("settings.close")}
          onClick={() => onOpenChange(false)}
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
            query={query}
            selectedModelId={settings.model}
            onQueryChange={setQuery}
            onRetry={onRetry}
            onSelect={selectModel}
          />
          <div className="grid min-w-0 gap-4">
            <AspectRatioPanel
              options={sizeOptions}
              selected={settings.aspectRatio}
              defaultValue={sizeDefault}
              onReset={() => updateSettings({ aspectRatio: sizeDefault ?? sizeOptions?.[0] ?? "" })}
              onSelect={(aspectRatio) => updateSettings({ aspectRatio })}
            />
            <MoreOptionsPanel
              settings={settings}
              variationMax={variationMax}
              showVariations={showVariations}
              resolutionOptions={resolutionOptions}
              onChange={updateSettings}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelPanel({
  models,
  isLoading,
  error,
  query,
  selectedModelId,
  onQueryChange,
  onRetry,
  onSelect,
}: {
  models: FizzAiModel[];
  isLoading: boolean;
  error: boolean;
  query: string;
  selectedModelId: string;
  onQueryChange: (value: string) => void;
  onRetry?: () => void;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((model) => model.name.toLowerCase().includes(q));
  }, [models, query]);

  return (
    <section className="min-w-0">
      <h3 className="text-center text-sm font-semibold tracking-[0.01em] text-white/90">
        {t("settings.selectModel")}
      </h3>
      <div className="mt-4">
        <label className="flex h-9 min-w-0 items-center gap-2 rounded-[12px] border border-white/[0.07] bg-white/[0.03] px-3 text-white/52">
          <IconSearch className="size-4 shrink-0" stroke={1.8} />
          <span className="sr-only">{t("settings.searchModels")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("settings.searchModels")}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/42"
          />
        </label>
      </div>

      {isLoading ? (
        <ModelGridSkeleton />
      ) : error ? (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-[16px] border border-white/[0.07] bg-white/[0.02] p-5 text-center">
          <IconAlertTriangle className="size-6 text-white/60" stroke={1.8} />
          <p className="text-sm text-white/64">{t("settings.modelsError")}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="h-9 rounded-full border border-white/[0.12] bg-white/[0.06] px-4 text-sm font-semibold text-white transition-colors hover:bg-white/[0.1]"
            >
              {t("settings.retry")}
            </button>
          ) : null}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-[16px] border border-white/[0.07] bg-white/[0.02] p-5 text-center">
          <IconPhoto className="size-6 text-white/50" stroke={1.8} />
          <p className="text-sm text-white/60">
            {query.trim() ? t("settings.noModelMatch") : t("settings.noModels")}
          </p>
        </div>
      ) : (
        <div className="mt-4 flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-1">
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

function ModelGridSkeleton() {
  return (
    <div className="mt-4 flex flex-col gap-1">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-[14px] px-3 py-2.5">
          <span className="size-9 shrink-0 animate-pulse rounded-[11px] bg-white/[0.06]" />
          <span className="h-3.5 flex-1 animate-pulse rounded-full bg-white/[0.06]" />
          <span className="h-5 w-12 shrink-0 animate-pulse rounded-full bg-white/[0.05]" />
        </div>
      ))}
    </div>
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
  const t = useTranslations("fizzStudio.imageStudio");
  const lockReason = model.access?.reason || model.disabledReason;
  const Icon = modelIcon(model);
  const price = estimateModelSellPoints(model, 1, 1);

  return (
    <button
      type="button"
      aria-pressed={active}
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
        <Icon className="size-4" stroke={1.7} />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-[13px] font-medium">{model.name}</span>
        {locked ? (
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
            <IconLock className="size-2.5" stroke={2.4} />
          </span>
        ) : null}
      </span>
      {price ? (
        <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-medium tabular-nums text-white/68">
          {t("priceEstimate", { points: price.sellPoints })}
        </span>
      ) : null}
    </button>
  );
}

function AspectRatioPanel({
  options,
  selected,
  defaultValue,
  onReset,
  onSelect,
}: {
  options: string[] | null;
  selected: string;
  defaultValue: string | undefined;
  onReset: () => void;
  onSelect: (value: string) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");

  // Hide the panel entirely when the selected model exposes no size enum.
  if (!options || options.length === 0) return null;

  return (
    <section className="min-w-0">
      <div className="flex items-center justify-between gap-4">
        <h3 className="flex-1 text-center text-sm font-semibold tracking-[0.01em] text-white/90">
          {t("settings.selectAspectRatio")}
        </h3>
        <button
          type="button"
          onClick={onReset}
          disabled={!defaultValue}
          className="text-sm font-semibold text-white/46 transition-colors hover:text-white disabled:opacity-40"
        >
          {t("settings.reset")}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {options.map((value) => {
          const { icon: Icon, label } = imageSizeMeta(value);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected === value}
              onClick={() => onSelect(value)}
              className={cn(
                "flex h-9 items-center justify-center gap-2 rounded-[12px] border text-[13px] font-semibold transition duration-200",
                selected === value
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

function MoreOptionsPanel({
  settings,
  variationMax,
  showVariations,
  resolutionOptions,
  onChange,
}: {
  settings: ImageGenerationSettings;
  variationMax: number;
  showVariations: boolean;
  resolutionOptions: string[] | null;
  onChange: (settings: Partial<ImageGenerationSettings>) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");

  const variationValues = useMemo(
    () => Array.from({ length: Math.max(1, variationMax) }, (_, index) => index + 1),
    [variationMax]
  );

  const showResolution = Boolean(resolutionOptions && resolutionOptions.length > 0);

  return (
    <section className="min-w-0">
      <h3 className="text-center text-sm font-semibold tracking-[0.01em] text-white/90">
        {t("settings.moreOptions")}
      </h3>
      <div className="mt-4 divide-y divide-white/[0.07]">
        {showVariations ? (
          <SettingRow label={t("settings.variations")}>
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${variationValues.length}, minmax(0, 1fr))` }}
            >
              {variationValues.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={settings.variations === value}
                  onClick={() => onChange({ variations: value })}
                  className={cn(
                    "h-9 min-w-12 rounded-[12px] border text-sm font-semibold transition duration-200",
                    settings.variations === value
                      ? "border-white/25 bg-white/[0.12] text-white ring-1 ring-white/15"
                      : "border-white/[0.07] bg-white/[0.03] text-white/68 hover:bg-white/[0.06] hover:text-white"
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </SettingRow>
        ) : null}
        {showResolution ? (
          <SettingRow label={t("settings.resolution")}>
            <div className="flex flex-wrap items-center justify-end gap-4">
              {resolutionOptions!.map((resolution) => (
                <button
                  key={resolution}
                  type="button"
                  aria-pressed={settings.resolution === resolution}
                  onClick={() => onChange({ resolution })}
                  className="flex items-center gap-2 text-sm font-semibold text-white/68 transition-colors hover:text-white"
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full border",
                      settings.resolution === resolution
                        ? "border-white bg-white"
                        : "border-white/20"
                    )}
                  >
                    {settings.resolution === resolution ? (
                      <span className="size-2 rounded-full bg-[#111]" />
                    ) : null}
                  </span>
                  {resolution}
                </button>
              ))}
            </div>
          </SettingRow>
        ) : null}
      </div>
    </section>
  );
}

function SettingRow({ label, children }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex min-h-[72px] flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-medium text-white/80">{label}</span>
      {children}
    </div>
  );
}
