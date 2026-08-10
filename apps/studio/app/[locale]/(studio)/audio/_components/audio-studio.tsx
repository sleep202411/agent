"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  IconArrowUp,
  IconBolt,
  IconChevronDown,
  IconCopy,
  IconDownload,
  IconMicrophone,
  IconMusic,
  IconPlayerPlay,
  IconRefresh,
  IconSparkles,
  IconVolume,
  IconWaveSine,
  type IconProps,
} from "@tabler/icons-react";
import type { ComponentType, FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/utils";

type AudioMode = "voice" | "music" | "sfx";

type ModeConfig = {
  key: AudioMode;
  labelKey: string;
  descriptionKey: string;
  placeholderKey: string;
  icon: ComponentType<IconProps>;
  credits: number;
};

type OptionConfig = {
  key: string;
  labelKey: string;
};

const MODES: ModeConfig[] = [
  {
    key: "voice",
    labelKey: "modes.voice",
    descriptionKey: "modeDescriptions.voice",
    placeholderKey: "composer.placeholders.voice",
    icon: IconMicrophone,
    credits: 4,
  },
  {
    key: "music",
    labelKey: "modes.music",
    descriptionKey: "modeDescriptions.music",
    placeholderKey: "composer.placeholders.music",
    icon: IconMusic,
    credits: 12,
  },
  {
    key: "sfx",
    labelKey: "modes.sfx",
    descriptionKey: "modeDescriptions.sfx",
    placeholderKey: "composer.placeholders.sfx",
    icon: IconWaveSine,
    credits: 3,
  },
];

const VOICES: OptionConfig[] = [
  { key: "narrator", labelKey: "voices.narrator" },
  { key: "warm", labelKey: "voices.warm" },
  { key: "young", labelKey: "voices.young" },
];

const STYLES: OptionConfig[] = [
  { key: "natural", labelKey: "styles.natural" },
  { key: "cinematic", labelKey: "styles.cinematic" },
  { key: "bright", labelKey: "styles.bright" },
];

const DURATIONS: OptionConfig[] = [
  { key: "short", labelKey: "durations.short" },
  { key: "medium", labelKey: "durations.medium" },
  { key: "long", labelKey: "durations.long" },
];

const FORMATS: OptionConfig[] = [
  { key: "mp3", labelKey: "formats.mp3" },
  { key: "wav", labelKey: "formats.wav" },
];

const PREVIEW_CARDS = [
  {
    key: "voice",
    mode: "voice" as AudioMode,
    titleKey: "preview.voice.title",
    promptKey: "preview.voice.prompt",
    durationKey: "preview.voice.duration",
    icon: IconMicrophone,
    progress: 0.34,
    seed: 2,
  },
  {
    key: "music",
    mode: "music" as AudioMode,
    titleKey: "preview.music.title",
    promptKey: "preview.music.prompt",
    durationKey: "preview.music.duration",
    icon: IconMusic,
    progress: 0.56,
    seed: 5,
  },
  {
    key: "sfx",
    mode: "sfx" as AudioMode,
    titleKey: "preview.sfx.title",
    promptKey: "preview.sfx.prompt",
    durationKey: "preview.sfx.duration",
    icon: IconWaveSine,
    progress: 0.22,
    seed: 8,
  },
];

function nextOption<T extends OptionConfig>(items: T[], currentKey: string): string {
  const index = Math.max(
    0,
    items.findIndex((item) => item.key === currentKey)
  );
  return items[(index + 1) % items.length]?.key ?? items[0]?.key ?? currentKey;
}

function getOptionLabel(items: OptionConfig[], key: string, t: (key: string) => string): string {
  return t(items.find((item) => item.key === key)?.labelKey ?? items[0]?.labelKey ?? "");
}

function AudioWaveform({
  seed,
  progress = 0,
  compact = false,
}: {
  seed: number;
  progress?: number;
  compact?: boolean;
}) {
  const bars = useMemo(
    () =>
      Array.from({ length: compact ? 34 : 58 }, (_, index) => {
        const value = Math.sin((index + 1) * (seed + 1.7)) * 0.5 + 0.5;
        const height = 18 + Math.round(value * (compact ? 38 : 56));
        return height;
      }),
    [compact, seed]
  );
  const activeCount = Math.round(bars.length * progress);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-24 items-center gap-1 overflow-hidden rounded-2xl bg-black/20 px-4",
        compact && "h-16 rounded-xl px-3"
      )}
    >
      {bars.map((height, index) => (
        <span
          key={`${seed}-${index}`}
          className={cn(
            "w-1 shrink-0 rounded-full bg-white/18",
            index < activeCount && "bg-[#E52227]"
          )}
          style={{ height }}
        />
      ))}
    </div>
  );
}

