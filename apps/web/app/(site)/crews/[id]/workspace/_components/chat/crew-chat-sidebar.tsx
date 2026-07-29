"use client";

import {
  IconBolt,
  IconCheck,
  IconClipboardCheck,
  IconFiles,
  IconHash,
  IconSparkles,
} from "@tabler/icons-react";
import Link from "next/link";
import { useMemo } from "react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import {
  useCrewDetail,
  useCrewMembers,
  useCrewTaskSummary,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { CrewLogo } from "@/app/(site)/messages/_components/crew-logo";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

export function CrewChatSidebar({ crewId }: { crewId: string }) {
  const tm = useTranslations("messages");
  const locale = useLocale() as Locale;
  const crew = useCrewDetail(crewId);
  const members = useCrewMembers(crewId);
  const taskSummary = useCrewTaskSummary(crewId);
  const memberIds = useMemo(
    () => (members.data ?? []).map((member) => member.userId),
    [members.data]
  );
  const displays = useUserDisplays(memberIds);

  const completionPercent =
    (taskSummary.data?.total ?? 0) > 0
      ? Math.round(((taskSummary.data?.completed ?? 0) / (taskSummary.data?.total ?? 1)) * 100)
      : null;
  const memberPreview = (members.data ?? []).slice(0, 5);
  const crewName = crew.data?.name ?? tm("crewChatFallbackName");

  const taskHref = localizePath(`/crews/${crewId}/workspace?tab=tasks`, locale);
  const assetsHref = localizePath(`/crews/${crewId}/workspace?tab=assets`, locale);

  return (
    <aside className="hidden min-h-0 w-[232px] shrink-0 flex-col bg-[#0b0d10] lg:flex">
      <div className="flex h-[58px] shrink-0 items-center gap-3 border-b border-white/[0.065] px-3">
        <CrewLogo
          logo={crew.data?.logo}
          name={crewName}
          crewId={crewId}
          className="size-8 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[#f1f2f4]">{crewName}</p>
          <p className="mt-0.5 text-[10px] text-[#747984]">{tm("crewWorkspaceLabel")}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <SidebarLabel>{tm("channels")}</SidebarLabel>
        <div className="mt-1.5 flex h-8 items-center gap-2 rounded-md bg-white/[0.075] px-2.5 text-[12px] font-semibold text-[#f3f4f6]">
          <IconHash className="size-4 text-primary" />
          <span className="min-w-0 flex-1 truncate">{tm("crewChannelName")}</span>
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
        </div>

        <SidebarLabel className="mt-5">{tm("smartViews")}</SidebarLabel>
        <div className="mt-1.5 space-y-0.5">
          <SidebarLink
            href={taskHref}
            icon={<IconClipboardCheck className="size-4" />}
            label={tm("myTasks")}
            count={taskSummary.data?.myActive ?? 0}
          />
          <SidebarLink
            href={taskHref}
            icon={<IconCheck className="size-4" />}
            label={tm("pendingReview")}
            count={taskSummary.data?.pendingReview ?? 0}
          />
          <SidebarLink
            href={assetsHref}
            icon={<IconFiles className="size-4" />}
            label={tm("filesAndLinks")}
          />
        </div>

        <SidebarLabel className="mt-5">{tm("appsAndAssistants")}</SidebarLabel>
        <div className="mt-1.5 rounded-lg bg-white/[0.035] p-2.5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/[0.14] text-primary">
              <IconSparkles className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[12px] font-semibold text-[#eceef2]">
                  {tm("crewAssistantName")}
                </span>
                <span className="rounded bg-white/[0.08] px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-[#9ba0a9]">
                  {tm("systemBadge")}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[#777d87]">
                {tm("crewAssistantDescription")}
              </p>
            </div>
          </div>
        </div>

        <SidebarLabel className="mt-5">{tm("crewMembersLabel")}</SidebarLabel>
        <div className="mt-2 flex items-center">
          {memberPreview.map((member, index) => {
            const display = displays.get(member.userId);
            return (
              <UserAvatar
                key={member.id}
                src={display?.avatar}
                name={display?.nickname ?? ""}
                seed={member.userId}
                className={cn("size-7 ring-2 ring-[#0b0d10]", index > 0 && "-ml-1.5")}
              />
            );
          })}
          {(members.data?.length ?? 0) > memberPreview.length ? (
            <span className="-ml-1.5 grid size-7 place-items-center rounded-full bg-[#25282e] text-[9px] text-[#b8bcc3] ring-2 ring-[#0b0d10]">
              +{(members.data?.length ?? 0) - memberPreview.length}
            </span>
          ) : null}
          <span className="ml-2 text-[11px] text-[#818791]">
            {tm("crewMemberCount", { count: members.data?.length ?? 0 })}
          </span>
        </div>
      </div>

      <Link
        href={taskHref}
        className="m-2.5 rounded-lg bg-white/[0.04] p-3 transition-colors hover:bg-white/[0.065]"
      >
        <div className="flex items-center gap-2 text-[10px] font-medium text-[#a8adb6]">
          <IconBolt className="size-3.5 text-primary" />
          {tm("productionPulse")}
        </div>
        <p className="mt-2 text-[11px] font-semibold text-[#e8e9ec]">
          {tm("activeTaskCount", { count: taskSummary.data?.active ?? 0 })}
        </p>
        {completionPercent !== null ? (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${completionPercent}%` }}
              />
            </div>
            <span className="text-[8px] tabular-nums text-[#696e77]">{completionPercent}%</span>
          </div>
        ) : null}
      </Link>
    </aside>
  );
}

function SidebarLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "px-2.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#555a63]",
        className
      )}
    >
      {children}
    </p>
  );
}

function SidebarLink({
  href,
  icon,
  label,
  count,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[12px] text-[#969ca6] transition-colors hover:bg-white/[0.04] hover:text-[#eceef2]"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count && count > 0 ? (
        <span className="min-w-4 rounded-full bg-primary px-1 py-0.5 text-center text-[8px] font-semibold leading-3 text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
