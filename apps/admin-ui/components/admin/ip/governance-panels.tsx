"use client";

import { useMemo, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import Link from "next/link";
import { IconClipboardCheck, IconExternalLink, IconFlag, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  ErrorBanner,
  formatDate,
  PageHeader,
  reasonLabel,
  requestEnvelope,
  statusLabel,
  StatusPill,
  toErrorMessage,
  visibilityLabel,
} from "./shared";
import type { AdminIpOverviewData, ReportRow, ReviewQueueRow } from "./types";
import { emptyIpOverview } from "./types";

export function IpReviewsPanel({
  siteLabel,
  databaseLabel,
  overview,
  error: initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  overview: AdminIpOverviewData | null;
  error: string | null;
}) {
  const [data, setData] = useState(overview ?? emptyIpOverview);
  const { busy: loading, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(initialError);

  async function refresh() {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      const result = await requestEnvelope<AdminIpOverviewData>("/api/admin/ip-commerce/overview", {
        signal: operation.signal,
      });
      if (operation.current()) setData(result);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  return (
    <GovernanceTable
      siteLabel={siteLabel}
      databaseLabel={databaseLabel}
      title="IP 审核队列"
      description="所有 IP 档案发布审批集中在这里扫描，具体审核动作在 IP 详情抽屉内完成。"
      icon={<IconClipboardCheck className="size-4 text-slate-500" />}
      error={error}
      loading={loading}
      onRefresh={refresh}
      kind="review"
      rows={data.reviewQueue}
    />
  );
}

export function IpReportsPanel({
  siteLabel,
  databaseLabel,
  overview,
  error: initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  overview: AdminIpOverviewData | null;
  error: string | null;
}) {
  const [data, setData] = useState(overview ?? emptyIpOverview);
  const { busy: loading, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(initialError);

  async function refresh() {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      const result = await requestEnvelope<AdminIpOverviewData>("/api/admin/ip-commerce/overview", {
        signal: operation.signal,
      });
      if (operation.current()) setData(result);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  return (
    <GovernanceTable
      siteLabel={siteLabel}
      databaseLabel={databaseLabel}
      title="IP 举报处理"
      description="开放举报按风险和时间排序展示。处置动作依附 IP 详情，确保发布状态、举报和审计同处一条链路。"
      icon={<IconFlag className="size-4 text-slate-500" />}
      error={error}
      loading={loading}
      onRefresh={refresh}
      kind="report"
      rows={data.reports}
    />
  );
}

function GovernanceTable({
  siteLabel,
  databaseLabel,
  title,
  description,
  icon,
  error,
  loading,
  onRefresh,
  kind,
  rows,
}: {
  siteLabel: string;
  databaseLabel: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  error: string | null;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  kind: "review" | "report";
  rows: ReviewQueueRow[] | ReportRow[];
}) {
  const reviewColumns = useMemo<ColumnDef<ReviewQueueRow, unknown>[]>(
    () => [
      {
        accessorKey: "targetId",
        header: "内容",
        cell: ({ row }) => {
          const item = row.original;
          const targetTitle = item.ip?.title ?? item.episode?.title ?? item.targetId;
          return (
            <>
              <p className="max-w-[260px] truncate font-medium text-slate-950">{targetTitle}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {item.ip
                  ? `${visibilityLabel(item.ip.listingVisibility)} · ${statusLabel(item.ip.status)}`
                  : item.targetId}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "targetType",
        header: "类型",
        cell: ({ row }) => row.original.targetType,
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => (
          <StatusPill tone={row.original.status === "changes_requested" ? "risk" : "warn"}>
            {statusLabel(row.original.status)}
          </StatusPill>
        ),
      },
      {
        accessorKey: "changeSummary",
        header: "说明",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="max-w-[360px] truncate text-sm text-slate-700">
            {row.original.changeSummary ?? "未填写变更说明"}
          </p>
        ),
      },
      {
        accessorKey: "submittedById",
        header: "提交人",
        cell: ({ row }) => (
          <p className="max-w-[160px] truncate text-sm text-slate-700">
            {row.original.submittedById}
          </p>
        ),
      },
      {
        accessorKey: "submittedAt",
        header: "时间",
        cell: ({ row }) => (
          <p className="text-[12px] text-slate-700">{formatDate(row.original.submittedAt)}</p>
        ),
      },
    ],
    []
  );

  const reportColumns = useMemo<ColumnDef<ReportRow, unknown>[]>(
    () => [
      {
        accessorKey: "targetId",
        header: "内容",
        cell: ({ row }) => {
          const item = row.original;
          const targetTitle = item.ip?.title ?? item.episode?.title ?? item.targetId;
          return (
            <>
              <p className="max-w-[260px] truncate font-medium text-slate-950">{targetTitle}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{item.targetId}</p>
            </>
          );
        },
      },
      {
        accessorKey: "reason",
        header: "类型",
        cell: ({ row }) => reasonLabel(row.original.reason),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => (
          <StatusPill
            tone={
              row.original.status === "submitted"
                ? "risk"
                : row.original.status === "triaged"
                  ? "warn"
                  : "muted"
            }
          >
            {row.original.status}
          </StatusPill>
        ),
      },
      {
        accessorKey: "description",
        header: "说明",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="max-w-[360px] truncate text-sm text-slate-700">
            {row.original.description ?? "举报人未填写详细说明"}
          </p>
        ),
      },
      {
        accessorKey: "reporterUserId",
        header: "提交人",
        cell: ({ row }) => (
          <p className="max-w-[160px] truncate text-sm text-slate-700">
            {row.original.reporterUserId ?? "匿名"}
          </p>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "时间",
        cell: ({ row }) => (
          <p className="text-[12px] text-slate-700">{formatDate(row.original.createdAt)}</p>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title={title}
        description={description}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void onRefresh()}
          disabled={loading}
        >
          <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
          刷新
        </Button>
      </PageHeader>
      {error ? <ErrorBanner message={error} /> : null}

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="text-sm font-semibold text-slate-950">
              {kind === "review" ? "审核项" : "举报项"}
            </h3>
          </div>
          <Link
            href="/ip/titles"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-600 hover:text-slate-950"
          >
            去作品库处理
            <IconExternalLink className="size-3.5" />
          </Link>
        </div>
        {kind === "review" ? (
          <DataTable
            columns={reviewColumns}
            data={rows as ReviewQueueRow[]}
            loading={loading}
            minWidth={980}
            pageSize={20}
            emptyLabel="暂无待审核内容"
            className="rounded-none border-0"
          />
        ) : (
          <DataTable
            columns={reportColumns}
            data={rows as ReportRow[]}
            loading={loading}
            minWidth={980}
            pageSize={20}
            emptyLabel="暂无举报"
            className="rounded-none border-0"
          />
        )}
      </section>
    </div>
  );
}
