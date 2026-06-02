"use client";

import { useMemo, useState } from "react";
import { IconDeviceDesktop, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ErrorBanner,
  formatDate,
  Metric,
  PageHeader,
  requestEnvelope,
  StatusPill,
  toErrorMessage,
} from "./shared";
import type { AdminSessionRow, AdminSessionsData } from "./types";

type StatusFilter = "active" | "all";

export function SessionsPanel({
  currentUserId,
  currentSessionId,
  siteLabel,
  databaseLabel,
  initialData,
  initialError,
}: {
  currentUserId: string;
  currentSessionId: string;
  siteLabel: string;
  databaseLabel: string;
  initialData: AdminSessionsData | null;
  initialError: string | null;
}) {
  const [items, setItems] = useState<AdminSessionRow[]>(initialData?.items ?? []);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const activeCount = useMemo(() => items.filter((row) => row.status === "active").length, [items]);
  const uniqueUsers = useMemo(() => new Set(items.map((row) => row.userId)).size, [items]);

  async function refresh(nextStatus: StatusFilter = statusFilter) {
    setLoading(true);
    setError(null);
    try {
      const data = await requestEnvelope<AdminSessionsData>(
        `/api/admin/users/sessions?status=${nextStatus}`
      );
      setItems(data.items);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function revoke(row: AdminSessionRow) {
    try {
      await requestEnvelope(
        `/api/admin/users/${encodeURIComponent(row.userId)}/sessions/${encodeURIComponent(
          row.id
        )}/revoke`,
        { method: "POST" }
      );
      await refresh();
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        icon={<IconDeviceDesktop className="size-4" />}
        title="会话"
        description="所有后台账号的登录会话总览。可吊销可疑或遗留的活跃会话；账号本人当前会话需通过退出登录结束。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
            刷新
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric
          label="会话数"
          value={items.length}
          helper={statusFilter === "active" ? "活跃" : "全部"}
        />
        <Metric label="活跃会话" value={activeCount} />
        <Metric label="涉及账号" value={uniqueUsers} />
      </div>

      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-500">范围</Label>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              const next = value as StatusFilter;
              setStatusFilter(next);
              void refresh(next);
            }}
          >
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">仅活跃</SelectItem>
              <SelectItem value="all">全部</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <Th>账号</Th>
              <Th>IP</Th>
              <Th>设备</Th>
              <Th>最近活跃</Th>
              <Th>过期</Th>
              <Th>状态</Th>
              <Th className="text-right">操作</Th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-500">
                  {loading ? "加载中…" : "暂无会话。"}
                </td>
              </tr>
            ) : (
              items.map((row) => {
                const active = row.status === "active";
                const isSelf = row.userId === currentUserId;
                const isCurrent = row.id === currentSessionId;
                return (
                  <tr key={row.id} className="group hover:bg-slate-50/60">
                    <Td>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-950">
                          <span className="max-w-[180px] truncate">{row.userDisplayName}</span>
                          {isCurrent ? (
                            <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">
                              当前会话
                            </span>
                          ) : isSelf ? (
                            <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">
                              我
                            </span>
                          ) : null}
                        </p>
                        <p className="max-w-[220px] truncate text-[12px] text-slate-500">
                          {row.userEmail}
                        </p>
                      </div>
                    </Td>
                    <Td>
                      <span className="font-mono text-[12px] text-slate-600">
                        {row.ipAddress ?? "—"}
                      </span>
                    </Td>
                    <Td>
                      <span className="block max-w-[260px] truncate text-[12px] text-slate-500">
                        {row.userAgent ?? "—"}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-slate-600">
                        {formatDate(row.lastSeenAt)}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-slate-600">
                        {formatDate(row.expiresAt)}
                      </span>
                    </Td>
                    <Td>
                      {active ? (
                        <StatusPill tone="success">活跃</StatusPill>
                      ) : (
                        <StatusPill tone="muted">
                          {row.status === "revoked" ? "已吊销" : "已过期"}
                        </StatusPill>
                      )}
                    </Td>
                    <Td className="text-right">
                      {isCurrent ? (
                        <span
                          className="text-[12px] text-slate-400"
                          title="当前登录会话，请使用「退出登录」结束"
                        >
                          当前会话
                        </span>
                      ) : active ? (
                        <ConfirmDialog
                          title="吊销该会话？"
                          description={`确认吊销 ${row.userDisplayName}（${row.userEmail}）的这个登录会话？该设备将立即登出。`}
                          confirmLabel="吊销"
                          destructive
                          onConfirm={() => revoke(row)}
                          trigger={
                            <Button variant="outline" size="sm">
                              吊销
                            </Button>
                          }
                        />
                      ) : (
                        <span className="text-[12px] text-slate-400">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-500",
        className
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={cn("border-b border-slate-100 px-3 py-2.5 align-middle", className)}>
      {children}
    </td>
  );
}
