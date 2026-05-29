"use client";

import { useState } from "react";
import {
  IconAlertTriangle,
  IconBook2,
  IconClipboardCheck,
  IconEye,
  IconFlag,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IpTitleStatus =
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
  targetType: "title" | "episode";
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

type IpTitleRow = {
  id: string;
  workspaceId: string;
  sourceProjectId: string | null;
  slug: string | null;
  title: string;
  subtitle: string | null;
  summary: string;
  contentType: string;
  status: IpTitleStatus;
  listingVisibility: "private" | "unlisted" | "public";
  ageRating: string;
  language: string;
  genres: string[];
  tags: string[];
  version: number;
  scheduledAt: string | null;
  publishedAt: string | null;
  suspendedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    episodes: number;
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
  titleId: string | null;
  episodeId: string | null;
  status: string;
  changeSummary: string | null;
  submittedById: string;
  reviewerId: string | null;
  submittedAt: string;
  title: {
    id: string;
    title: string;
    status: string;
    listingVisibility: string;
  } | null;
  episode: {
    id: string;
    episodeNo: number;
    title: string;
    status: string;
  } | null;
};

type ReportRow = {
  id: string;
  targetType: string;
  targetId: string;
  titleId: string | null;
  episodeId: string | null;
  reporterUserId: string | null;
  reason: string;
  status: string;
  description: string | null;
  createdAt: string;
  title: {
    id: string;
    title: string;
    status: string;
    listingVisibility: string;
  } | null;
  episode: {
    id: string;
    episodeNo: number;
    title: string;
    status: string;
  } | null;
};

type IpPurchaseOrderRow = {
  id: string;
  orderNo: string;
  status: string;
  userId: string;
  titleId: string;
  episodeId: string | null;
  targetType: string;
  currency: string;
  totalAmount: string;
  createdAt: string;
};

export type AdminIpOverviewData = {
  generatedAt: string;
  metrics: {
    totalTitles: number;
    publishedTitles: number;
    pendingReviewTitles: number;
    activePriceRules: number;
    openReports: number;
    ordersLast7Days: number;
    revenueCreditsLast7Days: string;
  };
  reviewQueue: ReviewQueueRow[];
  reports: ReportRow[];
  recentTitles: IpTitleRow[];
  recentOrders: IpPurchaseOrderRow[];
};

export type AdminIpTitlesData = {
  items: IpTitleRow[];
  nextCursor: string | null;
};

const emptyOverview: AdminIpOverviewData = {
  generatedAt: new Date(0).toISOString(),
  metrics: {
    totalTitles: 0,
    publishedTitles: 0,
    pendingReviewTitles: 0,
    activePriceRules: 0,
    openReports: 0,
    ordersLast7Days: 0,
    revenueCreditsLast7Days: "0",
  },
  reviewQueue: [],
  reports: [],
  recentTitles: [],
  recentOrders: [],
};

const emptyTitles: AdminIpTitlesData = { items: [], nextCursor: null };

export function AdminIpCommercePanel({
  siteLabel,
  databaseLabel,
  initialOverview,
  initialTitles,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialOverview: AdminIpOverviewData | null;
  initialTitles: AdminIpTitlesData | null;
  initialError?: string | null;
}) {
  const [overview, setOverview] = useState(initialOverview ?? emptyOverview);
  const [titles, setTitles] = useState(initialTitles ?? emptyTitles);
  const [status, setStatus] = useState("");
  const [contentType, setContentType] = useState("");
  const [visibility, setVisibility] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function refreshAll() {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextTitles] = await Promise.all([
        requestEnvelope<AdminIpOverviewData>(`/api/admin/ip-commerce/overview${queryString()}`),
        requestEnvelope<AdminIpTitlesData>(`/api/admin/ip-commerce/titles${queryString()}`),
      ]);
      setOverview(nextOverview);
      setTitles(nextTitles);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshTitles() {
    setLoading(true);
    setError(null);
    try {
      setTitles(
        await requestEnvelope<AdminIpTitlesData>(`/api/admin/ip-commerce/titles${queryString()}`)
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function queryString() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (contentType) params.set("contentType", contentType);
    if (visibility) params.set("listingVisibility", visibility);
    if (query.trim()) params.set("q", query.trim());
    const text = params.toString();
    return text ? `?${text}` : "";
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
            <Metric label="IP 总数" value={overview.metrics.totalTitles} />
            <Metric label="已发布" value={overview.metrics.publishedTitles} />
            <Metric label="待审核" value={overview.metrics.pendingReviewTitles} tone="warn" />
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
            title: item.title?.title ?? item.episode?.title ?? item.targetId,
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
            title: item.title?.title ?? item.episode?.title ?? item.targetId,
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
            <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_150px_150px_150px_auto] 2xl:min-w-[820px]">
              <label className="relative block">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                  placeholder="搜索标题、slug、简介"
                />
              </label>
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
              <Select value={contentType} onChange={setContentType}>
                <option value="">全部类型</option>
                <option value="series">剧集</option>
                <option value="interactive_film">互动影游</option>
                <option value="film">电影</option>
                <option value="course">课程</option>
                <option value="collection">合集</option>
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
                  onClick={() => void refreshTitles()}
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
              </tr>
            </thead>
            <tbody>
              {titles.items.map((title) => (
                <tr key={title.id}>
                  <Td>
                    <div className="flex items-start gap-3">
                      <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                        <IconBook2 className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="max-w-[260px] truncate text-sm font-medium text-slate-950">
                          {title.title}
                        </p>
                        <p className="mt-0.5 max-w-[260px] truncate text-[12px] text-slate-500">
                          {title.slug ?? title.id}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <TitleStatusPill status={title.status} />
                    <p className="mt-1 text-[11px] text-slate-500">
                      {visibilityLabel(title.listingVisibility)}
                    </p>
                  </Td>
                  <Td>
                    <p className="text-sm font-medium text-slate-950">
                      {title.pricing.bundle
                        ? `${title.pricing.bundle.amount} ${currencyLabel(title.pricing.bundle.currency)}`
                        : "免费/未定价"}
                    </p>
                    <p className="text-[12px] text-slate-500">
                      {title.pricing.activePriceCount} 条有效价格
                    </p>
                  </Td>
                  <Td>
                    <p className="text-sm text-slate-700">{title.counts.purchaseOrders} 订单</p>
                    <p className="text-[12px] text-slate-500">{title.counts.entitlements} 权益</p>
                  </Td>
                  <Td>
                    {title.review.needsAttention || title.review.openReportCount ? (
                      <StatusPill tone={title.review.openReportCount ? "risk" : "warn"}>
                        {title.review.openReportCount
                          ? `${title.review.openReportCount} 举报`
                          : "待处理"}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="success">正常</StatusPill>
                    )}
                    <p className="mt-1 text-[11px] text-slate-500">v{title.version}</p>
                  </Td>
                  <Td>
                    <p className="text-sm text-slate-700">{contentTypeLabel(title.contentType)}</p>
                    <p className="text-[12px] text-slate-500">
                      {title.counts.episodes} 集 · {title.language}
                    </p>
                  </Td>
                  <Td>
                    <p className="text-[12px] text-slate-700">{formatDate(title.updatedAt)}</p>
                    <p className="text-[11px] text-slate-500">
                      {title.publishedAt ? `发布 ${formatDate(title.publishedAt)}` : "未发布"}
                    </p>
                  </Td>
                </tr>
              ))}
              {!titles.items.length ? <EmptyRow colSpan={7} label="暂无 IP 内容" /> : null}
            </tbody>
          </table>
        </div>
      </section>
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

function TitleStatusPill({ status }: { status: IpTitleStatus }) {
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

async function requestEnvelope<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
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

function contentTypeLabel(value: string) {
  const labels: Record<string, string> = {
    series: "剧集",
    interactive_film: "互动影游",
    film: "电影",
    course: "课程",
    collection: "合集",
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
