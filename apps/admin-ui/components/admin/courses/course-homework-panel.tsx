"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useHomeworkAttachment } from "./use-homework-attachment";
import { useRouter } from "next/navigation";
import {
  IconBook2,
  IconChartLine,
  IconChevronRight,
  IconClockHour4,
  IconPaperclip,
  IconRefresh,
  IconSearch,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminUiApiPath } from "@/lib/admin-api";
import type { AdminHomeworkRow, AdminTeachingIncome } from "@/lib/admin-academy-learning";

const STATUS_LABEL: Record<AdminHomeworkRow["status"], string> = {
  enrolled: "已报名",
  submitted: "待审核",
  revision: "需修改",
  approved: "已通过",
};

type WaitFilter = "all" | "fresh" | "aging" | "late";

export function workbenchGreeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function homeworkTitle(description: string | null) {
  const line = description?.split(/\r?\n/).find((part) => part.trim());
  return line?.trim().slice(0, 48) || "作业";
}

export function formatSubmittedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function waitHours(iso: string, now = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.floor((now - at) / 3600_000));
}

export function waitTone(hours: number): "ok" | "warn" | "late" {
  if (hours >= 48) return "late";
  if (hours >= 24) return "warn";
  return "ok";
}

export function monthStartUtc8(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 3600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - 8 * 3600_000);
}

export function queueMetrics(items: AdminHomeworkRow[], now = new Date()) {
  const start = monthStartUtc8(now).getTime();
  return {
    pending: items.filter((row) => row.status === "submitted").length,
    courses: new Set(items.map((row) => row.courseId)).size,
    students: new Set(items.map((row) => row.studentId)).size,
    monthly: new Set(
      items.filter((row) => Date.parse(row.createdAt) >= start).map((row) => row.studentId)
    ).size,
  };
}

