"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconRefresh } from "@tabler/icons-react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import type { AdminTeachingIncome } from "@/lib/admin-academy-learning";

const METRICS: {
  key: "courses" | "students" | "pending" | "earnedCredits";
  label: string;
}[] = [
  { key: "courses", label: "已开课" },
  { key: "students", label: "报名人数" },
  { key: "pending", label: "待审作业" },
  { key: "earnedCredits", label: "已结算授课积分" },
];

export function CourseIncomePanel({
  siteLabel,
  databaseLabel,
  summary,
  loadError,
}: {
  siteLabel: string;
  databaseLabel: string;
  summary: AdminTeachingIncome | null;
  loadError: string | null;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="授课收入"
        description="课程作业通过后结算给教师的社区积分汇总。教师提现请在剧组管理的提现队列处理。"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            <IconRefresh className="size-4" />
            刷新
          </Button>
        }
      />
      {loadError ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}
      {summary ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {summary.scope === "lecturer" && summary.platformUserId
            ? `当前按已绑定的 Web 讲师 ID ${summary.platformUserId} 汇总你的授课收入。`
            : "当前为运营视角（未绑定 Web 讲师 ID），汇总全站授课收入。在「账号权限」里为老师账号填写 Web 用户 ID 即可切换为讲师视角。"}
        </p>
      ) : null}
      {summary ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {METRICS.map((metric) => (
            <div key={metric.key} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">{metric.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">
                {summary[metric.key]}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-sm text-slate-600">
        100 已赚取社区积分 = 1 美元。提现审核入口：
        <Link href="/withdrawals" className="ml-1 underline">
          剧组提现
        </Link>
        。
      </p>
    </div>
  );
}
