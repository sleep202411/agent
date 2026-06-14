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
  const [document, setDocument] = useState<ModeDocumentRef | null>(null);
  const [status, setStatus] = useState<ModeDocumentStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setStatus("loading");
    ensureModeDocument(projectId, type)
      .then((doc) => {
        if (cancelled) return;
        setDocument(doc);
        setError(null);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to open document");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, type]);

  return {
    document,
    documentId: document?.id ?? null,
    status,
    error,
  };
}
