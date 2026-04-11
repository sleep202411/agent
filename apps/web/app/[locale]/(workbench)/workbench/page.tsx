import { useMemo, useState } from "react";
import {
  IconLayoutDashboard,
  IconTarget,
  IconClock,
  IconCircleCheck,
  IconFileText,
  IconAlertTriangle,
  IconBolt,
  IconChevronRight,
  IconBriefcase,
  IconCalendar,
  IconUsers,
  IconShield,
  IconBell,
  IconAlertCircle,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  MOCK_TASKS,
  MOCK_MY_CREWS,
  TASK_STATUS_CONFIG,
  STATUS_FILTERS,
} from "@/components/workbench/workbench-mock";

export default function WorkbenchPage() {
  const t = useTranslations("workbench");
  const [statusFilter, setStatusFilter] = useState("all");

  const urgentTasks = useMemo(() => MOCK_TASKS.filter((t) => t.urgent), []);
  const filteredTasks = useMemo(
    () => MOCK_TASKS.filter((t) => statusFilter === "all" || t.status === statusFilter),
    [statusFilter]
  );

  const stats = {
    total: MOCK_TASKS.length,
    inProgress: MOCK_TASKS.filter((t) => t.status === "in_progress").length,
    pending: MOCK_TASKS.filter((t) => t.status === "pending_review").length,
    toPickUp: MOCK_TASKS.filter((t) => t.status === "to_pick_up").length,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="border-b border-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
        <div className="mx-auto max-w-screen-2xl px-6 py-8">
          <h1 className="flex items-center gap-3 text-3xl font-bold text-foreground">
            <IconLayoutDashboard className="size-8 text-primary" />
            {t("title")}
          </h1>
          <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>

          {/* Stats */}
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {[
              {
                labelKey: "statusInProgress",
                value: stats.inProgress,
                icon: IconTarget,
                color: "text-blue-400",
              },
              {
                labelKey: "statusPendingReview",
                value: stats.pending,
                icon: IconClock,
                color: "text-amber-400",
              },
              {
                labelKey: "statusToPickUp",
                value: stats.toPickUp,
                icon: IconCircleCheck,
                color: "text-violet-400",
              },
              {
                labelKey: "totalTasks",
                value: stats.total,
                icon: IconFileText,
                color: "text-foreground",
              },
            ].map((s) => (
              <div
                key={s.labelKey}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2"
              >
                <s.icon className={cn("size-4", s.color)} />
                <span className="text-sm text-muted-foreground">{t(s.labelKey)}</span>
                <span className="text-lg font-black text-foreground">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl px-6 py-6">
        <div className="flex gap-6">
          {/* Main */}
          <div className="min-w-0 flex-1">
            {/* Urgent */}
            {urgentTasks.length > 0 && (
              <div className="mb-6">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-400">
                  <IconAlertTriangle className="size-4" />
                  {t("urgentTasks")}
                </h2>
                <div className="space-y-2">
                  {urgentTasks.map((task) => (
                    <a
                      key={task.id}
                      href={`/tasks/${task.id}`}
                      className="flex items-center gap-4 rounded-xl border-2 border-red-400/30 bg-red-400/5 p-4 transition-all hover:shadow-md"
                    >
                      <IconBolt className="size-5 shrink-0 text-red-400" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{task.title}</span>
                          <span className="rounded border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-xs text-red-400">
                            {t(TASK_STATUS_CONFIG[task.status].labelKey)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{task.crew}</span>
                          <span className="font-medium text-red-400">
                            {t("due")}: {task.deadline}
                          </span>
                        </div>
                      </div>
                      <IconChevronRight className="size-5 shrink-0 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Task list */}
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">{t("allTasks")}</h2>
                <div className="flex gap-2">
                  {STATUS_FILTERS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setStatusFilter(s.value)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        statusFilter === s.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      )}
                    >
                      {t(s.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                {filteredTasks.map((task) => {
                  const statusConf = TASK_STATUS_CONFIG[task.status];
                  return (
                    <a
                      key={task.id}
                      href={`/tasks/${task.id}`}
                      className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-md"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{task.title}</span>
                          <span
                            className={cn(
                              "rounded-full border px-1.5 py-0.5 text-xs font-semibold",
                              statusConf.color
                            )}
                          >
                            {t(statusConf.labelKey)}
                          </span>
                          {task.urgent && (
                            <span className="rounded bg-red-400/10 px-1.5 py-0.5 text-xs text-red-400">
                              {t("urgent")}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <IconBriefcase className="size-3" />
                            {task.crew}
                          </span>
                          <span className="flex items-center gap-1">
                            <IconCalendar className="size-3" />
                            {t("due")}: {task.deadline}
                          </span>
                        </div>
                      </div>
                      <IconChevronRight className="size-5 shrink-0 text-muted-foreground" />
                    </a>
                  );
                })}
                {filteredTasks.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {t("noTasks")}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="hidden w-80 shrink-0 space-y-6 xl:block">
            {/* My crews */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                <IconUsers className="size-4 text-primary" />
                {t("myCrews")}
              </h3>
              <div className="space-y-3">
                {MOCK_MY_CREWS.map((crew) => (
                  <a
                    key={crew.id}
                    href={`/crews/${crew.id}`}
                    className="block rounded-lg bg-secondary/50 p-3 transition-colors hover:bg-secondary"
                  >
                    <div className="mb-1 text-sm font-medium text-foreground">{crew.name}</div>
                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{crew.role}</span>
                      <span>·</span>
                      <span>{crew.phase}</span>
                    </div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{t("progress")}</span>
                      <span className="font-medium text-foreground">{crew.progress}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${crew.progress}%` }}
                      />
                    </div>
                  </a>
                ))}
              </div>
            </div>

            {/* Certification */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <IconShield className="size-4 text-primary" />
                {t("certStatus")}
              </h3>
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <IconAlertCircle className="size-4 text-amber-400" />
                  <span className="text-sm font-medium text-amber-400">{t("certInProgress")}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t("certHint")}</p>
              </div>
            </div>

            {/* Deadline reminders */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <IconBell className="size-4 text-primary" />
                {t("deadlineReminders")}
              </h3>
              <div className="space-y-2">
                {[...MOCK_TASKS]
                  .sort((a, b) => (a.urgent ? -1 : b.urgent ? 1 : 0))
                  .map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between rounded-lg p-2 hover:bg-secondary/50"
                    >
                      <span className="mr-2 flex-1 truncate text-xs text-foreground">
                        {task.title}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs font-medium",
                          task.urgent ? "text-red-400" : "text-muted-foreground"
                        )}
                      >
                        {task.deadline}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
