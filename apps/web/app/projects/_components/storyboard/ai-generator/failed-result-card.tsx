"use client";

/**
 * Unified failed-task card used across every generation surface
 * (image / video / character fusion / lip-sync audio + video).
 *
 * Default state:
 *   ┌─────────────────────┐
 *   │  Generation failed  │  ← title
 *   │  The request failed │  ← parsed `data.message` (line-clamp-2)
 *   │  because the input… │
 *   └─────────────────────┘
 *
 * Hover state — overlay with three centered actions:
 *   - retry (↻)        → calls `onRetry`
 *   - view details (⚠) → opens an in-card Dialog with the raw payload
 *   - delete (🗑)       → calls `onDelete` (omitted when not provided)
 *
 * The "View details" Dialog renders two sections:
 *   - **Message** — the parsed friendly string (hidden when not parseable)
 *   - **Response** — the full raw error payload, monospace + break-all
 *
 * The card supplies all its own visuals and dialog state — call sites
 * just bind `onRetry` / `onDelete` to their item context and pass a
 * `className` for sizing (typically `aspect-square` or `aspect-video`).
 */

import { useState } from "react";
import { IconAlertTriangleFilled, IconRefresh, IconTrash } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import { extractFriendlyErrorMessage } from "@/src/lib/error-message";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface FailedResultCardProps {
  /** Raw error payload (typically `task.error` / `item.errorMessage`).
   *  Used both to extract the friendly message for the card body and
   *  to display the full response in the details dialog. */
  error?: string | null;
  /** Retry handler. When provided, a retry button shows up in the
   *  hover overlay. The card doesn't know what to retry — the caller
   *  binds the closure with its own item context. */
  onRetry?: () => void;
  /** Delete handler — optional; some surfaces (lip-sync audio) don't
   *  support deletion of failed entries. */
  onDelete?: () => void;
  /** Outer sizing — e.g. `"aspect-square"`, `"aspect-video"`, or a
   *  fixed height utility. Defaults to `aspect-square`. */
  className?: string;
}

export function FailedResultCard({ error, onRetry, onDelete, className }: FailedResultCardProps) {
  const tc = useTranslations("common");
  const [detailOpen, setDetailOpen] = useState(false);
  const hasError = !!error;
  const friendlyMessage = extractFriendlyErrorMessage(error);

  return (
    <div
      className={cn(
        "group/failed relative overflow-hidden rounded-lg border border-destructive/30 bg-destructive/5",
        !className && "aspect-square",
        className
      )}
    >
      {/* Default state — title + parsed message, centered. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center">
        <div className="text-xs font-semibold text-destructive">{tc("generateFailed")}</div>
        {friendlyMessage ? (
          <p
            className="line-clamp-2 text-[11px] leading-relaxed text-destructive/80"
            title={friendlyMessage}
          >
            {friendlyMessage}
          </p>
        ) : null}
      </div>

      {/* Hover state — semi-opaque overlay with retry / warning / delete
          buttons centered both ways. Buttons are pointer-events-none
          while the overlay is invisible so they don't intercept clicks
          aimed at neighbours. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-black/65 opacity-0 transition-opacity group-hover/failed:pointer-events-auto group-hover/failed:opacity-100">
        {onRetry ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            className="flex size-8 items-center justify-center rounded-md bg-black/60 text-white transition-colors hover:bg-primary"
            aria-label={tc("retry")}
          >
            <IconRefresh className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (hasError) setDetailOpen(true);
          }}
          disabled={!hasError}
          className={cn(
            "flex size-8 items-center justify-center rounded-md bg-black/60 text-destructive transition-colors",
            hasError ? "hover:bg-destructive/30" : "cursor-default opacity-50"
          )}
          aria-label={hasError ? tc("viewErrorDetails") : tc("generateFailed")}
        >
          <IconAlertTriangleFilled className="size-4" />
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="flex size-8 items-center justify-center rounded-md bg-black/60 text-white transition-colors hover:bg-destructive"
            aria-label={tc("delete")}
          >
            <IconTrash className="size-4" />
          </button>
        ) : null}
      </div>

      {hasError ? (
        <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{tc("generateFailed")}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <div className="space-y-4">
                {friendlyMessage ? (
                  <div>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {tc("errorMessage")}
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                      {friendlyMessage}
                    </p>
                  </div>
                ) : null}
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {tc("errorResponse")}
                  </div>
                  <pre className="max-h-60 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                    {error}
                  </pre>
                </div>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" color="muted" onClick={() => setDetailOpen(false)}>
                {tc("close")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
