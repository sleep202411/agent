"use client";

import { useEffect, useState } from "react";
import { IconAlertTriangle, IconCircleCheck, IconRefresh, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AuditOutcome = "success" | "failure";

export type AdminAuditRow = {
  id: string;
  actor: { id: string; email: string; displayName: string } | null;
  actorSessionId: string | null;
  siteScope: "global" | "cn" | "all";
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: AuditOutcome;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
};

export type AdminAuditListData = {
  items: AdminAuditRow[];
  page: number;
  pageSize: number;
  total: number;
};

const emptyData: AdminAuditListData = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
};

export function AdminAuditPanel({
  databaseLabel,
  initialData,
  initialError,
}: {
  databaseLabel: string;
  initialData: AdminAuditListData | null;
  initialError?: string | null;
}) {
  const [data, setData] = useState(initialData ?? emptyData);
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<AuditOutcome | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh({ silent: true });
    }, 240);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, outcome]);

  async function refresh(options: { silent?: boolean } = {}) {
    if (!options.silent) setError(null);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (outcome) params.set("outcome", outcome);
      const suffix = params.toString() ? `?${params}` : "";
      const nextData = await requestEnvelope<AdminAuditListData>(`/api/admin/audit${suffix}`);
      setData(nextData);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[12px] font-medium text-slate-500">系统审计</p>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">后台操作日志</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              当前数据源：{databaseLabel}。登录、MFA、账号、密码、会话和权限变更都会进入审计。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[260px]">
            <Metric label="日志总数" value={data.total} />
            <Metric
              label="失败事件"
              value={data.items.filter((item) => item.outcome === "failure").length}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid flex-1 gap-2 lg:grid-cols-[minmax(220px,1fr)_140px]">
              <label className="relative block">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                  placeholder="搜索操作、资源或操作者"
                />
              </label>
              <select
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as AuditOutcome | "")}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm"
              >
                <option value="">全部结果</option>
                <option value="success">成功</option>
                <option value="failure">失败</option>
              </select>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
              刷新
            </Button>
          </div>
        </div>

        {error ? (
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">时间</th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">操作者</th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">动作</th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">资源</th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">结果</th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">IP</th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">详情</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="border-b border-slate-100 px-3 py-3 text-sm text-slate-700">
                    {formatDate(item.createdAt)}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <p className="text-sm font-medium text-slate-950">
                      {item.actor?.displayName ?? "系统"}
                    </p>
                    <p className="text-[12px] text-slate-500">{item.actor?.email ?? "-"}</p>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <code className="rounded bg-slate-100 px-2 py-1 text-[12px] text-slate-700">
                      {item.action}
                    </code>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-sm text-slate-600">
                    <p>{item.resourceType}</p>
                    <p className="max-w-[180px] truncate text-[11px] text-slate-400">
                      {item.resourceId ?? "-"}
                    </p>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                        item.outcome === "success"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-red-200 bg-red-50 text-red-700"
                      )}
                    >
                      {item.outcome === "success" ? (
                        <IconCircleCheck className="size-3" />
                      ) : (
                        <IconAlertTriangle className="size-3" />
                      )}
                      {item.outcome === "success" ? "成功" : "失败"}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-sm text-slate-600">
                    {item.ipAddress ?? "-"}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <p className="max-w-[280px] truncate text-[12px] text-slate-500">
                      {item.reason ?? compactJson(item.metadata)}
                    </p>
                  </td>
                </tr>
              ))}
              {!data.items.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
                    暂无审计记录
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{value}</p>
    </div>
  );
}

async function requestEnvelope<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    message?: string;
    data?: T;
  } | null;
  if (!response.ok || payload?.code !== 200) {
    throw new Error(payload?.msg ?? payload?.message ?? `请求失败：${response.status}`);
  }
  return payload.data as T;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function compactJson(value: unknown) {
  try {
    const text = JSON.stringify(value);
    return text && text !== "{}" ? text : "-";
  } catch {
    return "-";
  }
}