function IconButton({ label, icon: Icon }: { label: string; icon: ComponentType<IconProps> }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-full bg-white/[0.06] text-white/60 transition-colors hover:bg-white/[0.1] hover:text-white"
    >
      <Icon className="size-4" stroke={1.8} />
    </button>
  );
}

function PreviewCard({ card, active }: { card: (typeof PREVIEW_CARDS)[number]; active: boolean }) {
  const t = useTranslations("audioStudio");
  const Icon = card.icon;

  return (
    <div className="group flex flex-col gap-2.5">
      {/* Media tile: waveform visual + mode glyph + status overlay. The
          rim-light ring + tone-lift (active → neutral lift) replace the old
          hard border; the label lives BELOW the tile per the TileCard idiom. */}
      <FrostedPanel
        className={cn("p-4 transition-colors", active && "bg-white/[0.07] ring-white/[0.12]")}
      >
        <div className="flex items-start justify-between gap-4">
          <div
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-white/70",
              active && "bg-white/[0.12] text-white"
            )}
          >
            <Icon className="size-5" stroke={1.8} />
          </div>
          <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-white/55">
            {t("preview.status")}
          </span>
        </div>

        <div className="mt-4">
          <AudioWaveform seed={card.seed} progress={card.progress} />
        </div>

        <p className="mt-4 line-clamp-2 min-h-10 text-sm leading-5 text-white/55">
          {t(card.promptKey)}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-white text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            <span className="flex size-10 items-center justify-center rounded-full">
              <IconPlayerPlay className="size-4 fill-current" stroke={1.8} />
            </span>
            <span className="pr-4">{t("actions.play")}</span>
          </button>
          <div className="flex items-center gap-2">
            <IconButton label={t("actions.download")} icon={IconDownload} />
            <IconButton label={t("actions.reuse")} icon={IconCopy} />
            <IconButton label={t("actions.regenerate")} icon={IconRefresh} />
          </div>
        </div>
      </FrostedPanel>

      <div>
        <div className="truncate text-sm font-medium text-white">{t(card.titleKey)}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t(`modes.${card.mode}`)} · {t(card.durationKey)}
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  mode,
  active,
  onClick,
}: {
  mode: ModeConfig;
  active: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("audioStudio");
  const Icon = mode.icon;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-3 py-2 text-left transition-colors sm:flex-none",
        active
          ? "bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
          : "text-white/50 hover:bg-white/[0.06] hover:text-white"
      )}
    >
      <Icon className="size-4 shrink-0" stroke={1.8} />
      <span className="truncate text-sm font-semibold">{t(mode.labelKey)}</span>
    </button>
  );
}

function ControlChip({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 max-w-full items-center gap-2 rounded-2xl bg-white/[0.06] px-3 text-sm text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
    >
      <span className="text-white/40">{label}</span>
      <span className="truncate font-semibold">{value}</span>
      <IconChevronDown className="size-4 shrink-0 text-white/45" stroke={1.8} />
    </button>
  );
}

