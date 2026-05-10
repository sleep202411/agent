"use client";

/**
 * Crew detail v2 — design layout follows fizzdragon-prd's
 * `app/studio/[id]/page.tsx` reference. Routed to from the new
 * "All Crews" feed on /crews (queryCrewList items). Legacy detail
 * at `/crews/[id]/page.tsx` is left untouched so in-flight
 * job-application flows from the old grid keep working.
 *
 * Real-data sources:
 *   - useCrewDetail   — hero (banner / video / name / description)
 *   - useCrewMembers  — team sidebar
 *   - useCrewJobs     — open positions list
 *   - useProjectRoles — role-name lookup
 *
 * Sections from the PRD that don't yet have a backend
 * (Project Roadmap phase steps, Latest Activity feed, status enum,
 * deadline, budget range) are intentionally omitted rather than
 * mocked — keeps this page truthful while we slim the rest of the
 * crews surface area.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  IconArrowLeft,
  IconCalendar,
  IconClock,
  IconLoader2,
  IconMovie,
  IconSettings,
  IconUserPlus,
  IconUsers,
} from "@tabler/icons-react";
import { env } from "@/src/env";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { useCrewDetail, useCrewJobs, useCrewMembers } from "@/app/(site)/crews/_hooks/use-crew";
import { useProjectRoles } from "@/app/(site)/crews/_hooks/use-projects";

export default function CrewDetailV2Page() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const t = useTranslations("workspace");
  const tCrew = useTranslations("crew");

  const { data: crewDetail, isLoading: detailLoading } = useCrewDetail(id);
  const { data: crewMembers = [] } = useCrewMembers(id);
  const { data: crewJobs = [] } = useCrewJobs(id);
  const { data: projectRoles = [] } = useProjectRoles();
  const roleNameById = useMemo(
    () => new Map(projectRoles.map((r) => [r.id, r.name])),
    [projectRoles]
  );

  // Derived stats — same source as recruitment tab in workspace.
  const slotsTotal = useMemo(
    () => crewJobs.reduce((s, j) => s + Number(j.jobNumber ?? 0), 0),
    [crewJobs]
  );
  const slotsFilled = useMemo(
    () => crewJobs.reduce((s, j) => s + Number(j.filledNumber ?? 0), 0),
    [crewJobs]
  );

  if (detailLoading || !crewDetail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <IconLoader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  const heroBanner = resolveAsset(crewDetail.banner, env.BANNER_BASE_URL);
  const heroVideo = resolveAsset(crewDetail.video, env.OSS_BASE_URL);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero with cover image — banner + optional autoplay video. */}
      <div className="relative h-56 overflow-hidden md:h-72">
        {heroBanner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroBanner} alt={crewDetail.name} className="size-full object-cover" />
        ) : (
          <div className="size-full bg-secondary" />
        )}
        {heroVideo ? (
          <video
            src={heroVideo}
            poster={heroBanner || undefined}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 size-full object-cover"
            aria-hidden
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-screen-2xl px-6 pb-6">
          <Link
            href="/crews"
            className="mb-3 inline-flex items-center gap-1 text-sm text-white/70 transition-colors hover:text-white"
          >
            <IconArrowLeft className="size-4" />
            {tCrew("plaza")}
          </Link>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="mb-1 text-3xl font-bold text-white">{crewDetail.name}</h1>
              {crewDetail.description ? (
                <p className="line-clamp-2 max-w-2xl text-sm text-white/70">
                  {crewDetail.description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/crews/${id}/workspace`}
                className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10"
              >
                <IconMovie className="size-4" />
                {tCrew("workspace")}
              </Link>
              <Link
                href={`/crews/${id}/edit`}
                className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10"
              >
                <IconSettings className="size-4" />
                {tCrew("settings")}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Stats bar — backend currently surfaces members + slots; phase
          / deadline / budget are PRD design slots that need backend
          fields before they can light up. Hidden for now. */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-screen-2xl items-center gap-8 px-6 py-4">
          <div className="flex items-center gap-2">
            <IconUsers className="size-4 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">{t("wsMembers")}</div>
              <div className="text-sm font-semibold text-foreground">
                {crewMembers.length} {t("people")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconCalendar className="size-4 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">{t("wsSlots")}</div>
              <div className="text-sm font-semibold text-foreground">
                {slotsFilled}/{slotsTotal}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main content + sidebar */}
      <div className="mx-auto max-w-screen-2xl px-6 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main content */}
          <div className="space-y-6 lg:col-span-2">
            {/* Project Overview */}
            {crewDetail.description ? (
              <section className="rounded-xl border border-border bg-card p-5">
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  {tCrew("createDescriptionLabel")}
                </h2>
                <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {crewDetail.description}
                </p>
              </section>
            ) : null}

            {/* Open Positions */}
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold text-foreground">
                {tCrew("openPositions")}
              </h2>
              {crewJobs.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("noJobsYet")}
                </div>
              ) : (
                <div className="space-y-4">
                  {crewJobs.map((job) => {
                    const filled = Number(job.filledNumber ?? 0);
                    const total = Number(job.jobNumber ?? 0);
                    const full = total > 0 && filled >= total;
                    const roleLabel =
                      job.jobName ||
                      job.roleName ||
                      (job.roleId != null ? roleNameById.get(job.roleId) : undefined) ||
                      `#${job.roleId}`;
                    return (
                      <div
                        key={job.id}
                        className="rounded-lg border border-border bg-secondary/30 p-4"
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-foreground">
                              {roleLabel} × {total}
                            </h3>
                            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                              <span>
                                {filled}/{total} {t("filled")}
                              </span>
                              <span
                                className={cn(
                                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                  full
                                    ? "border-green-400/30 bg-green-400/10 text-green-400"
                                    : "border-amber-400/30 bg-amber-400/10 text-amber-400"
                                )}
                              >
                                <IconClock className="size-3" />
                                {full ? t("statusFull") : t("statusRecruiting")}
                              </span>
                            </div>
                          </div>
                          {!full ? (
                            <button
                              type="button"
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                              <IconUserPlus className="size-3.5" />
                              {tCrew("applyNow")}
                            </button>
                          ) : null}
                        </div>
                        {job.jobDescription ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {job.jobDescription}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            {/* Team Members */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <IconUsers className="size-4 text-primary" />
                {t("memberManagement")}
              </h3>
              {crewMembers.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  {t("noMembersYet")}
                </div>
              ) : (
                <div className="space-y-3">
                  {crewMembers.map((m) => {
                    const displayName = m.nick?.trim() || `User ${m.userId}`;
                    const initial = (displayName[0] ?? "?").toUpperCase();
                    const avatarUrl = m.avatar
                      ? `${env.USER_BASE_URL || env.OSS_BASE_URL}/${m.avatar.replace(/^\/+/, "")}`
                      : "";
                    const roleLabel =
                      (m.roleId != null && roleNameById.get(m.roleId)) || t("memberRoleUnknown");
                    return (
                      <div key={m.userId} className="flex items-center gap-3">
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatarUrl}
                            alt=""
                            className="size-9 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-medium text-foreground">
                            {initial}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-foreground">
                            {displayName}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{roleLabel}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Apply-to-join CTA — actual application flow needs backend
                wiring (the legacy /crews/[id] page has the apply
                modal). v2 shows the affordance only. */}
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <IconUserPlus className="size-4" />
              {tCrew("applyToJoin")}
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** Concat OSS key with its base URL, guarding the leading-slash case
 *  so `/foo/bar.jpg` doesn't produce a `//` join. Empty / missing
 *  inputs return "" so callers can branch cleanly. */
function resolveAsset(path: string | null | undefined, base: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
