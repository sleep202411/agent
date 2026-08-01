"use client";

import { IconAlertCircle, IconCircleCheck, IconLoader2 } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import type { StudioAgentDocumentAnalysisView } from "@/lib/studio-agent";

export interface StudioAgentDocumentAnalysisLabels {
  /** Names the live region so a screen reader announces what is progressing. */
  region: string;
  queued: string;
  mapping: (progress: number) => string;
  reducing: (progress: number) => string;
  succeeded: string;
  /** Fallback only — a recorded failure shows the server's own message. */
  failed: string;
  cancelled: string;
}

/**
 * The document analysis running behind a "ready" attachment.
 *
 * An attachment turns ready as soon as its text is extracted, but the job that
 * reads the document keeps running for minutes afterwards. Without this the
 * creator sees an idle panel for the entire run and nothing at all when it
 * dies, so this row is the job's only surface: its phase while it runs, its
 * completion, and — verbatim — the structured public error it failed with.
 */
export function StudioAgentAttachmentAnalysis({
  analysis,
  labels,
  className,
}: {
  analysis: StudioAgentDocumentAnalysisView;
  labels: StudioAgentDocumentAnalysisLabels;
  className?: string;
}) {
  const failed = analysis.phase === "failed";
  const running =
    analysis.phase === "queued" || analysis.phase === "mapping" || analysis.phase === "reducing";
  const text = failed
    ? (analysis.error?.message ?? labels.failed)
    : analysis.phase === "queued"
      ? labels.queued
      : analysis.phase === "mapping"
        ? labels.mapping(analysis.progress)
        : analysis.phase === "reducing"
          ? labels.reducing(analysis.progress)
          : analysis.phase === "succeeded"
            ? labels.succeeded
            : labels.cancelled;
  const Icon = failed
    ? IconAlertCircle
    : analysis.phase === "succeeded"
      ? IconCircleCheck
      : IconLoader2;

  return (
    <div className={cn("mt-1.5", className)}>
      <p
        role="status"
        aria-label={labels.region}
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-[10px] text-white/44",
          failed && "text-destructive/82"
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn("size-3 shrink-0", running && "animate-spin motion-reduce:animate-none")}
        />
        <span className="min-w-0 flex-1 truncate">{text}</span>
      </p>
      {running ? (
        <div
          role="progressbar"
          aria-label={`${labels.region}: ${text}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={analysis.progress}
          className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-white/[0.05]"
        >
          <div
            className="h-full bg-white/40 transition-[width] duration-300 ease-out"
            style={{ width: `${analysis.progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
