"use client";

import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconPhotoUp,
  IconSend,
  IconStack2,
  IconUpload,
  IconVideoPlus,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { useAiCatalog, usableModelsByModality } from "../../_hooks/use-ai-catalog";
import { VIDEO_MODES, type StudioModeKey, type StudioSlotKind } from "../../_lib/studio-modes";
import { FizzStudioShell, useFizzStudioWorkspace } from "./fizzstudio-shell";
import { ImageMasonry, IMAGE_FEED } from "./image-studio-page";
import { StudioModeRail } from "./studio-mode-rail";

type VideoTab = "history" | "community";
const VIDEO_TABS: VideoTab[] = ["history", "community"];

type ComposerPanel = "mode" | "settings";

/** Icon per non-prompt input slot. */
const SLOT_ICON: Record<
  Exclude<StudioSlotKind, "prompt">,
  ComponentType<{ className?: string; stroke?: number }>
> = {
  firstFrame: IconPhotoUp,
  lastFrame: IconPhotoUp,
  sourceVideo: IconVideoPlus,
  referenceImages: IconStack2,
  referenceVideo: IconVideoPlus,
  audio: IconUpload,
};

export function VideoStudioPage() {
  const workspaceState = useFizzStudioWorkspace();

  return (
    <FizzStudioShell
      className="overflow-x-hidden bg-[#09090a]"
      headerVariant="enterprise"
      mainClassName="max-w-none px-0 pt-0"
      sidebarVariant="enterprise"
      workspaceState={workspaceState}
    >
      <VideoStudioSurface />
    </FizzStudioShell>
  );
}

function VideoStudioSurface() {
  const t = useTranslations("fizzStudio.videoStudio");
  const catalogQuery = useAiCatalog();
  const [activeTab, setActiveTab] = useState<VideoTab>("community");
  const [activeMode, setActiveMode] = useState<StudioModeKey>("text_to_video");
  const [prompt, setPrompt] = useState("");
  const [panel, setPanel] = useState<ComposerPanel | null>(null);

  const mode = useMemo(
    () => VIDEO_MODES.find((m) => m.key === activeMode) ?? VIDEO_MODES[0],
    [activeMode]
  );

  const models = useMemo(() => {
    const all = usableModelsByModality(catalogQuery.data, "video");
    return all.filter((m) => (m.generationModes ?? []).some((gm) => gm === mode.generationMode));
  }, [catalogQuery.data, mode]);
  const hasModels = models.length > 0;
  const canCreate = hasModels && prompt.trim().length > 0;

  const uploadSlots = mode.inputSlots.filter(
    (slot): slot is Exclude<StudioSlotKind, "prompt"> => slot !== "prompt"
  );

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel]);

  return (
    <div className="relative min-h-[calc(100svh-64px)] pb-[430px] text-white md:pb-56">
      {/* Sticky tabs — same as the image studio */}
      <div className="sticky top-16 z-30 border-b border-white/[0.06] bg-[#09090a]/88 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6 xl:px-8">
          <div className="shrink-0 text-base font-semibold text-white">{t("title")}</div>
          <div
            role="tablist"
            aria-label={t("modeTabsLabel")}
            className="flex h-8 rounded-[14px] bg-white/[0.04] p-1"
          >
            {VIDEO_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "h-6 min-w-[78px] rounded-[10px] px-3 text-sm font-semibold transition-colors",
                  activeTab === tab ? "bg-white/12 text-white" : "text-white/42 hover:text-white"
                )}
              >
                {t(`modeTabs.${tab}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Feed */}
      <section className="px-4 pb-10 pt-5 sm:px-6 xl:px-8">
        <div className="mx-auto max-w-none">
          {activeTab === "history" ? (
            <div className="py-24 text-center text-sm text-white/40">{t("historyEmpty")}</div>
          ) : (
            <ImageMasonry items={IMAGE_FEED} />
          )}
        </div>
      </section>

      {/* Floating panel backdrop */}
      {panel && (
        <button
          type="button"
          aria-label="Close panel"
          onClick={() => setPanel(null)}
          className="fixed inset-0 z-[39] cursor-default bg-black/55 duration-150 animate-in fade-in-0"
        />
      )}

      {/* Fixed-bottom composer — same placement as the image studio */}
      <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-[960px] lg:left-[72px] lg:right-6">
        {panel === "mode" && (
          <FloatingPanel title={t("modePanelTitle")} onClose={() => setPanel(null)}>
            <div className="p-3">
              <StudioModeRail
                modes={VIDEO_MODES}
                active={activeMode}
                onSelect={(key) => {
                  setActiveMode(key);
                  setPanel(null);
                }}
              />
            </div>
          </FloatingPanel>
        )}
        {panel === "settings" && (
          <FloatingPanel title={t("settingsPanelTitle")} onClose={() => setPanel(null)}>
            <p className="px-5 py-6 text-center text-sm text-white/45">{t("noModels")}</p>
          </FloatingPanel>
        )}

        <div className="rounded-3xl border border-white/[0.08] bg-[#141416] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
          {uploadSlots.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2.5">
              {uploadSlots.map((slot) => {
                const Icon = SLOT_ICON[slot];
                return (
                  <button
                    key={slot}
                    type="button"
                    className="flex size-20 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-white/12 bg-white/[0.02] text-white/45 transition-colors hover:border-white/25 hover:text-white/70"
                  >
                    <Icon className="size-5" stroke={1.6} />
                    <span className="px-1 text-center text-[11px] leading-tight">
                      {t(`slots.${slot}`)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("promptPlaceholder")}
            className="min-h-[72px] w-full resize-none rounded-2xl bg-transparent px-1 py-1 text-sm text-white placeholder:text-white/35 focus:outline-none"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
            <ComposerChip
              icon={mode.icon}
              label={t(`modes.${mode.i18nKey}`)}
              active={panel === "mode"}
              onClick={() => setPanel(panel === "mode" ? null : "mode")}
            />
            <ComposerChip
              icon={IconAdjustmentsHorizontal}
              label={hasModels ? (models[0]?.name ?? "") : t("selectModel")}
              active={panel === "settings"}
              onClick={() => setPanel(panel === "settings" ? null : "settings")}
            />
            <button
              type="button"
              disabled={!canCreate}
              className={cn(
                "ml-auto inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-medium transition-colors",
                canCreate
                  ? "bg-[#E52227] text-white hover:bg-[#c91d22]"
                  : "cursor-not-allowed bg-white/[0.06] text-white/40"
              )}
            >
              <IconSend className="size-4" stroke={1.8} />
              {t("create")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FloatingPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-x-0 bottom-full z-50 mb-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141416] shadow-[0_24px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] duration-150 animate-in fade-in-0 slide-in-from-bottom-3">
      <div className="flex h-12 items-center justify-between px-4">
        <span className="text-sm font-semibold text-white/90">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconX className="size-4" stroke={1.8} />
        </button>
      </div>
      {children}
    </div>
  );
}

function ComposerChip({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: ComponentType<{ className?: string; stroke?: number }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex max-w-[220px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-white/20 bg-white/[0.1] text-white"
          : "border-white/[0.08] bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
      )}
    >
      <Icon className="size-4 shrink-0" stroke={1.8} />
      <span className="truncate">{label}</span>
      <IconChevronDown className="size-3.5 shrink-0 opacity-60" stroke={2} />
    </button>
  );
}
