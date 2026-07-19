"use client";

import { IconFileText, IconLoader2, IconX } from "@tabler/icons-react";

/** Compact 1-decimal size label; documents are capped at 10MB. */
export function formatDocumentSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  if (sizeBytes >= 1024) return `${(sizeBytes / 1024).toFixed(1)}KB`;
  return `${sizeBytes}B`;
}

/**
 * Monochrome document chip (composer pending state and transcript rendering).
 * Name + size only — no type icons per format, no color coding.
 */
export function StoryCanvasDocumentChip({
  name,
  sizeBytes,
  uploading = false,
  onRemove,
  removeLabel,
  ariaLabel,
}: {
  name: string;
  sizeBytes: number;
  uploading?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  ariaLabel?: string;
}) {
  return (
    <span
      aria-label={ariaLabel}
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-xl bg-white/[0.08] py-1.5 pr-2 pl-2.5 text-xs text-white/80"
    >
      {uploading ? (
        <IconLoader2 className="size-3.5 shrink-0 animate-spin text-white/55" stroke={1.8} />
      ) : (
        <IconFileText className="size-3.5 shrink-0 text-white/55" stroke={1.8} />
      )}
      <span className="min-w-0 truncate font-medium">{name}</span>
      <span className="shrink-0 text-white/40">{formatDocumentSize(sizeBytes)}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={uploading}
          aria-label={removeLabel}
          className="grid size-4.5 shrink-0 place-items-center text-white/40 transition-colors hover:text-white/80 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:opacity-40"
        >
          <IconX className="size-3" stroke={1.8} />
        </button>
      ) : null}
    </span>
  );
}