export function CourseHomeworkPanel({
  siteLabel,
  databaseLabel,
  displayName,
  initialItems,
  metricItems,
  summary,
  loadError,
  canReview,
  scope,
}: {
  siteLabel: string;
  databaseLabel: string;
  displayName: string;
  initialItems: AdminHomeworkRow[];
  metricItems?: AdminHomeworkRow[];
  summary: AdminTeachingIncome | null;
  loadError: string | null;
  canReview: boolean;
  scope: "lecturer" | "operator";
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [selected, setSelected] = useState<AdminHomeworkRow | null>(null);
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState(loadError);
  const [query, setQuery] = useState("");
  const [courseId, setCourseId] = useState("all");
  const [waitFilter, setWaitFilter] = useState<WaitFilter>("all");
  const catalog = metricItems ?? initialItems;
  const [loaded, setLoaded] = useState({ initialItems, catalog, loadError, summary });
  if (
    loaded.initialItems !== initialItems ||
    loaded.catalog !== catalog ||
    loaded.loadError !== loadError ||
    loaded.summary !== summary
  ) {
    setLoaded({ initialItems, catalog, loadError, summary });
    setItems(initialItems);
    setError(loadError);
    setSelected(null);
  }

  const fromCatalog = queueMetrics(catalog);
  const pagePending = items.filter((row) => row.status === "submitted").length;
  const initialPending = initialItems.filter((row) => row.status === "submitted").length;
  const pending = Math.max(0, (summary?.pending ?? initialPending) - initialPending + pagePending);
  const courses = Math.max(summary?.courses ?? 0, fromCatalog.courses);
  const students = Math.max(summary?.students ?? 0, fromCatalog.students);
  const monthly = Math.max(summary?.monthlyNewStudents ?? 0, fromCatalog.monthly);
  const monthlyDelta = monthly - (summary?.previousMonthNewStudents ?? 0);
  const coursesInList = [...new Map(items.map((row) => [row.courseId, row.courseTitle])).entries()];

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((row) => {
      const submitted = row.submittedAt ?? row.createdAt;
      const hours = waitHours(submitted);
      if (needle && !row.studentName.toLowerCase().includes(needle)) return false;
      if (courseId !== "all" && row.courseId !== courseId) return false;
      if (waitFilter === "fresh" && hours >= 24) return false;
      if (waitFilter === "aging" && (hours < 24 || hours >= 48)) return false;
      if (waitFilter === "late" && hours < 48) return false;
      return true;
    });
  }, [courseId, items, query, waitFilter]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium text-slate-400">
            {siteLabel} · {databaseLabel}
          </p>
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-slate-950">
            {workbenchGreeting()}，{displayName}
            {scope === "lecturer" ? "老师" : ""}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            今天共有
            <span className="mx-1 font-medium text-slate-800">{pending}</span>
            份作业等待审批。
          </p>
        </div>
      </header>

      <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<IconBook2 className="size-4" />}
          iconClass="bg-sky-50 text-sky-600"
          value={courses}
          label="我的课程数"
        />
        <MetricCard
          icon={<IconUsers className="size-4" />}
          iconClass="bg-violet-50 text-violet-600"
          value={students}
          label="总购买人数（去重学生）"
        />
        <MetricCard
          icon={<IconChartLine className="size-4" />}
          iconClass="bg-emerald-50 text-emerald-600"
          value={monthly}
          label="本月新增购买人数"
          trend={monthlyDelta}
        />
        <a
          href="#pending-homework"
          className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-sm outline-none ring-slate-950/10 transition hover:border-slate-300 focus-visible:ring-2"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-500">
            <IconClockHour4 className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1.5">
              <span className="text-xl font-semibold tabular-nums text-slate-950">
                {pending.toLocaleString("en-US")}
              </span>
            </span>
            <span className="block text-[11px] text-slate-500">待审批作业 · 点击查看</span>
          </span>
          <IconChevronRight className="size-4 shrink-0 text-slate-300" />
        </a>
      </section>

      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <section
        id="pending-homework"
        className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm"
      >
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="size-2 rounded-sm bg-amber-400" />
            待审批作业
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索学生姓名"
                aria-label="搜索学生姓名"
                className="h-9 w-52 rounded-full border-slate-200 bg-slate-50 pl-8"
              />
            </label>
            <select
              aria-label="课程"
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              className="h-9 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700"
            >
              <option value="all">课程: 全部</option>
              {coursesInList.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
            <select
              aria-label="等待时长"
              value={waitFilter}
              onChange={(event) => setWaitFilter(event.target.value as WaitFilter)}
              className="h-9 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700"
            >
              <option value="all">等待时长: 全部</option>
              <option value="fresh">24 小时内</option>
              <option value="aging">24–48 小时</option>
              <option value="late">超过 48 小时</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={() =>
                startRefresh(() => {
                  setError(null);
                  router.refresh();
                })
              }
            >
              <IconRefresh className="size-4" />
              刷新
            </Button>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="px-5 py-10 text-sm text-slate-500">暂无待审作业。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[12px] text-slate-400">
                <tr>
                  {["学生", "课程", "作业标题", "提交时间", "等待时长", "状态", "操作"].map(
                    (label) => (
                      <th key={label} className="px-5 py-3 font-medium">
                        {label}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const submitted = row.submittedAt ?? row.createdAt;
                  const hours = waitHours(submitted);
                  const tone = waitTone(hours);
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <StudentMark name={row.studentName} src={row.studentAvatar} />
                          <span className="font-medium text-slate-900">{row.studentName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-600">{row.courseTitle}</td>
                      <td className="px-5 py-4 text-slate-700">{homeworkTitle(row.description)}</td>
                      <td className="px-5 py-4 tabular-nums text-slate-500">
                        {formatSubmittedAt(submitted)}
                      </td>
                      <td className="px-5 py-4">
                        <WaitLabel hours={hours} tone={tone} />
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-5 py-4">
                        <Button size="sm" onClick={() => setSelected(row)}>
                          {row.status === "submitted" && canReview ? "审批" : "查看"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected ? (
        <HomeworkReviewDialog
          row={selected}
          canReview={canReview && selected.status === "submitted"}
          close={() => setSelected(null)}
          onSaved={(next) => {
            setItems((prev) =>
              prev.map((item) => (item.id === next.id ? { ...item, ...next } : item))
            );
            setSelected(null);
            router.refresh();
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function MetricCard({
  icon,
  iconClass,
  value,
  label,
  trend,
}: {
  icon: ReactNode;
  iconClass: string;
  value: number;
  label: string;
  trend?: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-sm">
      <span className={`grid size-8 shrink-0 place-items-center rounded-full ${iconClass}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <p className="text-xl font-semibold leading-none tabular-nums text-slate-950">
            {value.toLocaleString("en-US")}
          </p>
          {trend != null && trend !== 0 ? (
            <span
              className={
                trend > 0
                  ? "text-[11px] font-medium text-emerald-500"
                  : "text-[11px] font-medium text-slate-400"
              }
            >
              {trend > 0 ? "+" : ""}
              {trend.toLocaleString("en-US")}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AdminHomeworkRow["status"] }) {
  return (
    <span
      className={
        status === "submitted"
          ? "rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-600"
          : status === "revision"
            ? "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
            : status === "approved"
              ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
              : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
      }
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function WaitLabel({ hours, tone }: { hours: number; tone: ReturnType<typeof waitTone> }) {
  return (
    <span
      className={
        tone === "late"
          ? "inline-flex items-center gap-1 text-red-500"
          : tone === "warn"
            ? "inline-flex items-center gap-1 text-amber-500"
            : "inline-flex items-center gap-1 text-slate-400"
      }
    >
      <IconClockHour4 className="size-3.5" />
      {hours}小时
    </span>
  );
}

function StudentMark({ name, src }: { name: string; src?: string | null }) {
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className="size-9 rounded-full object-cover" />
    );
  }
  return (
    <span className="grid size-9 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
      {initial}
    </span>
  );
}

function HomeworkReviewDialog({
  row,
  canReview,
  close,
  onSaved,
  onError,
}: {
  row: AdminHomeworkRow;
  canReview: boolean;
  close: () => void;
  onSaved: (row: AdminHomeworkRow) => void;
  onError: (message: string) => void;
}) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const attachment = useHomeworkAttachment();
  const [localError, setLocalError] = useState("");
  const [score, setScore] = useState(row.score != null ? String(row.score) : "");
  const [feedback, setFeedback] = useState(row.feedback ?? "");
  const submitted = row.submittedAt ?? row.createdAt;
  const hours = waitHours(submitted);
  const title = homeworkTitle(row.description);

  async function decide(decision: "approved" | "revision") {
    if (lock.current || !canReview) return;
    lock.current = true;
    setBusy(true);
    setLocalError("");
    try {
      const response = await fetch(
        adminUiApiPath(
          `/api/admin/academy/learning/enrollments/${encodeURIComponent(row.id)}/review`
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedVersion: row.version,
            decision,
            score: Number(score),
            feedback,
          }),
        }
      );
      const payload = (await response.json().catch(() => null)) as {
        code?: number;
        msg?: string;
        message?: string;
        data?: AdminHomeworkRow;
      } | null;
      if (!response.ok || payload?.code !== 200 || !payload.data) {
        throw new Error(payload?.msg || payload?.message || `审核失败：${response.status}`);
      }
      onSaved({
        ...row,
        ...payload.data,
        courseTitle: row.courseTitle,
        studentName: row.studentName,
        teacherName: row.teacherName,
        studentAvatar: row.studentAvatar,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "审核失败。";
      setLocalError(message);
      onError(message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function openAttachment(assetId: string) {
    setLocalError("");
    await attachment.open(
      assetId,
      async (signal) => {
        const response = await fetch(
          adminUiApiPath(
            `/api/admin/academy/learning/enrollments/${encodeURIComponent(row.id)}/attachments/${encodeURIComponent(assetId)}`
          ),
          { signal }
        );
        const payload = (await response.json().catch(() => null)) as {
          code?: number;
          msg?: string;
          data?: { url: string };
        } | null;
        if (!response.ok || payload?.code !== 200 || !payload.data?.url) {
          throw new Error(payload?.msg || "附件打开失败。");
        }
        return payload.data.url;
      },
      (error) => setLocalError(error instanceof Error ? error.message : "附件打开失败。")
    );
  }

  const reviewReady = score !== "" && feedback.trim() && Number(score) >= 0 && Number(score) <= 100;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="homework-review-title"
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-400">作业详情</p>
            <h2
              id="homework-review-title"
              className="mt-1 truncate text-lg font-semibold text-slate-950"
            >
              {title}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={close}
            aria-label="关闭"
            className="rounded-full"
          >
            <IconX className="size-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <StudentMark name={row.studentName} src={row.studentAvatar} />
              <div>
                <p className="font-medium text-slate-950">{row.studentName}</p>
                <p className="text-xs text-slate-500">{row.courseTitle}</p>
              </div>
            </div>
            <StatusBadge status={row.status} />
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <dt className="text-[11px] text-slate-400">提交时间</dt>
              <dd className="mt-1 tabular-nums text-slate-800">{formatSubmittedAt(submitted)}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <dt className="text-[11px] text-slate-400">等待时长</dt>
              <dd className="mt-1">
                <WaitLabel hours={hours} tone={waitTone(hours)} />
              </dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <dt className="text-[11px] text-slate-400">授课教师</dt>
              <dd className="mt-1 text-slate-800">{row.teacherName}</dd>
            </div>
          </dl>

          <section>
            <h3 className="mb-2 text-xs font-medium text-slate-400">提交内容</h3>
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-slate-800">
              {row.description?.trim() || "学员未填写说明。"}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium text-slate-400">
              附件{row.assetIds.length ? ` · ${row.assetIds.length}` : ""}
            </h3>
            {row.assetIds.length === 0 ? (
              <p className="text-sm text-slate-400">没有附件。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {row.assetIds.map((assetId, index) =>
                  attachment.link?.id === assetId ? (
                    <a
                      key={assetId}
                      href={attachment.link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    >
                      <IconPaperclip className="size-3.5 text-slate-400" />
                      附件 {index + 1}
                    </a>
                  ) : (
                    <button
                      key={assetId}
                      type="button"
                      disabled={attachment.pending}
                      onClick={() => void openAttachment(assetId)}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                    >
                      <IconPaperclip className="size-3.5 text-slate-400" />
                      附件 {index + 1}
                    </button>
                  )
                )}
              </div>
            )}
          </section>

          {row.feedback ? (
            <section className="rounded-xl border border-slate-100 px-4 py-3">
              <h3 className="text-xs font-medium text-slate-400">上次评语</h3>
              <p className="mt-1 text-sm text-slate-800">
                <span className="mr-2 font-semibold tabular-nums">{row.score}/100</span>
                {row.feedback}
              </p>
            </section>
          ) : null}

          {localError ? (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              {localError}
            </p>
          ) : null}

          {canReview ? (
            <form
              id="homework-review-form"
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void decide("approved");
              }}
            >
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">评分</span>
                <div className="flex items-center gap-3">
                  <input
                    required
                    type="number"
                    min={0}
                    max={100}
                    value={score}
                    disabled={busy}
                    aria-label="评分"
                    onChange={(event) => setScore(event.target.value)}
                    className="h-11 w-28 rounded-xl border border-slate-200 px-3 text-lg font-semibold tabular-nums outline-none focus:border-slate-400"
                  />
                  <span className="text-sm text-slate-400">/ 100</span>
                </div>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700">评语</span>
                <textarea
                  required
                  maxLength={10000}
                  value={feedback}
                  disabled={busy}
                  placeholder="写给学生的修改意见或通过说明"
                  onChange={(event) => setFeedback(event.target.value)}
                  className="min-h-32 rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-slate-400"
                />
              </label>
            </form>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
          {canReview ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !reviewReady}
                onClick={() => void decide("revision")}
              >
                退回修改
              </Button>
              <Button type="submit" form="homework-review-form" disabled={busy || !reviewReady}>
                通过并提交
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={close}>
              关闭
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
