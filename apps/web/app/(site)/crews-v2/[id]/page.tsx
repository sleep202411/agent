"use client";

/**
 * `/crews-v2/[id]` — Studio detail page.
 *
 * Direct port of fizzdragon-prd `app/studio/[id]/page.tsx`. Mock only.
 * lucide → tabler; status / phase literals stay English in mock and map
 * to i18n keys at render. Internal links target `/crews-v2/...`.
 */

import { useParams } from "next/navigation";
import Link from "next/link";
import {
  IconArrowLeft,
  IconUsers,
  IconMovie,
  IconClock,
  IconCalendar,
  IconUserPlus,
  IconCircleCheck,
  IconCircle,
  IconSettings,
  IconDeviceTv,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useT } from "../_hooks/use-t";
import {
  DETAIL_STUDIO,
  DETAIL_PHASES,
  DETAIL_PHASE_KEY,
  DETAIL_ROLES,
  DETAIL_MEMBERS,
  DETAIL_ACTIVITIES,
  type PhaseId,
} from "../_data/mock";
import type { CrewsV2Key } from "../_data/i18n";

const STATUS_KEY: Record<string, CrewsV2Key> = {
  Recruiting: "statusRecruiting",
  "In Production": "statusInProduction",
  "Post-production": "statusPostProduction",
  Completed: "statusCompleted",
};

const STATUS_CLASSES: Record<string, string> = {
  Recruiting: "text-blue-400 bg-blue-400/10 border border-blue-400/30",
  "In Production": "text-green-400 bg-green-400/10 border border-green-400/30",
  "Post-production": "text-amber-400 bg-amber-400/10 border border-amber-400/30",
};

export default function StudioDetailPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const studio = DETAIL_STUDIO;

  return (
    <div className="min-h-screen bg-background">
      {/* Hero with cover image */}
      <div className="relative h-56 overflow-hidden md:h-72">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={studio.cover_image} alt={studio.name} className="size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-screen-2xl px-6 pb-6">
          <Link
            href="/crews-v2"
            className="mb-3 inline-flex items-center gap-1 text-sm text-white/70 transition-colors hover:text-white"
          >
            <IconArrowLeft className="size-4" />
            {t("dtBackToPlaza")}
          </Link>
          <div className="flex items-end justify-between">
            <div>
              <div className="mb-1 flex items-center gap-3">
                <h1 className="text-3xl font-bold text-white">{studio.name}</h1>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    STATUS_CLASSES[studio.status] ||
                      "border border-border bg-muted/50 text-muted-foreground"
                  )}
                >
                  {t(STATUS_KEY[studio.status] ?? "statusAll")}
                </span>
              </div>
              <p className="text-sm text-white/70">{studio.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/crews-v2/${id}/workspace`}
                className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10"
              >
                <IconDeviceTv className="size-4" />
                {t("dtBtnWorkspace")}
              </Link>
              <Link
                href={`/crews-v2/${id}/edit`}
                className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10"
              >
                <IconSettings className="size-4" />
                {t("dtBtnSettings")}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-screen-2xl items-center gap-8 px-6 py-4">
          <div className="flex items-center gap-2">
            <IconMovie className="size-4 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">{t("dtCurrentPhaseLabel")}</div>
              <div className="text-sm font-semibold text-foreground">
                {t(DETAIL_PHASE_KEY[studio.current_phase] as CrewsV2Key)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-24 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${studio.progress}%` }}
              />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("dtProgressLabel")}</div>
              <div className="text-sm font-semibold text-foreground">{studio.progress}%</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconUsers className="size-4 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">{t("dtTeamLabel")}</div>
              <div className="text-sm font-semibold text-foreground">
                {t("dtMembersCount", { n: studio.member_count })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconCalendar className="size-4 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">{t("dtDeadlineLabel")}</div>
              <div className="text-sm font-semibold text-foreground">{studio.deadline}</div>
            </div>
          </div>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">{studio.budget_range}</span>
        </div>
      </div>

      {/* Main content + sidebar */}
      <div className="mx-auto max-w-screen-2xl px-6 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main */}
          <div className="space-y-6 lg:col-span-2">
            {/* Project Overview */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                {t("dtProjectOverview")}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {studio.full_description}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {studio.roles_needed.map((role) => (
                  <span
                    key={role}
                    className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent"
                  >
                    {t("dtHiringPrefix", { role })}
                  </span>
                ))}
              </div>
            </div>

            {/* Open Positions */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold text-foreground">{t("dtOpenPositions")}</h2>
              <div className="space-y-4">
                {DETAIL_ROLES.map((role) => (
                  <div
                    key={role.name}
                    className="rounded-lg border border-border bg-secondary/30 p-4"
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          {t("dtRoleCount", { role: role.name, count: role.count })}
                        </h3>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{role.budget}</span>
                          <span>{t("dtRoleDuration", { period: role.period })}</span>
                          <span className="flex items-center gap-1">
                            <IconClock className="size-3" />
                            {t("dtRoleDeadline", { date: role.deadline })}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                      >
                        <IconUserPlus className="size-3.5" />
                        {t("dtRoleViewBtn")}
                      </button>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {role.skills.map((skill) => (
                        <span
                          key={skill}
                          className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("dtRoleDeliverable", { text: role.deliverable })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Project Roadmap */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold text-foreground">
                {t("dtProjectRoadmap")}
              </h2>
              <div className="space-y-0">
                {DETAIL_PHASES.map((phase, i) => (
                  <div key={phase.id} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      {phase.done ? (
                        <IconCircleCheck className="size-5 shrink-0 text-green-400" />
                      ) : (
                        <IconCircle
                          className={cn(
                            "size-5 shrink-0",
                            phase.active ? "text-primary" : "text-muted-foreground/40"
                          )}
                        />
                      )}
                      {i < DETAIL_PHASES.length - 1 && (
                        <div
                          className={cn("h-8 w-px", phase.done ? "bg-green-400/40" : "bg-border")}
                        />
                      )}
                    </div>
                    <div className="pb-4">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          phase.done
                            ? "text-green-400"
                            : phase.active
                              ? "text-primary"
                              : "text-muted-foreground"
                        )}
                      >
                        {t(DETAIL_PHASE_KEY[phase.id] as CrewsV2Key)}
                      </span>
                      {phase.active && (
                        <span className="ml-2 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                          {t("dtCurrentPhaseTag")}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Team Members */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <IconUsers className="size-4 text-primary" />
                {t("dtTeamMembers")}
              </h3>
              <div className="space-y-3">
                {DETAIL_MEMBERS.map((member) => (
                  <div key={member.name} className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-medium text-foreground">
                      {member.name.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">
                        {member.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{member.role}</div>
                    </div>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {member.level}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Latest Activity */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">
                {t("dtLatestActivity")}
              </h3>
              <div className="space-y-3">
                {DETAIL_ACTIVITIES.map((act, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    <p>{act.text}</p>
                    <span className="text-[10px] text-muted-foreground/60">{act.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Apply to Join */}
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <IconUserPlus className="size-4" />
              {t("dtApplyToJoin")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
