"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  IconBook2,
  IconClockHour4,
  IconCoin,
  IconRefresh,
  IconSearch,
  IconUsers,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminHomeworkRow, AdminTeachingIncome } from "@/lib/admin-academy-learning";
import { formatSubmittedAt, queueMetrics } from "./course-homework-panel";

const STATUS_LABEL: Record<AdminHomeworkRow["status"], string> = {
  enrolled: "已报名",
  submitted: "待审核",
  revision: "需修改",
  approved: "已通过",
};

export function CourseIncomePanel({
  siteLabel,
  databaseLabel,
  summary,
  items,
  loadError,
}: {
  siteLabel: string;
  databaseLabel: string;
  summary: AdminTeachingIncome | null;
  items: AdminHomeworkRow[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [courseId, setCourseId] = useState("all");
  const [status, setStatus] = useState<"all" | AdminHomeworkRow["status"]>("all");
  const fromRows = queueMetrics(items);
  const coursesInList = [...new Map(items.map((row) => [row.courseId, row.courseTitle])).entries()];
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((row) => {
      if (needle && !row.studentName.toLowerCase().includes(needle)) return false;
      if (courseId !== "all" && row.courseId !== courseId) return false;
      if (status !== "all" && row.status !== status) return false;
      return true;
    });
  }, [courseId, items, query, status]);
  const earned = Number(summary?.earnedCredits ?? settledCredits(items)) || 0;
  const values = {
    courses: Math.max(summary?.courses ?? 0, fromRows.courses),
    students: Math.max(summary?.students ?? 0, fromRows.students),
    pending: summary?.pending ?? fromRows.pending,
    earnedCredits: earned,
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium text-slate-400">
            {siteLabel} · {databaseLabel}
          </p>
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-slate-950">授课收入</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            已结算
            <span className="mx-1 font-medium tabular-nums text-emerald-600">
              {values.earnedCredits.toLocaleString("en-US")}
            </span>
            积分
            {values.pending > 0 ? (
              <>
                ，另有
                <span className="mx-1 font-medium tabular-nums text-slate-800">
                  {values.pending}
                </span>
                份作业待审。
              </>
            ) : (
              "。"
            )}
          </p>
        </div>
      </header>

      {loadError ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<IconBook2 className="size-4" />}
          iconClass="bg-sky-50 text-sky-600"
          value={values.courses}
          label="已开课"
        />
        <MetricCard
          icon={<IconUsers className="size-4" />}
          iconClass="bg-violet-50 text-violet-600"
          value={values.students}
          label="报名人数"
        />
        <MetricCard
          icon={<IconClockHour4 className="size-4" />}
          iconClass="bg-amber-50 text-amber-500"
          value={values.pending}
          label="待审作业"
        />
        <MetricCard
          icon={<IconCoin className="size-4" />}
          iconClass="bg-emerald-50 text-emerald-600"
          value={values.earnedCredits}
          label="已结算授课积分"
          emphasize
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="size-2 rounded-sm bg-emerald-400" />
            收入详情
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
              aria-label="状态"
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
              className="h-9 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700"
            >
              <option value="all">状态: 全部</option>
              <option value="approved">已通过</option>
              <option value="submitted">待审核</option>
              <option value="revision">需修改</option>
              <option value="enrolled">已报名</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={() => startRefresh(() => router.refresh())}
            >
              <IconRefresh className="size-4" />
              刷新
            </Button>
          </div>
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-slate-400">暂无授课收入记录。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[12px] text-slate-400">
                <tr>
                  {["学生", "课程", "状态", "授课积分", "结算时间"].map((label) => (
                    <th key={label} className="px-5 py-3 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const settled = row.status === "approved";
                  const credits = Number(row.teacherCredits || 0);
                  return (
                    <tr
                      key={row.id}
                      className="border-t border-slate-100 transition-colors hover:bg-slate-50/80"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <StudentMark name={row.studentName} src={row.studentAvatar} />
                          <span className="font-medium text-slate-900">{row.studentName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-600">{row.courseTitle}</td>
                      <td className="px-5 py-4">
                        <StatusBadge status={row.status} />
                      </td>
                      <td
                        className={
                          settled
                            ? "px-5 py-4 font-semibold tabular-nums text-emerald-600"
                            : "px-5 py-4 tabular-nums text-slate-300"
                        }
                      >
                        {settled ? `+${credits.toLocaleString("en-US")}` : "—"}
                      </td>
                      <td className="px-5 py-4 tabular-nums text-slate-500">
                        {settled && row.reviewedAt ? formatSubmittedAt(row.reviewedAt) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  iconClass,
  value,
  label,
  emphasize,
}: {
  icon: ReactNode;
  iconClass: string;
  value: number;
  label: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-sm">
      <span className={`grid size-8 shrink-0 place-items-center rounded-full ${iconClass}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p
          className={
            emphasize
              ? "text-xl font-semibold leading-none tabular-nums text-emerald-600"
              : "text-xl font-semibold leading-none tabular-nums text-slate-950"
          }
        >
          {value.toLocaleString("en-US")}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AdminHomeworkRow["status"] }) {
  return (
    <span
      className={
        status === "approved"
          ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
          : status === "submitted"
            ? "rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-600"
            : status === "revision"
              ? "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
              : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
      }
    >
      {STATUS_LABEL[status]}
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

function settledCredits(items: AdminHomeworkRow[]) {
  return items
    .filter((row) => row.status === "approved")
    .reduce((sum, row) => sum + Number(row.teacherCredits || 0), 0)
    .toString();
}
