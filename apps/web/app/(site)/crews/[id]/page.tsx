"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  IconArrowLeft,
  IconUsers,
  IconMovie,
  IconClock,
  IconCalendar,
  IconUserPlus,
  IconCircleCheck,
  IconCircle,
  IconLayoutDashboard,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { STATUS_CONFIG, useCrewDetail } from "@/app/(site)/crews/_hooks/use-crew";

export default function CrewDetailPage() {
  const t = useTranslations("crew");
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: crew, isLoading } = useCrewDetail(id);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (!crew) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <h1 className="text-xl font-bold text-foreground">Crew not found</h1>
        <Link href="/crews" className="text-sm text-primary hover:underline">
          ← Back to Crews
        </Link>
      </div>
    );
  }

  const status = STATUS_CONFIG[crew.status];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="relative h-56 overflow-hidden md:h-72">
        <img
          src={crew.coverImage.replace("w=600", "w=1200")}
          alt={crew.name}
          className="size-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-screen-2xl px-6 pb-6">
          <Link
            href="/crews"
            className="mb-3 inline-flex items-center gap-1 text-sm text-white/70 transition-colors hover:text-white"
          >
            <IconArrowLeft className="size-4" />
            {t("backToHall")}
          </Link>
          <div className="flex items-end justify-between">
            <div>
              <div className="mb-1 flex items-center gap-3">
                <h1 className="text-3xl font-bold text-white">{crew.name}</h1>
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                    status.badge
                  )}
                >
                  {t(status.labelKey)}
                </span>
              </div>
              <p className="text-sm text-white/70">{crew.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/crews/${id}/workspace`}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black shadow-sm transition-transform hover:scale-[1.02]"
              >
                <IconLayoutDashboard className="size-4" />
                {t("manage")}
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
              <div className="text-xs text-muted-foreground">{t("currentPhase")}</div>
              <div className="text-sm font-semibold text-foreground">{crew.currentPhase}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-24 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${crew.progress}%` }}
              />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("progress")}</div>
              <div className="text-sm font-semibold text-foreground">{crew.progress}%</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconUsers className="size-4 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">{t("team")}</div>
              <div className="text-sm font-semibold text-foreground">
                {crew.memberCount} {t("people")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconCalendar className="size-4 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">{t("deadlineLabel")}</div>
              <div className="text-sm font-semibold text-foreground">{crew.deadline}</div>
            </div>
          </div>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">{crew.budgetRange}</span>
        </div>
      </div>

      {/* Main + sidebar */}
      <div className="mx-auto max-w-screen-2xl px-6 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main */}
          <div className="space-y-6 lg:col-span-2">
            {/* Overview */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">{t("projectOverview")}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {crew.fullDescription}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {crew.rolesNeeded.map((role) => (
                  <span
                    key={role}
                    className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent"
                  >
                    {t("hiring")}: {role}
                  </span>
                ))}
              </div>
            </div>

            {/* Open Positions */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold text-foreground">{t("openPositions")}</h2>
              <div className="space-y-4">
                {crew.roles.map((role) => (
                  <div
                    key={role.name}
                    className="rounded-lg border border-border bg-secondary/30 p-4"
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          {role.name} × {role.count}
                        </h3>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{role.budget}</span>
                          <span>
                            {t("duration")}: {role.period}
                          </span>
                          <span className="flex items-center gap-1">
                            <IconClock className="size-3" />
                            {t("deadlineLabel")} {role.deadline}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                      >
                        <IconUserPlus className="size-3.5" />
                        {t("viewRole")}
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
                      {t("deliverable")}：{role.deliverable}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Roadmap */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold text-foreground">{t("roadmap")}</h2>
              <div className="space-y-0">
                {crew.phases.map((phase, i) => (
                  <div key={phase.name} className="flex items-start gap-3">
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
                      {i < crew.phases.length - 1 && (
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
                        {phase.name}
                      </span>
                      {phase.active && (
                        <span className="ml-2 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                          {t("currentPhase")}
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
            {/* Team */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <IconUsers className="size-4 text-primary" />
                {t("teamMembers")}
              </h3>
              <div className="space-y-3">
                {crew.members.map((member) => (
                  <div key={member.name} className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-medium text-foreground">
                      {member.name[0]}
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

            {/* Activity */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">{t("latestActivity")}</h3>
              <div className="space-y-3">
                {crew.activities.map((act, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    <p>{act.text}</p>
                    <span className="text-[10px] text-muted-foreground/60">{act.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Apply */}
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <IconUserPlus className="size-4" />
              {t("applyToJoin")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
