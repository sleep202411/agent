"use client";

export function CopilotStatusNotice({
  message,
  actionLabel,
  onAction,
  dismissLabel,
  onDismiss,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Secondary, quieter affordance rendered before the primary action. */
  dismissLabel?: string;
  onDismiss?: () => void;
}) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-2xl bg-white/[0.05] px-3 py-2">
      <p className="min-w-0 flex-1 break-words text-xs leading-5 text-white/58">{message}</p>
      {dismissLabel && onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs font-medium text-white/55 hover:text-white/85 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
        >
          {dismissLabel}
        </button>
      ) : null}
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 text-xs font-semibold text-white/82 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
