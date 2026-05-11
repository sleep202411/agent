"use client";

/**
 * Crew detail — legacy layout. Used by the orchestrator at
 * `app/(site)/crews/[id]/page.tsx` as the fallback when the new
 * `/project/crew/detail/:id` endpoint has no record for this id.
 * Historical project rows that never made it into the new crew schema
 * still render here via the older `/project/query` chain in
 * `_hooks/use-projects.ts`.
 *
 * UI mirrors fizzdragon-web's `projectDetail.vue` PC layout: left
 * column lists open job tabs (with selected job description + apply
 * button), right column shows banner + project info + optional promo
 * video + team members.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { IconArrowLeft } from "@tabler/icons-react";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import {
  useApplyJob,
  useJobApplyStatus,
  useOwnerInfo,
  useProjectDetail,
  useProjectJobs,
  useProjectMembers,
  useProjectRoles,
  useProjectVideoLink,
  type ProjectJob,
} from "@/app/(site)/crews/_hooks/use-projects";

// Backend hasApply codes (from legacy commentary):
// -2 own project · -1 not yet · 0 pending · 1 approved · 2 rejected · 6 withdrawn
const APPLY_NOT_APPLIED = -1;
const APPLY_OWN_PROJECT = -2;

export function CrewDetailLegacy() {
  const t = useTranslations("crew.detail");
  const locale = useLocale() as Locale;
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const { data: project, isLoading: projectLoading } = useProjectDetail(projectId);
  const { data: jobs = [] } = useProjectJobs(projectId);
  const { data: roles = [] } = useProjectRoles();
  const { data: owner } = useOwnerInfo(project?.ownerId);
  const { data: videoLink } = useProjectVideoLink(projectId);
  const { data: members = [] } = useProjectMembers(projectId);

  const roleNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of roles) map.set(r.id, r.name);
    return map;
  }, [roles]);

  const [selectedJobIndex, setSelectedJobIndex] = useState(0);
  // Reset to first when the underlying jobs list changes (e.g. project switch).
  useEffect(() => {
    setSelectedJobIndex(0);
  }, [projectId]);
  const selectedJob: ProjectJob | undefined = jobs[selectedJobIndex];

  const { data: applyStatus } = useJobApplyStatus(selectedJob?.id);
  const applyMutation = useApplyJob();

  const canApply = applyStatus === APPLY_NOT_APPLIED;
  const applyLabel =
    applyStatus === APPLY_OWN_PROJECT
      ? t("ownProject")
      : canApply
        ? t("applyJoin")
        : t("alreadyApplied");

  const handleApply = () => {
    if (!selectedJob || !canApply || applyMutation.isPending) return;
    applyMutation.mutate(selectedJob.id, {
      onSuccess: () => toast.success(t("applySuccess")),
      onError: () => toast.error(t("applyFail")),
    });
  };

  if (projectLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <h1 className="text-xl font-bold text-foreground">{t("notFound")}</h1>
        <Link
          href={localizePath("/crews", locale)}
          className="text-sm text-primary hover:underline"
        >
          ← {t("back")}
        </Link>
      </div>
    );
  }

  const banner = project.bannerLink
    ? `${env.BANNER_BASE_URL}/${project.bannerLink}`
    : env.DEFAULT_COVER_URL;
  const ownerAvatar = owner?.avatar ? `${env.USER_BASE_URL}/${owner.avatar}` : "";

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-9 px-5 py-10 lg:grid-cols-[470px_1fr]">
        {/* ── Left: Job requirements ────────────────────────────────── */}
        <aside className="self-start rounded-xl border border-border bg-card p-6">
          <h2 className="mb-6 text-base font-semibold text-muted-foreground">{t("rolesTitle")}</h2>

          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noRoles")}</p>
          ) : (
            <>
              <div className="mb-6 flex flex-wrap gap-x-6 gap-y-2">
                {jobs.map((job, i) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setSelectedJobIndex(i)}
                    className={cn(
                      "border-b-2 py-1.5 text-sm transition-colors",
                      selectedJobIndex === i
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {roleNameById.get(job.roleId) ?? `#${job.roleId}`}
                  </button>
                ))}
              </div>

              {selectedJob && (
                <div className="space-y-5">
                  <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                    {selectedJob.jobDescription || ""}
                  </p>
                  <button
                    type="button"
                    onClick={handleApply}
                    disabled={!canApply || applyMutation.isPending}
                    className={cn(
                      "h-11 w-full rounded-xl text-sm font-semibold transition-colors",
                      canApply && !applyMutation.isPending
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "cursor-not-allowed bg-secondary text-muted-foreground"
                    )}
                  >
                    {applyLabel}
                  </button>
                </div>
              )}
            </>
          )}
        </aside>

        {/* ── Right: Project info / video / team ────────────────────── */}
        <div className="space-y-8">
          <Link
            href={localizePath("/crews", locale)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
            {t("back")}
          </Link>

          <section className="rounded-xl border border-border bg-card p-6">
            <div className="flex flex-col gap-6 md:flex-row">
              <div className="aspect-[4/3] w-full shrink-0 overflow-hidden rounded-lg bg-muted md:w-72">
                <img
                  src={banner}
                  alt={project.name}
                  className="size-full object-cover"
                  loading="lazy"
                />
              </div>

              <div className="flex flex-1 flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
                  {project.tags && project.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {project.tags.map((tag, i) => (
                        <span
                          key={`${tag}-${i}`}
                          className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {(owner?.nickName || ownerAvatar || owner?.userId != null) && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <UserAvatar
                      src={ownerAvatar}
                      seed={owner?.userId}
                      name={owner?.nickName}
                      className="size-7"
                    />
                    <span>{owner?.nickName}</span>
                  </div>
                )}

                {project.description && (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {project.description}
                  </p>
                )}

                {project.contact && (
                  <div className="text-sm text-muted-foreground">
                    <span>{t("contactLabel")}：</span>
                    <span className="text-foreground">{project.contact}</span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {videoLink && (
            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-4 text-base font-semibold text-muted-foreground">
                {t("promoVideo")}
              </h2>
              <div className="overflow-hidden rounded-lg bg-black">
                <video src={videoLink} controls className="aspect-video w-full" />
              </div>
            </section>
          )}

          {members.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-4 text-base font-semibold text-muted-foreground">{t("team")}</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {members.map((m, i) => {
                  const av = m.avatar ? `${env.USER_BASE_URL}/${m.avatar}` : "";
                  const role = m.roleId != null ? roleNameById.get(m.roleId) : m.roleName;
                  return (
                    <div
                      key={m.userId ?? m.id ?? i}
                      className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3"
                    >
                      {av ? (
                        <img
                          src={av}
                          alt=""
                          className="size-9 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <div className="size-9 shrink-0 rounded-full bg-muted" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {m.nickName ?? "—"}
                        </div>
                        {role && (
                          <div className="truncate text-xs text-muted-foreground">{role}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
