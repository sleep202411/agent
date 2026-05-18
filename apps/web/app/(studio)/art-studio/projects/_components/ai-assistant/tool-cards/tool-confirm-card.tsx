"use client";

import { IconAlertTriangle, IconCheck, IconX } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";

interface ToolConfirmCardProps {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function ToolConfirmCard({
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
  disabled = false,
}: ToolConfirmCardProps) {
  const t = useTranslations("ai");
  const resolvedConfirmLabel = confirmLabel ?? t("toolConfirm");
  const resolvedCancelLabel = cancelLabel ?? t("toolSkip");

  return (
    <div>
      {/* Header */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/8">
          {destructive ? (
            <IconAlertTriangle className="size-4 text-destructive" />
          ) : (
            <IconCheck className="size-4 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{title}</div>
          {description && (
            <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground/70">
              {description}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 border-t border-white/6 px-4 py-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40"
        >
          {resolvedCancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-40 ${
            destructive
              ? "bg-destructive hover:bg-destructive/90"
              : "bg-primary hover:bg-primary/90"
          }`}
        >
          {resolvedConfirmLabel}
        </button>
      </div>
    </div>
  );
}
