"use client";

import { useEffect, useState } from "react";
import { ensureModeDocument, type ModeDocumentRef } from "./projects-api";

export type ModeDocumentStatus = "loading" | "ready" | "error";

export interface ModeDocumentState {
  document: ModeDocumentRef | null;
  documentId: string | null;
  status: ModeDocumentStatus;
  error: string | null;
}

/**
 * Resolves a route projectId + mode `type` to that mode's collaborative document
 * (idempotently creating it on first open). The returned documentId feeds
 * {@link useCollabDoc}. This is the multi-mode generalization of the old
 * canvas-only resolver.
 */
export function useModeDocument(
  projectId: string | null | undefined,
  type: string
): ModeDocumentState {
  const [state, setState] = useState<ModeDocumentState & { projectId: string; type: string }>();

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    ensureModeDocument(projectId, type, controller.signal)
      .then((document) => {
        if (controller.signal.aborted) return;
        setState({
          projectId,
          type,
          document,
          documentId: document.id,
          error: null,
          status: "ready",
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          projectId,
          type,
          document: null,
          documentId: null,
          error: err instanceof Error ? err.message : "Failed to open document",
          status: "error",
        });
      });
    return () => controller.abort();
  }, [projectId, type]);

  if (!projectId || state?.projectId !== projectId || state.type !== type) {
    return { document: null, documentId: null, status: "loading", error: null };
  }
  return state;
}
