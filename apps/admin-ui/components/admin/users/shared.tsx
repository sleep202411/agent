"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { adminUiApiPath } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

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

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function requestEnvelope<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(adminUiApiPath(url), { cache: "no-store", ...init });
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
