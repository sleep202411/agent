"use client";

import { useEffect, useState } from "react";
import {
  IconAlertTriangle,
  IconBook2,
  IconCheck,
  IconClipboardCheck,
  IconEye,
  IconFlag,
  IconRefresh,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IpStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "scheduled"
  | "published"
  | "hidden"
  | "suspended"
  | "archived";

type PriceRule = {
  id: string;
  targetType: "ip" | "episode";
  status: string;
  currency: string;
  amount: string;
  originalAmount: string | null;
  campaignId: string | null;
  priority?: number;
  startsAt: string | null;
  endsAt: string | null;
  unlocksAt: string | null;
  maxPerUser: number | null;
};

type LocalizationMeta = {
  requestedLocale: string;
  locale: string;
  sourceLocale: string;
  isFallback: boolean;
  availableLocales: string[];
  status: string | null;
};

type IpMediaAsset = {
  id: string;
  kind: string;
  storageProvider: string;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  url: string | null;
  contentType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

type IpLibraryAssetRow = {
  id: string;
  purpose: string;
  title: string | null;
  description: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  asset: IpMediaAsset | null;
};

type IpRow = {
  id: string;
  slug: string | null;
  title: string;
  subtitle: string | null;
  summary: string;
  ipType: string;
  status: IpStatus;
  listingVisibility: "private" | "unlisted" | "public";
  ageRating: string;
  sourceLocale: string;
  localization: LocalizationMeta;
  genres: string[];
  tags: string[];
  version: number;
  coverAsset: IpMediaAsset | null;
  trailerAsset: IpMediaAsset | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  suspendedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    episodes: number;
    assets?: number;
    campaigns: number;
    priceRules: number;
    purchaseOrders: number;
    entitlements: number;
    contributors: number;
    reports: number;
  };
  pricing: {
    bundle: PriceRule | null;
    activeEpisodePriceCount: number;
    activePriceCount: number;
  };
  review: {
    needsAttention: boolean;
    openReportCount: number;
  };
};

type ReviewQueueRow = {
  id: string;
  targetType: string;
  targetId: string;
  ipId: string | null;
  episodeId: string | null;
  status: string;
  changeSummary: string | null;
  submittedById: string;
  reviewerId: string | null;
  submittedAt: string;
  ip: {
    id: string;
    title: string;
    status: string;
    listingVisibility: string;
    localization?: LocalizationMeta;
  } | null;
  episode: {
    id: string;
    episodeNo: number;
    title: string;
    status: string;
    localization?: LocalizationMeta;
  } | null;
};

type ReportRow = {
  id: string;
  targetType: string;
  targetId: string;
  ipId: string | null;
  episodeId: string | null;
  reporterUserId: string | null;
  reason: string;
  status: string;
  description: string | null;
  createdAt: string;
  ip: {
    id: string;
    title: string;
    status: string;
    listingVisibility: string;
    localization?: LocalizationMeta;
  } | null;
  episode: {
    id: string;
    episodeNo: number;
    title: string;
    status: string;
    localization?: LocalizationMeta;
  } | null;
};

type IpEpisodeRow = {
  id: string;
  episodeNo: number;
  sortOrder: number;
  status: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  durationSeconds: number | null;
  isFreePreview: boolean;
  priceRules: PriceRule[];
};

type IpPurchaseOrderRow = {
  id: string;
  orderNo: string;
  status: string;
  userId: string;
  ipId: string;
  episodeId: string | null;
  targetType: string;
  currency: string;
  totalAmount: string;
  createdAt: string;
};

type IpContributorRow = {
  id: string;
  userId: string;
  displayName: string | null;
  role: string;
  customRole: string | null;
  isPublic: boolean;
  displayOrder: number;
};

type AdminIpDetail = IpRow & {
  description: string | null;
  copyrightOwner: string | null;
  rightsSummary: Record<string, unknown>;
  aiDisclosure: Record<string, unknown>;
  episodes: IpEpisodeRow[];
  priceRules: PriceRule[];
  assets: IpLibraryAssetRow[];
  campaigns: Array<{
    id: string;
    campaignType: string;
    status: string;
    code: string;
    name: string;
    description: string | null;
    startsAt: string | null;
    endsAt: string | null;
    unlocksAt: string | null;
  }>;
  contributors: IpContributorRow[];
  reports: ReportRow[];
  recentOrders: IpPurchaseOrderRow[];
};

export type AdminIpOverviewData = {
  generatedAt: string;
  metrics: {
    totalIps: number;
    publishedIps: number;
    pendingReviewIps: number;
    activePriceRules: number;
    openReports: number;
    ordersLast7Days: number;
  };
  reviewQueue: ReviewQueueRow[];
  reports: ReportRow[];
  recentIps: IpRow[];
  recentOrders: IpPurchaseOrderRow[];
};

export type AdminIpsData = {
  items: IpRow[];
  nextCursor: string | null;
};

const emptyOverview: AdminIpOverviewData = {
  generatedAt: new Date(0).toISOString(),
  metrics: {
    totalIps: 0,
    publishedIps: 0,
    pendingReviewIps: 0,
    activePriceRules: 0,
    openReports: 0,
    ordersLast7Days: 0,
  },
  reviewQueue: [],
  reports: [],
  recentIps: [],
  recentOrders: [],
};

const emptyIps: AdminIpsData = { items: [], nextCursor: null };

export function AdminIpCommercePanel({
  siteLabel,
  databaseLabel,
  initialOverview,
  initialIps,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialOverview: AdminIpOverviewData | null;
  initialIps: AdminIpsData | null;
  initialError?: string | null;
}) {
  const [overview, setOverview] = useState(initialOverview ?? emptyOverview);
  const [ips, setIps] = useState(initialIps ?? emptyIps);
  const [status, setStatus] = useState("");
  const [ipType, setIpType] = useState("");
  const [visibility, setVisibility] = useState("");
  const [locale, setLocale] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [selectedIp, setSelectedIp] = useState<AdminIpDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function refreshAll() {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextIps] = await Promise.all([
        requestEnvelope<AdminIpOverviewData>(`/api/admin/ip-commerce/overview${queryString()}`),
        requestEnvelope<AdminIpsData>(`/api/admin/ip-commerce/ips${queryString()}`),
      ]);
      setOverview(nextOverview);
      setIps(nextIps);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
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

  function queryString() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (ipType) params.set("ipType", ipType);
    if (visibility) params.set("listingVisibility", visibility);
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
        body: JSON.stringify({
          ...input,
          expectedVersion: selectedIp.version,
        }),
      }
    );
    setSelectedIp(data.ip);
    await refreshAll();
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
    if (selectedIp) {
      await openIpDetail(selectedIp.id);
    }
    await refreshAll();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[12px] font-medium text-slate-500">
              {siteLabel} · {databaseLabel}
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
              IP 内容商业化
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              管理公开 IP、剧集定价、审核队列、举报和销售状态。当前站点连接独立数据库。
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[760px] xl:grid-cols-5">
            <Metric label="IP 总数" value={overview.metrics.totalIps} />
            <Metric label="已发布" value={overview.metrics.publishedIps} />
            <Metric label="待审核" value={overview.metrics.pendingReviewIps} tone="warn" />
            <Metric label="开放举报" value={overview.metrics.openReports} tone="risk" />
            <Metric label="7 日订单" value={overview.metrics.ordersLast7Days} />
          </div>
        </div>
      </section>

      {error ? <ErrorBanner message={error} /> : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <QueuePanel
          title="审核队列"
          icon={IconClipboardCheck}
          emptyLabel="暂无待审核内容"
          rows={overview.reviewQueue.map((item) => ({
            id: item.id,
            title: item.ip?.title ?? item.episode?.title ?? item.targetId,
            subtitle: `${item.targetType} · ${item.status}`,
            meta: item.changeSummary ?? item.submittedById,
            time: item.submittedAt,
            tone: item.status === "changes_requested" ? "risk" : "warn",
          }))}
        />
        <QueuePanel
          title="举报处理"
          icon={IconFlag}
          emptyLabel="暂无开放举报"
          rows={overview.reports.map((item) => ({
            id: item.id,
            title: item.ip?.title ?? item.episode?.title ?? item.targetId,
            subtitle: `${reasonLabel(item.reason)} · ${item.status}`,
            meta: item.description ?? item.reporterUserId ?? "匿名举报",
            time: item.createdAt,
            tone: item.status === "submitted" ? "risk" : "warn",
          }))}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">IP 标题列表</h3>
              <p className="mt-1 text-[12px] text-slate-500">
                列表直接反映当前站点数据库的发布、销售和审核状态。
              </p>
            </div>
            <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_130px_150px_150px_150px_auto] 2xl:min-w-[940px]">
              <label className="relative block">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                  placeholder="搜索标题、slug、简介"
                />
              </label>
              <Select value={locale} onChange={setLocale}>
                <option value="">默认语言</option>
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
                <option value="zh-HK">繁體中文</option>
                <option value="ja-JP">日本語</option>
              </Select>
              <Select value={status} onChange={setStatus}>
                <option value="">全部状态</option>
                <option value="submitted">待提交审核</option>
                <option value="in_review">审核中</option>
                <option value="approved">已批准</option>
                <option value="scheduled">已排期</option>
                <option value="published">已发布</option>
                <option value="hidden">隐藏</option>
                <option value="suspended">暂停销售</option>
              </Select>
              <Select value={ipType} onChange={setIpType}>
                <option value="">全部 IP 类型</option>
                <option value="series">剧集</option>
                <option value="film_short">电影/短片</option>
                <option value="other">其他</option>
              </Select>
              <Select value={visibility} onChange={setVisibility}>
                <option value="">全部可见性</option>
                <option value="public">公开</option>
                <option value="unlisted">不公开列表</option>
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
                  onClick={() => void refreshAll()}
                  disabled={loading}
                >
                  <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
                </Button>
              </div>
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
                        ? `${ip.pricing.bundle.amount} ${currencyLabel(ip.pricing.bundle.currency)}`
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
                    <p className="text-sm text-slate-700">{ipTypeLabel(ip.ipType)}</p>
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
  const [status, setStatus] = useState<IpStatus>("in_review");
  const [visibility, setVisibility] = useState<IpRow["listingVisibility"]>("private");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [reportSavingId, setReportSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!ip) return;
    setStatus(ip.status === "draft" ? "in_review" : ip.status);
    setVisibility(ip.listingVisibility);
    setReason(defaultReviewReason(ip.status));
    setActionError(null);
  }, [ip]);

  if (!ip && !loading && !error) return null;

  async function submitAction(nextStatus?: IpStatus) {
    if (!ip || saving) return;
    const finalStatus = nextStatus ?? status;
    const finalVisibility =
      finalStatus === "published" || finalStatus === "scheduled"
        ? "public"
        : finalStatus === "approved"
          ? visibility
          : finalStatus === "in_review"
            ? visibility
            : finalStatus === "changes_requested"
              ? "private"
              : visibility;
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

  const publishReadiness = ip ? getPublishReadiness(ip) : null;

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
                <DetailCell label="IP 类型" value={ipTypeLabel(ip.ipType)} />
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
                        这些条件与后端发布拦截保持一致，未满足时只能批准或退回，不能直接发布。
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
                  <h4 className="text-sm font-semibold text-slate-950">剧集与定价</h4>
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
                <p className="mt-1 text-[12px] leading-5 text-slate-500">
                  展示创作者上传到新版 IP 素材库的源文件，审核时用于判断来源、权利链和内容完整度。
                </p>
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
                    <p className="py-4 text-sm text-slate-500">
                      暂无开放举报。后续用户侧举报会进入这里处理。
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold text-slate-950">审核动作</h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-medium text-slate-600">目标状态</span>
                    <Select value={status} onChange={(value) => setStatus(value as IpStatus)}>
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
                      value={visibility}
                      onChange={(value) => setVisibility(value as IpRow["listingVisibility"])}
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
                    onChange={(event) => setReason(event.target.value)}
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

function QueuePanel({
  title,
  icon: Icon,
  rows,
  emptyLabel,
}: {
  title: string;
  icon: typeof IconEye;
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
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <Icon className="size-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
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

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warn" | "risk";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tone === "risk" && "border-red-200 bg-red-50",
        tone === "warn" && "border-amber-200 bg-amber-50",
        tone === "default" && "border-slate-200 bg-slate-50"
      )}
    >
      <p
        className={cn(
          "text-[11px] font-medium",
          tone === "risk" ? "text-red-600" : tone === "warn" ? "text-amber-700" : "text-slate-500"
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tracking-tight",
          tone === "risk" ? "text-red-700" : tone === "warn" ? "text-amber-800" : "text-slate-950"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
    >
      {children}
    </select>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-b border-slate-100 px-3 py-3 align-top text-sm text-slate-700">
      {children}
    </td>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-slate-500">
        {label}
      </td>
    </tr>
  );
}

function IpStatusPill({ status }: { status: IpStatus }) {
  const tone =
    status === "published" || status === "scheduled"
      ? "success"
      : status === "suspended" || status === "hidden" || status === "archived"
        ? "risk"
        : status === "submitted" || status === "in_review" || status === "changes_requested"
          ? "warn"
          : "muted";
  return <StatusPill tone={tone}>{statusLabel(status)}</StatusPill>;
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "success" | "warn" | "risk" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "risk" && "border-red-200 bg-red-50 text-red-700",
        tone === "muted" && "border-slate-200 bg-slate-50 text-slate-600"
      )}
    >
      {children}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

