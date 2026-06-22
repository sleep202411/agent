"use client";

/**
 * The home's REAL Creative composer. Keeps the home's signature look — the
 * left modality rail + the frosted glass panel (DESIGN.md §3) — but wires it to
 * the shared generation engine (`useImageGeneration` / `useVideoGeneration`) and
 * the real model picker / settings. Create submits the job (server-backed feed,
 * scoped by sourceSurface) then navigates to /images or /video to watch it.
 *
 * Only image + video are backed today; the rail offers those two. Reference
 * uploads are a follow-up — text → image/video works now.
 */

import { useState, type ReactNode } from "react";
import { IconAdjustmentsHorizontal, IconChevronDown } from "@tabler/icons-react";
import { useRouter } from "@/i18n/navigation";
import { useDismiss } from "@/lib/use-dismiss";
import { useAuth } from "@/app/_components/auth-provider";
import { CONIC_BORDER, EASE, RAIL_STEP, type Theme } from "../_pollo/theme";
import { G, Glyph, GradientRing } from "../_pollo/glyphs";
import { useImageGeneration } from "../(studio)/_components/generation/use-image-generation";
import { useVideoGeneration } from "../(studio)/_components/generation/use-video-generation";
import {
  type FizzAiCatalog,
  type FizzAiModel,
  type ModelSettings as ModelSettingsBag,
} from "../canvas/_lib/generation-api";
import { useModeLabel } from "../canvas/_lib/use-labels";
import { ModelPicker } from "../canvas/_components/model-picker";
import { ModeMenu } from "../canvas/_components/mode-menu";
import { ComposerQuickSettings } from "../canvas/_components/composer-quick-settings";
import {
  hasRenderableModelSettings,
  ModelSettings as ModelSettingsPanel,
} from "../canvas/_components/model-settings";

type Modality = "image" | "video";

const RAIL: { id: Modality; label: string; svg: string }[] = [
  { id: "video", label: "Video", svg: G.video },
  { id: "image", label: "Image", svg: G.image },
];

