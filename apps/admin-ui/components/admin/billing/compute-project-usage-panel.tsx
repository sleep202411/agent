"use client";

// Project consumption rolled up by workspace pot.
// Backed by GET /billing/usage/project-compute.

import { useRef, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import {
  IconChevronDown,
  IconChevronRight,
  IconFolders,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  ErrorBanner,
  Metric,
  PageHeader,
  StatusPill,
  TextInput,
  formatDate,
  formatInteger,
  requestEnvelope,
  toErrorMessage,
} from "./shared";
import type {
  AdminComputeProjectUsageData,
  AdminComputeProjectUsageSort,
  AdminComputeProjectUsageWorkspace,
} from "./types";

const RANGE_OPTIONS = [7, 30, 90] as const;
const KIND_TABS: { key: AdminComputeProjectUsageData["workspaceKind"]; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "shared", label: "共享工作区" },
  { key: "personal", label: "个人默认池" },
];
const SORT_TABS: { key: AdminComputeProjectUsageSort; label: string }[] = [
  { key: "credits", label: "消耗最多" },
  { key: "recent", label: "最近活跃" },
];

const ROW_GRID = "grid-cols-[minmax(0,1.5fr)_140px_100px_72px_72px_72px] gap-3";

const emptyUsage: AdminComputeProjectUsageData = {
  rangeDays: 30,
  workspaceKind: "all",
  sort: "credits",
  workspaceId: null,
  totalCredits: "0",
  workspaceCount: 0,
  projectCount: 0,
  workspaces: [],
};

