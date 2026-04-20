"use client";

import { useState } from "react";
import Link from "next/link";
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
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  MOCK_WORKSPACE,
  CURRENT_EP_MEMBERS,
  ROLES_PROGRESS,
  TODOS,
  ACTIVITY_LIST,
  DELIVERY_RECORDS,
  MEMBER_STATUS_META,
} from "@/app/(site)/crews/_components/workspace-mock";
import { EpisodeAccordion } from "@/app/(site)/crews/_components/episode-accordion";

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

export default function CrewWorkspacePage({ id }: { id: string }) {
  const t = useTranslations("workspace");
  const [activeTab, setActiveTab] = useState("overview");
  const s = MOCK_WORKSPACE;

  return (
    <div className="min-h-screen bg-background">
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
            <div className="flex shrink-0 items-center gap-2">
              <a
                href={`/crews/${id}/edit`}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/70"
              >
                <IconEdit className="size-3.5" /> {t("wsEditStudio")}
              </a>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <IconSend className="size-3.5" /> {t("wsSubmitClient")}
              </button>
            </div>
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
                    <div className="mt-0.5 font-semibold text-amber-400">2 {t("people")}</div>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">{t("deadlineLabel")}</span>
                    <div className="mt-0.5 font-semibold text-foreground">2026-03-30</div>
                  </div>
                </div>
              </div>

              {/* Member status */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-bold">{t("epMemberStatus")}</h3>
                <div className="space-y-2">
                  {CURRENT_EP_MEMBERS.map((m) => {
                    const variant = ACTION_VARIANT[m.status];
                    const meta = MEMBER_STATUS_META[m.status];
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
                              m.color
                            )}
                          >
                            {t(meta.labelKey)}
                          </span>
                          <button
                            type="button"
                            className={cn(
                              "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                              BTN_STYLES[variant]
                            )}
                          >
                            {m.status === "submitted"
                              ? t("actReview")
                              : m.status === "in_progress"
                                ? t("actRemind")
                                : t("actView")}
                          </button>
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
                  {ROLES_PROGRESS.map((r) => (
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
                <div className="space-y-2">
                  {TODOS.map((todo, i) => (
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
                <h3 className="mb-3 text-sm font-bold">{t("recentActivity")}</h3>
                <div className="space-y-0">
                  {ACTIVITY_LIST.map((a, i) => (
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
              <h3 className="mb-4 text-sm font-bold">{t("tabRecruitment")}</h3>
              <div className="space-y-3">
                {ROLES_PROGRESS.map((r) => (
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

          {/* Members */}
          {activeTab === "members" && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold">
                  {t("memberManagement")} · {s.memberCount} {t("people")}
                </h3>
                <button
                  type="button"
                  className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                >
                  + {t("inviteMember")}
                </button>
              </div>
              <div className="space-y-2">
                {CURRENT_EP_MEMBERS.map((m) => (
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
                        m.color
                      )}
                    >
                      {t(MEMBER_STATUS_META[m.status].labelKey)}
                    </span>
                  </div>
                ))}
              </div>
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
                {DELIVERY_RECORDS.map((d) => (
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
                {[...ACTIVITY_LIST, ...ACTIVITY_LIST].map((a, i) => (
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
