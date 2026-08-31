"use client";

import type { ReactNode } from "react";
import {
  IconBriefcase,
  IconFolder,
  IconHome,
  IconMessageCircle,
  IconCheckbox,
  IconCoins,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";

import { CrewLogo } from "@/app/(site)/messages/_components/crew-logo";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import type {
  WorkspaceTab,
  WorkspaceTabId,
} from "@/app/(site)/crews/[id]/workspace/_lib/workspace-tabs";
import { CrewSwitcherRail } from "@/app/(site)/crews/_components/crew-switcher-rail";

const RAIL_ICONS: Record<WorkspaceTabId, typeof IconHome> = {
  overview: IconHome,
  chat: IconMessageCircle,
  tasks: IconCheckbox,
  income: IconCoins,
  assets: IconFolder,
  members: IconUsers,
  roles: IconBriefcase,
};

interface CrewWorkbenchShellProps {
  activeTab: WorkspaceTabId;
  tabs: readonly WorkspaceTab[];
  children: ReactNode;
  crewId: string;
  crewLogo?: string | null;
  crewName: string;
  isOwner: boolean;
  onEditCrew: () => void;
  onSelectTab: (tab: WorkspaceTabId) => void;
}

export function CrewWorkbenchShell({
  activeTab,
  tabs,
  children,
  crewId,
  crewLogo,
  crewName,
  isOwner,
  onEditCrew,
  onSelectTab,
}: CrewWorkbenchShellProps) {
  const t = useTranslations("workspace");
  const tw = useTranslations("crewWorkbench");
  return (
    <div className="grid h-dvh min-h-0 grid-cols-[52px_minmax(0,1fr)] overflow-hidden bg-[#07080a] text-[#f5f5f6] md:grid-cols-[60px_220px_minmax(0,1fr)] min-[1152px]:!grid-cols-[180px_220px_minmax(0,1fr)]">
      <CrewSwitcherRail
        currentCrew={{ id: crewId, logo: crewLogo ?? "", name: crewName }}
        showNames
      />

      <aside
        aria-label={tw("globalNavigation")}
        className="flex min-h-0 flex-col items-stretch border-r border-white/[0.075] bg-[#090a0d] px-1.5 py-2 md:px-2"
      >
        <div className="flex h-10 shrink-0 items-center justify-center gap-3 overflow-hidden md:justify-start md:px-2">
          <CrewLogo logo={crewLogo} name={crewName} crewId={crewId} className="size-8 shrink-0" />
          <span className="hidden min-w-0 truncate text-[13px] font-semibold text-[#eceef2] md:block">
            {crewName}
          </span>
        </div>

        <div className="my-2 h-px bg-white/[0.075]" />

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5">
          {tabs.map((tab) => {
            const Icon = RAIL_ICONS[tab.id];
            return (
              <RailButton
                key={tab.id}
                icon={Icon}
                label={t(tab.labelKey)}
                active={activeTab === tab.id}
                onClick={() => onSelectTab(tab.id)}
              />
            );
          })}
        </nav>

        {isOwner ? (
          <RailButton icon={IconSettings} label={tw("crewSettings")} onClick={onEditCrew} />
        ) : null}
      </aside>

      <section className="min-h-0 min-w-0 overflow-hidden bg-[#07080a]">{children}</section>
    </div>
  );
}

function RailButton({
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  icon: typeof IconHome;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const className = cn(
    "relative flex h-10 w-full shrink-0 items-center justify-center gap-3 rounded-[8px] text-[#858a95] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#e52227]/70 md:justify-start md:px-3",
    active ? "bg-[#1b1d22] text-[#f5f5f6]" : "hover:bg-white/[0.055] hover:text-[#d8dae0]"
  );

  const content = (
    <>
      {active ? (
        <span className="absolute -left-1.5 h-5 w-0.5 rounded-r bg-[#e52227] md:-left-2" />
      ) : null}
      <Icon className="size-[18px] shrink-0" stroke={1.75} />
      <span className="hidden min-w-0 truncate text-[12px] font-medium md:block">{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        title={label}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <button type="button" className={className} title={label} aria-label={label}>
      {content}
    </button>
  );
}
