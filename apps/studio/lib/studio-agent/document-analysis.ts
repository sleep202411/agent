"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentAttachmentSummary } from "@repo/shared/agent-platform";

import { isStudioAgentDataPart, type StudioAgentUIMessage } from "./transport-contract";

/**
 * Reconcile cadence for a durable document analysis, in schedule order.
 *
 * The job runs for minutes, not seconds, so this settles at a slow backstop
 * instead of the sub-second cadence an upload uses. It mirrors the invocation
 * reconciler: the interval only widens while the tab stays visible, and a
 * resumed tab starts over at the top so a creator who comes back sees the
 * current state immediately.
 */
export const STUDIO_AGENT_DOCUMENT_ANALYSIS_RECONCILE_MS = [2_000, 5_000, 10_000, 15_000] as const;

export type StudioAgentDocumentAnalysisPhase =
  | "queued"
  | "mapping"
  | "reducing"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface StudioAgentDocumentAnalysisView {
  attachmentId: string;
  jobId: string;
  phase: StudioAgentDocumentAnalysisPhase;
  /** Server-computed completion percentage over the job's durable plan. */
  progress: number;
  completedUnits: number;
  totalUnits: number;
  /** The job's structured public failure, never a client-invented one. */
  error: { code: string; message: string; retryable: boolean } | null;
  settled: boolean;
}

export type StudioAgentDocumentAnalysisMap = ReadonlyMap<string, StudioAgentDocumentAnalysisView>;

export const EMPTY_STUDIO_AGENT_DOCUMENT_ANALYSIS: StudioAgentDocumentAnalysisMap = new Map();

/**
 * The attachment's background analysis, as the panel should show it.
 *
 * `status: "ready"` on the attachment itself only means the text was
 * extracted — the analysis that reads the document is a separate durable job
 * that outlives the upload by minutes. Returns `null` for an attachment that
 * has no such job (an image, or a document whose ingest has not finished).
 */
export function projectStudioAgentDocumentAnalysis(
  summary: AgentAttachmentSummary
): StudioAgentDocumentAnalysisView | null {
  const analysis = summary.analysis;
  if (!analysis) return null;
  const phase = toPhase(analysis.status);
  return {
    attachmentId: summary.id,
    jobId: analysis.jobId,
    phase,
    progress: analysis.progress,
    completedUnits: analysis.completedUnits,
    totalUnits: analysis.totalUnits,
    error: analysis.error,
    settled: phase === "succeeded" || phase === "failed" || phase === "cancelled",
  };
}

/**
 * How many of a transcript's documents are reconciled on open.
 *
 * A loaded history page can hold dozens of attachments whose analyses settled
 * long ago; reading every one of them would be a burst of requests to learn
 * nothing. Only the newest few can still be running, and anything older stays
 * exactly as honest as the attachment row already was.
 */
export const STUDIO_AGENT_DOCUMENT_ANALYSIS_TRACKED_LIMIT = 8;

/**
 * Attachment ids worth reconciling, deduplicated and in a stable order.
 *
 * Images never carry an analysis job, so asking for their status would be
 * pure traffic. `messages` is oldest-first, so the newest documents survive
 * the cap.
 */
export function selectStudioAgentDocumentAttachmentIds(
  messages: readonly StudioAgentUIMessage[],
  limit: number = STUDIO_AGENT_DOCUMENT_ANALYSIS_TRACKED_LIMIT
): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isStudioAgentDataPart(part, "studio-agent-attachment")) continue;
      if (part.data.mediaType.startsWith("image/")) continue;
      ids.add(part.data.attachmentId);
    }
  }
  return [...ids].slice(-limit).sort();
}

/**
 * Keeps the panel honest about analyses that are still running.
 *
 * There is no realtime channel for this job — the transport carries the
 * conversation, not the ingest pipeline — so the durable status endpoint is
 * the source. Polling stops the moment every tracked job is terminal, and a
 * hidden tab produces no traffic at all for a job it cannot show.
 */
