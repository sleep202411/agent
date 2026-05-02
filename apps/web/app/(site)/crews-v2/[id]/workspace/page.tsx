"use client";

/**
 * `/crews-v2/[id]/workspace` — Studio Workspace v2.
 *
 * Direct port of fizzdragon-prd `app/studio/[id]/workspace/page.tsx`. Mock
 * data only. lucide → tabler; PRD-specific utility classes inlined as
 * plain Tailwind; all UI strings via the feature-private `useT()` hook.
 * Internal links target `/crews-v2/...` rather than PRD's `/studio/...`.
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  IconArrowLeft,
  IconUsers,
  IconChevronRight,
  IconPackage,
  IconEdit,
  IconSend,
  IconEye,
  IconAlertCircle,
  IconClock,
  IconMovie,
  IconBriefcase,
  IconActivity,
  IconBook,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useT } from "../../_hooks/use-t";
import {
  WORKSPACE_STUDIO,
  WORKSPACE_CURRENT_EP_MEMBERS,
  WORKSPACE_ROLES_PROGRESS,
  WORKSPACE_TODOS,
  WORKSPACE_ACTIVITY,
  WORKSPACE_DELIVERY_HISTORY,
  type MemberStatus,
} from "../../_data/mock";
import { EpisodeAccordion } from "../../_components/episode-accordion";
import type { CrewsV2Key } from "../../_data/i18n";

const TABS = [
  { id: "overview", labelKey: "wsTabOverview" as const, Icon: IconBook },
  { id: "roles", labelKey: "wsTabRecruitment" as const, Icon: IconBriefcase },
  { id: "members", labelKey: "wsTabMembers" as const, Icon: IconUsers },
  { id: "episodes", labelKey: "wsTabEpisodes" as const, Icon: IconMovie },
  { id: "delivery", labelKey: "wsTabDelivery" as const, Icon: IconPackage },
  { id: "activity", labelKey: "wsTabActivity" as const, Icon: IconActivity },
] as const;

const MEMBER_STATUS_META: Record<MemberStatus, { labelKey: CrewsV2Key; color: string }> = {
  approved: {
    labelKey: "wsMemberApproved",
    color: "text-green-400 bg-green-400/10 border-green-400/30",
  },
  submitted: {
    labelKey: "wsMemberSubmitted",
    color: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  },
  in_progress: {
    labelKey: "wsMemberInProduction",
    color: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  },
  rejected: {
    labelKey: "wsMemberRejected",
    color: "text-red-400 bg-red-400/10 border-red-400/30",
  },
};

type ActionVariant = "primary" | "warn" | "ghost";

const MEMBER_ACTION: Record<MemberStatus, { labelKey: CrewsV2Key; variant: ActionVariant }> = {
  approved: { labelKey: "wsActionView", variant: "ghost" },
  submitted: { labelKey: "wsActionReview", variant: "primary" },
  in_progress: { labelKey: "wsActionRemind", variant: "warn" },
  rejected: { labelKey: "wsActionView", variant: "ghost" },
};

const ACTION_STYLES: Record<ActionVariant, string> = {
  primary: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20",
  warn: "bg-amber-400/10 text-amber-400 border-amber-400/20 hover:bg-amber-400/20",
  ghost: "bg-secondary text-muted-foreground border-border hover:text-foreground",
};

function ActionBtn({ variant, children }: { variant: ActionVariant; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
        ACTION_STYLES[variant]
      )}
    >
      {children}
    </button>
  );
}

export default function WorkspacePage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("overview");
  const s = WORKSPACE_STUDIO;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top Header Banner ── */}
      <div className="border-b border-border bg-card/50">
        <div className="mx-auto max-w-screen-xl px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            {/* Left */}
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Link
                  href={`/crews-v2/${id}`}
                  className="mr-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <IconArrowLeft className="size-4" />
                </Link>
                <h1 className="text-xl font-black text-foreground">{s.name}</h1>
                <span className="rounded-full border border-blue-400/30 bg-blue-400/10 px-2 py-0.5 text-xs font-semibold text-blue-400">
                  {t("statusInProduction")}
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
                  {t("wsClientLabel")}
                  <span className="ml-1 font-medium text-foreground">{s.client}</span>
                </span>
                <span>
                  {t("wsProducerLabel")}
                  <span className="ml-1 font-medium text-foreground">{s.producer}</span>
                </span>
                <span>
                  {t("wsCurrentEpisodeLabel")}
                  <span className="ml-1 font-medium text-foreground">
                    {t("wsEpisodeShort", { n: s.currentEpisode })}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <IconClock className="size-3" /> {t("wsLastUpdatedLabel")} {s.lastUpdated}
                </span>
              </div>
            </div>
            {/* Right actions */}
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/crews-v2/${id}/edit`}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/70"
              >
                <IconEdit className="size-3.5" /> {t("wsEditStudio")}
              </Link>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <IconSend className="size-3.5" /> {t("wsSubmitToClient")}
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-4 flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
            {[
              { labelKey: "wsStatMembers" as const, value: String(s.memberCount) },
              {
                labelKey: "wsStatSlots" as const,
                value: `${s.slotsFilled}/${s.slotsTotal}`,
              },
              {
                labelKey: "wsStatCurrentEpParticipants" as const,
                value: String(s.currentEpMembers),
              },
              {
                labelKey: "wsStatTodo" as const,
                value: String(s.todoCount),
                highlight: true,
              },
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

      {/* ── Body: Sidebar + Content ── */}
      <div className="mx-auto flex max-w-screen-xl gap-5 px-6 py-6">
        {/* Sidebar nav */}
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
                <tab.Icon className="size-3.5 shrink-0" />
                {t(tab.labelKey)}
              </button>
            ))}
          </nav>
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* ── Overview ── */}
          {activeTab === "overview" && (
            <>
              {/* Current Episode Card */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-bold">
                    {t("wsCurrentEpCardTitle", { n: s.currentEpisode })}
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab("episodes")}
                      className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                    >
                      <IconEye className="size-3.5" /> {t("wsViewCurrentEpisode")}
                    </button>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/70"
                    >
                      <IconUsers className="size-3.5" /> {t("wsConfigureMembers")}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground">{t("wsOvStatus")}</span>
                    <div className="mt-0.5 font-semibold text-blue-400">
                      {t("wsOvStatusInProduction")}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      {t("wsOvRemainingIncomplete")}
                    </span>
                    <div className="mt-0.5 font-semibold text-amber-400">
                      {t("wsOvPeopleCount", { n: s.remainingIncomplete })}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">{t("wsOvDeadline")}</span>
                    <div className="mt-0.5 font-semibold text-foreground">{s.deadline}</div>
                  </div>
                </div>
              </div>

              {/* Current Ep Members */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-bold">{t("wsCurrentEpMembersTitle")}</h3>
                <div className="space-y-2">
                  {WORKSPACE_CURRENT_EP_MEMBERS.map((m) => {
                    const meta = MEMBER_STATUS_META[m.status];
                    const action = MEMBER_ACTION[m.status];
                    return (
                      <div
                        key={m.name}
                        className="flex items-center justify-between border-b border-border/50 py-2 last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-bold text-foreground">
                            {m.name[0]}
                          </div>
                          <div>
                            <span className="text-sm font-medium text-foreground">{m.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">/ {m.role}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-xs font-semibold",
                              meta.color
                            )}
                          >
                            {t(meta.labelKey)}
                          </span>
                          <ActionBtn variant={action.variant}>{t(action.labelKey)}</ActionBtn>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Roles Progress */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold">{t("wsRecruitmentProgressTitle")}</h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab("roles")}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {t("wsViewRecruitmentLink")} <IconChevronRight className="size-3" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {WORKSPACE_ROLES_PROGRESS.map((r) => (
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
                  <IconAlertCircle className="size-4 text-amber-400" /> {t("wsTodosTitle")}
                </h3>
                <div className="space-y-2">
                  {WORKSPACE_TODOS.map((todo, i) => (
                    <div key={i} className="flex items-center gap-2.5 py-1.5 text-sm">
                      <div
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          todo.urgent ? "bg-red-400" : "bg-amber-400"
                        )}
                      />
                      <span className={todo.urgent ? "text-foreground" : "text-foreground/80"}>
                        {todo.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Activity */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-bold">{t("wsRecentActivityTitle")}</h3>
                <div className="space-y-0">
                  {WORKSPACE_ACTIVITY.map((a, i) => (
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

          {/* ── Recruitment ── */}
          {activeTab === "roles" && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-4 text-sm font-bold">{t("wsTabRecruitment")}</h3>
              <div className="space-y-3">
                {WORKSPACE_ROLES_PROGRESS.map((r) => (
                  <div
                    key={r.role}
                    className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3"
                  >
                    <div>
                      <div className="text-sm font-semibold text-foreground">{r.role}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t("wsFilledSuffix", { filled: r.filled, total: r.total })}
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
                      {r.filled < r.total ? (
                        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-xs font-semibold text-amber-400">
                          {t("wsRoleRecruiting")}
                        </span>
                      ) : (
                        <span className="rounded-full border border-green-400/30 bg-green-400/10 px-2 py-0.5 text-xs font-semibold text-green-400">
                          {t("wsRoleFull")}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Members ── */}
          {activeTab === "members" && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold">
                  {t("wsMemberMgmtTitle", { n: s.memberCount })}
                </h3>
                <button
                  type="button"
                  className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                >
                  {t("wsInviteMember")}
                </button>
              </div>
              <div className="space-y-2">
                {WORKSPACE_CURRENT_EP_MEMBERS.map((m) => {
                  const meta = MEMBER_STATUS_META[m.status];
                  return (
                    <div
                      key={m.name}
                      className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                          {m.name[0]}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-foreground">{m.name}</div>
                          <div className="text-xs text-muted-foreground">{m.role}</div>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs font-semibold",
                          meta.color
                        )}
                      >
                        {t(meta.labelKey)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Episodes ── */}
          {activeTab === "episodes" && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">{t("wsEpisodeProgressTitle")}</h3>
                <span className="text-xs text-muted-foreground">
                  {t("wsEpisodeProgressSubtitle", {
                    total: s.totalEpisodes,
                    current: s.currentEpisode,
                  })}
                </span>
              </div>
              <EpisodeAccordion />
            </div>
          )}

          {/* ── Delivery ── */}
          {activeTab === "delivery" && (
            <div className="space-y-4">
              <Link
                href={`/crews-v2/${id}/delivery`}
                className="group flex items-center justify-between rounded-xl border border-violet-400/30 bg-violet-400/5 px-5 py-4 transition-colors hover:bg-violet-400/10"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-400/10">
                    <IconPackage className="size-5 text-violet-400" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-foreground">
                      {t("wsDeliveryZoneTitle")}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t("wsDeliveryZoneDesc")}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-400">
                    {t("wsDeliveryPendingReceipt")}
                  </span>
                  <IconChevronRight className="size-4 text-violet-400 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-bold">{t("wsDeliveryHistoryTitle")}</h3>
                {WORKSPACE_DELIVERY_HISTORY.map((d) => (
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
                          d.status === "Client Confirmed"
                            ? "border-green-400/30 bg-green-400/10 text-green-400"
                            : "border-amber-400/30 bg-amber-400/10 text-amber-400"
                        )}
                      >
                        {d.status === "Client Confirmed"
                          ? t("wsDeliveryClientConfirmed")
                          : t("wsDeliveryRevising")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Activity ── */}
          {activeTab === "activity" && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-4 text-sm font-bold">{t("wsAllActivityTitle")}</h3>
              <div className="space-y-0">
                {[...WORKSPACE_ACTIVITY, ...WORKSPACE_ACTIVITY].map((a, i) => (
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
    </div>
  );
}