export function BillingComputeProjectUsagePanel({
  siteLabel,
  databaseLabel,
  initialData,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialData: AdminComputeProjectUsageData | null;
  initialError?: string | null;
}) {
  const [days, setDays] = useState<number>(initialData?.rangeDays ?? 30);
  const [workspaceKind, setWorkspaceKind] = useState<AdminComputeProjectUsageData["workspaceKind"]>(
    initialData?.workspaceKind ?? "all"
  );
  const [sort, setSort] = useState<AdminComputeProjectUsageSort>(initialData?.sort ?? "credits");
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [data, setData] = useState<AdminComputeProjectUsageData>(initialData ?? emptyUsage);
  const [previousInitialData, setPreviousInitialData] = useState(initialData);
  const { busy: loading, begin } = useAdminOperation();
  const loadedParams = useRef(
    new URLSearchParams({
      days: String(initialData?.rangeDays ?? 30),
      workspaceKind: initialData?.workspaceKind ?? "all",
      sort: initialData?.sort ?? "credits",
      limit: "100",
      ...(initialData?.workspaceId ? { workspaceId: initialData.workspaceId } : {}),
    })
  );
  const filters = useRef({ days, workspaceKind, sort });
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  async function refresh(next?: {
    days?: number;
    workspaceKind?: AdminComputeProjectUsageData["workspaceKind"];
    sort?: AdminComputeProjectUsageSort;
  }) {
    const operation = begin("read");
    if (!operation) return;
    const nextDays = next?.days ?? filters.current.days;
    const nextKind = next?.workspaceKind ?? filters.current.workspaceKind;
    const nextSort = next?.sort ?? filters.current.sort;
    filters.current = { days: nextDays, workspaceKind: nextKind, sort: nextSort };
    setDays(nextDays);
    setWorkspaceKind(nextKind);
    setSort(nextSort);
    setError(null);
    try {
      const params = new URLSearchParams({
        days: String(nextDays),
        workspaceKind: nextKind,
        sort: nextSort,
        limit: "100",
      });
      if (workspaceFilter.trim()) {
        const trimmed = workspaceFilter.trim();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
          params.set("workspaceId", trimmed);
        } else {
          params.set("workspaceQuery", trimmed);
        }
      }
      if (projectQuery.trim()) params.set("projectQuery", projectQuery.trim());
      const nextData = await requestEnvelope<AdminComputeProjectUsageData>(
        `/api/admin/billing/usage/project-compute?${params.toString()}`,
        operation.signal
      );
      if (!operation.current()) return;
      loadedParams.current = params;
      setData(nextData);
      setExpanded(new Set());
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  async function loadMore(workspace?: AdminComputeProjectUsageWorkspace) {
    if (loading) return;
    const offset = workspace ? workspace.nextProjectOffset : data.nextWorkspaceOffset;
    if (offset == null) return;
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    const params = new URLSearchParams(loadedParams.current);
    if (workspace) {
      params.set("workspaceId", workspace.workspaceId);
      params.set("projectOffset", String(offset));
      params.delete("workspaceOffset");
    } else {
      params.set("workspaceOffset", String(offset));
      params.delete("projectOffset");
    }
    try {
      const page = await requestEnvelope<AdminComputeProjectUsageData>(
        `/api/admin/billing/usage/project-compute?${params.toString()}`,
        operation.signal
      );
      if (!operation.current()) return;
      setData((previous) => {
        if (workspace) {
          const incoming = page.workspaces.find(
            (item) => item.workspaceId === workspace.workspaceId
          );
          return {
            ...previous,
            workspaces: previous.workspaces.map((item) =>
              item.workspaceId !== workspace.workspaceId
                ? item
                : {
                    ...item,
                    nextProjectOffset: incoming?.nextProjectOffset ?? null,
                    projects: [
                      ...new Map(
                        [...item.projects, ...(incoming?.projects ?? [])].map((project) => [
                          project.projectId,
                          project,
                        ])
                      ).values(),
                    ],
                  }
            ),
          };
        }
        return {
          ...previous,
          nextWorkspaceOffset: page.nextWorkspaceOffset ?? null,
          workspaces: [
            ...new Map(
              [...previous.workspaces, ...page.workspaces].map((item) => [item.workspaceId, item])
            ).values(),
          ],
        };
      });
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  if (initialData !== previousInitialData) {
    setPreviousInitialData(initialData);
    if (
      initialData &&
      initialData.rangeDays === days &&
      initialData.workspaceKind === workspaceKind &&
      initialData.sort === sort &&
      initialData.workspaceId === (workspaceFilter.trim() || null) &&
      !projectQuery.trim()
    ) {
      setData(initialData);
    }
  }

  function toggle(workspaceId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="项目积分消耗"
        icon={<IconFolders className="size-5" />}
        description="按工作区汇总各项目消耗。默认看消耗最多的，也可切到最近有消耗的。"
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
        <Metric label="涉及工作区" value={data.workspaceCount} />
        <Metric label="涉及项目" value={data.projectCount} />
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
            {SORT_TABS.map((tab) => {
              const active = tab.key === sort;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    void refresh({ sort: tab.key });
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

          <div className="min-w-[200px] flex-1">
            <TextInput
              value={workspaceFilter}
              onChange={(event) => setWorkspaceFilter(event.target.value)}
              placeholder="工作区名 / UUID"
              onKeyDown={(event) => {
                if (event.key === "Enter") void refresh();
              }}
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <TextInput
              value={projectQuery}
              onChange={(event) => setProjectQuery(event.target.value)}
              placeholder="项目名"
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
        <div
          className={`grid ${ROW_GRID} border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-[11px] font-medium tracking-wide text-slate-500 uppercase`}
        >
          <span>工作区</span>
          <span className="text-right">最近消耗</span>
          <span className="text-right">积分</span>
          <span className="text-right">次数</span>
          <span className="text-right">生视频</span>
          <span className="text-right">生图</span>
        </div>

        {data.workspaces.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-slate-500">
            {loading ? "加载中…" : "该时间窗暂无项目消耗。"}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.workspaces.map((workspace) => (
              <WorkspaceRow
                key={workspace.workspaceId}
                workspace={workspace}
                open={expanded.has(workspace.workspaceId)}
                onToggle={() => toggle(workspace.workspaceId)}
                loading={loading}
                onLoadMore={() => void loadMore(workspace)}
              />
            ))}
          </ul>
        )}
        {data.nextWorkspaceOffset != null ? (
          <Button
            type="button"
            variant="outline"
            className="m-4"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            Load more workspaces
          </Button>
        ) : null}
      </section>
    </div>
  );
}

function WorkspaceRow({
  workspace,
  open,
  onToggle,
  onLoadMore,
  loading,
}: {
  workspace: AdminComputeProjectUsageWorkspace;
  open: boolean;
  onToggle: () => void;
  onLoadMore: () => void;
  loading: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={`grid w-full ${ROW_GRID} px-4 py-3 text-left hover:bg-slate-50/80`}
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
            <p className="truncate text-[13px] font-medium text-slate-950">
              {workspace.workspaceName}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
              {workspace.workspaceId}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <StatusPill tone={workspace.isPersonal ? "muted" : "success"}>
                {workspace.isPersonal ? "个人默认池" : "共享工作区"}
              </StatusPill>
              {workspace.workspaceStatus ? (
                <StatusPill tone="muted">{workspace.workspaceStatus}</StatusPill>
              ) : null}
              <span className="text-[11px] text-slate-500">{workspace.projectCount} 个项目</span>
            </div>
          </div>
        </div>
        <p className="text-right text-[12px] tabular-nums text-slate-600">
          {workspace.lastSpentAt ? formatDate(workspace.lastSpentAt) : "—"}
        </p>
        <p className="text-right text-[13px] font-semibold tabular-nums text-slate-950">
          {formatInteger(workspace.totalCredits)}
        </p>
        <p className="text-right text-[13px] tabular-nums text-slate-700">{workspace.totalJobs}</p>
        <p className="text-right text-[13px] tabular-nums text-slate-700">
          {workspace.totalVideoJobs}
        </p>
        <p className="text-right text-[13px] tabular-nums text-slate-700">
          {workspace.totalImageJobs}
        </p>
      </button>

      {open ? (
        <ul className="space-y-1 bg-slate-50/60 px-4 py-2 pb-3">
          {workspace.projects.map((project) => (
            <li
              key={`${workspace.workspaceId}:${project.projectId ?? "unassigned"}`}
              className={`grid ${ROW_GRID} rounded-lg border border-slate-200 bg-white px-3 py-2`}
            >
              <div className="min-w-0 pl-6">
                <p className="truncate text-[13px] font-medium text-slate-900">
                  {project.projectName?.trim() ||
                    (project.projectId ? project.projectId : "未归属项目")}
                </p>
                {project.projectId ? (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                    {project.projectId}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] text-slate-500">账本未记录项目</p>
                )}
              </div>
              <p className="text-right text-[12px] tabular-nums text-slate-600">
                {project.lastSpentAt ? formatDate(project.lastSpentAt) : "—"}
              </p>
              <p className="text-right text-[13px] font-medium tabular-nums text-slate-900">
                {formatInteger(project.credits)}
              </p>
              <p className="text-right text-[13px] tabular-nums text-slate-700">{project.jobs}</p>
              <p className="text-right text-[13px] tabular-nums text-slate-700">
                {project.videoJobs}
              </p>
              <p className="text-right text-[13px] tabular-nums text-slate-700">
                {project.imageJobs}
              </p>
            </li>
          ))}
          {workspace.nextProjectOffset != null ? (
            <li>
              <Button type="button" variant="outline" disabled={loading} onClick={onLoadMore}>
                Load more projects
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}