export function useStudioAgentDocumentAnalysis({
  attachmentIds,
  readStatus,
}: {
  /** Stable, deduplicated; identity changes are ignored, contents are not. */
  attachmentIds: readonly string[];
  readStatus:
    | ((attachmentId: string, signal: AbortSignal) => Promise<AgentAttachmentSummary>)
    | null;
}): StudioAgentDocumentAnalysisMap {
  const [views, setViews] = useState<StudioAgentDocumentAnalysisMap>(
    EMPTY_STUDIO_AGENT_DOCUMENT_ANALYSIS
  );
  const viewsRef = useRef(views);
  const trackedKey = attachmentIds.join(",");

  useEffect(() => {
    const ids = trackedKey ? trackedKey.split(",") : [];
    const tracked = new Set(ids);
    const retained = new Map(
      [...viewsRef.current].filter(([attachmentId]) => tracked.has(attachmentId))
    );
    if (retained.size !== viewsRef.current.size) {
      viewsRef.current = retained;
      setViews(retained);
    }
    if (!readStatus || ids.length === 0) return;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let reconciling = false;

    const unsettled = () => ids.filter((id) => !viewsRef.current.get(id)?.settled);

    const reconcile = async () => {
      if (reconciling || controller.signal.aborted) return;
      const pending = unsettled();
      if (pending.length === 0) return;
      reconciling = true;
      try {
        const results = await Promise.all(
          pending.map((attachmentId) =>
            readStatus(attachmentId, controller.signal).then(
              projectStudioAgentDocumentAnalysis,
              // A failed status read is turbulence, not a verdict. The job is
              // durable; the next tick reconciles it rather than reporting a
              // failure the server never recorded.
              () => null
            )
          )
        );
        if (controller.signal.aborted) return;
        const next = new Map(viewsRef.current);
        let changed = false;
        for (const view of results) {
          if (!view || isSameAnalysis(next.get(view.attachmentId), view)) continue;
          next.set(view.attachmentId, view);
          changed = true;
        }
        if (!changed) return;
        viewsRef.current = next;
        setViews(next);
      } finally {
        reconciling = false;
      }
    };

    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (controller.signal.aborted || isHidden()) return;
      if (unsettled().length === 0) return;
      const delay =
        STUDIO_AGENT_DOCUMENT_ANALYSIS_RECONCILE_MS[
          Math.min(attempt, STUDIO_AGENT_DOCUMENT_ANALYSIS_RECONCILE_MS.length - 1)
        ]!;
      attempt += 1;
      timer = setTimeout(() => void reconcile().then(schedule), delay);
    };

    const resume = () => {
      if (isHidden()) {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        return;
      }
      attempt = 0;
      void reconcile().then(schedule);
    };

    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    void reconcile().then(schedule);
    return () => {
      controller.abort();
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [readStatus, trackedKey]);

  return views;
}

function toPhase(
  status: NonNullable<AgentAttachmentSummary["analysis"]>["status"]
): StudioAgentDocumentAnalysisPhase {
  switch (status) {
    case "queued":
    case "dispatching":
      return "queued";
    case "running":
      return "mapping";
    case "reducing":
      return "reducing";
    case "succeeded":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    // A dead-lettered job has exhausted every durable retry. It is a failure
    // to the creator, whatever the queue calls it.
    case "failed":
    case "dead_lettered":
      return "failed";
  }
}

function isSameAnalysis(
  left: StudioAgentDocumentAnalysisView | undefined,
  right: StudioAgentDocumentAnalysisView
): boolean {
  return (
    left !== undefined &&
    left.jobId === right.jobId &&
    left.phase === right.phase &&
    left.progress === right.progress &&
    left.completedUnits === right.completedUnits &&
    left.totalUnits === right.totalUnits &&
    left.error?.code === right.error?.code &&
    left.error?.message === right.error?.message
  );
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}
