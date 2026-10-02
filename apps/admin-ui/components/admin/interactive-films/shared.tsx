"use client";

import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { adminUiApiPath } from "@/lib/admin-api";
import {
  parseAdminInteractiveFilmBffDetail,
  type AdminInteractiveFilmDetail,
  type InteractiveFilmStatus,
} from "@/lib/interactive-film-admin-contract";
import { cn } from "@/lib/utils";

export function InteractiveFilmStatusPill({ status }: { status: InteractiveFilmStatus }) {
  const tone =
    status === "published"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "reviewing"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : status === "offline"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span
      className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", tone)}
    >
      {interactiveFilmStatusLabel(status)}
    </span>
  );
}

export function InteractiveFilmErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      role="alert"
    >
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

export function InteractiveFilmMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string | undefined;
  tone?: "default" | "warn" | "success" | "risk";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tone === "default" && "border-slate-200 bg-slate-50",
        tone === "warn" && "border-amber-200 bg-amber-50",
        tone === "success" && "border-emerald-200 bg-emerald-50",
        tone === "risk" && "border-red-200 bg-red-50"
      )}
    >
      <p
        className={cn(
          "text-[11px] font-medium",
          tone === "default" && "text-slate-500",
          tone === "warn" && "text-amber-700",
          tone === "success" && "text-emerald-700",
          tone === "risk" && "text-red-600"
        )}
      >
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{value ?? "—"}</p>
    </div>
  );
}

export function InteractiveFilmSuccessBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
      role="status"
    >
      <IconCircleCheck className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export async function requestAdminInteractiveFilm(
  gameId: string,
  init: RequestInit
): Promise<AdminInteractiveFilmDetail> {
  const response = await fetch(
    adminUiApiPath(`/api/admin/interactive-films/${encodeURIComponent(gameId)}`),
    { cache: "no-store", ...init }
  );
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    data?: unknown;
  } | null;
  if (!response.ok || payload?.code !== 200) {
    throw new Error(payload?.msg ?? `影游审核请求失败：${response.status}`);
  }
  return parseAdminInteractiveFilmBffDetail(payload.data);
}

export function interactiveFilmStatusLabel(status: InteractiveFilmStatus): string {
  return {
    draft: "草稿",
    reviewing: "审核中",
    published: "已发布",
    offline: "已下架",
  }[status];
}

export function formatInteractiveFilmDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function interactiveFilmErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "影游审核操作失败。";
}