export function CreativeComposer({ theme: t }: { theme: Theme }) {
  const [modality, setModality] = useState<Modality>("video");
  const activeIndex = Math.max(
    0,
    RAIL.findIndex((m) => m.id === modality)
  );

  return (
    <div className="mx-auto mt-6 flex w-full max-w-[1200px] items-stretch gap-1 px-[64px]">
      {/* modality rail — absolute, right-anchored, expands LEFT on hover */}
      <div className="relative w-[58px] shrink-0">
        <div
          className="group/rail absolute top-1/2 right-0 z-20 flex w-[58px] -translate-y-1/2 flex-col gap-[2px] rounded-[18px] p-1 backdrop-blur-[30px] backdrop-saturate-150 transition-[width] duration-300 ease-out hover:w-[120px]"
          style={{ background: t.railBg }}
        >
          <GradientRing padding="1.5px" gradient={CONIC_BORDER} />
          <span
            aria-hidden
            className="pointer-events-none absolute top-1 right-1 left-1 h-[38px] rounded-[14px]"
            style={{
              backgroundImage: t.railFill,
              boxShadow: t.railGlow,
              transform: `translateY(${activeIndex * RAIL_STEP}px)`,
              transition: `transform 0.3s ${EASE}`,
            }}
          >
            <GradientRing padding="0.5px" gradient={t.railRing} />
          </span>

          {RAIL.map((m) => {
            const active = modality === m.id;
            return (
              <button
                key={m.id}
                type="button"
                title={m.label}
                onClick={() => setModality(m.id)}
                className="group/mode relative z-10 flex h-[38px] items-center justify-center self-stretch rounded-[14px] px-4 font-medium"
                style={{ transition: `all 0.3s ${EASE}` }}
              >
                <span className="order-first grid grid-cols-[0fr] transition-[grid-template-columns] duration-300 ease-out group-hover/rail:grid-cols-[1fr]">
                  <span
                    className={[
                      "min-w-0 -translate-x-1 overflow-hidden whitespace-nowrap text-[14px] opacity-0 transition-all duration-300 ease-out group-hover/rail:translate-x-0 group-hover/rail:pr-2 group-hover/rail:opacity-100",
                      active ? "bg-clip-text text-transparent" : "text-white/70",
                    ].join(" ")}
                    style={active ? { backgroundImage: t.accentText } : undefined}
                  >
                    {m.label}
                  </span>
                </span>
                <Glyph
                  svg={m.svg}
                  size={18}
                  gradient={active ? t.accentText : undefined}
                  fill={active ? undefined : t.idleIcon}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* panel — per-modality so only the active modality's generation runs */}
      {modality === "image" ? <ImagePanel theme={t} /> : <VideoPanel theme={t} />}
    </div>
  );
}

function ImagePanel({ theme: t }: { theme: Theme }) {
  const router = useRouter();
  const { requireAuth } = useAuth();
  const gen = useImageGeneration();
  // Public to browse, gated to run — prompt sign-in then resume on success.
  const onGenerate = () =>
    requireAuth(async () => {
      const result = await gen.submit();
      if (result.ok) router.push("/images");
    });
  return (
    <CreativePanel
      theme={t}
      modality="image"
      placeholder="Enter your idea to generate"
      catalog={gen.catalog}
      model={gen.model}
      onSelectModel={gen.onSelectModel}
      settings={gen.settings}
      onSettingsChange={gen.setSettings}
      mode={gen.mode}
      modes={gen.modes}
      onSelectMode={gen.setMode}
      prompt={gen.prompt}
      onPromptChange={gen.setPrompt}
      cost={gen.cost}
      canGenerate={gen.canSubmit}
      generating={gen.submitting}
      error={gen.submitError}
      onGenerate={onGenerate}
    />
  );
}

function VideoPanel({ theme: t }: { theme: Theme }) {
  const router = useRouter();
  const { requireAuth } = useAuth();
  const gen = useVideoGeneration();
  const onGenerate = () =>
    requireAuth(async () => {
      const result = await gen.submit();
      if (result.ok) router.push("/video");
    });
  return (
    <CreativePanel
      theme={t}
      modality="video"
      placeholder="Enter your idea to generate"
      catalog={gen.catalog}
      model={gen.model}
      onSelectModel={gen.onSelectModel}
      settings={gen.settings}
      onSettingsChange={gen.setSettings}
      mode={gen.mode}
      modes={gen.modes}
      onSelectMode={gen.setMode}
      prompt={gen.prompt}
      onPromptChange={gen.setPrompt}
      cost={gen.cost}
      canGenerate={gen.canSubmit}
      generating={gen.submitting}
      error={gen.error}
      onGenerate={onGenerate}
    />
  );
}

/** The home frosted panel + real controls, wired via props. */
function CreativePanel({
  theme: t,
  modality,
  placeholder,
  catalog,
  model,
  onSelectModel,
  settings,
  onSettingsChange,
  mode,
  modes = [],
  onSelectMode,
  prompt,
  onPromptChange,
  cost,
  canGenerate,
  generating,
  error,
  onGenerate,
}: {
  theme: Theme;
  modality: Modality;
  placeholder: string;
  catalog: FizzAiCatalog | undefined;
  model: FizzAiModel | undefined;
  onSelectModel: (model: FizzAiModel) => void;
  settings: ModelSettingsBag;
  onSettingsChange: (next: ModelSettingsBag) => void;
  mode?: string;
  modes?: string[];
  onSelectMode?: (mode: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  cost: number | null;
  canGenerate: boolean;
  generating: boolean;
  error?: string | null;
  onGenerate: () => void;
}) {
  const ml = useModeLabel();
  const [panel, setPanel] = useState<"model" | "settings" | "mode" | null>(null);
  useDismiss(panel !== null, () => setPanel(null));
  const showSettingsButton = hasRenderableModelSettings(model, true);

  const pill = (children: ReactNode, onClick: () => void, key?: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white/[0.08] px-3 text-sm font-medium text-white/85 transition hover:bg-white/[0.12]"
    >
      {children}
    </button>
  );

  return (
    <div className="relative min-w-0 flex-1 rounded-[24px]">
      <GradientRing padding="1.5px" gradient={CONIC_BORDER} />
      <div
        className="rounded-[24px] p-4 backdrop-blur-[60px] backdrop-saturate-150 transition-all duration-300"
        style={{ background: t.panelBg }}
      >
        <div className="flex min-h-[152px] flex-col justify-between gap-3">
          <textarea
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canGenerate) {
                e.preventDefault();
                onGenerate();
              }
            }}
            placeholder={placeholder}
            rows={3}
            className="min-h-[88px] w-full resize-none bg-transparent pt-1.5 text-[14px] font-light leading-[20px] text-white/85 outline-none placeholder:text-white/35"
          />

          {error ? <p className="text-[12px] text-destructive">{error}</p> : null}

          <div className="flex items-center justify-between gap-4 pt-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-visible">
              {/* mode — always shown when the model exposes one; interactive when >1 */}
              {modes.length >= 1 && mode ? (
                <div className="relative" data-popover-zone>
                  <button
                    type="button"
                    onClick={
                      modes.length > 1
                        ? () => setPanel((p) => (p === "mode" ? null : "mode"))
                        : undefined
                    }
                    className={[
                      "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white/[0.08] px-3 text-sm font-medium text-white/85 transition",
                      modes.length > 1 ? "hover:bg-white/[0.12]" : "cursor-default",
                    ].join(" ")}
                  >
                    {ml(mode)}
                    {modes.length > 1 ? (
                      <IconChevronDown className="size-3.5 text-white/45" stroke={2} />
                    ) : null}
                  </button>
                  {panel === "mode" && modes.length > 1 ? (
                    <ModeMenu
                      modes={modes}
                      value={mode}
                      onSelect={(m) => onSelectMode?.(m)}
                      onClose={() => setPanel(null)}
                    />
                  ) : null}
                </div>
              ) : null}

              {/* model */}
              <div className="relative" data-popover-zone>
                {pill(
                  <>
                    {model?.name ?? "Choose model"}
                    <IconChevronDown className="size-3.5 text-white/45" stroke={2} />
                  </>,
                  () => setPanel((p) => (p === "model" ? null : "model"))
                )}
                {panel === "model" ? (
                  <ModelPicker
                    catalog={catalog}
                    modality={modality}
                    selectedId={model?.id}
                    onSelect={onSelectModel}
                    onClose={() => setPanel(null)}
                  />
                ) : null}
              </div>

              <ComposerQuickSettings
                model={model}
                settings={settings}
                onChange={onSettingsChange}
              />

              {showSettingsButton ? (
                <div className="relative" data-popover-zone>
                  <button
                    type="button"
                    aria-label="More settings"
                    onClick={() => setPanel((p) => (p === "settings" ? null : "settings"))}
                    className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-white/70 transition hover:bg-white/[0.12]"
                  >
                    <IconAdjustmentsHorizontal className="size-[18px]" stroke={1.8} />
                  </button>
                  {panel === "settings" ? (
                    <ModelSettingsPanel
                      model={model}
                      settings={settings}
                      onChange={onSettingsChange}
                      hideQuickFields
                    />
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="relative shrink-0">
              <button
                type="button"
                disabled={!canGenerate}
                onClick={onGenerate}
                className={[
                  "inline-flex h-9 items-center gap-1 rounded-full px-4 text-[12px] transition",
                  canGenerate
                    ? "hover:brightness-110"
                    : "cursor-not-allowed bg-white/[0.06] text-white/25",
                ].join(" ")}
                style={
                  canGenerate
                    ? { background: t.genBg, color: t.genText, boxShadow: t.genShadow }
                    : undefined
                }
              >
                <Glyph
                  svg={G.star}
                  size={14}
                  fill={canGenerate ? t.genText : "rgba(255,255,255,0.25)"}
                />
                {generating ? "Generating…" : "Generate"}
                {cost != null ? (
                  <span className="ml-1 inline-flex items-center gap-0.5">
                    <Glyph
                      svg={G.credits}
                      size={14}
                      fill={canGenerate ? t.genText : "rgba(255,255,255,0.25)"}
                    />
                    {cost}
                  </span>
                ) : null}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
