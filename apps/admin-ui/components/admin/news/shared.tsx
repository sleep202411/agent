"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

// Canonical PageHeader lives in components/admin/page-header.tsx; re-exported so
// the news panel imports everything from "./shared" like the other modules.
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
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** Labelled form control wrapper (matches the IP panels' inline Field). */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-[12px] font-medium text-slate-600">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** ISO string -> `<input type="datetime-local">` value (local time, no tz). */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** `<input type="datetime-local">` value -> ISO string. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
