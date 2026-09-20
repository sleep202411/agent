"use client";

import { useRef, useState, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { useTranslations } from "next-intl";
import {
  IconArrowLeft,
  IconBlocks,
  IconBook2,
  IconFolder,
  IconHistory,
  IconId,
  IconLibraryPhoto,
  IconPuzzle,
  IconShare3,
  IconSettings,
  IconUsersGroup,
} from "@tabler/icons-react";
import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { Link } from "@/i18n/navigation";
import { useCanvasConnection } from "@/app/[locale]/project/_components/canvas-connection-context";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import { ConnectionSignal } from "@/app/[locale]/canvas/_components/connection-signal";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openSettings } from "@/lib/settings-hash";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP, CustomEase);

export const PROJECT_PANEL_WIDTH = 300;
export const PROJECT_PANEL_OPEN_DURATION_MS = 200;
export const PROJECT_PANEL_CLOSE_DURATION_MS = 160;

const PROJECT_PANEL_OPEN_EASE = CustomEase.create("project-panel-open", "0.22,1,0.36,1");
const PROJECT_PANEL_CLOSE_EASE = CustomEase.create("project-panel-close", "0.4,0,1,1");

/**
 * Project-level navigation chrome. The rail and the active project panel share
 * one positioned owner so every project mode gets the same full-height panel,
 * without changing the canvas or page layout width.
 */