async function requestEnvelope<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
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

function ipTypeLabel(value: string) {
  const labels: Record<string, string> = {
    series: "剧集",
    film_short: "电影/短片",
    other: "其他",
  };
  return labels[value] ?? value;
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    submitted: "待审核",
    in_review: "审核中",
    changes_requested: "需修改",
    approved: "已批准",
    scheduled: "已排期",
    published: "已发布",
    hidden: "隐藏",
    suspended: "暂停销售",
    archived: "归档",
  };
  return labels[value] ?? value;
}

function visibilityLabel(value: string) {
  const labels: Record<string, string> = {
    public: "公开",
    unlisted: "不公开列表",
    private: "私有",
  };
  return labels[value] ?? value;
}

function assetPurposeLabel(value: string) {
  const labels: Record<string, string> = {
    source_material: "源材料",
    reference_art: "参考素材",
    production_asset: "生产素材",
  };
  return labels[value] ?? value;
}

function reasonLabel(value: string) {
  const labels: Record<string, string> = {
    copyright: "版权",
    unsafe_content: "安全",
    fraud: "欺诈",
    misleading: "误导",
    privacy: "隐私",
    harassment: "骚扰",
    other: "其他",
  };
  return labels[value] ?? value;
}

function currencyLabel(value: string) {
  const labels: Record<string, string> = {
    community_point: "社区积分",
    bubble: "算力积分",
  };
  return labels[value] ?? value;
}

