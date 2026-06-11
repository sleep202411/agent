"use client";

import { useState } from "react";
import Link from "next/link";
import { IconArrowLeft, IconHammer, IconSettings, IconSparkles } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { StudioAccountMenu } from "@/components/studio-account-menu";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useProject } from "../../../_hooks/use-project";
import { usePrimaryStoryboard } from "../../../_hooks/use-document";
import { VIEW_MODES, type ViewMode } from "../_data/view-modes";
import { StoryboardCanvas } from "./canvas/storyboard-canvas";

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations("fizzStudio");
  const locale = useLocale() as Locale;
  // Canvas is the first real view; storyboard table + timeline come later.
  const [mode, setMode] = useState<ViewMode>("canvas");

  const { data: project, isError: projectError } = useProject(projectId);
  const {
    data: storyboard,
    isLoading: loadingDoc,
    isError: docError,
  } = usePrimaryStoryboard(projectId);

  if (projectError || docError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0f0f10] px-6 text-center text-white">
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-white/[0.04]">
          <IconSparkles className="size-6 text-white/30" />
        </div>
        <p className="text-sm font-medium text-white/60">{t("projectNotFound")}</p>
        <p className="mt-1 text-xs text-white/30">{t("projectNotFoundHint")}</p>
        <Link
          href={localizePath("/fizzstudio", locale)}
          className="mt-5 inline-flex h-8 items-center gap-1.5 rounded-full bg-white/8 px-4 text-sm font-medium text-white/70 transition-colors hover:bg-white/12 hover:text-white"
        >
          <IconArrowLeft className="size-3.5" />
          {t("backToStudio")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#0f0f10] text-white">
      {/* Editor header — back · title · view-mode switcher · settings */}
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#0f0f10]/90 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <Link
            href={localizePath("/fizzstudio", locale)}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/8 hover:text-white"
            aria-label={t("backToStudio")}
          >
            <IconArrowLeft className="size-[18px]" />
          </Link>
          <div className="min-w-0">
            {project ? (
              <h1 className="truncate text-sm font-semibold">{project.name}</h1>
            ) : (
              <div className="h-4 w-32 animate-pulse rounded bg-white/[0.06]" />
            )}
          </div>

          {/* View-mode switcher — centered segmented control */}
          <div className="mx-auto">
            <div className="inline-flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.04] p-0.5">
              {VIEW_MODES.map((vm) => {
                const active = mode === vm.mode;
                return (
                  <button
                    key={vm.mode}
                    type="button"
                    onClick={() => setMode(vm.mode)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors",
                      active ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white/80"
                    )}
                  >
                    <vm.Icon className="size-4" />
                    <span className="hidden sm:inline">{t(vm.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <StudioAccountMenu />
            <button
              type="button"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/8 hover:text-white"
              aria-label={t("projectSettings")}
            >
              <IconSettings className="size-[18px]" />
            </button>
          </div>
        </div>
      </header>

      {/* Editor body — the active view renders the same storyboard data */}
      <main className="flex flex-1 flex-col">
        {loadingDoc || !storyboard ? (
          <div className="flex flex-1 items-center justify-center text-sm text-white/40">
            {t("loading") ?? "Loading…"}
          </div>
        ) : mode === "canvas" ? (
          <StoryboardCanvas key={storyboard.id} doc={storyboard} />
        ) : (
          <ComingSoonView label={t(mode === "timeline" ? "viewTimeline" : "viewStoryboard")} />
        )}
      </main>
    </div>
  );
}

// ─── Coming-soon views (storyboard table / timeline) ──────────────────────────

function ComingSoonView({ label }: { label: string }) {
  const t = useTranslations("fizzStudio");
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-white/[0.04]">
        <IconHammer className="size-6 text-white/30" />
      </div>
      <p className="text-sm font-medium text-white/55">{label}</p>
      <p className="mt-1 max-w-xs text-xs text-white/30">{t("viewComingSoon")}</p>
    </div>
  );
}
