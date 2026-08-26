"use client";

import type { ComponentType } from "react";
import {
  IconArtboard,
  IconLayoutGrid,
  IconMessageCircle,
  IconMovie,
  IconScript,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { isProductionStepSegment } from "../_lib/production-steps";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * Phone-only bottom bar (hidden ≥md): chat first, then the four production
 * steps. Steps navigate the normal routes; chat flips the layout to the
 * full-screen agent conversation without leaving the current route.
 */
export function StoryProjectMobileNav({ projectId }: { projectId: string }) {
  const segment = useSelectedLayoutSegment();
  const searchParams = useSearchParams();
  const t = useTranslations("storyStudio.canvas");
  const mobileView = useStoryProjectUiStore((state) => state.mobileView);
  const setMobileView = useStoryProjectUiStore((state) => state.setMobileView);
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);

  if (!isProductionStepSegment(segment)) return null;

  const base = `/story-studio/projects/${projectId}`;
  // Preserve route context during the first render, before workbench state
  // has had a chance to publish the selected chapter into the UI store.
  const chapterId = activeChapterId ?? searchParams.get("chapter");
  const chapterQuery = chapterId ? `?chapter=${encodeURIComponent(chapterId)}` : "";
  const steps: Array<{ segment: string; href: string; icon: NavIcon; label: string }> = [
    {
      segment: "script",
      href: `${base}/script${chapterQuery}`,
      icon: IconScript,
      label: t("steps.script"),
    },
    {
      segment: "canvas",
      href: `${base}/canvas${chapterQuery}`,
      icon: IconArtboard,
      label: t("steps.tree"),
    },
    {
      segment: "assets",
      href: `${base}/assets${chapterQuery}`,
      icon: IconLayoutGrid,
      label: t("steps.assets"),
    },
    {
      segment: "storyboard",
      href: `${base}/storyboard${chapterQuery}`,
      icon: IconMovie,
      label: t("steps.storyboard"),
    },
  ];

  return (
    <nav
      aria-label={t("mobileNav.label")}
      className="flex shrink-0 border-t border-white/8 bg-[#0A0A0A] pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <button
        type="button"
        aria-pressed={mobileView === "chat"}
        onClick={() => setMobileView("chat")}
        className={navItemClass(mobileView === "chat")}
      >
        <IconMessageCircle className="size-5" stroke={1.6} />
        <span className="text-[10px] leading-4 font-medium">{t("mobileNav.chat")}</span>
      </button>
      {steps.map((step) => {
        const active = mobileView === "work" && segment === step.segment;
        return (
          <Link
            key={step.segment}
            href={step.href}
            aria-current={active ? "page" : undefined}
            onClick={() => setMobileView("work")}
            className={navItemClass(active)}
          >
            <step.icon className="size-5" stroke={1.6} />
            <span className="text-[10px] leading-4 font-medium">{step.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

type NavIcon = ComponentType<{ className?: string; stroke?: number }>;

function navItemClass(active: boolean) {
  return cn(
    "flex h-14 flex-1 flex-col items-center justify-center gap-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none",
    active ? "text-white" : "text-white/44 hover:text-white/75"
  );
}
