"use client";

import { useState, type ReactNode } from "react";
import {
  IconLayoutSidebarLeftCollapse,
  IconBriefcase,
  IconFolder,
  IconHash,
  IconHome,
  IconMessageCircle,
  IconCheckbox,
  IconCoins,
  IconSettings,
  IconUserPlus,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";

import { CrewLogo } from "@/app/(site)/messages/_components/crew-logo";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import type {
  WorkspaceTab,
  WorkspaceTabId,
} from "@/app/(site)/crews/[id]/workspace/_lib/workspace-tabs";
import { CrewSwitcherRail } from "@/app/(site)/crews/_components/crew-switcher-rail";
import Link from "next/link";
import { useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { CrewWorkbenchHeader } from "./crew-workbench-header";

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
  embedded?: boolean;
  activeChatChannel: "team" | "community";
  activeTab: WorkspaceTabId;
  tabs: readonly WorkspaceTab[];
  children: ReactNode;
  notice?: ReactNode;
  crewId: string;
  crewLogo?: string | null;
  crewName: string;
  currentCrewHref?: string;
  isOwner: boolean;
  onEditCrew?: () => void;
  onInviteCommunity?: () => void;
  onInviteTeam?: () => void;
  onSelectChatChannel: (channel: "team" | "community") => void;
  onSelectTab: (tab: WorkspaceTabId) => void;
  showTeamChat: boolean;
}

export function CrewWorkbenchShell({
  embedded = false,
  activeChatChannel,
  activeTab,
  tabs,
  children,
  notice,
  crewId,
  crewLogo,
  crewName,
  currentCrewHref,
  isOwner,
  onEditCrew,
  onInviteCommunity,
  onInviteTeam,
  onSelectChatChannel,
  onSelectTab,
  showTeamChat,
}: CrewWorkbenchShellProps) {
  const locale = useLocale() as Locale;
  const tCrew = useTranslations("crew");
  const t = useTranslations("workspace");
  const tw = useTranslations("crewWorkbench");
  const tc = useTranslations("crewCommunityChat");
  const [crewNamesExpanded, setCrewNamesExpanded] = useState(true);
  const hasChat = tabs.some((tab) => tab.id === "chat");
  return (
    <div
      className={cn(
        "grid min-h-0 grid-cols-[52px_minmax(0,1fr)] overflow-hidden bg-background text-[#f5f5f6] ",
        crewNamesExpanded
          ? "md:grid-cols-[168px_168px_minmax(0,1fr)] xl:grid-cols-[180px_180px_minmax(0,1fr)]"
          : "md:grid-cols-[56px_168px_minmax(0,1fr)] xl:grid-cols-[56px_180px_minmax(0,1fr)]",
        embedded ? "h-full" : "h-dvh"
      )}
    >
      <CrewSwitcherRail
        showNames={crewNamesExpanded}
        embedded={embedded}
        currentCrew={{ id: crewId, logo: crewLogo ?? "", name: crewName }}
        currentCrewHref={currentCrewHref}
      />
      <aside
        aria-label={tw("globalNavigation")}
        className="flex min-h-0 flex-col items-stretch border-r border-white/[0.075] bg-background px-1.5 py-2 md:px-2"
      >
        <div className="flex h-10 shrink-0 items-center justify-center gap-3 overflow-hidden md:justify-start md:px-2">
          <CrewLogo logo={crewLogo} name={crewName} crewId={crewId} className="size-8 shrink-0" />
          <span className="hidden min-w-0 truncate text-[13px] font-semibold text-[#eceef2] md:block">
            {crewName}
          </span>
          <button
            type="button"
            className="ml-auto hidden shrink-0 rounded p-1 text-muted-foreground hover:bg-white/5 md:block"
            title={tw("crewSwitcherNavigation")}
            aria-label={tw("crewSwitcherNavigation")}
            aria-expanded={crewNamesExpanded}
            onClick={() => setCrewNamesExpanded((expanded) => !expanded)}
          >
            <IconLayoutSidebarLeftCollapse className="size-4" />
          </button>
        </div>

        <Link
          href={localizePath("/crews?view=mine", locale)}
          title={tCrew("myCrewsTitle")}
          aria-label={tCrew("myCrewsTitle")}
          className="flex min-h-11 items-center gap-2 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <IconUsers className="size-5 shrink-0" />
          <span className="hidden md:inline">{tCrew("myCrewsTitle")}</span>
        </Link>
        <div className="my-2 h-px bg-white/[0.075]" />

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain">
          {tabs
            .filter((tab) => ["overview", "tasks", "roles", "income"].includes(tab.id))
            .map((tab) => {
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
          {hasChat ? (
            <div className="mb-2 flex flex-col gap-0.5">
              <div className="flex h-8 items-center justify-between px-3">
                <span className="hidden text-xs font-semibold uppercase tracking-wider text-[#858a95] md:block">
                  {tc("channels")}
                </span>
              </div>
              {showTeamChat ? (
                <RailButton
                  icon={IconHash}
                  label={tc("teamChannel")}
                  actionLabel={onInviteTeam ? t("inviteMember") : undefined}
                  onAction={onInviteTeam}
                  active={activeTab === "chat" && activeChatChannel === "team"}
                  onClick={() => onSelectChatChannel("team")}
                />
              ) : null}
              <RailButton
                icon={IconUsersGroup}
                label={tc("communityChannel")}
                active={activeTab === "chat" && activeChatChannel === "community"}
                onClick={() => onSelectChatChannel("community")}
                actionLabel={onInviteCommunity ? tc("inviteCommunity") : undefined}
                onAction={onInviteCommunity}
              />
              <div className="mx-2 mt-2 h-px bg-white/[0.075]" />
            </div>
          ) : null}

          {tabs
            .filter((tab) => !["overview", "chat", "tasks", "roles", "income"].includes(tab.id))
            .map((tab) => {
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

        {isOwner && onEditCrew ? (
          <RailButton icon={IconSettings} label={tw("crewSettings")} onClick={onEditCrew} />
        ) : null}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-tl-xl border-l border-white/[0.055] bg-background">
        <CrewWorkbenchHeader
          crewLogo={crewLogo}
          crewId={crewId}
          crewName={crewName}
          pageTitle={
            activeTab === "chat"
              ? tc(activeChatChannel === "team" ? "teamChannel" : "communityChannel")
              : t(tabs.find((tab) => tab.id === activeTab)!.labelKey)
          }
          showProductionActions={showTeamChat}
        />
        {notice}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </section>
    </div>
  );
}

function RailButton({
  icon: Icon,
  label,
  active = false,
  onClick,
  actionLabel,
  onAction,
}: {
  icon: typeof IconHome;
  label: string;
  active?: boolean;
  onClick?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const surfaceClassName = cn(
    "relative flex h-10 w-full shrink-0 items-center rounded-[8px] text-[#858a95] transition-colors",
    active ? "bg-[#1b1d22] text-[#f5f5f6]" : "hover:bg-white/[0.055] hover:text-[#d8dae0]"
  );

  const labelContent = (
    <>
      <Icon className="size-[18px] shrink-0" stroke={1.75} />
      <span className="hidden min-w-0 truncate text-[12px] font-medium md:block">{label}</span>
    </>
  );

  if (onClick && onAction && actionLabel) {
    return (
      <div className={surfaceClassName}>
        {active ? (
          <span className="absolute -left-1.5 h-5 w-0.5 rounded-r bg-[#e52227] md:-left-2" />
        ) : null}
        <button
          type="button"
          className="flex h-full min-w-0 flex-1 items-center justify-center gap-3 rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-[#e52227]/70 md:justify-start md:pl-3"
          title={label}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          onClick={onClick}
        >
          {labelContent}
        </button>
        <button
          type="button"
          className="mr-1 grid size-8 shrink-0 place-items-center rounded-md text-[#aeb2bb] outline-none transition-colors hover:bg-white/[0.08] hover:text-[#f5f5f6] focus-visible:ring-2 focus-visible:ring-[#e52227]/70"
          title={actionLabel}
          aria-label={actionLabel}
          onClick={onAction}
        >
          <IconUserPlus className="size-[17px]" stroke={1.75} />
        </button>
      </div>
    );
  }

  const className = cn(
    surfaceClassName,
    "justify-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-[#e52227]/70 md:justify-start md:px-3"
  );

  const content = (
    <>
      {active ? (
        <span className="absolute -left-1.5 h-5 w-0.5 rounded-r bg-[#e52227] md:-left-2" />
      ) : null}
      {labelContent}
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