function defaultReviewReason(status: string) {
  if (status === "submitted" || status === "draft") return "开始审核 IP 档案。";
  if (status === "changes_requested") return "创作者已重新提交，继续复核。";
  if (status === "approved") return "审核已通过，准备发布。";
  return "更新 IP 发布状态。";
}

function getPublishReadiness(ip: AdminIpDetail) {
  const rightsSummary = toRecord(ip.rightsSummary);
  const aiDisclosure = toRecord(ip.aiDisclosure);
  const hasAiGeneratedContent =
    aiDisclosure.generatedVisuals === true || aiDisclosure.generatedCopy === true;
  const checks = [
    {
      key: "copy",
      label: "标题和短简介",
      description: ip.summary.trim()
        ? "创作者已填写公开标题和短简介。"
        : "公开详情页需要清晰标题和短简介，便于用户、运营和审核理解内容。",
      done: Boolean(ip.title.trim() && ip.summary.trim()),
    },
    {
      key: "media",
      label: "封面或推广片",
      description:
        ip.coverAsset || ip.trailerAsset
          ? "已绑定封面或推广片，公开详情页不会是空媒体位。"
          : "至少需要封面或推广片，避免发布后公开页缺少主视觉。",
      done: Boolean(ip.coverAsset || ip.trailerAsset),
    },
    {
      key: "rights-owner",
      label: "版权主体",
      description: ip.copyrightOwner?.trim()
        ? `版权主体：${ip.copyrightOwner.trim()}`
        : "需要填写版权主体，后续售卖、举报和下架处理都要可追溯。",
      done: Boolean(ip.copyrightOwner?.trim()),
    },
    {
      key: "rights-statement",
      label: "权利声明",
      description:
        typeof rightsSummary.statement === "string" && rightsSummary.statement.trim()
          ? "已填写权利声明。"
          : "需要说明创作者对该 IP 的版权、授权或素材来源承诺。",
      done: typeof rightsSummary.statement === "string" && Boolean(rightsSummary.statement.trim()),
    },
    {
      key: "ai-disclosure",
      label: "AI 生成披露",
      description: hasAiGeneratedContent
        ? typeof aiDisclosure.statement === "string" && aiDisclosure.statement.trim()
          ? "已填写 AI 生成内容披露。"
          : "标记含 AI 生成内容时，需要写明使用范围和披露说明。"
        : "未标记 AI 生成内容，当前不强制填写披露说明。",
      done:
        !hasAiGeneratedContent ||
        (typeof aiDisclosure.statement === "string" && Boolean(aiDisclosure.statement.trim())),
    },
    {
      key: "reports",
      label: "开放举报",
      description: ip.review.openReportCount
        ? `仍有 ${ip.review.openReportCount} 条开放举报，必须先处理。`
        : "没有开放举报阻塞发布。",
      done: ip.review.openReportCount === 0,
    },
  ];
  return {
    checks,
    ready: checks.every((check) => check.done),
  };
}

function toRecord(value: Record<string, unknown> | null | undefined) {
  return value && typeof value === "object" ? value : {};
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