export function AudioStudio() {
  const t = useTranslations("audioStudio");
  const [mode, setMode] = useState<AudioMode>("voice");
  const [prompt, setPrompt] = useState("");
  const [voice, setVoice] = useState(VOICES[0].key);
  const [style, setStyle] = useState(STYLES[0].key);
  const [duration, setDuration] = useState(DURATIONS[1].key);
  const [format, setFormat] = useState(FORMATS[0].key);
  const [instrumental, setInstrumental] = useState(true);

  const activeMode = MODES.find((item) => item.key === mode) ?? MODES[0];
  const previewCards = useMemo(
    () => [...PREVIEW_CARDS].sort((a) => (a.mode === mode ? -1 : 1)),
    [mode]
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    toast.info(t("composer.comingSoonToast"));
  }

  return (
    <>
      <section className="mt-8 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <FrostedPanel className="rounded-4xl bg-white/[0.025] p-4 sm:p-5">
          <SectionHeading
            title={t("preview.heading")}
            subtitle={t("preview.subheading")}
            action={
              <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/55">
                <IconVolume className="size-4" stroke={1.8} />
                {t("preview.outputLabel")}
              </span>
            }
          />

          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {previewCards.map((card) => (
              <PreviewCard key={card.key} card={card} active={card.mode === mode} />
            ))}
          </div>
        </FrostedPanel>

        <FrostedPanel className="rounded-4xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white/[0.06] text-white/70">
              <IconSparkles className="size-5" stroke={1.8} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{t("panel.title")}</p>
              <p className="mt-0.5 text-xs text-white/45">{t(activeMode.descriptionKey)}</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {MODES.map((item) => {
              const Icon = item.icon;
              const active = item.key === mode;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setMode(item.key)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors",
                    active ? "bg-white/[0.1]" : "bg-white/[0.035] hover:bg-white/[0.07]"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-white/55",
                      active && "bg-white/[0.12] text-white"
                    )}
                  >
                    <Icon className="size-5" stroke={1.8} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">
                      {t(item.labelKey)}
                    </span>
                    <span className="block truncate text-xs text-white/42">
                      {t(item.descriptionKey)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </FrostedPanel>
      </section>

      <form
        onSubmit={handleSubmit}
        className="pointer-events-none fixed inset-x-4 bottom-5 z-40 transition-[left] duration-200 lg:left-[calc(var(--studio-sidebar-width)+1rem)]"
      >
        <div className="pointer-events-auto mx-auto w-full max-w-[1120px] rounded-4xl bg-[oklch(0.18_0_0_/_0.94)] p-3 shadow-[0_28px_90px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.08] backdrop-blur-2xl">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t(activeMode.placeholderKey)}
            className="min-h-22 w-full resize-none rounded-3xl border border-transparent bg-white/[0.035] px-4 py-3 text-base leading-6 text-white outline-none transition-colors placeholder:text-white/32 focus:bg-white/[0.055] focus:ring-1 focus:ring-white/[0.08]"
          />

          <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="flex w-full min-w-0 rounded-3xl bg-black/20 p-1 sm:w-auto">
                {MODES.map((item) => (
                  <ModeButton
                    key={item.key}
                    mode={item}
                    active={item.key === mode}
                    onClick={() => setMode(item.key)}
                  />
                ))}
              </div>

              {mode === "voice" && (
                <ControlChip
                  label={t("composer.voice")}
                  value={getOptionLabel(VOICES, voice, t)}
                  onClick={() => setVoice(nextOption(VOICES, voice))}
                />
              )}

              {mode !== "sfx" && (
                <ControlChip
                  label={t("composer.style")}
                  value={getOptionLabel(STYLES, style, t)}
                  onClick={() => setStyle(nextOption(STYLES, style))}
                />
              )}

              {mode !== "voice" && (
                <ControlChip
                  label={t("composer.duration")}
                  value={getOptionLabel(DURATIONS, duration, t)}
                  onClick={() => setDuration(nextOption(DURATIONS, duration))}
                />
              )}

              {mode === "music" && (
                <button
                  type="button"
                  aria-pressed={instrumental}
                  onClick={() => setInstrumental((value) => !value)}
                  className={cn(
                    "h-11 rounded-2xl px-3 text-sm font-semibold transition-colors",
                    instrumental
                      ? "bg-white/[0.12] text-white"
                      : "bg-white/[0.06] text-white/55 hover:bg-white/[0.1] hover:text-white"
                  )}
                >
                  {t("composer.instrumental")}
                </button>
              )}

              <ControlChip
                label={t("composer.format")}
                value={getOptionLabel(FORMATS, format, t)}
                onClick={() => setFormat(nextOption(FORMATS, format))}
              />
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 xl:justify-end">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-white/55">
                <IconBolt className="size-4" stroke={1.8} />
                {activeMode.credits}
              </span>
              <Button
                type="submit"
                variant="primary-cta"
                aria-label={t("composer.createAria")}
                className="size-12 rounded-full shadow-[0_14px_35px_rgba(0,0,0,0.45)] [&_svg:not([class*='size-'])]:size-5"
              >
                <IconArrowUp className="size-5" stroke={2} />
              </Button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
