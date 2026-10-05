"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PRESET_POSITIONS, type PresetPositionValue } from "@repo/shared/crew";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  useCrewDetail,
  useCrewMembers,
  useCrewInvitations,
  useUpdateMember,
} from "../_hooks/use-crew";
import { useCrewEpisodes } from "../_hooks/use-production";
import { useCrewPermissions } from "../_hooks/use-crew-permissions";
import { useUserDisplays, displayNameOf } from "../_hooks/use-users";
import { AddCrewMemberDialog } from "./add-member-dialog";
import { CreateCrewJobDialog } from "./create-crew-job-dialog";
import { EpisodeTemplatePreview } from "../[id]/workspace/_components/tasks/episode-template-preview";
import { CrewTasksTab } from "../[id]/workspace/_components/tasks/crew-tasks-tab";
import { CrewSectionNavigation } from "./crew-section-navigation";

export function CrewSetup({ crewId }: { crewId: string }) {
  const { user } = useCurrentUser();
  return <SetupSession key={`${crewId}:${user?.id ?? "guest"}`} crewId={crewId} />;
}
function SetupSession({ crewId }: { crewId: string }) {
  const t = useTranslations("crewSetup"),
    roleT = useTranslations("crewRoles");
  const locale = useLocale() as Locale;
  const detail = useCrewDetail(crewId),
    roster = useCrewMembers(crewId);
  const permissions = useCrewPermissions(crewId);
  const canInvite = permissions.can("members.invite");
  const invitations = useCrewInvitations(crewId, canInvite);
  const {
    fetchNextPage: fetchMoreInvitations,
    hasNextPage: hasMoreInvitations,
    isFetching: fetchingInvitations,
    isError: invitationError,
  } = invitations;
  useEffect(() => {
    if (!canInvite || !hasMoreInvitations || fetchingInvitations || invitationError) return;
    void fetchMoreInvitations();
  }, [canInvite, hasMoreInvitations, fetchingInvitations, invitationError, fetchMoreInvitations]);
  const invitationsIncomplete = canInvite && (fetchingInvitations || hasMoreInvitations);
  const invitationsFailed = canInvite && invitationError;
  const episodes = useCrewEpisodes(crewId, permissions.can("tasks.manage"));
  const update = useUpdateMember(crewId);
  const members = roster.data.filter((member) => member.status === "active");
  const displays = useUserDisplays(members.map((member) => member.userId));
  const [step, setStep] = useState(1);
  const [invite, setInvite] = useState<PresetPositionValue | null>(null);
  const [publish, setPublish] = useState<{ role?: string; taskId?: string } | null>(null);
  const [recruitRole, setRecruitRole] = useState("");
  const [episode, setEpisode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const ready =
    Boolean(detail.data) &&
    !detail.isError &&
    !roster.isError &&
    !roster.isFetching &&
    !roster.hasNextPage;
  const canManage = permissions.can("members.manage") && permissions.can("tasks.manage");
  const unfilledRoles = PRESET_POSITIONS.filter(
    (role) => !members.some((member) => member.positions.some((p) => p.categoryKey === role.value))
  );
  async function addRole(role: PresetPositionValue, memberId: string) {
    const member = members.find((m) => m.id === memberId);
    if (
      !member ||
      !ready ||
      !canManage ||
      lock.current ||
      member.positions.some((p) => p.categoryKey === role)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await update.mutateAsync({
        memberId,
        input: {
          expectedVersion: member.version,
          positions: [
            ...member.positions.map((p) => ({ categoryKey: p.categoryKey, title: p.title })),
            { categoryKey: role },
          ],
        },
      });
      await roster.refetch();
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const reload = () => {
    void detail.refetch();
    void roster.refetch();
    void episodes.refetch();
    if (canInvite) void invitations.refetch();
  };
  return (
    <main className="mx-auto max-w-screen-xl space-y-4 px-4 pb-4 pt-8 sm:px-6">
      <CrewSectionNavigation active="mine" showDashboard={false} />
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p>{detail.data?.name}</p>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </header>
      <ol className="grid gap-3 sm:grid-cols-3">
        {[1, 2, 3].map((value) => (
          <li
            key={value}
            aria-current={step === value ? "step" : undefined}
            className={`rounded-xl p-3 ${step === value ? "bg-muted" : "text-muted-foreground"}`}
          >
            {value}. {t(`step${value}`)}
          </li>
        ))}
      </ol>
      {!ready || detail.isFetching || !canManage ? (
        <div role="status" className="space-y-3">
          <p>
            {detail.error?.message || roster.error?.message || t(!canManage ? "access" : "loading")}
          </p>
          <Button onClick={reload}>{t("refresh")}</Button>
        </div>
      ) : (
        <>
          {error && <p role="alert">{error}</p>}
          {step === 1 && (
            <section className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("membersHint")}</p>
              {(invitationsFailed || invitationsIncomplete) && (
                <p role="status">{invitations.error?.message || t("loading")}</p>
              )}
              <div className="grid items-start gap-2 md:grid-cols-2">
                {PRESET_POSITIONS.map((role) => {
                  const assigned = members.filter((member) =>
                    member.positions.some((p) => p.categoryKey === role.value)
                  );
                  const pending =
                    !canInvite || invitationsFailed || invitationsIncomplete
                      ? []
                      : invitations.data.filter(
                          (item) =>
                            item.positionCategory === role.value &&
                            item.status === "pending" &&
                            Date.parse(item.expiresAt) > Date.now()
                        );
                  const candidates = members.filter(
                    (member) => !assigned.includes(member) && member.positions.length < 12
                  );
                  return (
                    <details
                      key={role.value}
                      name="crew-setup-role"
                      className="rounded-lg bg-muted/30"
                    >
                      <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">
                        <span className="font-medium">{roleT(role.value)}</span>
                        <span className="mt-1 block pl-4 text-muted-foreground">
                          {assigned
                            .map((member) => displayNameOf(member.userId, displays))
                            .join(" · ") || t("vacant")}
                        </span>
                        {pending.length > 0 && (
                          <span className="mt-1 block pl-4 text-muted-foreground">
                            {t("pending", { count: pending.length })}
                          </span>
                        )}
                      </summary>
                      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                        {candidates.length > 0 && (
                          <NativeSelect
                            className="min-w-0 flex-1"
                            aria-label={t("addToRole", { role: roleT(role.value) })}
                            value=""
                            disabled={busy}
                            onChange={(value) => void addRole(role.value, value)}
                          >
                            <NativeSelectOption value="">{t("chooseMember")}</NativeSelectOption>
                            {candidates.map((member) => (
                              <NativeSelectOption key={member.id} value={member.id}>
                                {displayNameOf(member.userId, displays)}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        )}
                        {canInvite && (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => setInvite(role.value)}
                          >
                            {t("invite")}
                          </Button>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={reload}>
                  {t("refresh")}
                </Button>
                <Button
                  disabled={busy || invitationsFailed || invitationsIncomplete}
                  onClick={() => setStep(2)}
                >
                  {t("confirmMembers")}
                </Button>
              </div>
            </section>
          )}
          {step === 2 && (
            <section className="space-y-4">
              <h2 className="font-semibold">{t("step2")}</h2>
              <p className="text-sm text-muted-foreground">{t("tasksHint")}</p>
              {episodes.isError ? (
                <p role="alert">{episodes.error.message}</p>
              ) : (
                episodes.data
                  ?.filter((item) => item.status !== "cancelled")
                  .map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/30 p-4"
                    >
                      <span className="flex-1">{item.title}</span>
                      <span>{t("taskCount", { count: item.taskProgress.total })}</span>
                      <Button disabled={episodes.isFetching} onClick={() => setEpisode(item.id)}>
                        {t("initialize")}
                      </Button>
                    </div>
                  ))
              )}
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={() => setStep(1)}>
                  {t("back")}
                </Button>
                <Button variant="outline" onClick={reload}>
                  {t("refresh")}
                </Button>
                <Button
                  disabled={episodes.isError || episodes.isFetching || !episodes.data}
                  onClick={() => setStep(3)}
                >
                  {t("toAssignments")}
                </Button>
              </div>
            </section>
          )}
          {step === 3 && (
            <section className="space-y-5">
              <h2 className="font-semibold">{t("step3")}</h2>
              <p className="text-sm text-muted-foreground">{t("assignHint")}</p>
              {permissions.can("openings.manage") && unfilledRoles.length > 0 && (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="grid w-full gap-2 text-xs font-medium sm:w-64">
                    {t("recruitRoleLabel")}
                    <NativeSelect value={recruitRole} onChange={setRecruitRole}>
                      <NativeSelectOption value="">{t("chooseRole")}</NativeSelectOption>
                      {unfilledRoles.map((role) => (
                        <NativeSelectOption key={role.value} value={role.value}>
                          {roleT(role.value)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <Button
                    variant="outline"
                    disabled={!unfilledRoles.some((role) => role.value === recruitRole)}
                    onClick={() => setPublish({ role: recruitRole })}
                  >
                    {t("recruitRoleAction")}
                  </Button>
                </div>
              )}
              <div className="h-[75dvh] min-h-96">
                <CrewTasksTab
                  crewId={crewId}
                  crewName={detail.data!.name}
                  crewSummary={detail.data!.description}
                  crewLogo={detail.data!.logo}
                  crewVersion={detail.data!.version}
                  members={members}
                  isOwner={permissions.can("tasks.manage")}
                  canCreate={permissions.can("tasks.manage")}
                  canInvite={permissions.can("tasks.manage") && permissions.can("members.invite")}
                  canReview={permissions.can("tasks.review")}
                  canSubmitAssigned={permissions.can("tasks.submit_assigned")}
                  canComment={permissions.can("tasks.comment")}
                  canEditCrewInfo={permissions.can("crew.settings.manage")}
                  viewerUserId={permissions.effectiveUserId}
                  onPublishTask={
                    permissions.can("openings.manage")
                      ? (taskId) => setPublish({ taskId })
                      : undefined
                  }
                />
              </div>
              <Button variant="outline" onClick={() => setStep(2)}>
                {t("back")}
              </Button>
            </section>
          )}
        </>
      )}
      <Link
        className="inline-flex min-h-11 items-center underline"
        href={localizePath(`/crews/${crewId}/workspace`, locale)}
      >
        {t("workspace")}
      </Link>
      {invite && ready && canManage && canInvite && (
        <AddCrewMemberDialog
          open
          crewId={crewId}
          positionCategory={invite}
          canGrantPolicies={permissions.can("members.permissions.manage")}
          onOpenChange={(open) => {
            if (!open) setInvite(null);
          }}
        />
      )}
      {episode && ready && canManage && (
        <EpisodeTemplatePreview
          crewId={crewId}
          episodeId={episode}
          onClose={() => {
            setEpisode(null);
            void episodes.refetch();
          }}
        />
      )}
      {publish && ready && permissions.can("openings.manage") && (
        <CreateCrewJobDialog
          key={JSON.stringify(publish)}
          open
          crewId={crewId}
          initialPositionType={publish.role}
          initialTaskId={publish.taskId}
          onOpenChange={(open) => {
            if (!open) setPublish(null);
          }}
        />
      )}
    </main>
  );
}
