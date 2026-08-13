"use client";

import { useState } from "react";
import Link from "next/link";
import { IconArrowLeft, IconHammer, IconSparkles } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useProject } from "../../../_hooks/use-project";
import { useFirstSectionCanvas } from "../../../_hooks/use-document";
import { type ViewMode } from "../_data/view-modes";
import { StoryboardCanvas } from "./canvas/storyboard-canvas";

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations("fizzStudio");
  const locale = useLocale() as Locale;
  // Canvas is the only view for now; the storyboard table + timeline (and the
  // view switcher that selects them) will be reintroduced in the UI/UX rework.
  const [mode] = useState<ViewMode>("canvas");

  const { isError: projectError } = useProject(projectId);
  const {
    data: storyboard,
    isLoading: loadingDoc,
    isError: docError,
  } = useFirstSectionCanvas(projectId);

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
      {/* Editor header — back only, transparent (no bg / border); view switcher,
          account + settings will be reintroduced elsewhere in the UI/UX rework. */}
      <header className="sticky top-0 z-40">
        <div className="flex h-14 items-center px-4 sm:px-6">
          <Link
            href={localizePath("/fizzstudio", locale)}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/8 hover:text-white"
            aria-label={t("backToStudio")}
          >
            <IconArrowLeft className="size-[18px]" />
          </Link>
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
