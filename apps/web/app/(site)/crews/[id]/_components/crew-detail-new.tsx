"use client";

/**
 * Crew detail — primary layout. Renders when the new
 * `/project/crew/detail/:id` endpoint returns a record. Composition
 * follows fizzdragon-prd's `app/studio/[id]/page.tsx` reference.
 *
 * Real-data sources:
 *   - useCrewDetail   — hero (banner / video / name / description)
 *   - useCrewMembers  — team sidebar
 *   - useCrewJobs     — open positions list
 *   - useProjectRoles — role-name lookup
 *
 * Sections from the PRD that don't yet have a backend (Roadmap, Latest
 * Activity, deadline, budget range) are intentionally omitted rather
 * than mocked.
 *
 * Orchestrator: `app/(site)/crews/[id]/page.tsx` mounts this when the
 * new endpoint has data, and falls back to `crew-detail-legacy.tsx`
 * otherwise.
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
  IconUserPlus,
  IconUsers,
} from "@tabler/icons-react";
import { env } from "@/src/env";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useCrewDetail,
  useCrewMembers,
  usePublicCrewJobs,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useApplyToJob } from "@/app/(site)/crews/_hooks/use-applications";
import { useProjectRoles } from "@/app/(site)/crews/_hooks/use-projects";
import { useUserInfo } from "@/src/hooks/use-user";
import { ApiRequestError } from "@/src/lib/api";

export function CrewDetailNew() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const t = useTranslations("workspace");
  const tCrew = useTranslations("crew");

  const { data: crewDetail, isLoading: detailLoading } = useCrewDetail(id);
  const { data: crewMembers = [] } = useCrewMembers(id);
  // Public view — owner workspace uses `useCrewJobs` for the full list
  // (including closed / drafted). Visitors landing here only need the
  // public subset, served by `/project/crew/job/find/public/jobs`.
  const { data: crewJobs = [] } = usePublicCrewJobs(id);
  const { data: projectRoles = [] } = useProjectRoles();
  const { data: userInfo } = useUserInfo();
  const applyMutation = useApplyToJob();

  // Real ownership check — Workspace entry only shows for the user
  // whose id matches the crew's adminUserId. Null-safe so the button
  // stays hidden until both queries resolve.
  const currentUserId = userInfo?.id != null ? Number(userInfo.id) : undefined;
  const isOwner =
    currentUserId != null &&
    crewDetail?.adminUserId != null &&
    crewDetail.adminUserId === currentUserId;
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

  // "Hiring: ..." chips on the Project Overview card. Excludes closed
  // jobs (status === 9) and roles that are already fully staffed —
  // only show roles a visitor could still join.
  const hiringRoles = useMemo(
    () =>
      crewJobs
        .filter((job) => Number(job.status ?? 0) !== 9)
        .filter((job) => Number(job.filledNumber ?? 0) < Number(job.jobNumber ?? 0))
        .map((job) => ({
          jobId: job.id,
          label:
            job.jobName ||
            job.roleName ||
            (job.roleId != null ? roleNameById.get(job.roleId) : undefined) ||
            `#${job.roleId}`,
        })),
    [crewJobs, roleNameById]
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
            {/* Workspace entry — owner-only. Settings dropped: editing
                crew metadata lives inside the workspace header now. */}
            {isOwner ? (
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/crews/${id}/workspace`}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10"
                >
                  <IconMovie className="size-4" />
                  {tCrew("workspace")}
                </Link>
              </div>
            ) : null}
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
            {crewDetail.description || hiringRoles.length > 0 ? (
              <section className="rounded-xl border border-border bg-card p-5">
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  {tCrew("projectOverview")}
                </h2>
                {crewDetail.description ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {crewDetail.description}
                  </p>
                ) : null}
                {hiringRoles.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {hiringRoles.map((role) => (
                      <span
                        key={role.jobId}
                        className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-300"
                      >
                        {tCrew("hiring")}: {role.label}
                      </span>
                    ))}
                  </div>
                ) : null}
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
                              disabled={
                                applyMutation.isPending &&
                                applyMutation.variables?.jobId === Number(job.id)
                              }
                              onClick={() =>
                                applyMutation.mutate(
                                  { jobId: Number(job.id) },
                                  {
                                    onSuccess: () => {
                                      toast.success(tCrew("applySuccess"));
                                    },
                                    onError: (err) => {
                                      if (err instanceof ApiRequestError) {
                                        const detail =
                                          err.responseBody?.slice(0, 800) || err.message;
                                        toast.error(`HTTP ${err.status}`, {
                                          description: detail,
                                          duration: 10000,
                                        });
                                      } else {
                                        toast.error(
                                          err instanceof Error ? err.message : tCrew("applyFailed")
                                        );
                                      }
                                    },
                                  }
                                )
                              }
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
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
