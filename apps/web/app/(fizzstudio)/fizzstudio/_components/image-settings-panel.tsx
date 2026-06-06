"use client";

import { useEffect, useId } from "react";
import type { ComponentType } from "react";
import {
  IconBrandGoogle,
  IconBrandOpenai,
  IconBrain,
  IconLock,
  IconRectangle,
  IconRectangleVertical,
  IconSailboat,
  IconSearch,
  IconSparkles,
  IconSquare,
  IconTriangle,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";

type SettingsIcon = ComponentType<{ className?: string; stroke?: number }>;

export type ImageModelKey =
  | "gptImage2"
  | "nanoBanana2"
  | "imagineArt20"
  | "imagineArt15"
  | "ideogramV4"
  | "kreaFlux1"
  | "midjourneyV7"
  | "seedreamV5"
  | "recraftV4"
  | "fluxKontext"
  | "gptImage1"
  | "auroraX1";

export type ImageAspectRatio =
  | "9:16"
  | "2:3"
  | "3:4"
  | "4:5"
  | "1:1"
  | "5:4"
  | "4:3"
  | "3:2"
  | "16:9"
  | "21:9";
export type ImageResolution = "1K" | "2K" | "4K";
export type ImageVisibility = "public" | "private";

export interface ImageGenerationSettings {
  aspectRatio: ImageAspectRatio;
  model: ImageModelKey;
  promptEnhancer: boolean;
  resolution: ImageResolution;
  variations: number;
  visibility: ImageVisibility;
}

interface ImageSettingsPanelProps {
  open: boolean;
  settings: ImageGenerationSettings;
  onOpenChange: (open: boolean) => void;
  onSettingsChange: (settings: ImageGenerationSettings) => void;
}

const IMAGE_MODELS: Array<{
  key: ImageModelKey;
  icon: SettingsIcon;
  locked?: boolean;
}> = [
  { key: "gptImage2", icon: IconBrandOpenai, locked: true },
  { key: "nanoBanana2", icon: IconBrandGoogle, locked: true },
  { key: "imagineArt20", icon: IconSparkles },
  { key: "imagineArt15", icon: IconSparkles },
  { key: "ideogramV4", icon: IconBrain },
  { key: "kreaFlux1", icon: IconTriangle },
  { key: "midjourneyV7", icon: IconSailboat, locked: true },
  { key: "seedreamV5", icon: IconWand },
  { key: "recraftV4", icon: IconBrain, locked: true },
  { key: "fluxKontext", icon: IconSparkles },
  { key: "gptImage1", icon: IconBrandOpenai },
  { key: "auroraX1", icon: IconTriangle, locked: true },
];

const ASPECT_RATIO_OPTIONS: Array<{ icon: SettingsIcon; value: ImageAspectRatio }> = [
  { value: "9:16", icon: IconRectangleVertical },
  { value: "2:3", icon: IconRectangleVertical },
  { value: "3:4", icon: IconRectangleVertical },
  { value: "4:5", icon: IconRectangleVertical },
  { value: "1:1", icon: IconSquare },
  { value: "5:4", icon: IconRectangle },
  { value: "4:3", icon: IconRectangle },
  { value: "3:2", icon: IconRectangle },
  { value: "16:9", icon: IconRectangle },
  { value: "21:9", icon: IconRectangle },
];

const VARIATION_OPTIONS = [1, 2, 3, 4] as const;
const RESOLUTION_OPTIONS: ImageResolution[] = ["1K", "2K", "4K"];
const VISIBILITY_OPTIONS: ImageVisibility[] = ["public", "private"];

export const DEFAULT_IMAGE_GENERATION_SETTINGS: ImageGenerationSettings = {
  aspectRatio: "4:3",
  model: "nanoBanana2",
  promptEnhancer: false,
  resolution: "1K",
  variations: 4,
  visibility: "public",
};

export function ImageSettingsPanel({
  open,
  settings,
  onOpenChange,
  onSettingsChange,
}: ImageSettingsPanelProps) {
  const t = useTranslations("fizzStudio.imageStudio");
  const titleId = useId();
  const descriptionId = useId();

  const updateSettings = (patch: Partial<ImageGenerationSettings>) => {
    onSettingsChange({ ...settings, ...patch });
  };

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  if (!open) return null;

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="mb-4 max-h-[calc(100svh-15rem)] overflow-hidden rounded-[28px] border border-white/[0.09] bg-[#0c0c0d]/98 text-white shadow-[0_28px_90px_rgba(0,0,0,.66)] ring-1 ring-white/[0.035] backdrop-blur-2xl duration-150 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3"
    >
      <div className="flex h-20 items-center justify-between px-7">
        <div>
          <h2
            id={titleId}
            className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-white"
          >
            {t("settings.title")}
          </h2>
          <p id={descriptionId} className="sr-only">
            {t("settings.description")}
          </p>
        </div>
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/8 hover:text-white"
          aria-label={t("settings.close")}
          onClick={() => onOpenChange(false)}
        >
          <IconX className="size-5" stroke={1.8} />
        </button>
      </div>

      <div className="max-h-[calc(100svh-20rem)] overflow-y-auto px-5 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.06fr)]">
          <ModelPanel
            selectedModel={settings.model}
            onSelect={(model) => updateSettings({ model })}
          />
          <div className="grid min-w-0 gap-4">
            <AspectRatioPanel
              selectedRatio={settings.aspectRatio}
              onReset={() =>
                updateSettings({ aspectRatio: DEFAULT_IMAGE_GENERATION_SETTINGS.aspectRatio })
              }
              onSelect={(aspectRatio) => updateSettings({ aspectRatio })}
            />
            <MoreOptionsPanel settings={settings} onChange={updateSettings} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function getImageModelLabel(t: ReturnType<typeof useTranslations>, model: ImageModelKey) {
  return t(`models.${model}`);
}

function ModelPanel({
  selectedModel,
  onSelect,
}: {
  selectedModel: ImageModelKey;
  onSelect: (model: ImageModelKey) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");

  return (
    <section className="min-w-0 rounded-[24px] bg-[#121213] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.03)]">
      <h3 className="text-center text-base font-semibold tracking-[0.01em] text-white/74">
        {t("settings.selectModel")}
      </h3>
      <div className="mt-5 grid grid-cols-[1fr_1fr] gap-2 sm:grid-cols-[1fr_1fr_1.35fr]">
        <ControlButton>{t("settings.providers")}</ControlButton>
        <ControlButton>{t("settings.resolutions")}</ControlButton>
        <label className="col-span-2 flex h-10 min-w-0 items-center gap-2 rounded-[14px] border border-white/[0.12] bg-[#101011] px-3 text-white/52 sm:col-span-1">
          <IconSearch className="size-4 shrink-0" stroke={1.8} />
          <span className="sr-only">{t("settings.searchModels")}</span>
          <input
            type="search"
            placeholder={t("settings.searchModels")}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/42"
          />
        </label>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {IMAGE_MODELS.map((model) => (
          <ModelCard
            key={model.key}
            active={selectedModel === model.key}
            model={model}
            onSelect={() => onSelect(model.key)}
          />
        ))}
      </div>
    </section>
  );
}

function ModelCard({
  active,
  model,
  onSelect,
}: {
  active: boolean;
  model: (typeof IMAGE_MODELS)[number];
  onSelect: () => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");
  const Icon = model.icon;

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "group relative flex min-h-[116px] flex-col items-stretch gap-2 rounded-[14px] text-left transition duration-200",
        active ? "text-white" : "text-white/58 hover:text-white"
      )}
    >
      <span
        className={cn(
          "relative flex h-[86px] items-center justify-center rounded-[12px] border bg-[#1b1b1c] transition duration-200",
          active
            ? "border-white/80 shadow-[0_0_0_1px_rgba(255,255,255,.64)]"
            : "border-white/[0.07] group-hover:border-white/18 group-hover:bg-[#202022]"
        )}
      >
        <Icon className="size-7" stroke={1.9} />
        {model.locked ? (
          <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-black/78 text-white">
            <IconLock className="size-3" stroke={2.2} />
          </span>
        ) : null}
      </span>
      <span className="truncate px-0.5 text-sm font-semibold">{t(`models.${model.key}`)}</span>
    </button>
  );
}

function ControlButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="flex h-10 min-w-0 items-center justify-center rounded-[14px] border border-white/[0.12] bg-[#101011] px-3 text-sm font-medium text-white/76 transition-colors hover:border-white/22 hover:bg-white/[0.06] hover:text-white"
    >
      <span className="truncate">{children}</span>
    </button>
  );
}