export function ProjectSidebar({
  activeMode,
  panel,
  panelOpen,
  crewAssetsEnabled = false,
  backHref = "/projects",
}: {
  activeMode: string;
  panel: ReactNode;
  panelOpen: boolean;
  crewAssetsEnabled?: boolean;
  backHref?: string;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [panelContentPresent, setPanelContentPresent] = useState(panelOpen);
  const t = useTranslations("project");
  const tShell = useTranslations("shell");
  const assetsOpen = useProjectUIStore((s) => s.assetsOpen);
  const crewAssetsOpen = useProjectUIStore((s) => s.crewAssetsOpen);
  const nodesOpen = useProjectUIStore((s) => s.nodesOpen);
  const sectionsOpen = useProjectUIStore((s) => s.sectionsOpen);
  const skillsOpen = useProjectUIStore((s) => s.skillsOpen);
  const openAssets = useProjectUIStore((s) => s.openAssets);
  const closeAssets = useProjectUIStore((s) => s.closeAssets);
  const openCrewAssets = useProjectUIStore((s) => s.openCrewAssets);
  const closeCrewAssets = useProjectUIStore((s) => s.closeCrewAssets);
  const openNodes = useProjectUIStore((s) => s.openNodes);
  const closeNodes = useProjectUIStore((s) => s.closeNodes);
  const historyOpen = useProjectUIStore((s) => s.historyOpen);
  const overviewOpen = useProjectUIStore((s) => s.overviewOpen);
  const toggleHistory = useProjectUIStore((s) => s.toggleHistory);
  const toggleOverview = useProjectUIStore((s) => s.toggleOverview);
  const toggleSections = useProjectUIStore((s) => s.toggleSections);
  const toggleSkills = useProjectUIStore((s) => s.toggleSkills);
  const closeCopilot = useProjectUIStore((s) => s.closeCopilot);
  const { connectionStatus, rtt } = useCanvasConnection();
  const { canEdit, canManage, openShare } = useProjectContext();
  const nodesDisabledReason =
    activeMode !== "canvas" && activeMode !== "storyboard"
      ? t("sidebar.nodesModeUnavailable")
      : !canEdit
        ? t("sidebar.nodesEditRequired")
        : undefined;

  useGSAP(
    () => {
      const element = panelRef.current;
      if (!element) return;

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      gsap.to(element, {
        x: panelOpen ? 0 : -PROJECT_PANEL_WIDTH,
        autoAlpha: panelOpen ? 1 : 0,
        duration: reducedMotion
          ? 0
          : panelOpen
            ? PROJECT_PANEL_OPEN_DURATION_MS / 1_000
            : PROJECT_PANEL_CLOSE_DURATION_MS / 1_000,
        ease: panelOpen ? PROJECT_PANEL_OPEN_EASE : PROJECT_PANEL_CLOSE_EASE,
        overwrite: "auto",
        onStart: () => {
          if (panelOpen) setPanelContentPresent(true);
        },
        onComplete: () => {
          if (!panelOpen) setPanelContentPresent(false);
        },
      });
    },
    { scope: shellRef, dependencies: [panelOpen] }
  );

  const items = [
    {
      icon: IconId,
      iconClassName: undefined,
      label: t("sidebar.overview"),
      active: overviewOpen,
      disabledReason: undefined,
      onClick: toggleOverview,
    },
    {
      icon: IconBook2,
      iconClassName: undefined,
      label: t("sidebar.chapters"),
      active: sectionsOpen,
      disabledReason: undefined,
      onClick: toggleSections,
    },
    {
      icon: IconBlocks,
      iconClassName: undefined,
      label: t("sidebar.nodes"),
      active: nodesOpen && !nodesDisabledReason,
      disabledReason: nodesDisabledReason,
      onClick: () => (nodesOpen ? closeNodes() : openNodes()),
    },
    {
      icon: IconLibraryPhoto,
      iconClassName: undefined,
      label: t("sidebar.assets"),
      active: assetsOpen,
      disabledReason: undefined,
      onClick: () => (assetsOpen ? closeAssets() : openAssets()),
    },
    ...(crewAssetsEnabled
      ? [
          {
            icon: IconFolder,
            iconClassName: undefined,
            label: t("sidebar.crewAssets"),
            active: crewAssetsOpen,
            disabledReason: undefined,
            onClick: () => (crewAssetsOpen ? closeCrewAssets() : openCrewAssets()),
          },
        ]
      : []),
    {
      icon: IconPuzzle,
      iconClassName: "text-brand-yellow",
      label: t("sidebar.skills"),
      active: skillsOpen,
      disabledReason: undefined,
      onClick: toggleSkills,
    },
    ...(canEdit
      ? [
          {
            icon: IconHistory,
            iconClassName: undefined,
            label: t("sidebar.activity"),
            active: historyOpen,
            disabledReason: undefined,
            onClick: () => {
              closeCopilot();
              toggleHistory();
            },
          },
        ]
      : []),
  ];

  return (
    <div
      ref={shellRef}
      className="relative z-40 h-full w-16 shrink-0 overflow-visible bg-[#0A0A0A]"
    >
      <aside className="relative z-20 flex h-full w-16 shrink-0 flex-col border-r border-white/10 bg-[#0A0A0A]">
        <div className="flex h-[53px] shrink-0 items-center justify-center">
          <Link
            href={backHref}
            aria-label={t("backToProjects")}
            title={t("backToProjects")}
            className="flex size-11 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none"
          >
            <IconArrowLeft className="size-[22px]" stroke={1.6} />
          </Link>
        </div>

        <nav
          aria-label={t("sidebar.navigation")}
          className="flex min-h-0 flex-1 flex-col items-center gap-2 px-1.5 py-2"
        >
          {items.map(({ icon: Icon, iconClassName, label, active, disabledReason, onClick }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  aria-disabled={disabledReason ? "true" : undefined}
                  onClick={(event) => {
                    if (disabledReason) {
                      event.preventDefault();
                      return;
                    }
                    onClick();
                  }}
                  className={cn(
                    "flex h-[54px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none",
                    disabledReason
                      ? "cursor-not-allowed text-white/30"
                      : active
                        ? "bg-white/[0.08] text-white"
                        : "text-white/90 hover:bg-white/[0.07] hover:text-white"
                  )}
                >
                  <Icon className={cn("size-[19px] shrink-0", iconClassName)} stroke={1.45} />
                  <span className="whitespace-nowrap text-[10px] leading-4 font-medium tracking-[-0.01em]">
                    {label}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={10}>
                {disabledReason ?? label}
              </TooltipContent>
            </Tooltip>
          ))}
        </nav>

        <div className="flex shrink-0 flex-col items-center gap-1 px-3 pt-2 pb-4">
          <button
            type="button"
            onClick={openShare}
            aria-label={t("sidebar.members")}
            title={t("sidebar.members")}
            className="flex size-9 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none"
          >
            <IconUsersGroup className="size-[19px]" stroke={1.45} />
          </button>
          <span className="flex size-9 items-center justify-center rounded-lg text-white/90">
            <ConnectionSignal status={connectionStatus} rtt={rtt} />
          </span>
          {canManage ? (
            <button
              type="button"
              onClick={openShare}
              aria-label={t("share")}
              title={t("share")}
              className="flex size-9 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none"
            >
              <IconShare3 className="size-[19px]" stroke={1.45} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => openSettings("account")}
            aria-label={tShell("nav.settings")}
            title={tShell("nav.settings")}
            className="flex size-9 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none"
          >
            <IconSettings className="size-[19px]" stroke={1.45} />
          </button>
        </div>
      </aside>

      <aside
        ref={panelRef}
        aria-hidden={!panelOpen}
        className={cn(
          "absolute inset-y-0 left-16 z-10 flex flex-col overflow-hidden bg-[#0A0A0A] shadow-[18px_0_36px_rgba(0,0,0,0.32)] will-change-transform",
          panelOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
        style={{
          width: PROJECT_PANEL_WIDTH,
          opacity: 0,
          visibility: "hidden",
          transform: `translate3d(-${PROJECT_PANEL_WIDTH}px, 0, 0)`,
        }}
      >
        {panelOpen || panelContentPresent ? panel : null}
      </aside>
    </div>
  );
}
