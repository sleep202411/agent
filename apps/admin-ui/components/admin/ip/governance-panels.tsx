"use client";

import Link from "next/link";
import { IconClipboardCheck, IconExternalLink, IconFlag } from "@tabler/icons-react";
import {
  EmptyRow,
  ErrorBanner,
  formatDate,
  PageHeader,
  reasonLabel,
  statusLabel,
  StatusPill,
  Td,
  Th,
  visibilityLabel,
} from "./shared";
import type { AdminIpOverviewData, ReportRow, ReviewQueueRow } from "./types";
import { emptyIpOverview } from "./types";

export function IpReviewsPanel({
  siteLabel,
  databaseLabel,
  overview,
  error,
}: {
  siteLabel: string;
  databaseLabel: string;
  overview: AdminIpOverviewData | null;
  error: string | null;
}) {
  const rows = (overview ?? emptyIpOverview).reviewQueue;
  return (
    <GovernanceTable
      siteLabel={siteLabel}
      databaseLabel={databaseLabel}
      title="IP 审核队列"
      description="所有 IP 档案发布审批集中在这里扫描，具体审核动作在 IP 详情抽屉内完成。"
      icon={<IconClipboardCheck className="size-4 text-slate-500" />}
      error={error}
      kind="review"
      rows={rows}
    />
  );
}

export function IpReportsPanel({
  siteLabel,
  databaseLabel,
  overview,
  error,
}: {
  siteLabel: string;
  databaseLabel: string;
  overview: AdminIpOverviewData | null;
  error: string | null;
}) {
  const rows = (overview ?? emptyIpOverview).reports;
  return (
    <GovernanceTable
      siteLabel={siteLabel}
      databaseLabel={databaseLabel}
      title="IP 举报处理"
      description="开放举报按风险和时间排序展示。处置动作依附 IP 详情，确保发布状态、举报和审计同处一条链路。"
      icon={<IconFlag className="size-4 text-slate-500" />}
      error={error}
      kind="report"
      rows={rows}
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
  kind,
  rows,
}: {
  siteLabel: string;
  databaseLabel: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  error: string | null;
  kind: "review" | "report";
  rows: ReviewQueueRow[] | ReportRow[];
}) {
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title={title}
        description={description}
      />
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
            去标题库处理
            <IconExternalLink className="size-3.5" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <Th>内容</Th>
                <Th>类型</Th>
                <Th>状态</Th>
                <Th>说明</Th>
                <Th>提交人</Th>
                <Th>时间</Th>
              </tr>
            </thead>
            <tbody>
              {kind === "review"
                ? (rows as ReviewQueueRow[]).map((row) => <ReviewRowView key={row.id} row={row} />)
                : (rows as ReportRow[]).map((row) => <ReportRowView key={row.id} row={row} />)}
              {!rows.length ? (
                <EmptyRow colSpan={6} label={kind === "review" ? "暂无待审核内容" : "暂无举报"} />
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReviewRowView({ row }: { row: ReviewQueueRow }) {
  const targetTitle = row.ip?.title ?? row.episode?.title ?? row.targetId;
  return (
    <tr>
      <Td>
        <p className="max-w-[260px] truncate font-medium text-slate-950">{targetTitle}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {row.ip
            ? `${visibilityLabel(row.ip.listingVisibility)} · ${statusLabel(row.ip.status)}`
            : row.targetId}
        </p>
      </Td>
      <Td>{row.targetType}</Td>
      <Td>
        <StatusPill tone={row.status === "changes_requested" ? "risk" : "warn"}>
          {statusLabel(row.status)}
        </StatusPill>
      </Td>
      <Td>
        <p className="max-w-[360px] truncate text-sm text-slate-700">
          {row.changeSummary ?? "未填写变更说明"}
        </p>
      </Td>
      <Td>
        <p className="max-w-[160px] truncate text-sm text-slate-700">{row.submittedById}</p>
      </Td>
      <Td>
        <p className="text-[12px] text-slate-700">{formatDate(row.submittedAt)}</p>
      </Td>
    </tr>
  );
}

function ReportRowView({ row }: { row: ReportRow }) {
  const targetTitle = row.ip?.title ?? row.episode?.title ?? row.targetId;
  return (
    <tr>
      <Td>
        <p className="max-w-[260px] truncate font-medium text-slate-950">{targetTitle}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{row.targetId}</p>
      </Td>
      <Td>{reasonLabel(row.reason)}</Td>
      <Td>
        <StatusPill
          tone={row.status === "submitted" ? "risk" : row.status === "triaged" ? "warn" : "muted"}
        >
          {row.status}
        </StatusPill>
      </Td>
      <Td>
        <p className="max-w-[360px] truncate text-sm text-slate-700">
          {row.description ?? "举报人未填写详细说明"}
        </p>
      </Td>
      <Td>
        <p className="max-w-[160px] truncate text-sm text-slate-700">
          {row.reporterUserId ?? "匿名"}
        </p>
      </Td>
      <Td>
        <p className="text-[12px] text-slate-700">{formatDate(row.createdAt)}</p>
      </Td>
    </tr>
  );
}
