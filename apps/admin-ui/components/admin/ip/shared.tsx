"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { adminUiApiPath } from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import type { AdminIpDetail, IpStatus } from "./types";

// Canonical PageHeader now lives in components/admin/page-header.tsx.
// Re-exported here so existing IP panels keep importing from "./shared".
export { PageHeader } from "../page-header";

export function Metric({
  label,
  value,
  tone = "default",
  helper,
}: {
  label: string;
  value: number | string;
  tone?: "default" | "warn" | "risk";
  helper?: string;
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
      {helper ? <p className="mt-0.5 truncate text-[11px] text-slate-500">{helper}</p> : null}
    </div>
  );
}

export function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "success" | "warn" | "risk" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
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

export function IpStatusPill({ status }: { status: IpStatus }) {
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

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export async function requestEnvelope<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(adminUiApiPath(url), { cache: "no-store", ...init });
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    message?: string | { message?: string; issues?: Array<{ path?: string; message?: string }> };
    issues?: Array<{ path?: string; message?: string }>;
    data?: T;
  } | null;
  init?.signal?.throwIfAborted();
  if (!response.ok || payload?.code !== 200) {
    throw new Error(formatAdminError(payload, response.status));
  }
  return payload.data as T;
}

function formatAdminError(
  payload: {
    msg?: string;
    message?: string | { message?: string; issues?: Array<{ path?: string; message?: string }> };
    issues?: Array<{ path?: string; message?: string }>;
  } | null,
  status: number
) {
  const nested = payload?.message && typeof payload.message === "object" ? payload.message : null;
  const issues = payload?.issues ?? nested?.issues ?? [];
  const issueText = issues
    .map((issue) => {
      const path = issue.path?.trim();
      const message = issue.message?.trim();
      if (path && message) return `${path}: ${message}`;
      return message || path || "";
    })
    .filter(Boolean)
    .join("；");
  const headline =
    payload?.msg ??
    (typeof payload?.message === "string" ? payload.message : nested?.message) ??
    `请求失败：${status}`;
  return issueText ? `${headline}（${issueText}）` : headline;
}

export function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function statusLabel(value: string) {
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

export function visibilityLabel(value: string) {
  const labels: Record<string, string> = {
    public: "公开",
    unlisted: "仅链接",
    private: "私有",
  };
  return labels[value] ?? value;
}

export function taxonomyStatusLabel(value: string) {
  const labels: Record<string, string> = {
    active: "启用",
    hidden: "隐藏",
    archived: "归档",
  };
  return labels[value] ?? value;
}

export function reasonLabel(value: string) {
  const labels: Record<string, string> = {
    payment: "Payment",
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

export function targetTypeLabel(value: string) {
  const labels: Record<string, string> = {
    ip: "整部 IP",
    episode: "单集",
  };
  return labels[value] ?? value;
}

export function orderStatusLabel(value: string) {
  const labels: Record<string, string> = {
    pending: "待支付",
    paid: "已支付",
    fulfilled: "已履约",
    canceled: "已取消",
    failed: "失败",
    refunded: "已退款",
    partially_refunded: "部分退款",
  };
  return labels[value] ?? value;
}

export function entitlementStatusLabel(value: string) {
  const labels: Record<string, string> = {
    active: "有效",
    expired: "已过期",
    revoked: "已撤销",
    refunded: "已退款",
  };
  return labels[value] ?? value;
}

export function sourceTypeLabel(value: string) {
  const labels: Record<string, string> = {
    purchase: "购买",
    admin_grant: "后台补发",
  };
  return labels[value] ?? value;
}

export function currencyLabel(value: string) {
  const labels: Record<string, string> = {
    community_point: "社区积分",
    compute_point: "算力积分",
  };
  return labels[value] ?? value;
}

export function assetPurposeLabel(value: string) {
  const labels: Record<string, string> = {
    source_material: "源材料",
    reference_art: "参考素材",
    production_asset: "生产素材",
  };
  return labels[value] ?? value;
}

export function revenueLedgerEntryTypeLabel(value: string) {
  const labels: Record<string, string> = {
    revenue_share: "收入分成",
    refund_reversal: "退款冲正",
    manual_adjustment: "人工调整",
  };
  return labels[value] ?? value;
}

export function revenueLedgerStatusLabel(value: string) {
  const labels: Record<string, string> = {
    pending: "待结算",
    posted: "已结算",
    voided: "已作废",
  };
  return labels[value] ?? value;
}

// shareBps -> percent string (10000 bps = 100%). Trims trailing zeros so 1500 -> "15%".
export function formatShareBps(bps: number | null | undefined) {
  if (bps === null || bps === undefined) return "-";
  const percent = bps / 100;
  return `${Number(percent.toFixed(2))}%`;
}

export function formatAmount(value: string) {
  try {
    return new Intl.NumberFormat("zh-CN").format(Number(BigInt(value)));
  } catch {
    return value;
  }
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function defaultReviewReason(status: string) {
  if (status === "submitted" || status === "draft") return "开始审核 IP 档案。";
  if (status === "changes_requested") return "创作者已重新提交，继续复核。";
  if (status === "approved") return "审核已通过，准备发布。";
  return "更新 IP 发布状态。";
}

export function getPublishReadiness(ip: AdminIpDetail) {
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
        : "公开详情页需要清晰标题和短简介。",
      done: Boolean(ip.title.trim() && ip.summary.trim()),
    },
    {
      key: "media",
      label: "封面或推广片",
      description:
        ip.coverAsset || ip.trailerAsset
          ? "已绑定封面或推广片。"
          : "至少需要封面或推广片，避免公开页缺少主视觉。",
      done: Boolean(ip.coverAsset || ip.trailerAsset),
    },
    {
      key: "rights-owner",
      label: "版权主体",
      description: ip.copyrightOwner?.trim()
        ? `版权主体：${ip.copyrightOwner.trim()}`
        : "需要填写版权主体，便于售卖、举报和下架追溯。",
      done: Boolean(ip.copyrightOwner?.trim()),
    },
    {
      key: "rights-statement",
      label: "权利声明",
      description:
        typeof rightsSummary.statement === "string" && rightsSummary.statement.trim()
          ? "已填写权利声明。"
          : "需要说明版权、授权或素材来源承诺。",
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
