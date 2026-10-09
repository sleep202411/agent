"use client";
import { IpChannelPanel } from "./channel-panel";

import { useRef, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import Link from "next/link";
import {
  IconAlertTriangle,
  IconBook2,
  IconCheck,
  IconEye,
  IconRefresh,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
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
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  assetPurposeLabel,
  currencyLabel,
  defaultReviewReason,
  ErrorBanner,
  formatAmount,
  formatDate,
  getPublishReadiness,
  IpStatusPill,
  Metric,
  PageHeader,
  reasonLabel,
  requestEnvelope,
  statusLabel,
  StatusPill,
  targetTypeLabel,
  toErrorMessage,
  visibilityLabel,
} from "./shared";
import type {
  AdminIpDetail,
  AdminIpsData,
  AdminIpTaxonomyData,
  IpRow,
  IpStatus,
  ReportRow,
} from "./types";
import { emptyIps, emptyIpTaxonomy } from "./types";
import { IpPublishersSection } from "./ip-publishers-section";
import { IpRevenueSection } from "./ip-revenue-section";

// shadcn SelectItem value cannot be an empty string, so the "全部/默认" filter
// options use this sentinel and map back to "" in the onValueChange handler.
const ALL_VALUE = "__all__";

export function IpTitlesPanel({
  siteLabel,
  databaseLabel,
  initialIps,
  taxonomy,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialIps: AdminIpsData | null;
  taxonomy: AdminIpTaxonomyData | null;
  initialError: string | null;
}) {
  const [ips, setIps] = useState(initialIps ?? emptyIps);
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState("");
  const [genreCode, setGenreCode] = useState("");
  const [channelType, setChannelType] = useState<"" | "ip" | "community">("");
  const [locale, setLocale] = useState("");
  const [query, setQuery] = useState("");
  const { busy: loading, begin: beginList } = useAdminOperation();
  const loadingMore = loading;
  const [loadedQuery, setLoadedQuery] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [selectedIp, setSelectedIp] = useState<AdminIpDetail | null>(null);
  const { busy: detailLoading, begin: beginDetail } = useAdminOperation();
  const detailRead = useRef<ReturnType<typeof beginDetail>>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const terms = taxonomy ?? emptyIpTaxonomy;
  const genreTerms = terms.items.filter((term) => term.type === "genre");

  function queryString(extra?: Record<string, string>) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (visibility) params.set("listingVisibility", visibility);
    if (genreCode) params.set("genreCodes", genreCode);
    if (channelType) params.set("channelType", channelType);
    if (locale) params.set("locale", locale);
    if (query.trim()) params.set("q", query.trim());
    if (extra) {
      for (const [key, value] of Object.entries(extra)) params.set(key, value);
    }
    const text = params.toString();
    return text ? `?${text}` : "";
  }

  function localeQueryString() {
    const params = new URLSearchParams();
    if (locale) params.set("locale", locale);
    const text = params.toString();
    return text ? `?${text}` : "";
  }

  async function refreshIps() {
    const operation = beginList("read");
    if (!operation) return;
    const params = queryString();
    setError(null);
    try {
      const next = await requestEnvelope<AdminIpsData>(`/api/admin/ip-commerce/ips${params}`, {
        signal: operation.signal,
      });
      if (operation.current()) {
        setIps(next);
        setLoadedQuery(params);
      }
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  async function loadMoreIps() {
    if (!ips.nextCursor) return;
    if (queryString() !== loadedQuery) {
      await refreshIps();
      return;
    }
    const operation = beginList("read");
    if (!operation) return;
    setError(null);
    try {
      const next = await requestEnvelope<AdminIpsData>(
        `/api/admin/ip-commerce/ips${queryString({ cursor: ips.nextCursor })}`,
        { signal: operation.signal }
      );
      if (operation.current())
        setIps((current) => ({
          items: [...current.items, ...next.items],
          nextCursor: next.nextCursor,
        }));
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  async function openIpDetail(ipId: string) {
    const operation = beginDetail("read");
    if (!operation) return;
    detailRead.current = operation;
    setDetailId(ipId);
    setSelectedIp((current) => (current?.id === ipId ? current : null));
    setDetailError(null);
    try {
      const data = await requestEnvelope<{ ip: AdminIpDetail }>(
        `/api/admin/ip-commerce/ips/${encodeURIComponent(ipId)}${localeQueryString()}`,
        { signal: operation.signal }
      );
      if (operation.current()) setSelectedIp(data.ip);
    } catch (err) {
      if (operation.current()) setDetailError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  function closeIpDetail() {
    detailRead.current?.cancel();
    detailRead.current?.finish();
    detailRead.current = null;
    setDetailId(null);
    setSelectedIp(null);
    setDetailError(null);
  }

  async function updateSelectedIpPublication(input: {
    status: IpStatus;
    listingVisibility: IpRow["listingVisibility"];
    reason: string;
  }) {
    if (!selectedIp) return;
    const operation = beginDetail();
    if (!operation) return;
    detailRead.current = operation;
    try {
      const data = await requestEnvelope<{ ip: AdminIpDetail }>(
        `/api/admin/ip-commerce/ips/${encodeURIComponent(selectedIp.id)}/publication`,
        {
          method: "PATCH",
          signal: operation.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...input, expectedVersion: selectedIp.version }),
        }
      );
      if (!operation.current()) return;
      setSelectedIp(data.ip);
      await refreshIps();
    } catch (err) {
      if (operation.current()) throw err;
    } finally {
      operation.finish();
    }
  }

  async function resolveSelectedReport(
    reportId: string,
    input: {
      status: "triaged" | "actioned" | "dismissed";
      actionType?: "hide" | "suspend_sales" | "takedown" | "restore" | "reject" | "approve";
      reason?: string;
      resolutionNote?: string;
    }
  ) {
    if (!selectedIp) return;
    const operation = beginDetail();
    if (!operation) return;
    detailRead.current = operation;
    try {
      await requestEnvelope<unknown>(
        `/api/admin/ip-commerce/reports/${encodeURIComponent(reportId)}`,
        {
          method: "PATCH",
          signal: operation.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      if (!operation.current()) return;
      const data = await requestEnvelope<{ ip: AdminIpDetail }>(
        `/api/admin/ip-commerce/ips/${encodeURIComponent(selectedIp.id)}${localeQueryString()}`,
        { signal: operation.signal }
      );
      if (!operation.current()) return;
      setSelectedIp(data.ip);
      await refreshIps();
    } catch (err) {
      if (operation.current()) throw err;
    } finally {
      operation.finish();
    }
  }

  const columns: ColumnDef<IpRow, unknown>[] = [
    {
      accessorKey: "title",
      header: "IP",
      cell: ({ row }) => {
        const ip = row.original;
        return (
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
              <IconBook2 className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="max-w-[260px] truncate text-sm font-medium text-slate-950">
                {ip.title}
              </p>
              <p className="mt-0.5 max-w-[260px] truncate text-[12px] text-slate-500">
                {ip.slug ?? ip.id}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      id: "channelType",
      header: "频道",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-slate-700">
          {row.original.channelType === "ip" ? "IP 频道" : "社区频道"}
        </span>
      ),
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
              {visibilityLabel(ip.listingVisibility)}
            </p>
          </>
        );
      },
    },
    {
      id: "pricing",
      header: "定价",
      enableSorting: false,
      cell: ({ row }) => {
        const ip = row.original;
        return (
          <>
            <p className="text-sm font-medium text-slate-950">
              {ip.pricing.bundle
                ? `${formatAmount(ip.pricing.bundle.amount)} ${currencyLabel(
                    ip.pricing.bundle.currency
                  )}`
                : "免费/未定价"}
            </p>
            <p className="text-[12px] text-slate-500">{ip.pricing.activePriceCount} 条有效价格</p>
          </>
        );
      },
    },
    {
      id: "sales",
      header: "销售/权益",
      enableSorting: false,
      cell: ({ row }) => {
        const ip = row.original;
        return (
          <>
            <p className="text-sm text-slate-700">{ip.counts.purchaseOrders} 订单</p>
            <p className="text-[12px] text-slate-500">{ip.counts.entitlements} 权益</p>
          </>
        );
      },
    },
    {
      id: "review",
      header: "审核风险",
      enableSorting: false,
      cell: ({ row }) => {
        const ip = row.original;
        return (
          <>
            {ip.review.needsAttention || ip.review.openReportCount ? (
              <StatusPill tone={ip.review.openReportCount ? "risk" : "warn"}>
                {ip.review.openReportCount ? `${ip.review.openReportCount} 举报` : "待处理"}
              </StatusPill>
            ) : (
              <StatusPill tone="success">正常</StatusPill>
            )}
            <p className="mt-1 text-[11px] text-slate-500">v{ip.version}</p>
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
            <p className="max-w-[180px] truncate text-sm text-slate-700">
              {ip.genres.length ? ip.genres.join(" / ") : "未设置题材"}
            </p>
            <p className="text-[12px] text-slate-500">
              {ip.counts.episodes} 集 · {ip.localization.locale}
              {ip.localization.isFallback ? " · 回退" : ""}
            </p>
          </>
        );
      },
    },
    {
      accessorKey: "updatedAt",
      header: "更新时间",
      cell: ({ row }) => {
        const ip = row.original;
        return (
          <>
            <p className="text-[12px] text-slate-700">{formatDate(ip.updatedAt)}</p>
            <p className="text-[11px] text-slate-500">
              {ip.publishedAt ? `发布 ${formatDate(ip.publishedAt)}` : "未发布"}
            </p>
          </>
        );
      },
    },
    {
      id: "actions",
      header: "操作",
      enableSorting: false,
      meta: { pin: "right" },
      cell: ({ row }) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void openIpDetail(row.original.id)}
          disabled={detailLoading}
        >
          <IconEye className="size-3.5" />
          查看
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="IP 作品库"
        description="面向内容运营的主列表，负责状态扫描、审核进入、发布动作和风险追踪。"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="grid gap-2 lg:grid-cols-[minmax(200px,1fr)_110px_120px_120px_120px_120px_auto]">
            <label className="relative block">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 w-full pl-9"
                placeholder="Search title, room number, slug or summary"
              />
            </label>
            <Select
              value={locale || ALL_VALUE}
              onValueChange={(value) => setLocale(value === ALL_VALUE ? "" : value)}
            >
              <SelectTrigger className="h-9 w-full" aria-label="语言">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>默认语言</SelectItem>
                <SelectItem value="zh-CN">简体中文</SelectItem>
                <SelectItem value="en-US">English</SelectItem>
                <SelectItem value="zh-HK">繁體中文</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={channelType || ALL_VALUE}
              onValueChange={(value) =>
                setChannelType(value === ALL_VALUE ? "" : (value as "ip" | "community"))
              }
            >
              <SelectTrigger className="h-9 w-full" aria-label="频道类型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>全部频道</SelectItem>
                <SelectItem value="ip">IP 频道</SelectItem>
                <SelectItem value="community">社区频道</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={genreCode || ALL_VALUE}
              onValueChange={(value) => setGenreCode(value === ALL_VALUE ? "" : value)}
            >
              <SelectTrigger className="h-9 w-full" aria-label="题材">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>全部题材</SelectItem>
                {genreTerms.map((term) => (
                  <SelectItem key={term.id} value={term.code}>
                    {term.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={status || ALL_VALUE}
              onValueChange={(value) => setStatus(value === ALL_VALUE ? "" : value)}
            >
              <SelectTrigger className="h-9 w-full" aria-label="状态">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>全部状态</SelectItem>
                <SelectItem value="submitted">待审核</SelectItem>
                <SelectItem value="in_review">审核中</SelectItem>
                <SelectItem value="approved">已批准</SelectItem>
                <SelectItem value="scheduled">已排期</SelectItem>
                <SelectItem value="published">已发布</SelectItem>
                <SelectItem value="hidden">隐藏</SelectItem>
                <SelectItem value="suspended">暂停销售</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={visibility || ALL_VALUE}
              onValueChange={(value) => setVisibility(value === ALL_VALUE ? "" : value)}
            >
              <SelectTrigger className="h-9 w-full" aria-label="可见性">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>全部可见性</SelectItem>
                <SelectItem value="public">公开</SelectItem>
                <SelectItem value="unlisted">仅链接</SelectItem>
                <SelectItem value="private">私有</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refreshIps()}
                disabled={loading}
              >
                应用
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refreshIps()}
                disabled={loading}
              >
                <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={ips.items}
          loading={loading}
          minWidth={1180}
          pageSize={20}
          emptyLabel="暂无 IP 内容"
          className="rounded-none border-0"
        />
        {ips.nextCursor ? (
          <div className="flex justify-center border-t border-slate-200 px-4 py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadMoreIps()}
              disabled={loadingMore}
            >
              {loadingMore ? "加载中…" : "加载更多"}
            </Button>
          </div>
        ) : null}
      </section>

      <IpDetailDrawer
        key={detailId ?? "closed"}
        ip={selectedIp}
        locale={locale}
        loading={detailLoading}
        error={detailError}
        onClose={closeIpDetail}
        onRefresh={(ipId) => {
          void openIpDetail(ipId);
          void refreshIps();
        }}
        onUpdatePublication={updateSelectedIpPublication}
        onResolveReport={resolveSelectedReport}
      />
    </div>
  );
}

function IpDetailDrawer({
  ip,
  locale,
  loading,
  error,
  onClose,
  onRefresh,
  onUpdatePublication,
  onResolveReport,
}: {
  ip: AdminIpDetail | null;
  locale: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: (ipId: string) => void;
  onUpdatePublication: (input: {
    status: IpStatus;
    listingVisibility: IpRow["listingVisibility"];
    reason: string;
  }) => Promise<void>;
  onResolveReport: (
    reportId: string,
    input: {
      status: "triaged" | "actioned" | "dismissed";
      actionType?: "hide" | "suspend_sales" | "takedown" | "restore" | "reject" | "approve";
      reason?: string;
      resolutionNote?: string;
    }
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState<{
    ipId: string;
    status: IpStatus;
    visibility: IpRow["listingVisibility"];
    reason: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [reportSavingId, setReportSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const open = Boolean(ip || loading || error);

  const status =
    ip && draft?.ipId === ip.id ? draft.status : ip?.status === "draft" ? "in_review" : ip?.status;
  const visibility = ip && draft?.ipId === ip.id ? draft.visibility : ip?.listingVisibility;
  const reason =
    ip && draft?.ipId === ip.id ? draft.reason : ip ? defaultReviewReason(ip.status) : "";
  const publishReadiness = ip ? getPublishReadiness(ip) : null;

  function updateDraft(next: Partial<NonNullable<typeof draft>>) {
    if (!ip || saving || loading || reportSavingId) return;
    setDraft({
      ipId: ip.id,
      status: status ?? "in_review",
      visibility: visibility ?? "private",
      reason,
      ...next,
    });
  }

  async function submitAction(nextStatus?: IpStatus) {
    if (!ip || saving || loading || reportSavingId) return;
    const finalStatus = nextStatus ?? status ?? "in_review";
    const draftVisibility = visibility ?? "private";
    const finalVisibility =
      finalStatus === "published" || finalStatus === "scheduled"
        ? "public"
        : finalStatus === "changes_requested"
          ? "private"
          : draftVisibility;
    const finalReason = reason.trim();
    if (!finalReason) {
      setActionError("请填写审核原因或发布说明。");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await onUpdatePublication({
        status: finalStatus,
        listingVisibility: finalVisibility,
        reason: finalReason,
      });
    } catch (err) {
      setActionError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function submitReportAction(
    report: ReportRow,
    input: {
      status: "triaged" | "actioned" | "dismissed";
      actionType?: "hide" | "suspend_sales" | "takedown" | "restore" | "reject" | "approve";
      reason?: string;
      resolutionNote?: string;
    }
  ) {
    if (reportSavingId || saving || loading) return;
    setReportSavingId(report.id);
    setActionError(null);
    try {
      await onResolveReport(report.id, input);
    } catch (err) {
      setActionError(toErrorMessage(err));
    } finally {
      setReportSavingId(null);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex w-full flex-col gap-0 overflow-hidden bg-white p-0 sm:max-w-3xl"
      >
        <SheetHeader className="flex shrink-0 flex-row items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-[12px] font-medium text-slate-500">IP 审核详情</p>
            <SheetTitle className="mt-1 text-lg font-semibold text-slate-950">
              {ip?.title ?? "正在加载"}
            </SheetTitle>
            {ip ? (
              <p className="mt-1 text-[12px] text-slate-500">
                Room {ip.roomNumber} · {ip.id} · v{ip.version}
              </p>
            ) : null}
          </div>
          <SheetClose asChild>
            <button
              type="button"
              className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950"
              aria-label="关闭"
            >
              <IconX className="size-4" />
            </button>
          </SheetClose>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              正在加载 IP 详情...
            </div>
          ) : null}
          {error ? <ErrorBanner message={error} /> : null}
          {ip ? (
            <div className="space-y-4">
              <IpChannelPanel
                key={`${ip.id}:${ip.version}`}
                ipId={ip.id}
                version={ip.version}
                channelType={ip.channelType}
                onSaved={() => onRefresh(ip.id)}
              />
              <Link
                href={`/ip/titles/${encodeURIComponent(ip.id)}/production`}
                className="inline-block text-sm underline"
              >
                Production review evidence
              </Link>
              <section className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-2">
                <DetailCell
                  label="Channel"
                  value={ip.channelType === "ip" ? "IP 频道" : "社区频道"}
                />
                <DetailCell label="状态" value={statusLabel(ip.status)} />
                <DetailCell label="可见性" value={visibilityLabel(ip.listingVisibility)} />
                <DetailCell
                  label="题材"
                  value={ip.genres.length ? ip.genres.join(" / ") : "未设置"}
                />
                <DetailCell label="源语言" value={ip.sourceLocale} />
              </section>

              <section className="rounded-xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold text-slate-950">内容摘要</h4>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">
                  {ip.summary || ip.description || "暂无简介"}
                </p>
              </section>

              <IpPublishersSection
                key={`${ip.id}:publishers:${ip.version}`}
                ipId={ip.id}
                assigned={ip.publishers ?? []}
                onSaved={() => onRefresh(ip.id)}
              />

              {publishReadiness ? (
                <section className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-950">发布前检查</h4>
                      <p className="mt-1 text-[12px] leading-5 text-slate-500">
                        与发布拦截一致，未满足时只能批准或退回，不能直接发布。
                      </p>
                    </div>
                    <StatusPill tone={publishReadiness.ready ? "success" : "warn"}>
                      {publishReadiness.ready ? "可发布" : "需补齐"}
                    </StatusPill>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {publishReadiness.checks.map((check) => (
                      <div
                        key={check.key}
                        className={cn(
                          "flex items-start gap-3 rounded-lg border px-3 py-2",
                          check.done
                            ? "border-emerald-100 bg-emerald-50"
                            : "border-amber-200 bg-amber-50"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                            check.done
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                          )}
                        >
                          {check.done ? (
                            <IconCheck className="size-3.5" />
                          ) : (
                            <IconAlertTriangle className="size-3.5" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-950">{check.label}</p>
                          <p className="mt-0.5 text-[12px] leading-5 text-slate-600">
                            {check.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-slate-950">剧集、素材与交易</h4>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onRefresh(ip.id)}
                    disabled={loading}
                  >
                    <IconRefresh className="size-3.5" />
                    刷新
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Metric label="剧集" value={ip.episodes.length} />
                  <Metric label="源材料" value={ip.assets.length} />
                  <Metric label="价格规则" value={ip.priceRules.length} />
                  <Metric
                    label="举报"
                    value={ip.reports.length}
                    tone={ip.reports.length ? "risk" : "default"}
                  />
                </div>
                <div className="mt-3 divide-y divide-slate-100">
                  {ip.episodes.slice(0, 6).map((episode) => (
                    <div key={episode.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-950">
                          EP{episode.episodeNo} · {episode.title}
                        </p>
                        <p className="text-[12px] text-slate-500">
                          {statusLabel(episode.status)} ·{" "}
                          {episode.isFreePreview ? "试看" : "默认权益"}
                        </p>
                      </div>
                      <span className="text-[12px] text-slate-500">
                        {episode.priceRules.length} 规则
                      </span>
                    </div>
                  ))}
                  {!ip.episodes.length ? (
                    <p className="py-4 text-sm text-slate-500">暂无剧集，仍可审核 IP 档案本身。</p>
                  ) : null}
                </div>
              </section>

              <IpRevenueSection key={ip.id} ipId={ip.id} locale={locale || undefined} />

              <section className="rounded-xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold text-slate-950">素材与源材料</h4>
                <div className="mt-3 divide-y divide-slate-100">
                  {ip.assets.slice(0, 8).map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-950">
                          {item.title || item.asset?.objectKey?.split("/").at(-1) || "未命名素材"}
                        </p>
                        <p className="text-[12px] text-slate-500">
                          {assetPurposeLabel(item.purpose)} · {item.asset?.kind ?? "file"} ·{" "}
                          {item.asset?.contentType ?? "unknown"}
                        </p>
                      </div>
                      {item.asset?.url ? (
                        <a
                          href={adminRenderableMediaUrl(item.asset.url) ?? item.asset.url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          查看
                        </a>
                      ) : null}
                    </div>
                  ))}
                  {!ip.assets.length ? (
                    <p className="py-4 text-sm text-slate-500">暂无源材料。</p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold text-slate-950">最近交易</h4>
                <div className="mt-3 divide-y divide-slate-100">
                  {ip.recentOrders.map((order) => (
                    <div key={order.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-950">
                          {order.orderNo}
                        </p>
                        <p className="text-[12px] text-slate-500">
                          {targetTypeLabel(order.targetType)} · {order.status}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-medium text-slate-950">
                        {formatAmount(order.totalAmount)} {currencyLabel(order.currency)}
                      </span>
                    </div>
                  ))}
                  {!ip.recentOrders.length ? (
                    <p className="py-4 text-sm text-slate-500">暂无交易记录。</p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold text-slate-950">举报治理</h4>
                <div className="mt-3 divide-y divide-slate-100">
                  {ip.reports.map((report) => (
                    <div key={report.id} className="py-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill
                              tone={
                                report.status === "submitted"
                                  ? "risk"
                                  : report.status === "triaged"
                                    ? "warn"
                                    : "muted"
                              }
                            >
                              {report.status}
                            </StatusPill>
                            <span className="text-sm font-medium text-slate-950">
                              {reasonLabel(report.reason)}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">
                            {report.description ?? "举报人未填写详细说明。"}
                          </p>
                          {report.purchaseOrderId && (
                            <p className="mt-1 break-all text-xs text-slate-600">
                              Purchase reference: <code>{report.purchaseOrderId}</code>
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-slate-400">
                            {formatDate(report.createdAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={Boolean(reportSavingId) || saving || loading}
                            onClick={() =>
                              void submitReportAction(report, {
                                status: "triaged",
                                resolutionNote: "运营已标记为跟进中。",
                              })
                            }
                          >
                            跟进
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={Boolean(reportSavingId) || saving || loading}
                            onClick={() =>
                              void submitReportAction(report, {
                                status: "dismissed",
                                resolutionNote: "举报证据不足，暂不处理。",
                              })
                            }
                          >
                            驳回
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={Boolean(reportSavingId) || saving || loading}
                            onClick={() =>
                              void submitReportAction(report, {
                                status: "actioned",
                                actionType: "hide",
                                reason: "举报成立，先隐藏内容等待进一步复核。",
                                resolutionNote: "已隐藏内容。",
                              })
                            }
                          >
                            隐藏内容
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!ip.reports.length ? (
                    <p className="py-4 text-sm text-slate-500">暂无开放举报。</p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold text-slate-950">审核动作</h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-medium text-slate-600">目标状态</span>
                    <Select
                      disabled={saving || loading || Boolean(reportSavingId)}
                      value={status ?? "in_review"}
                      onValueChange={(value) => updateDraft({ status: value as IpStatus })}
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in_review">审核中</SelectItem>
                        <SelectItem value="changes_requested">退回修改</SelectItem>
                        <SelectItem value="approved">批准</SelectItem>
                        <SelectItem value="published">发布</SelectItem>
                        <SelectItem value="hidden">隐藏</SelectItem>
                        <SelectItem value="suspended">暂停销售</SelectItem>
                        <SelectItem value="archived">归档</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-medium text-slate-600">可见性</span>
                    <Select
                      disabled={saving || loading || Boolean(reportSavingId)}
                      value={visibility ?? "private"}
                      onValueChange={(value) =>
                        updateDraft({ visibility: value as IpRow["listingVisibility"] })
                      }
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="private">私有</SelectItem>
                        <SelectItem value="unlisted">仅链接</SelectItem>
                        <SelectItem value="public">公开</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </div>
                <label className="mt-3 block space-y-1.5">
                  <span className="text-[12px] font-medium text-slate-600">原因 / 说明</span>
                  <Textarea
                    disabled={saving || loading || Boolean(reportSavingId)}
                    value={reason}
                    onChange={(event) => updateDraft({ reason: event.target.value })}
                    className="min-h-24"
                    placeholder="写清楚审核决定，方便创作者和运营追溯。"
                  />
                </label>
                {actionError ? <p className="mt-2 text-sm text-red-600">{actionError}</p> : null}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void submitAction()}
                    disabled={
                      saving ||
                      loading ||
                      Boolean(reportSavingId) ||
                      ((status === "published" || status === "scheduled") &&
                        !publishReadiness?.ready)
                    }
                  >
                    Apply selected status
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void submitAction("changes_requested")}
                    disabled={saving || loading || Boolean(reportSavingId)}
                  >
                    <IconX className="size-3.5" />
                    退回修改
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void submitAction("approved")}
                    disabled={saving || loading || Boolean(reportSavingId)}
                  >
                    <IconCheck className="size-3.5" />
                    批准
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void submitAction("published")}
                    disabled={
                      saving || loading || Boolean(reportSavingId) || !publishReadiness?.ready
                    }
                  >
                    <IconCheck className="size-3.5" />
                    发布
                  </Button>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[12px] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-950">{value}</p>
    </div>
  );
}

function adminRenderableMediaUrl(value: string) {
  const mediaMatch = value.match(/^\/aurora\/media\/assets\/([^/]+)\/content(?:\?(.*))?$/u);
  if (!mediaMatch?.[1]) return null;
  const query = mediaMatch[2] ? `?${mediaMatch[2]}` : "?variantKey=original";
  return `/api/admin/media/assets/${encodeURIComponent(decodeURIComponent(mediaMatch[1]))}/content${query}`;
}
