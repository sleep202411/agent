"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminTeachingCourse } from "@/lib/admin-academy-learning";

export function formatSharePercent(bps: number | null) {
  if (bps == null) return "—";
  const percent = bps / 100;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

export function CourseMinePanel({
  siteLabel,
  databaseLabel,
  items,
  loadError,
}: {
  siteLabel: string;
  databaseLabel: string;
  items: AdminTeachingCourse[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((row) => row.courseTitle.toLowerCase().includes(needle));
  }, [items, query]);
  const students = items.reduce((sum, row) => sum + row.students, 0);
  const earned = items.reduce((sum, row) => sum + Number(row.earnedCredits || 0), 0);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-[11px] font-medium text-slate-400">
          {siteLabel} · {databaseLabel}
        </p>
        <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-slate-950">我的课程</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          共<span className="mx-1 font-medium tabular-nums text-slate-800">{items.length}</span>
          门课，合计
          <span className="mx-1 font-medium tabular-nums text-slate-800">{students}</span>
          人，已结算
          <span className="mx-1 font-medium tabular-nums text-emerald-600">
            {earned.toLocaleString("en-US")}
          </span>
          积分。
        </p>
      </header>

      {loadError ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="size-2 rounded-sm bg-sky-400" />
            课程分润
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索课程"
                aria-label="搜索课程"
                className="h-9 w-52 rounded-full border-slate-200 bg-slate-50 pl-8"
              />
            </label>
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
          <p className="px-5 py-14 text-center text-sm text-slate-400">暂无参与的课程。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[12px] text-slate-400">
                <tr>
                  {["课程", "分润比例", "总人数", "总积分"].map((label) => (
                    <th key={label} className="px-5 py-3 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.courseId}
                    className="border-t border-slate-100 transition-colors hover:bg-slate-50/80"
                  >
                    <td className="px-5 py-4 font-medium text-slate-900">{row.courseTitle}</td>
                    <td className="px-5 py-4 tabular-nums text-slate-700">
                      {formatSharePercent(row.shareBps)}
                    </td>
                    <td className="px-5 py-4 tabular-nums text-slate-700">
                      {row.students.toLocaleString("en-US")}
                    </td>
                    <td className="px-5 py-4 font-semibold tabular-nums text-emerald-600">
                      {Number(row.earnedCredits || 0).toLocaleString("en-US")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
