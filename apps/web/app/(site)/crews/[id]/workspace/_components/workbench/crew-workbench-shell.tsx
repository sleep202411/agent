"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  IconBriefcase,
  IconFolder,
  IconHome,
  IconMessageCircle,
  IconCheckbox,
  IconSettings,
  IconSparkles,
  IconUsers,
} from "@tabler/icons-react";

import { BellButton } from "@/components/notifications/bell-button";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import type {
  WorkspaceTab,
  WorkspaceTabId,
} from "@/app/(site)/crews/[id]/workspace/_lib/workspace-tabs";

const RAIL_ICONS: Record<WorkspaceTabId, typeof IconHome> = {
  overview: IconHome,
  chat: IconMessageCircle,
  tasks: IconCheckbox,
  assets: IconFolder,
  members: IconUsers,
  roles: IconBriefcase,
};

interface CrewWorkbenchShellProps {
  activeTab: WorkspaceTabId;
  tabs: readonly WorkspaceTab[];
  crewId: string;
  crewName: string;
  crewLogoUrl?: string;
  children: ReactNode;
  isOwner: boolean;
  onEditCrew: () => void;
  onSelectTab: (tab: WorkspaceTabId) => void;
}

export function CrewWorkbenchShell({
  activeTab,
  tabs,
  crewId,
  crewName: _crewName,
  crewLogoUrl,
  children,
  isOwner,
  onEditCrew,
  onSelectTab,
}: CrewWorkbenchShellProps) {
  const t = useTranslations("workspace");
  const tw = useTranslations("crewWorkbench");
  return (
    <div className="grid h-dvh min-h-0 grid-cols-[52px_minmax(0,1fr)] overflow-hidden bg-[#07080a] text-[#f5f5f6]">
      <aside
        aria-label={tw("globalNavigation")}
        className="flex min-h-0 flex-col items-center border-r border-white/[0.075] bg-[#090a0d] py-2"
      >
        <Link
          href={`/crews/${encodeURIComponent(crewId)}`}
          aria-label={tw("viewCrew")}
          className="mb-3 grid size-9 shrink-0 place-items-center overflow-hidden rounded-[9px] bg-[#17191e] text-[#ed2d35] ring-1 ring-white/8 transition-colors hover:bg-[#1d2026]"
        >
          {crewLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={crewLogoUrl} alt="" className="size-full object-cover" />
          ) : (
            <IconSparkles className="size-[19px]" stroke={1.8} />
          )}
        </Link>

        <div className="mb-2 h-px w-7 bg-white/[0.075]" />

        <BellButton variant="rail" />

        <div className="my-2 h-px w-7 bg-white/[0.075]" />

        <nav className="flex min-h-0 flex-1 flex-col items-center gap-0.5">
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
    "relative grid size-10 shrink-0 place-items-center rounded-[8px] text-[#858a95] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#e52227]/70",
    active ? "bg-[#1b1d22] text-[#f5f5f6]" : "hover:bg-white/[0.055] hover:text-[#d8dae0]"
  );

  const content = (
    <>
      {active ? <span className="absolute -left-1 h-5 w-0.5 rounded-r bg-[#e52227]" /> : null}
      <Icon className="size-[18px]" stroke={1.75} />
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
