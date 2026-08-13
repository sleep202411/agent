"use client";

import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import type { TextGameStatus } from "@repo/shared/text-game";
import { adminUiApiPath } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

export function TextGameStatusPill({ status }: { status: TextGameStatus }) {
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
      {textGameStatusLabel(status)}
    </span>
  );
}

export function TextGameErrorBanner({ message }: { message: string }) {
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

export function TextGameSuccessBanner({ message }: { message: string }) {
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

export async function requestAdminTextGame<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(adminUiApiPath(path), { cache: "no-store", ...init });
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    data?: T;
  } | null;
  if (!response.ok || payload?.code !== 200) {
    throw new Error(payload?.msg ?? `文游审核请求失败：${response.status}`);
  }
  return payload.data as T;
}

export function textGameStatusLabel(status: TextGameStatus): string {
  return {
    draft: "草稿",
    reviewing: "审核中",
    published: "已发布",
    offline: "已下架",
  }[status];
}

export function formatTextGameDate(value: string | null | undefined): string {
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

export function textGameErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "文游审核操作失败。";
}
