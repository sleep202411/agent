"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  IconArrowLeft,
  IconClock,
  IconEdit,
  IconSend,
  IconEye,
  IconUsers,
  IconAlertCircle,
  IconChevronRight,
  IconBook,
  IconBriefcase,
  IconMovie,
  IconPackage,
  IconActivity,
  IconTrash,
  IconLoader2,
} from "@tabler/icons-react";
import { env } from "@/src/env";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  MEMBER_STATUS_META,
  useCrewWorkspace,
  useCrewDetail,
  useEpisodeMemberAction,
  useSubmitEpisodeToClient,
  useCrewMembers,
  useRemoveMember,
  type EpMember,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useProjectRoles } from "@/app/(site)/crews/_hooks/use-projects";
import { useDevIdentity } from "@/app/(site)/crews/_hooks/use-dev-identity";
import { EpisodeAccordion } from "@/app/(site)/crews/_components/episode-accordion";
import { DevIdentitySwitcher } from "@/app/(site)/crews/_components/dev-identity-switcher";
import { AddCrewMemberDialog } from "@/app/(site)/crews/_components/add-member-dialog";
import { CreateCrewJobDialog } from "@/app/(site)/crews/_components/create-crew-job-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const TABS = [
  { id: "overview", labelKey: "tabOverview", icon: IconBook },
  { id: "roles", labelKey: "tabRecruitment", icon: IconBriefcase },
  { id: "members", labelKey: "tabMembers", icon: IconUsers },
  { id: "episodes", labelKey: "tabEpisodes", icon: IconMovie },
  { id: "delivery", labelKey: "tabDelivery", icon: IconPackage },
  { id: "activity", labelKey: "tabActivity", icon: IconActivity },
] as const;

const ACTION_VARIANT: Record<string, string> = {
  approved: "ghost",
  submitted: "primary",
  in_progress: "warn",
  rejected: "ghost",
};

const BTN_STYLES: Record<string, string> = {
  primary: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20",
  warn: "bg-amber-400/10 text-amber-400 border-amber-400/20 hover:bg-amber-400/20",
  ghost: "bg-secondary text-muted-foreground border-border hover:text-foreground",
};