function AspectRatioPanel({
  selectedRatio,
  onReset,
  onSelect,
}: {
  selectedRatio: ImageAspectRatio;
  onReset: () => void;
  onSelect: (ratio: ImageAspectRatio) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");

  return (
    <section className="min-w-0 rounded-[24px] bg-[#101011] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.025)]">
      <div className="flex items-center justify-between gap-4">
        <h3 className="flex-1 text-center text-base font-semibold tracking-[0.01em] text-white/74">
          {t("settings.selectAspectRatio")}
        </h3>
        <button
          type="button"
          onClick={onReset}
          className="text-sm font-semibold text-white/46 transition-colors hover:text-white"
        >
          {t("settings.reset")}
        </button>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {ASPECT_RATIO_OPTIONS.map(({ value, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={selectedRatio === value}
            onClick={() => onSelect(value)}
            className={cn(
              "flex h-10 items-center justify-center gap-2 rounded-[14px] border text-sm font-semibold transition duration-200",
              selectedRatio === value
                ? "border-white/12 bg-white/14 text-white"
                : "border-white/[0.08] bg-transparent text-white/62 hover:border-white/18 hover:bg-white/[0.05] hover:text-white"
            )}
          >
            <Icon className="size-4" stroke={1.9} />
            {value}
          </button>
        ))}
      </div>
    </section>
  );
}

function MoreOptionsPanel({
  settings,
  onChange,
}: {
  settings: ImageGenerationSettings;
  onChange: (settings: Partial<ImageGenerationSettings>) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");

  return (
    <section className="min-w-0 rounded-[24px] bg-[#101011] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.025)]">
      <h3 className="text-center text-base font-semibold tracking-[0.01em] text-white/74">
        {t("settings.moreOptions")}
      </h3>
      <div className="mt-5 divide-y divide-white/[0.07]">
        <SettingRow label={t("settings.promptEnhancer")}>
          <ToggleSwitch
            checked={settings.promptEnhancer}
            label={t("settings.promptEnhancer")}
            onChange={(promptEnhancer) => onChange({ promptEnhancer })}
          />
        </SettingRow>
        <SettingRow label={t("settings.variations")}>
          <div className="grid grid-cols-4 gap-2">
            {VARIATION_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={settings.variations === value}
                onClick={() => onChange({ variations: value })}
                className={cn(
                  "h-9 min-w-14 rounded-[12px] border text-sm font-semibold transition duration-200",
                  settings.variations === value
                    ? "border-white/86 bg-white/[0.06] text-white"
                    : "border-white/[0.08] bg-transparent text-white/68 hover:border-white/22 hover:text-white"
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label={t("settings.resolution")}>
          <div className="flex flex-wrap items-center justify-end gap-4">
            {RESOLUTION_OPTIONS.map((resolution) => (
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
                    settings.resolution === resolution ? "border-white bg-white" : "border-white/20"
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
      </div>
      <div className="mt-5 flex items-center justify-between gap-4 rounded-[18px] bg-[#0d0d0e] p-4">
        <span className="text-sm font-semibold text-white/76">{t("settings.visibility")}</span>
        <div className="flex rounded-[16px] bg-white/[0.07] p-1">
          {VISIBILITY_OPTIONS.map((visibility) => (
            <button
              key={visibility}
              type="button"
              aria-pressed={settings.visibility === visibility}
              onClick={() => onChange({ visibility })}
              className={cn(
                "h-9 rounded-[13px] px-4 text-sm font-semibold transition duration-200",
                settings.visibility === visibility
                  ? "bg-white/[0.12] text-white"
                  : "text-white/48 hover:text-white"
              )}
            >
              {t(`settings.visibilityOptions.${visibility}`)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingRow({ label, children }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex min-h-[72px] flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-semibold text-white/48">{label}</span>
      {children}
    </div>
  );
}

function ToggleSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-8 w-14 items-center rounded-full p-1 transition duration-200",
        checked ? "bg-white/30" : "bg-white/[0.08]"
      )}
    >
      <span
        className={cn(
          "size-6 rounded-full bg-white shadow-[0_6px_18px_rgba(0,0,0,.35)] transition-transform duration-200",
          checked && "translate-x-6"
        )}
      />
    </button>
  );
}
