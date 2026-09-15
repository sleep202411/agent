"use client";

// Cross-workspace compute consumption: who spent how much from which
// workspace pot. Backed by GET /billing/usage/member-compute.

import { useMemo, useRef, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import {
  IconChevronDown,
  IconChevronRight,
  IconRefresh,
  IconReportMoney,
  IconSearch,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  ErrorBanner,
  Metric,
  PageHeader,
  StatusPill,
  TextInput,
  formatInteger,
  requestEnvelope,
  toErrorMessage,
} from "./shared";
import type { AdminComputeMemberUsageData, AdminComputeMemberUsageMember } from "./types";

const RANGE_OPTIONS = [7, 30, 90] as const;
const KIND_TABS: { key: AdminComputeMemberUsageData["workspaceKind"]; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "shared", label: "共享工作区" },
  { key: "personal", label: "个人默认池" },
];

const emptyUsage: AdminComputeMemberUsageData = {
  rangeDays: 30,
  workspaceKind: "all",
  workspaceId: null,
  totalCredits: "0",
  memberCount: 0,
  workspaceCount: 0,
  members: [],
};

export function BillingComputeMemberUsagePanel({
  siteLabel,
  databaseLabel,
  initialData,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialData: AdminComputeMemberUsageData | null;
  initialError?: string | null;
}) {
  const [days, setDays] = useState<number>(initialData?.rangeDays ?? 30);
  const [workspaceKind, setWorkspaceKind] = useState<AdminComputeMemberUsageData["workspaceKind"]>(
    initialData?.workspaceKind ?? "all"
  );
  const [workspaceId, setWorkspaceId] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [data, setData] = useState<AdminComputeMemberUsageData>(initialData ?? emptyUsage);
  const [previousInitialData, setPreviousInitialData] = useState(initialData);
  const { busy: loading, begin } = useAdminOperation();
  const filters = useRef({ days, workspaceKind });
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  async function refresh(next?: {
    days?: number;
    workspaceKind?: AdminComputeMemberUsageData["workspaceKind"];
  }) {
    const operation = begin("read");
    if (!operation) return;
    const nextDays = next?.days ?? filters.current.days;
    const nextKind = next?.workspaceKind ?? filters.current.workspaceKind;
    filters.current = { days: nextDays, workspaceKind: nextKind };
    setDays(nextDays);
    setWorkspaceKind(nextKind);
    setError(null);
    try {
      const params = new URLSearchParams({
        days: String(nextDays),
        workspaceKind: nextKind,
        limit: "100",
      });
      if (workspaceId.trim()) params.set("workspaceId", workspaceId.trim());
      if (userQuery.trim()) {
        // Prefer explicit id when the field looks like one; otherwise treat as
        // phone/email for legacy bridge resolution.
        const trimmed = userQuery.trim();
        if (/^[0-9a-f-]{8,}$/i.test(trimmed) || /^\d{6,}$/.test(trimmed)) {
          params.set("userId", trimmed);
        } else {
          params.set("userQuery", trimmed);
        }
      }
      const nextData = await requestEnvelope<AdminComputeMemberUsageData>(
        `/api/admin/billing/usage/member-compute?${params.toString()}`,
        operation.signal
      );
      if (!operation.current()) return;
      setData(nextData);
      setExpanded(new Set());
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  // Accept new server snapshots only for the currently selected query.
  // Unchanged props must not replace an explicit client refresh result.
  if (initialData !== previousInitialData) {
    setPreviousInitialData(initialData);
    if (
      initialData &&
      initialData.rangeDays === days &&
      initialData.workspaceKind === workspaceKind &&
      initialData.workspaceId === (workspaceId.trim() || null)
    ) {
      setData(initialData);
    }
  }

  const maxCredits = useMemo(() => {
    return data.members.reduce((max, row) => {
      const credits = BigInt(row.totalCredits || "0");
      return credits > max ? credits : max;
    }, BigInt(0));
  }, [data.members]);

  function toggle(userId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="成员积分消耗"
        icon={<IconReportMoney className="size-5" />}
        description="跨工作区查看谁在哪个算力池消耗了积分。数据来自 settle/debit 账本，按成员汇总并可展开到工作区。"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="刷新"
          >
            <IconRefresh className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <section className="grid gap-3 md:grid-cols-3">
        <Metric label="消耗积分" value={formatInteger(data.totalCredits)} />
        <Metric label="有消耗成员" value={data.memberCount} />
        <Metric label="涉及工作区" value={data.workspaceCount} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
            {KIND_TABS.map((tab) => {
              const active = tab.key === workspaceKind;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    void refresh({ workspaceKind: tab.key });
                  }}
                  className={
                    active
                      ? "rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                      : "rounded-md px-3 py-1.5 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-800"
                  }
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
            {RANGE_OPTIONS.map((option) => {
              const active = option === days;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    void refresh({ days: option });
                  }}
                  className={
                    active
                      ? "rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                      : "rounded-md px-3 py-1.5 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-800"
                  }
                >
                  {option} 天
                </button>
              );
            })}
          </div>

          <div className="min-w-[180px] flex-1">
            <TextInput
              value={userQuery}
              onChange={(event) => setUserQuery(event.target.value)}
              placeholder="用户 ID / 手机 / 邮箱"
              onKeyDown={(event) => {
                if (event.key === "Enter") void refresh();
              }}
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <TextInput
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              placeholder="工作区 UUID（可选）"
              onKeyDown={(event) => {
                if (event.key === "Enter") void refresh();
              }}
            />
          </div>
          <Button type="button" size="sm" onClick={() => void refresh()} disabled={loading}>
            <IconSearch className="size-3.5" />
            查询
          </Button>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="grid grid-cols-[minmax(0,1.4fr)_120px_100px_minmax(0,1fr)] gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          <span>成员</span>
          <span className="text-right">积分</span>
          <span className="text-right">次数</span>
          <span>占比</span>
        </div>

        {data.members.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-slate-500">
            {loading ? "加载中…" : "该时间窗暂无成员消耗。"}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.members.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                maxCredits={maxCredits}
                open={expanded.has(member.userId)}
                onToggle={() => toggle(member.userId)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MemberRow({
  member,
  maxCredits,
  open,
  onToggle,
}: {
  member: AdminComputeMemberUsageMember;
  maxCredits: bigint;
  open: boolean;
  onToggle: () => void;
}) {
  const credits = BigInt(member.totalCredits || "0");
  const ratio = maxCredits > BigInt(0) ? Number((credits * BigInt(1000)) / maxCredits) / 10 : 0;
  const title =
    member.nickName?.trim() ||
    member.phone ||
    member.email ||
    (member.userId === "unknown" ? "未知 / 系统" : member.userId);
  const subtitle = [
    member.userId !== "unknown" ? member.userId : null,
    member.phone && member.nickName ? member.phone : null,
    member.email && member.nickName ? member.email : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[minmax(0,1.4fr)_120px_100px_minmax(0,1fr)] gap-3 px-4 py-3 text-left hover:bg-slate-50/80"
      >
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 text-slate-400">
            {open ? (
              <IconChevronDown className="size-4" />
            ) : (
              <IconChevronRight className="size-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-slate-950">{title}</p>
            {subtitle ? (
              <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{subtitle}</p>
            ) : null}
            <p className="mt-1 text-[11px] text-slate-500">{member.workspaces.length} 个工作区</p>
          </div>
        </div>
        <p className="text-right text-[13px] font-semibold tabular-nums text-slate-950">
          {formatInteger(member.totalCredits)}
        </p>
        <p className="text-right text-[13px] tabular-nums text-slate-700">{member.totalJobs}</p>
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-900/80"
              style={{ width: `${Math.max(ratio, credits > BigInt(0) ? 2 : 0)}%` }}
            />
          </div>
          <span className="w-10 text-right text-[11px] tabular-nums text-slate-500">
            {ratio.toFixed(0)}%
          </span>
        </div>
      </button>

      {open ? (
        <ul className="space-y-1 bg-slate-50/60 px-4 py-2 pb-3">
          {member.workspaces.map((ws) => (
            <li
              key={`${member.userId}:${ws.workspaceId}`}
              className="grid grid-cols-[minmax(0,1.4fr)_120px_100px_minmax(0,1fr)] gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <div className="min-w-0 pl-6">
                <p className="truncate text-[13px] font-medium text-slate-900">
                  {ws.workspaceName}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                  {ws.workspaceId}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <StatusPill tone={ws.isPersonal ? "muted" : "success"}>
                    {ws.isPersonal ? "个人默认池" : "共享工作区"}
                  </StatusPill>
                  {ws.workspaceStatus ? (
                    <StatusPill tone="muted">{ws.workspaceStatus}</StatusPill>
                  ) : null}
                </div>
              </div>
              <p className="text-right text-[13px] font-medium tabular-nums text-slate-900">
                {formatInteger(ws.credits)}
              </p>
              <p className="text-right text-[13px] tabular-nums text-slate-700">{ws.jobs}</p>
              <div />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
