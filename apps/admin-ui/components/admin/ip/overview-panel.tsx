"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  IconBook2,
  IconClipboardCheck,
  IconExternalLink,
  IconFlag,
  IconShoppingBag,
} from "@tabler/icons-react";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  currencyLabel,
  ErrorBanner,
  formatAmount,
  formatDate,
  IpStatusPill,
  Metric,
  PageHeader,
  reasonLabel,
  StatusPill,
  targetTypeLabel,
} from "./shared";
import type { AdminIpOverviewData, IpRow } from "./types";
import { emptyIpOverview } from "./types";

export function IpOverviewPanel({
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
  const data = overview ?? emptyIpOverview;

  const recentIpColumns = useMemo<ColumnDef<IpRow, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: "IP",
        cell: ({ row }) => {
          const ip = row.original;
          return (
            <>
              <p className="max-w-[260px] truncate font-medium text-slate-950">{ip.title}</p>
              <p className="mt-0.5 max-w-[260px] truncate text-[11px] text-slate-500">
                {ip.slug ?? ip.id}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "roomNumber",
        header: "Room number",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="select-text font-mono text-xs tabular-nums text-slate-600">
            {row.original.roomNumber}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => {
          const ip = row.original;
          return (
            <>
              <IpStatusPill status={ip.status} />
              <p className="mt-1 text-[11px] text-slate-500">
                v{ip.version} · {ip.listingVisibility}
              </p>
            </>
          );
        },
      },
      {
        id: "content",
        header: "内容",
        enableSorting: false,
        cell: ({ row }) => {
          const ip = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{ip.counts.episodes} 集</p>
              <p className="text-[11px] text-slate-500">
                {ip.genres.length ? ip.genres.join(" / ") : "未设置题材"}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "updatedAt",
        header: "更新时间",
        cell: ({ row }) => (
          <p className="text-[12px] text-slate-700">{formatDate(row.original.updatedAt)}</p>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="IP 运营总览"
        description="集中查看发布状态、审核压力、举报风险和最近交易。这里是 IP 管理入口，不承载具体配置表单。"
      >
        <p className="text-[12px] text-slate-500">更新 {formatDate(data.generatedAt)}</p>
      </PageHeader>

      {error ? <ErrorBanner message={error} /> : null}

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="IP 总数" value={data.metrics.totalIps} />
        <Metric label="已发布" value={data.metrics.publishedIps} />
        <Metric label="待审核" value={data.metrics.pendingReviewIps} tone="warn" />
        <Metric label="有效价格" value={data.metrics.activePriceRules} />
        <Metric label="开放举报" value={data.metrics.openReports} tone="risk" />
        <Metric label="7 日订单" value={data.metrics.ordersLast7Days} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <SignalPanel
          title="审核队列"
          href="/ip/reviews"
          icon={<IconClipboardCheck className="size-4 text-slate-500" />}
          emptyLabel="暂无待审核 IP"
          rows={data.reviewQueue.map((item) => ({
            id: item.id,
            title: item.ip?.title ?? item.episode?.title ?? item.targetId,
            subtitle: `${item.targetType} · ${item.status}`,
            meta: item.changeSummary ?? item.submittedById,
            time: item.submittedAt,
            tone: item.status === "changes_requested" ? "risk" : "warn",
          }))}
        />
        <SignalPanel
          title="举报处理"
          href="/ip/reports"
          icon={<IconFlag className="size-4 text-slate-500" />}
          emptyLabel="暂无开放举报"
          rows={data.reports.map((item) => ({
            id: item.id,
            title: item.ip?.title ?? item.episode?.title ?? item.targetId,
            subtitle: `${reasonLabel(item.reason)} · ${item.status}`,
            meta: item.description ?? item.reporterUserId ?? "匿名举报",
            time: item.createdAt,
            tone: item.status === "submitted" ? "risk" : "warn",
          }))}
        />
      </section>

      <section className="grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
        <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <IconBook2 className="size-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-950">最近 IP</h3>
            </div>
            <Link
              href="/ip/titles"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-600 hover:text-slate-950"
            >
              查看列表
              <IconExternalLink className="size-3.5" />
            </Link>
          </div>
          <DataTable
            columns={recentIpColumns}
            data={data.recentIps}
            minWidth={760}
            pageSize={20}
            emptyLabel="暂无 IP 数据"
            className="rounded-none border-0"
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <IconShoppingBag className="size-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-950">最近订单</h3>
            </div>
            <Link
              href="/ip/commerce/orders"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-600 hover:text-slate-950"
            >
              查看订单
              <IconExternalLink className="size-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {data.recentOrders.map((order) => (
              <div key={order.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-950">{order.orderNo}</p>
                  <p className="mt-0.5 truncate text-[12px] text-slate-500">
                    {order.ip?.title ?? order.ipId} · {targetTypeLabel(order.targetType)}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">{formatDate(order.createdAt)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <StatusPill tone={order.status === "fulfilled" ? "success" : "muted"}>
                    {order.status}
                  </StatusPill>
                  <p className="mt-1 text-sm font-semibold text-slate-950">
                    {formatAmount(order.totalAmount)}
                  </p>
                  <p className="text-[11px] text-slate-500">{currencyLabel(order.currency)}</p>
                </div>
              </div>
            ))}
            {!data.recentOrders.length ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">暂无订单流水</div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function SignalPanel({
  title,
  href,
  icon,
  rows,
  emptyLabel,
}: {
  title: string;
  href: string;
  icon: React.ReactNode;
  rows: Array<{
    id: string;
    title: string;
    subtitle: string;
    meta: string;
    time: string;
    tone: "warn" | "risk";
  }>;
  emptyLabel: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        </div>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-600 hover:text-slate-950"
        >
          进入
          <IconExternalLink className="size-3.5" />
        </Link>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((row) => (
          <div key={row.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-950">{row.title}</p>
              <p className="mt-0.5 text-[12px] text-slate-500">{row.subtitle}</p>
              <p className="mt-1 max-w-[520px] truncate text-[12px] text-slate-500">{row.meta}</p>
            </div>
            <div className="shrink-0 text-right">
              <StatusPill tone={row.tone}>{row.tone === "risk" ? "风险" : "待处理"}</StatusPill>
              <p className="mt-1 text-[11px] text-slate-400">{formatDate(row.time)}</p>
            </div>
          </div>
        ))}
        {!rows.length ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">{emptyLabel}</div>
        ) : null}
      </div>
    </div>
  );
}
