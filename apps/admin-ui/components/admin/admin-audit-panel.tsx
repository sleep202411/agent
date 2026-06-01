"use client";

import { useEffect, useMemo, useState } from "react";
import { IconAlertTriangle, IconCircleCheck, IconRefresh, IconSearch } from "@tabler/icons-react";
import { PageHeader } from "@/components/admin/page-header";
import { adminUiApiPath } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type AuditOutcome = "success" | "failure";

const OUTCOME_ALL = "__all__";

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

  const columns = useMemo<ColumnDef<AdminAuditRow, unknown>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "时间",
        cell: ({ row }) => (
          <span className="text-sm text-slate-700">{formatDate(row.original.createdAt)}</span>
        ),
      },
      {
        id: "actor",
        header: "操作者",
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">
                {item.actor?.displayName ?? "系统"}
              </p>
              <p className="text-[12px] text-slate-500">{item.actor?.email ?? "-"}</p>
            </>
          );
        },
      },
      {
        accessorKey: "action",
        header: "动作",
        cell: ({ row }) => (
          <code className="rounded bg-slate-100 px-2 py-1 text-[12px] text-slate-700">
            {row.original.action}
          </code>
        ),
      },
      {
        id: "resource",
        header: "资源",
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="text-sm text-slate-600">
              <p>{item.resourceType}</p>
              <p className="max-w-[180px] truncate text-[11px] text-slate-400">
                {item.resourceId ?? "-"}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: "outcome",
        header: "结果",
        cell: ({ row }) => {
          const item = row.original;
          return (
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
          );
        },
      },
      {
        accessorKey: "ipAddress",
        header: "IP",
        cell: ({ row }) => (
          <span className="text-sm text-slate-600">{row.original.ipAddress ?? "-"}</span>
        ),
      },
      {
        id: "detail",
        header: "详情",
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <p className="max-w-[280px] truncate text-[12px] text-slate-500">
              {item.reason ?? compactJson(item.metadata)}
            </p>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="系统审计"
        title="后台操作日志"
        description={`当前数据源：${databaseLabel}。登录、MFA、账号、密码、会话和权限变更都会进入审计。`}
        actions={
          <div className="grid grid-cols-2 gap-2 sm:min-w-[260px]">
            <Metric label="日志总数" value={data.total} />
            <Metric
              label="失败事件"
              value={data.items.filter((item) => item.outcome === "failure").length}
            />
          </div>
        }
      />

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid flex-1 gap-2 lg:grid-cols-[minmax(220px,1fr)_140px]">
              <label className="relative block">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-9 w-full rounded-lg border-slate-200 bg-white pl-9 pr-3 text-sm focus-visible:border-slate-950 focus-visible:ring-2 focus-visible:ring-slate-950/10"
                  placeholder="搜索操作、资源或操作者"
                />
              </label>
              <Select
                value={outcome === "" ? OUTCOME_ALL : outcome}
                onValueChange={(value) =>
                  setOutcome(value === OUTCOME_ALL ? "" : (value as AuditOutcome))
                }
              >
                <SelectTrigger className="h-9 w-full rounded-lg border-slate-200 bg-white px-2.5 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OUTCOME_ALL}>全部结果</SelectItem>
                  <SelectItem value="success">成功</SelectItem>
                  <SelectItem value="failure">失败</SelectItem>
                </SelectContent>
              </Select>
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

        <DataTable
          columns={columns}
          data={data.items}
          loading={loading}
          minWidth={980}
          pageSize={20}
          emptyLabel="暂无审计记录"
          className="rounded-none border-0"
        />
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
  const response = await fetch(adminUiApiPath(url), { cache: "no-store" });
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
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function compactJson(value: unknown) {
  try {
    const text = JSON.stringify(value);
    return text && text !== "{}" ? text : "-";
  } catch {
    return "-";
  }
}