export default function CrewWorkspacePage() {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const params = useParams<{ id: string }>();
  const id = params.id;
  const identity = useDevIdentity();
  const isOwner = identity.kind === "owner";
  const selfMemberName = identity.kind === "member" ? identity.name : null;
  const [activeTab, setActiveTab] = useState("overview");
  const [completedTodos, setCompletedTodos] = useState<Set<number>>(new Set());

  const { data, isLoading } = useCrewWorkspace(id);
  const memberAction = useEpisodeMemberAction(id);
  const submitToClient = useSubmitEpisodeToClient(id);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [publishJobOpen, setPublishJobOpen] = useState(false);
  // Pending member-remove target. `null` = dialog closed.
  // `{userId, name}` = AlertDialog showing "remove {name}?".
  const [pendingRemove, setPendingRemove] = useState<{ userId: number; name: string } | null>(null);

  // Real crew detail (banner / video / description) for the visual
  // hero strip rendered above the header. Independent from the
  // workspace aggregate (which still mocks members / todos / etc.)
  // so the hero shows real assets even before backend ships the
  // richer endpoints.
  const { data: crewDetail } = useCrewDetail(id);

  // Real crew members + role taxonomy for the Members tab. Replaces
  // the legacy mock `currentEpMembers` everywhere downstream.
  const { data: crewMembers = [], isLoading: membersLoading } = useCrewMembers(id);
  const { data: projectRoles = [] } = useProjectRoles();
  const roleNameById = useMemo(
    () => new Map(projectRoles.map((r) => [r.id, r.name])),
    [projectRoles]
  );
  const removeMember = useRemoveMember();

  // Derived stats stay reactive to cache mutations.
  const pendingReviewCount = useMemo(
    () => data?.currentEpMembers.filter((m) => m.status === "submitted").length ?? 0,
    [data]
  );
  const inProgressCount = useMemo(
    () => data?.currentEpMembers.filter((m) => m.status === "in_progress").length ?? 0,
    [data]
  );

  if (isLoading || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  const s = data.studio;
  const currentEpMembers = data.currentEpMembers;
  const rolesProgress = data.rolesProgress;
  const todos = data.todos;
  const activityList = data.activity;
  const deliveryRecords = data.delivery;

  const handleMemberAction = (
    member: EpMember,
    action: "approve" | "reject" | "remind" | "submitReview"
  ) => {
    memberAction.mutate(
      { crewId: id, memberName: member.name, action },
      {
        onSuccess: () => {
          const labelKey =
            action === "approve"
              ? "tApproved"
              : action === "reject"
                ? "tRejected"
                : action === "remind"
                  ? "tReminderSent"
                  : "tSubmittedForReview";
          toast.success(t(labelKey, { name: member.name }));
        },
        onError: () => toast.error(t("tActionFailed")),
      }
    );
  };

  const handleSubmitToClient = () => {
    submitToClient.mutate(
      { crewId: id, episodeNumber: s.currentEpisode },
      {
        onSuccess: () => toast.success(t("tEpisodeSubmitted", { n: s.currentEpisode })),
        onError: () => toast.error(t("tActionFailed")),
      }
    );
  };

  const handleInvite = () => {
    setAddMemberOpen(true);
  };

  // Open the styled <AlertDialog> instead of the OS-native confirm —
  // the latter shows "localhost:3000 says" + light theme that clashes
  // with the rest of the app.
  const handleRemoveMember = (userId: number, displayName: string) => {
    setPendingRemove({ userId, name: displayName });
  };

  const confirmRemoveMember = () => {
    if (!pendingRemove) return;
    const { userId, name } = pendingRemove;
    removeMember.mutate(
      { crewId: id, userId },
      {
        onSuccess: () => {
          toast.success(t("removeMemberSuccess", { name }));
          setPendingRemove(null);
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : "";
          toast.error(msg || t("removeMemberFailed"));
          setPendingRemove(null);
        },
      }
    );
  };

  const toggleTodo = (i: number) => {
    setCompletedTodos((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  // Resolve OSS keys into renderable URLs. Guard the leading-slash
  // case so `/foo/bar.jpg` doesn't produce a `//` join with the base.
  const resolveAsset = (path: string | null | undefined, base: string): string => {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  };
  const heroBanner = resolveAsset(crewDetail?.banner, env.BANNER_BASE_URL);
  const heroVideo = resolveAsset(crewDetail?.video, env.OSS_BASE_URL);
  const heroDescription = (crewDetail?.description ?? "").trim();

  return (
    <div className="min-h-screen bg-background">
      {/* Visual hero strip — shows the crew's banner (and optional
          autoplay video loop) above the textual header. Sourced
          from `useCrewDetail` so it's the real backend data, not the
          mock workspace aggregate. Hidden when the crew has no
          banner yet (during a fresh load or detail-fetch failure)
          so we don't render an empty grey box. */}
      {heroBanner && (
        <div className="relative h-48 w-full overflow-hidden bg-black sm:h-64">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroBanner} alt="" className="absolute inset-0 size-full object-cover" />
          {heroVideo && (
            <video
              src={heroVideo}
              poster={heroBanner}
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              className="absolute inset-0 size-full object-cover"
              aria-hidden
            />
          )}
          {/* Bottom legibility scrim so the title bar below can blend
              into the hero without the banner stealing focus. */}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
          {/* Description overlay (if any) — bottom-left so it sits
              above the scrim and reads cleanly against the banner. */}
          {heroDescription && (
            <div className="absolute inset-x-0 bottom-3 px-6">
              <div className="mx-auto max-w-screen-xl">
                <p className="line-clamp-2 max-w-2xl text-sm text-white/90">{heroDescription}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="border-b border-border bg-card/50">
        <div className="mx-auto max-w-screen-xl px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Link
                  href="/crews"
                  className="mr-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <IconArrowLeft className="size-4" />
                </Link>
                <h1 className="text-xl font-black text-foreground">{s.name}</h1>
                <span className="rounded-full border border-blue-400/30 bg-blue-400/10 px-2 py-0.5 text-xs font-semibold text-blue-400">
                  {s.status}
                </span>
                <span className="rounded-full border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 text-xs font-semibold text-violet-400">
                  {s.type}
                </span>
                {s.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span>
                  {t("wsClient")}：<span className="font-medium text-foreground">{s.client}</span>
                </span>
                <span>
                  {t("wsProducer")}：
                  <span className="font-medium text-foreground">{s.producer}</span>
                </span>
                <span>
                  {t("wsCurrentEp")}：
                  <span className="font-medium text-foreground">
                    {t("epLabel", { n: s.currentEpisode })}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <IconClock className="size-3" />
                  {t("wsLastUpdated")}：{s.lastUpdated}
                </span>
              </div>
            </div>
            {isOwner && (
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/crews/${id}/edit`}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/70"
                >
                  <IconEdit className="size-3.5" /> {t("wsEditStudio")}
                </Link>
                <button
                  type="button"
                  disabled={submitToClient.isPending}
                  onClick={handleSubmitToClient}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <IconSend className="size-3.5" />{" "}
                  {submitToClient.isPending ? t("wsSubmitting") : t("wsSubmitClient")}
                </button>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="mt-4 flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
            {[
              { labelKey: "wsMembers", value: s.memberCount },
              { labelKey: "wsSlots", value: `${s.slotsFilled}/${s.slotsTotal}` },
              { labelKey: "wsEpParticipants", value: s.currentEpMembers },
              { labelKey: "wsTodo", value: s.todoCount, highlight: true },
            ].map((item) => (
              <div key={item.labelKey} className="flex items-center gap-1">
                <span
                  className={cn(
                    "text-sm font-black",
                    item.highlight ? "text-amber-400" : "text-foreground"
                  )}
                >
                  {item.value}
                </span>
                <span>{t(item.labelKey)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto flex max-w-screen-xl gap-5 px-6 py-6">
        {/* Sidebar */}
        <div className="w-36 shrink-0">
          <nav className="sticky top-6 space-y-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                  activeTab === tab.id
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <tab.icon className="size-3.5 shrink-0" />
                {t(tab.labelKey)}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Overview */}
          {activeTab === "overview" && (
            <>
              {/* Current episode */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-bold">
                    {t("wsCurrentEp")}：{t("epLabel", { n: s.currentEpisode })}
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab("episodes")}
                      className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                    >
                      <IconEye className="size-3.5" /> {t("viewCurrentEp")}
                    </button>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/70"
                    >
                      <IconUsers className="size-3.5" /> {t("configMembers")}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground">{t("colEpStatus")}</span>
                    <div className="mt-0.5 font-semibold text-blue-400">{t("epInProgress")}</div>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">{t("wsIncomplete")}</span>
                    <div className="mt-0.5 font-semibold text-amber-400">
                      {inProgressCount} {t("people")}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">{t("colPending")}</span>
                    <div className="mt-0.5 font-semibold text-foreground">{pendingReviewCount}</div>
                  </div>
                </div>
              </div>

              {/* Member status */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-bold">{t("epMemberStatus")}</h3>
                <div className="space-y-2">
                  {currentEpMembers.map((m) => {
                    const meta = MEMBER_STATUS_META[m.status];
                    const isPending = memberAction.isPending;
                    const isSelf = selfMemberName === m.name;
                    return (
                      <div
                        key={m.name}
                        className={cn(
                          "flex items-center justify-between border-b border-border/50 py-2 last:border-0",
                          isSelf && "rounded-lg bg-primary/5 px-2"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-bold text-foreground">
                            {m.name[0]}
                          </div>
                          <div>
                            <span className="text-sm font-medium text-foreground">{m.name}</span>
                            {isSelf && (
                              <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                                You
                              </span>
                            )}
                            <span className="ml-2 text-xs text-muted-foreground">/ {m.role}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-xs font-semibold",
                              m.color
                            )}
                          >
                            {t(meta.labelKey)}
                          </span>
                          {/* Owner-only review actions */}
                          {isOwner && m.status === "submitted" && (
                            <>
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => handleMemberAction(m, "approve")}
                                className={cn(
                                  "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
                                  BTN_STYLES.primary
                                )}
                              >
                                {t("actApprove")}
                              </button>
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => handleMemberAction(m, "reject")}
                                className="rounded-lg border border-red-400/20 bg-red-400/10 px-2.5 py-1 text-xs font-semibold text-red-400 transition-colors hover:bg-red-400/20 disabled:opacity-50"
                              >
                                {t("actReject")}
                              </button>
                            </>
                          )}
                          {isOwner && m.status === "in_progress" && (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleMemberAction(m, "remind")}
                              className={cn(
                                "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
                                BTN_STYLES.warn
                              )}
                            >
                              {t("actRemind")}
                            </button>
                          )}
                          {/* Member self-actions */}
                          {isSelf && (m.status === "in_progress" || m.status === "rejected") && (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleMemberAction(m, "submitReview")}
                              className={cn(
                                "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
                                BTN_STYLES.primary
                              )}
                            >
                              {t("actSubmitReview")}
                            </button>
                          )}
                          {/* Read-only View button for everyone else */}
                          {!isOwner && !isSelf && (
                            <button
                              type="button"
                              className={cn(
                                "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                                BTN_STYLES.ghost
                              )}
                            >
                              {t("actView")}
                            </button>
                          )}
                          {isOwner && (m.status === "approved" || m.status === "rejected") && (
                            <button
                              type="button"
                              className={cn(
                                "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                                BTN_STYLES.ghost
                              )}
                            >
                              {t("actView")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recruitment progress */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold">{t("recruitmentProgress")}</h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab("roles")}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {t("viewRecruitment")} <IconChevronRight className="size-3" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {rolesProgress.map((r) => (
                    <div
                      key={r.role}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold",
                        r.filled === r.total
                          ? "border-green-400/30 bg-green-400/10 text-green-400"
                          : "border-amber-400/30 bg-amber-400/10 text-amber-400"
                      )}
                    >
                      {r.role}{" "}
                      <span className="opacity-70">
                        {r.filled}/{r.total}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Todos */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
                  <IconAlertCircle className="size-4 text-amber-400" /> {t("todoItems")}
                </h3>
                <div className="space-y-1">
                  {todos.length === 0 ? (
                    <div className="py-2 text-sm text-muted-foreground">{t("noTodos")}</div>
                  ) : (
                    todos.map((todo, i) => {
                      const done = completedTodos.has(i);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => toggleTodo(i)}
                          className="group flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-secondary/40"
                        >
                          <div
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                              done
                                ? "border-green-400 bg-green-400 text-black"
                                : todo.urgent
                                  ? "border-red-400/50"
                                  : "border-amber-400/50"
                            )}
                          >
                            {done && <span className="text-[10px] font-bold">✓</span>}
                          </div>
                          <span
                            className={cn(
                              "flex-1",
                              done
                                ? "text-muted-foreground line-through"
                                : todo.urgent
                                  ? "text-foreground"
                                  : "text-foreground/80"
                            )}
                          >
                            {todo.text}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Activity */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-bold">{t("recentActivity")}</h3>
                <div className="space-y-0">
                  {activityList.map((a, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-border/50 py-2 text-sm last:border-0"
                    >
                      <span className="text-foreground/80">{a.text}</span>
                      <span className="ml-4 shrink-0 text-xs text-muted-foreground">{a.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Recruitment */}
          {activeTab === "roles" && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold">{t("tabRecruitment")}</h3>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => setPublishJobOpen(true)}
                    className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                  >
                    + {t("publishJob")}
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {rolesProgress.map((r) => (
                  <div
                    key={r.role}
                    className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3"
                  >
                    <div>
                      <div className="text-sm font-semibold text-foreground">{r.role}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {r.filled}/{r.total} {t("filled")}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            r.filled === r.total ? "bg-green-400" : "bg-amber-400"
                          )}
                          style={{ width: `${(r.filled / r.total) * 100}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs font-semibold",
                          r.filled === r.total
                            ? "border-green-400/30 bg-green-400/10 text-green-400"
                            : "border-amber-400/30 bg-amber-400/10 text-amber-400"
                        )}
                      >
                        {r.filled < r.total ? t("statusRecruiting") : t("statusFull")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Members — real backend list (`useCrewMembers`) joined with
              `useProjectRoles` to render the role label. Owner sees
              a "+ Add Member" CTA + per-row delete button; non-owners
              see a read-only list. */}
          {activeTab === "members" && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold">
                  {t("memberManagement")} · {crewMembers.length} {t("people")}
                </h3>
                {isOwner && (
                  <button
                    type="button"
                    onClick={handleInvite}
                    className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                  >
                    + {t("inviteMember")}
                  </button>
                )}
              </div>
              {membersLoading ? (
                <div className="flex h-32 items-center justify-center text-muted-foreground">
                  <IconLoader2 className="size-4 animate-spin" />
                </div>
              ) : crewMembers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                  {t("noMembersYet")}
                </div>
              ) : (
                <div className="space-y-2">
                  {crewMembers.map((m) => {
                    const displayName = m.nick?.trim() || `User ${m.userId}`;
                    const initial = (displayName[0] ?? "?").toUpperCase();
                    const avatarUrl = m.avatar
                      ? `${env.USER_BASE_URL || env.OSS_BASE_URL}/${m.avatar.replace(/^\/+/, "")}`
                      : "";
                    const roleLabel =
                      (m.roleId != null && roleNameById.get(m.roleId)) || t("memberRoleUnknown");
                    return (
                      <div
                        key={m.userId}
                        className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3"
                      >
                        <div className="flex items-center gap-3">
                          {avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={avatarUrl}
                              alt=""
                              className="size-8 rounded-xl object-cover"
                            />
                          ) : (
                            <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                              {initial}
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-semibold text-foreground">
                              {displayName}
                            </div>
                            <div className="text-xs text-muted-foreground">{roleLabel}</div>
                          </div>
                        </div>
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.userId, displayName)}
                            disabled={removeMember.isPending}
                            className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                            aria-label={t("removeMember")}
                            title={t("removeMember")}
                          >
                            <IconTrash className="size-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Episodes */}
          {activeTab === "episodes" && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">{t("episodeProgress")}</h3>
                <span className="text-xs text-muted-foreground">
                  {t("epTotal", { total: s.totalEpisodes, current: s.currentEpisode })}
                </span>
              </div>
              <EpisodeAccordion />
            </div>
          )}

          {/* Delivery */}
          {activeTab === "delivery" && (
            <div className="space-y-4">
              <a
                href={`/delivery/${id}`}
                className="group flex items-center justify-between rounded-xl border border-violet-400/30 bg-violet-400/5 px-5 py-4 transition-colors hover:bg-violet-400/10"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-400/10">
                    <IconPackage className="size-5 text-violet-400" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-foreground">{t("deliveryZone")}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t("deliveryZoneDesc")}
                    </div>
                  </div>
                </div>
                <IconChevronRight className="size-4 text-violet-400 transition-transform group-hover:translate-x-0.5" />
              </a>
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-bold">{t("deliveryHistory")}</h3>
                {deliveryRecords.map((d) => (
                  <div
                    key={d.ep}
                    className="flex items-center justify-between border-b border-border/50 py-2.5 last:border-0"
                  >
                    <div className="text-sm font-medium text-foreground">{d.ep}</div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{d.date}</span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs font-semibold",
                          d.ok
                            ? "border-green-400/30 bg-green-400/10 text-green-400"
                            : "border-amber-400/30 bg-amber-400/10 text-amber-400"
                        )}
                      >
                        {t(d.statusKey)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity */}
          {activeTab === "activity" && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-4 text-sm font-bold">{t("allActivity")}</h3>
              <div className="space-y-0">
                {activityList.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 border-b border-border/50 py-3 last:border-0"
                  >
                    <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/50" />
                    <div className="flex-1">
                      <div className="text-sm text-foreground/90">{a.text}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{a.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <DevIdentitySwitcher />
      <AddCrewMemberDialog open={addMemberOpen} onOpenChange={setAddMemberOpen} crewId={id} />
      <CreateCrewJobDialog open={publishJobOpen} onOpenChange={setPublishJobOpen} crewId={id} />

      {/* Member-remove confirmation. Project-styled (vs. window.confirm,
          which leaks "localhost:3000 says" + light theme). The
          destructive variant on the action button matches the
          delete-experience pattern in project-team-dialog. */}
      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(v) => {
          if (!v) setPendingRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeMember")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove ? t("removeMemberConfirm", { name: pendingRemove.name }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMember.isPending}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="solid"
              color="destructive"
              disabled={removeMember.isPending}
              onClick={(e) => {
                // Prevent default close-on-action so the dialog stays
                // open while the request is in flight; we'll close it
                // ourselves in onSuccess / onError.
                e.preventDefault();
                confirmRemoveMember();
              }}
            >
              {removeMember.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {tc("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
