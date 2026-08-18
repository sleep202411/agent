"use client";

import type { ComponentType } from "react";
import {
  IconArrowLeft,
  IconBook2,
  IconMovie,
  IconShare3,
  IconSparkles,
  IconWorld,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
import { AgentOsPanel } from "@/components/agent-os/agent-os-panel";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

type RailIcon = ComponentType<{ className?: string; stroke?: number }>;

/**
 * Shared chrome for the production step routes (script; canvas will adopt it
 * in a later step). Renders the project rail + the Agent OS panel around the
 * page content.
 *
 * Stage-1 seam: the canvas still mounts its OWN sidebar and Agent panel with
 * the full chapter/world/share wiring, so on the `canvas` segment this shell
 * renders children only. Removing that condition (and the canvas-local copies)
 * is the follow-up step.
 */
export function StoryProjectProductionShell({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const segment = useSelectedLayoutSegment();
  const canvasOwnsChrome = segment === "canvas";
  const t = useTranslations("storyStudio.canvas");
  const agentOpen = useStoryProjectUiStore((state) => state.agentOpen);
  const toggleAgent = useStoryProjectUiStore((state) => state.toggleAgent);
  const closeAgent = useStoryProjectUiStore((state) => state.closeAgent);

  if (canvasOwnsChrome) return <>{children}</>;

  return (
    <div className="flex h-screen min-w-[1120px] overflow-hidden bg-[var(--canvas-background)] text-white">
      <aside
        aria-label={t("sidebar.navigation")}
        className="relative z-50 flex h-full w-16 shrink-0 flex-col border-r border-white/10 bg-[#0A0A0A]"
      >
        <div className="flex h-16 shrink-0 items-center justify-center">
          <Link
            href="/story-studio"
            aria-label={t("back")}
            className="flex size-11 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none"
          >
            <IconArrowLeft className="size-[22px]" stroke={1.6} />
          </Link>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col items-center gap-2 px-1.5 py-2">
          {/* Chapters lives on the canvas (its dropdown needs the draft data);
              from other steps the button navigates there. */}
          <RailLink
            href={`/story-studio/projects/${projectId}/canvas`}
            icon={IconBook2}
            label={t("chapters.action")}
          />
          <RailDisabled icon={IconWorld} label={t("sidebar.world")} />
          <RailDisabled icon={IconMovie} label={t("sidebar.media")} />
          <RailButton
            icon={IconSparkles}
            label={t("sidebar.agent")}
            active={agentOpen}
            onClick={toggleAgent}
          />
          <div className="flex-1" />
          <RailDisabled icon={IconShare3} label={t("share")} />
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1">{children}</div>
      <AgentOsPanel
        projectId={projectId}
        projectKind="story"
        workbenchMode="story"
        open={agentOpen}
        onClose={closeAgent}
      />
    </div>
  );
}

function railItemClass(active = false) {
  return cn(
    "flex h-[54px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none",
    active ? "bg-white/[0.08] text-white" : "text-white/90 hover:bg-white/[0.07] hover:text-white"
  );
}

function RailLink({ href, icon: Icon, label }: { href: string; icon: RailIcon; label: string }) {
  return (
    <Link href={href} className={railItemClass()}>
      <Icon className="size-[19px] shrink-0" stroke={1.45} />
      <span className="max-w-[48px] truncate text-[10px] leading-4 font-medium tracking-[-0.01em]">
        {label}
      </span>
    </Link>
  );
}

function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: RailIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={railItemClass(active)}>
      <Icon className="size-[19px] shrink-0" stroke={1.45} />
      <span className="max-w-[48px] truncate text-[10px] leading-4 font-medium tracking-[-0.01em]">
        {label}
      </span>
    </button>
  );
}

function RailDisabled({ icon: Icon, label }: { icon: RailIcon; label: string }) {
  return (
    <span aria-disabled="true" className={cn(railItemClass(), "cursor-default opacity-40")}>
      <Icon className="size-[19px] shrink-0" stroke={1.45} />
      <span className="max-w-[48px] truncate text-[10px] leading-4 font-medium tracking-[-0.01em]">
        {label}
      </span>
    </span>
  );
}
