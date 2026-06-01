"use client";

import { useState } from "react";
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
import { cn } from "@/lib/utils";
import {
  assetPurposeLabel,
  currencyLabel,
  defaultReviewReason,
  EmptyRow,
  ErrorBanner,
  formatAmount,
  formatDate,
  getPublishReadiness,
  IpStatusPill,
  Metric,
  PageHeader,
  reasonLabel,
  requestEnvelope,
  Select,
  statusLabel,
  StatusPill,
  targetTypeLabel,
  Td,
  Th,
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
  const [locale, setLocale] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [selectedIp, setSelectedIp] = useState<AdminIpDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const terms = taxonomy ?? emptyIpTaxonomy;
  const genreTerms = terms.items.filter((term) => term.type === "genre");

  function queryString() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (visibility) params.set("listingVisibility", visibility);
    if (genreCode) params.set("genreCodes", genreCode);
    if (locale) params.set("locale", locale);
    if (query.trim()) params.set("q", query.trim());
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
    setLoading(true);
    setError(null);
    try {
      setIps(await requestEnvelope<AdminIpsData>(`/api/admin/ip-commerce/ips${queryString()}`));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function openIpDetail(ipId: string) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await requestEnvelope<{ ip: AdminIpDetail }>(
        `/api/admin/ip-commerce/ips/${encodeURIComponent(ipId)}${localeQueryString()}`
      );
      setSelectedIp(data.ip);
    } catch (err) {
      setDetailError(toErrorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }

  async function updateSelectedIpPublication(input: {
    status: IpStatus;
    listingVisibility: IpRow["listingVisibility"];
    reason: string;
  }) {
    if (!selectedIp) return;
    const data = await requestEnvelope<{ ip: AdminIpDetail }>(
      `/api/admin/ip-commerce/ips/${encodeURIComponent(selectedIp.id)}/publication`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, expectedVersion: selectedIp.version }),
      }
    );
    setSelectedIp(data.ip);
    await refreshIps();
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
    await requestEnvelope<unknown>(
      `/api/admin/ip-commerce/reports/${encodeURIComponent(reportId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    if (selectedIp) await openIpDetail(selectedIp.id);
    await refreshIps();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="IP 标题库"
        description="面向内容运营的主列表，负责状态扫描、审核进入、发布动作和风险追踪。"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_120px_140px_140px_140px_auto]">
            <label className="relative block">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                placeholder="搜索标题、slug、简介"
              />
            </label>
            <Select value={locale} onChange={setLocale} aria-label="语言">
              <option value="">默认语言</option>
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
              <option value="zh-HK">繁體中文</option>
            </Select>
            <Select value={genreCode} onChange={setGenreCode} aria-label="题材">
              <option value="">全部题材</option>
              {genreTerms.map((term) => (
                <option key={term.id} value={term.code}>
                  {term.label}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={setStatus} aria-label="状态">
              <option value="">全部状态</option>
              <option value="submitted">待审核</option>
              <option value="in_review">审核中</option>
              <option value="approved">已批准</option>
              <option value="scheduled">已排期</option>
              <option value="published">已发布</option>
              <option value="hidden">隐藏</option>
              <option value="suspended">暂停销售</option>
            </Select>
            <Select value={visibility} onChange={setVisibility} aria-label="可见性">
              <option value="">全部可见性</option>
              <option value="public">公开</option>
              <option value="unlisted">仅链接</option>
              <option value="private">私有</option>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <Th>IP</Th>
                <Th>状态</Th>
                <Th>定价</Th>
                <Th>销售/权益</Th>
                <Th>审核风险</Th>
                <Th>内容</Th>
                <Th>更新时间</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {ips.items.map((ip) => (
                <tr key={ip.id}>
                  <Td>
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
                  </Td>
                  <Td>
                    <IpStatusPill status={ip.status} />
                    <p className="mt-1 text-[11px] text-slate-500">
                      {visibilityLabel(ip.listingVisibility)}
                    </p>
                  </Td>
                  <Td>
                    <p className="text-sm font-medium text-slate-950">
                      {ip.pricing.bundle
                        ? `${formatAmount(ip.pricing.bundle.amount)} ${currencyLabel(
                            ip.pricing.bundle.currency
                          )}`
                        : "免费/未定价"}
                    </p>
                    <p className="text-[12px] text-slate-500">
                      {ip.pricing.activePriceCount} 条有效价格
                    </p>
                  </Td>
                  <Td>
                    <p className="text-sm text-slate-700">{ip.counts.purchaseOrders} 订单</p>
                    <p className="text-[12px] text-slate-500">{ip.counts.entitlements} 权益</p>
                  </Td>
                  <Td>
                    {ip.review.needsAttention || ip.review.openReportCount ? (
                      <StatusPill tone={ip.review.openReportCount ? "risk" : "warn"}>
                        {ip.review.openReportCount ? `${ip.review.openReportCount} 举报` : "待处理"}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="success">正常</StatusPill>
                    )}
                    <p className="mt-1 text-[11px] text-slate-500">v{ip.version}</p>
                  </Td>
                  <Td>
                    <p className="max-w-[180px] truncate text-sm text-slate-700">
                      {ip.genres.length ? ip.genres.join(" / ") : "未设置题材"}
                    </p>
                    <p className="text-[12px] text-slate-500">
                      {ip.counts.episodes} 集 · {ip.localization.locale}
                      {ip.localization.isFallback ? " · 回退" : ""}
                    </p>
                  </Td>
                  <Td>
                    <p className="text-[12px] text-slate-700">{formatDate(ip.updatedAt)}</p>
                    <p className="text-[11px] text-slate-500">
                      {ip.publishedAt ? `发布 ${formatDate(ip.publishedAt)}` : "未发布"}
                    </p>
                  </Td>
                  <Td>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void openIpDetail(ip.id)}
                      disabled={detailLoading}
                    >
                      <IconEye className="size-3.5" />
                      查看
                    </Button>
                  </Td>
                </tr>
              ))}
              {!ips.items.length ? <EmptyRow colSpan={8} label="暂无 IP 内容" /> : null}
            </tbody>
          </table>
        </div>
      </section>

      <IpDetailDrawer
        ip={selectedIp}
        loading={detailLoading}
        error={detailError}
        onClose={() => {
          setSelectedIp(null);
          setDetailError(null);
        }}
        onRefresh={(ipId) => void openIpDetail(ipId)}
        onUpdatePublication={updateSelectedIpPublication}
        onResolveReport={resolveSelectedReport}
      />
    </div>
  );
}

function IpDetailDrawer({
  ip,
  loading,
  error,
  onClose,
  onRefresh,
  onUpdatePublication,
  onResolveReport,
}: {
  ip: AdminIpDetail | null;
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

  if (!ip && !loading && !error) return null;

  const status =
    ip && draft?.ipId === ip.id ? draft.status : ip?.status === "draft" ? "in_review" : ip?.status;
  const visibility = ip && draft?.ipId === ip.id ? draft.visibility : ip?.listingVisibility;
  const reason =
    ip && draft?.ipId === ip.id ? draft.reason : ip ? defaultReviewReason(ip.status) : "";
  const publishReadiness = ip ? getPublishReadiness(ip) : null;

  function updateDraft(next: Partial<NonNullable<typeof draft>>) {
    if (!ip) return;
    setDraft({
      ipId: ip.id,
      status: status ?? "in_review",
      visibility: visibility ?? "private",
      reason,
      ...next,
    });
  }

  async function submitAction(nextStatus?: IpStatus) {
    if (!ip || saving) return;
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
    if (reportSavingId) return;
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
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[1px]">
      <div className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-[12px] font-medium text-slate-500">IP 审核详情</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-950">{ip?.title ?? "正在加载"}</h3>
            {ip ? (
              <p className="mt-1 text-[12px] text-slate-500">
                {ip.id} · v{ip.version}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950"
            aria-label="关闭"
          >
            <IconX className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              正在加载 IP 详情...
            </div>
          ) : null}
          {error ? <ErrorBanner message={error} /> : null}
          {ip ? (
            <div className="space-y-4">
              <section className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-2">
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
                          href={item.asset.url}
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
                          <p className="mt-1 text-[11px] text-slate-400">
                            {formatDate(report.createdAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={Boolean(reportSavingId)}
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
                            disabled={Boolean(reportSavingId)}
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
                            disabled={Boolean(reportSavingId)}
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
                      value={status ?? "in_review"}
                      onChange={(value) => updateDraft({ status: value as IpStatus })}
                    >
                      <option value="in_review">审核中</option>
                      <option value="changes_requested">退回修改</option>
                      <option value="approved">批准</option>
                      <option value="published">发布</option>
                      <option value="hidden">隐藏</option>
                      <option value="suspended">暂停销售</option>
                      <option value="archived">归档</option>
                    </Select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-medium text-slate-600">可见性</span>
                    <Select
                      value={visibility ?? "private"}
                      onChange={(value) =>
                        updateDraft({ visibility: value as IpRow["listingVisibility"] })
                      }
                    >
                      <option value="private">私有</option>
                      <option value="unlisted">仅链接</option>
                      <option value="public">公开</option>
                    </Select>
                  </label>
                </div>
                <label className="mt-3 block space-y-1.5">
                  <span className="text-[12px] font-medium text-slate-600">原因 / 说明</span>
                  <textarea
                    value={reason}
                    onChange={(event) => updateDraft({ reason: event.target.value })}
                    className="min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                    placeholder="写清楚审核决定，方便创作者和运营追溯。"
                  />
                </label>
                {actionError ? <p className="mt-2 text-sm text-red-600">{actionError}</p> : null}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void submitAction("changes_requested")}
                    disabled={saving}
                  >
                    <IconX className="size-3.5" />
                    退回修改
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void submitAction("approved")}
                    disabled={saving}
                  >
                    <IconCheck className="size-3.5" />
                    批准
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void submitAction("published")}
                    disabled={saving || !publishReadiness?.ready}
                  >
                    <IconCheck className="size-3.5" />
                    发布
                  </Button>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
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
